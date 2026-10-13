import { readFileSync } from "node:fs";
import path from "node:path";
import { parse as parseYaml } from "yaml";
import { configSignature, effectiveConfigDir, localConnectionKey, redactLocalSecrets } from "./profile-store";

/**
 * Model Router · 配置层
 *
 * 唯一事实来源：
 *   config/models.yaml        —— Provider + 模型注册表（这个模型是谁、怎么连）
 *   config/model-routing.yaml —— 业务功能 → 模型（哪个功能用哪个模型）
 *
 * 业务代码只允许调用 resolveRoute("<route_key>")，不允许自己写 model id / base URL / API Key。
 * 配置写错时**明确报错**，不会静默回退到别的模型。
 */

export type ProviderProtocol = "openai_compatible" | "anthropic_compatible" | "image_generation";
export type Capability = "text" | "vision" | "structured_output" | "image_generation" | "speech_to_text";

export interface ProviderDef {
  name: string;
  label: string;
  protocol: ProviderProtocol;
  baseUrl: string;
  baseUrlEnv?: string;
  apiKeyEnv?: string;
  apiKeyFallbackEnv?: string;
  connectionStore?: string;
  imageAdapter?: "openai" | "seedream";
  audioFormat?: "chat" | "transcriptions";
}

export interface ModelDef {
  alias: string;
  label: string;
  provider: string;
  modelId: string;
  capabilities: Capability[];
  defaultTimeoutMs?: number;
}

export interface RouteDef {
  key: string;
  label: string;
  model: string;
  capability: Capability;
  temperature?: number;
  maxTokens?: number;
  fallback?: string;
  fallbackModels?: string[];
  retouchModels?: string[];
}

export interface ResolvedProvider {
  name: string;
  label: string;
  protocol: ProviderProtocol;
  baseUrl: string;
  apiKey: string;
  apiKeyEnv: string;
  connectionStore?: string;
}

export interface ResolvedRoute {
  routeKey: string;
  label: string;
  modelAlias: string;
  modelId: string;
  provider: ResolvedProvider;
  capabilities: Capability[];
  capability: Capability;
  temperature?: number;
  maxTokens?: number;
  timeoutMs: number;
  /** 主模型不可用时允许回退的模型（未配置则为空）。 */
  fallbackAlias?: string;
  fallbackModelId?: string;
  /** 生图路由专用：自动推荐时的候选顺序。 */
  modelAliasChain: string[];
}

interface Catalog {
  providers: ProviderDef[];
  models: ModelDef[];
}

const DEFAULT_MODEL_ID = new Map<string, string>();

export class ModelRoutingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ModelRoutingError";
  }
}

function configDir() {
  return effectiveConfigDir();
}

function readYamlFile(fileName: string): Record<string, unknown> {
  const filePath = path.join(configDir(), fileName);
  let raw: string;
  try {
    raw = readFileSync(filePath, "utf8");
  } catch {
    throw new ModelRoutingError(`找不到模型配置文件：${filePath}。请确认 config/ 目录随代码一起部署。`);
  }
  try {
    return (parseYaml(raw) || {}) as Record<string, unknown>;
  } catch (error) {
    throw new ModelRoutingError(`模型配置文件不是合法 YAML：${filePath}（${error instanceof Error ? error.message : "解析失败"}）`);
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function asString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value.trim() : fallback;
}

function asStringList(value: unknown): string[] {
  return Array.isArray(value) ? value.map((item) => String(item).trim()).filter(Boolean) : [];
}

function asNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

let catalogCache: Catalog | null = null;
let routeCache: RouteDef[] | null = null;
let cachedSignature = "";

function refreshConfig() {
  const signature = configSignature();
  if (signature !== cachedSignature) {
    resetModelRouterCache();
    cachedSignature = signature;
  }
}

/** 清空缓存（测试 / 手工重载用）。 */
export function resetModelRouterCache() {
  catalogCache = null;
  routeCache = null;
  DEFAULT_MODEL_ID.clear();
  cachedSignature = "";
}

export function loadModelCatalog(): Catalog {
  refreshConfig();
  if (catalogCache) return catalogCache;
  const doc = readYamlFile("models.yaml");
  const providers = Object.entries(asRecord(doc.providers)).map(([name, value]): ProviderDef => {
    const record = asRecord(value);
    const protocol = asString(record.protocol, "openai_compatible") as ProviderProtocol;
    return {
      name: name.trim(),
      label: asString(record.label, name.trim()),
      protocol,
      baseUrl: asString(record.base_url),
      baseUrlEnv: asString(record.base_url_env) || undefined,
      apiKeyEnv: asString(record.api_key_env) || undefined,
      apiKeyFallbackEnv: asString(record.api_key_fallback_env) || undefined,
      connectionStore: asString(record.connection_store) || undefined,
      imageAdapter: record.image_adapter as ProviderDef["imageAdapter"],
      audioFormat: record.audio_format as ProviderDef["audioFormat"]
    };
  });
  const models = Object.entries(asRecord(doc.models)).map(([alias, value]): ModelDef => {
    const record = asRecord(value);
    const modelId = asString(record.model_id);
    DEFAULT_MODEL_ID.set(alias.trim(), modelId);
    return {
      alias: alias.trim(),
      label: asString(record.label, alias.trim()),
      provider: asString(record.provider),
      modelId,
      capabilities: asStringList(record.capabilities) as Capability[],
      defaultTimeoutMs: asNumber(record.default_timeout_ms)
    };
  });
  catalogCache = { providers, models };
  return catalogCache;
}

export function loadRouteTable(): RouteDef[] {
  refreshConfig();
  if (routeCache) return routeCache;
  const doc = readYamlFile("model-routing.yaml");
  const routesNode = asRecord(doc.routes);
  routeCache = Object.entries(routesNode).map(([key, value]): RouteDef => {
    const record = asRecord(value);
    const fallbackRaw = asString(record.fallback);
    return {
      key: key.trim(),
      label: asString(record.label, key.trim()),
      model: asString(record.model),
      capability: asString(record.capability, "text") as Capability,
      temperature: asNumber(record.temperature),
      maxTokens: asNumber(record.max_tokens),
      fallback: fallbackRaw && fallbackRaw !== "none" ? fallbackRaw : undefined,
      fallbackModels: asStringList(record.fallback_models),
      retouchModels: asStringList(record.retouch_models)
    };
  });
  return routeCache;
}

export function findProvider(name: string): ProviderDef {
  const catalog = loadModelCatalog();
  const provider = catalog.providers.find((item) => item.name === name);
  if (!provider) {
    throw new ModelRoutingError(`模型配置引用了不存在的 Provider "${name}"。可用 Provider：${catalog.providers.map((item) => item.name).join(", ")}。`);
  }
  return provider;
}

export function findModel(alias: string): ModelDef {
  const catalog = loadModelCatalog();
  const model = catalog.models.find((item) => item.alias === alias);
  if (!model) {
    throw new ModelRoutingError(`引用了不存在的模型 "${alias}"。请在 config/models.yaml 注册它，或改成可用模型：${catalog.models.map((item) => item.alias).join(", ")}。`);
  }
  if (!model.modelId) {
    throw new ModelRoutingError(`模型 "${alias}" 缺少 model_id（config/models.yaml）。`);
  }
  return model;
}

/** 解析 Provider 的连接信息：环境变量优先于默认地址；Key 来自私有本机连接或原环境变量。 */
export function resolveProvider(provider: ProviderDef): ResolvedProvider {
  const baseUrl = (provider.baseUrlEnv ? process.env[provider.baseUrlEnv] : "") || provider.baseUrl;
  if (!baseUrl) {
    throw new ModelRoutingError(`Provider "${provider.name}" 缺少 base_url（config/models.yaml）。`);
  }
  const keyEnv = provider.apiKeyEnv || provider.apiKeyFallbackEnv || "";
  const apiKey = localConnectionKey(provider.connectionStore) ?? ((provider.apiKeyEnv ? process.env[provider.apiKeyEnv] : "")
    || (provider.apiKeyFallbackEnv ? process.env[provider.apiKeyFallbackEnv] : "")
    || "");
  return {
    name: provider.name,
    label: provider.label,
    protocol: provider.protocol,
    baseUrl: baseUrl.replace(/\/+$/, ""),
    apiKey,
    apiKeyEnv: keyEnv,
    connectionStore: provider.connectionStore
  };
}

/** 某个 Provider 的 API Key 是否已配置（状态展示用；不返回 Key 值）。 */
export function isProviderConfigured(providerName: string) {
  return Boolean(resolveProvider(findProvider(providerName)).apiKey);
}

export function resolveRoute(routeKey: string): ResolvedRoute {
  const routes = loadRouteTable();
  const route = routes.find((item) => item.key === routeKey);
  if (!route) {
    throw new ModelRoutingError(`没有这个功能 Route："${routeKey}"。请检查 config/model-routing.yaml 里的 routes，或告诉 Harness 新增 Route。可用 Route：${routes.map((item) => item.key).join(", ")}。`);
  }
  if (!route.model) {
    throw new ModelRoutingError(`Route "${routeKey}" 没有写 model（config/model-routing.yaml）。`);
  }
  const model = findModel(route.model);
  if (!model.capabilities.includes(route.capability)) {
    throw new ModelRoutingError(
      `Route "${routeKey}" 需要 "${route.capability}" 能力，但模型 "${route.model}"（${model.modelId}）只有 [${model.capabilities.join(", ")}]。`
      + ` 请在 config/models.yaml 换用具备该能力的模型，或修改 config/model-routing.yaml。`
    );
  }
  const providerDef = findProvider(model.provider);
  const provider = resolveProvider(providerDef);
  const fallbackModel = route.fallback ? findModel(route.fallback) : undefined;

  return {
    routeKey: route.key,
    label: route.label,
    modelAlias: model.alias,
    modelId: model.modelId,
    provider,
    capabilities: model.capabilities,
    capability: route.capability,
    temperature: route.temperature,
    maxTokens: route.maxTokens,
    timeoutMs: model.defaultTimeoutMs ?? 180000,
    fallbackAlias: fallbackModel?.alias,
    fallbackModelId: fallbackModel?.modelId,
    modelAliasChain: [model.alias, ...(route.fallbackModels ?? []).filter((item) => item !== model.alias)]
  };
}

/** 生图路由专用：按任务类型取候选模型顺序（保留现有“自动推荐”行为）。 */
export function resolveImageModelChain(kind: string): ResolvedRoute {
  const route = resolveRoute("image_generation");
  const retouch = route.capability === "image_generation" ? routeAlignedRetouch() : [];
  const chain = kind === "retouch" && retouch.length
    ? retouch
    : route.modelAliasChain;
  return { ...route, modelAliasChain: chain };
}

function routeAlignedRetouch(): string[] {
  const routes = loadRouteTable();
  return routes.find((item) => item.key === "image_generation")?.retouchModels ?? [];
}

export interface RouteOverviewEntry {
  routeKey: string;
  label: string;
  modelAlias: string;
  modelId: string;
  providerName: string;
  providerLabel: string;
  protocol: ProviderProtocol;
  apiKeyEnv: string;
  configured: boolean;
  fallbackAlias?: string;
  capability: Capability;
}

/** 给文档 / 设置页「模型路由总览」用的只读快照（不含任何 Key 值）。 */
export function listRouteOverview(): RouteOverviewEntry[] {
  return loadRouteTable().map((route) => {
    const resolved = resolveRoute(route.key);
    return {
      routeKey: route.key,
      label: route.label,
      modelAlias: resolved.modelAlias,
      modelId: resolved.modelId,
      providerName: resolved.provider.name,
      providerLabel: resolved.provider.label,
      protocol: resolved.provider.protocol,
      apiKeyEnv: resolved.provider.apiKeyEnv,
      configured: Boolean(resolved.provider.apiKey),
      fallbackAlias: resolved.fallbackAlias,
      capability: resolved.capability
    };
  });
}

/** 启动校验：配置引用的模型 / Provider / capability 是否自洽。 */
export function validateModelRouting(): { ok: boolean; errors: string[]; warnings: string[] } {
  const errors: string[] = [];
  const warnings: string[] = [];
  try {
    const catalog = loadModelCatalog();
    const modelAliases = new Set(catalog.models.map((item) => item.alias));
    const providerNames = new Set(catalog.providers.map((item) => item.name));

    for (const model of catalog.models) {
      if (!providerNames.has(model.provider)) {
        errors.push(`模型 "${model.alias}" 引用了不存在的 Provider "${model.provider}"。可用 Provider：${[...providerNames].join(", ")}。`);
      }
      if (!model.capabilities.length) errors.push(`模型 "${model.alias}" 没有声明 capabilities。`);
      if (!model.modelId) errors.push(`模型 "${model.alias}" 缺少 model_id。`);
    }

    for (const route of loadRouteTable()) {
      if (!modelAliases.has(route.model)) {
        errors.push(`功能 Route "${route.key}" 引用了不存在的模型 "${route.model}"。可用模型：${[...modelAliases].join(", ")}。`);
        continue;
      }
      try {
        const resolved = resolveRoute(route.key);
        if (!resolved.provider.apiKey) {
          warnings.push(`Route "${route.key}" 需要的 ${resolved.provider.apiKeyEnv || "API Key"} 还没配置，这个功能暂时不可用。`);
        }
      } catch (error) {
        errors.push(error instanceof Error ? error.message : String(error));
      }
      if (route.fallback && !modelAliases.has(route.fallback)) {
        errors.push(`Route "${route.key}" 的 fallback 引用了不存在的模型 "${route.fallback}"。`);
      }
    }
  } catch (error) {
    errors.push(error instanceof Error ? error.message : String(error));
  }
  return { ok: errors.length === 0, errors, warnings };
}

export function assertModelRoutingValid() {
  const result = validateModelRouting();
  if (!result.ok) {
    throw new ModelRoutingError(`模型路由配置有误：\n- ${result.errors.join("\n- ")}`);
  }
  return result;
}

/** 统一的调用日志：只记录 route / model / provider / 耗时，绝不记录 Key。 */
export function logModelCall(options: {
  routeKey: string;
  modelAlias: string;
  modelId: string;
  provider: string;
  durationMs: number;
  status: "success" | "failed";
  source?: string;
  reason?: string;
}) {
  const parts = [
    `[MODEL_CALL] route=${options.routeKey}`,
    `model=${options.modelId}`,
    `alias=${options.modelAlias}`,
    `provider=${options.provider}`,
    `duration=${(options.durationMs / 1000).toFixed(1)}s`,
    `status=${options.status}`
  ];
  if (options.source) parts.push(`source=${options.source}`);
  if (options.reason) parts.push(`reason=${redactLocalSecrets(options.reason).slice(0, 200)}`);
  const line = parts.join(" ");
  if (options.status === "success") console.info(line);
  else console.warn(line);
}
