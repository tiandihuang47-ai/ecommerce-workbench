import { createHash } from "node:crypto";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { deepseekModelId } from "@/lib/deepseek-client";
import { findModel, findProvider } from "@/lib/model-router";
import { commerceImageModelRegistry, commerceImageRegistryModelForProvider } from "@/lib/commerce-image-models";
import type {
  CommerceAssistantProviderStatus,
  CommerceImageProviderStatus,
  ResolvedCommerceImageModel
} from "@/lib/commerce-image-types";

/** 生图通道。阿里云（qwen / 通义万相）已下线，全部走豆包 Seedream 或 GPT Image。 */
export type CommerceImageProvider = "seedream" | "openai" | "openai_v25";
export type CommerceAssistantProvider = "text" | "vision";

interface StoredProviderConfig {
  apiKey?: string;
  workspaceId?: string;
  baseUrl?: string;
  modelId?: string;
  lastVerifiedAt?: string;
  verificationFingerprint?: string;
}

interface StoredCommerceImageConfig {
  version: 2;
  providers: Partial<Record<CommerceImageProvider, StoredProviderConfig>>;
  assistants: Partial<Record<CommerceAssistantProvider, StoredProviderConfig>>;
}

export interface ResolvedProviderConfig {
  provider: CommerceImageProvider;
  apiKey: string;
  workspaceId: string;
  baseUrl: string;
  modelId: string;
  source: "local" | "environment" | "none";
  lastVerifiedAt: string;
  verifiedForCurrentConfig: boolean;
}

export interface ResolvedAssistantConfig {
  provider: CommerceAssistantProvider;
  apiKey: string;
  baseUrl: string;
  modelId: string;
  source: "local" | "environment" | "none";
  lastVerifiedAt: string;
  verifiedForCurrentConfig: boolean;
}

export function commerceImageDataRoot() {
  return process.env.COMMERCE_IMAGE_DATA_DIR
    || (process.env.DIRECTOR_RUNTIME_DIR ? path.join(process.env.DIRECTOR_RUNTIME_DIR, "commerce-image") : "")
    || path.join(process.cwd(), ".director-platform-data", "commerce-image");
}

export async function ensureCommerceImageDataRoot() {
  const root = commerceImageDataRoot();
  await mkdir(root, { recursive: true, mode: 0o700 });
  return root;
}

export async function getResolvedProviderConfig(provider: CommerceImageProvider): Promise<ResolvedProviderConfig> {
  const stored = (await readStoredConfig()).providers[provider] || {};
  const environment = environmentProviderConfig(provider);
  const apiKey = stored.apiKey?.trim() || environment.apiKey;
  const workspaceId = stored.workspaceId?.trim() || environment.workspaceId;
  const baseUrl = normalizeBaseUrl(stored.baseUrl?.trim() || environment.baseUrl || defaultBaseUrl(provider));
  const modelId = stored.modelId?.trim() || environment.modelId || defaultProviderModelId(provider);
  const fingerprint = configFingerprint({ apiKey, workspaceId, baseUrl, modelId });
  return {
    provider,
    apiKey,
    workspaceId,
    baseUrl,
    modelId,
    source: stored.apiKey?.trim() ? "local" : apiKey ? "environment" : "none",
    lastVerifiedAt: stored.lastVerifiedAt || "",
    verifiedForCurrentConfig: Boolean(stored.lastVerifiedAt && stored.verificationFingerprint === fingerprint)
  };
}

export async function getResolvedAssistantConfig(provider: CommerceAssistantProvider): Promise<ResolvedAssistantConfig> {
  const stored = (await readStoredConfig()).assistants[provider] || {};
  const environment = environmentAssistantConfig(provider);
  const apiKey = stored.apiKey?.trim() || environment.apiKey;
  const baseUrl = normalizeBaseUrl(stored.baseUrl?.trim() || environment.baseUrl);
  /* 文本助手的 modelId 只是历史连接配置的展示字段：
   * 「某功能用哪个模型」现在由 config/model-routing.yaml 决定，不再由界面配置决定。 */
  const modelId = stored.modelId?.trim() || environment.modelId;
  const fingerprint = configFingerprint({ apiKey, workspaceId: "", baseUrl, modelId });
  return {
    provider,
    apiKey,
    baseUrl,
    modelId,
    source: stored.apiKey?.trim() ? "local" : apiKey ? "environment" : "none",
    lastVerifiedAt: stored.lastVerifiedAt || "",
    verifiedForCurrentConfig: Boolean(stored.lastVerifiedAt && stored.verificationFingerprint === fingerprint)
  };
}

export async function listCommerceImageProviderStatuses(): Promise<CommerceImageProviderStatus[]> {
  const providers: CommerceImageProvider[] = ["seedream", "openai", "openai_v25"];
  return Promise.all(providers.map(async (provider) => {
    const config = await getResolvedProviderConfig(provider);
    const model = modelForProvider(provider);
    return {
      provider,
      label: provider === "seedream" ? "豆包 Seedream" : provider === "openai_v25" ? "OpenAI GPT Image 2.5" : commerceImageModelRegistry[model].label,
      modelId: model,
      providerModelId: config.modelId,
      configured: Boolean(config.apiKey),
      maskedKey: maskSecret(config.apiKey),
      source: config.source,
      workspaceId: undefined,
      baseUrl: config.baseUrl,
      lastVerifiedAt: config.lastVerifiedAt,
      verifiedForCurrentConfig: config.verifiedForCurrentConfig,
      message: statusMessage(Boolean(config.apiKey), config.verifiedForCurrentConfig, config.lastVerifiedAt)
    };
  }));
}

export async function listCommerceAssistantStatuses(): Promise<CommerceAssistantProviderStatus[]> {
  const providers: CommerceAssistantProvider[] = ["text", "vision"];
  return Promise.all(providers.map(async (provider) => {
    const config = await getResolvedAssistantConfig(provider);
    return {
      provider,
      label: provider === "text" ? "DeepSeek 文本与对话" : "豆包视觉理解（火山方舟）",
      configured: Boolean(config.apiKey),
      maskedKey: maskSecret(config.apiKey),
      source: config.source,
      baseUrl: config.baseUrl,
      modelId: config.modelId,
      lastVerifiedAt: config.lastVerifiedAt,
      verifiedForCurrentConfig: config.verifiedForCurrentConfig,
      message: statusMessage(Boolean(config.apiKey), config.verifiedForCurrentConfig, config.lastVerifiedAt)
    };
  }));
}

export async function saveCommerceImageProviderConfig(provider: CommerceImageProvider, patch: {
  apiKey?: string;
  workspaceId?: string;
  baseUrl?: string;
  modelId?: string;
}) {
  const current = await readStoredConfig();
  current.providers[provider] = applyConfigPatch(current.providers[provider] || {}, patch);
  await writeStoredConfig(current);
  return getResolvedProviderConfig(provider);
}

export async function saveCommerceAssistantConfig(provider: CommerceAssistantProvider, patch: {
  apiKey?: string;
  baseUrl?: string;
  modelId?: string;
}) {
  const current = await readStoredConfig();
  current.assistants[provider] = applyConfigPatch(current.assistants[provider] || {}, patch);
  await writeStoredConfig(current);
  return getResolvedAssistantConfig(provider);
}

export async function markCommerceImageProviderVerified(provider: CommerceImageProvider) {
  const current = await readStoredConfig();
  const resolved = await getResolvedProviderConfig(provider);
  current.providers[provider] = {
    ...(current.providers[provider] || {}),
    lastVerifiedAt: new Date().toISOString(),
    verificationFingerprint: configFingerprint(resolved)
  };
  await writeStoredConfig(current);
}

export async function markCommerceAssistantVerified(provider: CommerceAssistantProvider) {
  const current = await readStoredConfig();
  const resolved = await getResolvedAssistantConfig(provider);
  current.assistants[provider] = {
    ...(current.assistants[provider] || {}),
    lastVerifiedAt: new Date().toISOString(),
    verificationFingerprint: configFingerprint({ ...resolved, workspaceId: "" })
  };
  await writeStoredConfig(current);
}

export async function deleteCommerceImageProviderConfig(provider: CommerceImageProvider) {
  const current = await readStoredConfig();
  delete current.providers[provider];
  await cleanOrWriteConfig(current);
}

export async function deleteCommerceAssistantConfig(provider: CommerceAssistantProvider) {
  const current = await readStoredConfig();
  delete current.assistants[provider];
  await cleanOrWriteConfig(current);
}

export function isCommerceImageProvider(value: unknown): value is CommerceImageProvider {
  return value === "seedream" || value === "openai" || value === "openai_v25";
}

export function isCommerceAssistantProvider(value: unknown): value is CommerceAssistantProvider {
  return value === "text" || value === "vision";
}

export function modelForProvider(provider: CommerceImageProvider): ResolvedCommerceImageModel {
  /* 返回 UI 模型注册表键；真实 Provider model_id 由 getResolvedProviderConfig 从 models.yaml 解析。 */
  return commerceImageRegistryModelForProvider(provider);
}

export function providerForModel(model: ResolvedCommerceImageModel): CommerceImageProvider {
  return commerceImageModelRegistry[model].provider;
}

async function configPath() {
  return path.join(await ensureCommerceImageDataRoot(), "providers.json");
}

async function readStoredConfig(): Promise<StoredCommerceImageConfig> {
  try {
    const parsed = JSON.parse(await readFile(await configPath(), "utf8")) as {
      providers?: StoredCommerceImageConfig["providers"];
      assistants?: StoredCommerceImageConfig["assistants"];
    };
    return {
      version: 2,
      providers: parsed.providers && typeof parsed.providers === "object" ? parsed.providers : {},
      assistants: parsed.assistants && typeof parsed.assistants === "object" ? parsed.assistants : {}
    };
  } catch {
    return { version: 2, providers: {}, assistants: {} };
  }
}

async function writeStoredConfig(config: StoredCommerceImageConfig) {
  const target = await configPath();
  const temp = `${target}.${Date.now()}.tmp`;
  await writeFile(temp, JSON.stringify(config, null, 2), { encoding: "utf8", mode: 0o600 });
  await rename(temp, target);
}

async function cleanOrWriteConfig(config: StoredCommerceImageConfig) {
  if (!Object.keys(config.providers).length && !Object.keys(config.assistants).length) {
    try {
      await unlink(await configPath());
    } catch { /* 文件不存在时无需处理 */ }
    return;
  }
  await writeStoredConfig(config);
}

function applyConfigPatch(previous: StoredProviderConfig, patch: {
  apiKey?: string;
  workspaceId?: string;
  baseUrl?: string;
  modelId?: string;
}) {
  const next: StoredProviderConfig = {
    ...previous,
    workspaceId: patch.workspaceId === undefined ? previous.workspaceId : patch.workspaceId.trim(),
    baseUrl: patch.baseUrl === undefined ? previous.baseUrl : normalizeBaseUrl(patch.baseUrl.trim()),
    modelId: patch.modelId === undefined ? previous.modelId : patch.modelId.trim(),
    lastVerifiedAt: previous.lastVerifiedAt,
    verificationFingerprint: previous.verificationFingerprint
  };
  if (patch.apiKey !== undefined && patch.apiKey.trim()) next.apiKey = patch.apiKey.trim();
  const changed = next.apiKey !== previous.apiKey
    || next.workspaceId !== previous.workspaceId
    || next.baseUrl !== previous.baseUrl
    || next.modelId !== previous.modelId;
  if (changed) {
    next.lastVerifiedAt = "";
    next.verificationFingerprint = "";
  }
  return next;
}

function environmentProviderConfig(provider: CommerceImageProvider) {
  if (provider === "seedream") {
    return {
      apiKey: process.env.COMMERCE_SEEDREAM_API_KEY || process.env.ARK_API_KEY || "",
      workspaceId: "",
      baseUrl: process.env.COMMERCE_SEEDREAM_BASE_URL || "",
      modelId: process.env.COMMERCE_SEEDREAM_MODEL || ""
    };
  }
  if (provider === "openai") {
    return {
      apiKey: process.env.COMMERCE_OPENAI_API_KEY || process.env.OPENAI_API_KEY || "",
      workspaceId: "",
      baseUrl: process.env.COMMERCE_OPENAI_BASE_URL || "",
      modelId: process.env.COMMERCE_OPENAI_MODEL || ""
    };
  }
  return {
    apiKey: process.env.ORIGIN_GATEWAY_API_KEY || "",
    workspaceId: "",
    baseUrl: normalizeOriginGatewayBaseUrl(process.env.ORIGIN_GATEWAY_BASE_URL || ""),
    modelId: process.env.COMMERCE_OPENAI_V25_MODEL || ""
  };
}

function environmentAssistantConfig(provider: CommerceAssistantProvider) {
  if (provider === "vision") {
    return {
      apiKey: process.env.REPLICA_VISION_API_KEY || process.env.ARK_API_KEY || process.env.DOUBAO_API_KEY || "",
      baseUrl: process.env.REPLICA_VISION_BASE_URL || process.env.ARK_BASE_URL || "https://ark.cn-beijing.volces.com/api/v3",
      modelId: findModel("doubao_vision").modelId
    };
  }
  return {
    apiKey: process.env.DEEPSEEK_API_KEY || "",
    baseUrl: process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com",
    modelId: deepseekModelId()
  };
}

function defaultProviderModelId(provider: CommerceImageProvider) {
  const alias = provider === "seedream" ? "seedream_5_pro" : provider === "openai_v25" ? "gpt_image_2_5" : "gpt_image_2";
  return findModel(alias).modelId;
}

function defaultBaseUrl(provider: CommerceImageProvider) {
  const alias = provider === "seedream" ? "seedream_5_pro" : provider === "openai_v25" ? "gpt_image_2_5" : "gpt_image_2";
  return findProvider(findModel(alias).provider).baseUrl;
}

function normalizeBaseUrl(value: string) {
  return value.replace(/\/+$/, "");
}

/** OriginGateway 常被配置成裸域名（无路径）；生图端点需要 /v1 前缀，裸域名时补上。 */
function normalizeOriginGatewayBaseUrl(value: string) {
  const trimmed = normalizeBaseUrl(value);
  if (!trimmed) return "";
  try {
    const url = new URL(trimmed);
    if (url.pathname === "" || url.pathname === "/") return `${trimmed}/v1`;
  } catch {
    return trimmed;
  }
  return trimmed;
}

function maskSecret(secret: string) {
  if (!secret) return "";
  const prefix = secret.slice(0, Math.min(secret.length > 8 ? 3 : 1, secret.length));
  const suffix = secret.length > 4 ? secret.slice(-4) : "";
  return `${prefix}${"•".repeat(Math.max(4, Math.min(10, secret.length - prefix.length - suffix.length)))}${suffix}`;
}

function configFingerprint(value: { apiKey: string; workspaceId?: string; baseUrl: string; modelId: string }) {
  return createHash("sha256")
    .update(`${value.apiKey}\u0000${value.workspaceId || ""}\u0000${value.baseUrl}\u0000${value.modelId}`)
    .digest("hex");
}

function statusMessage(configured: boolean, verified: boolean, lastVerifiedAt: string) {
  if (!configured) return "未配置";
  if (verified) return "当前配置已验证";
  return lastVerifiedAt ? "配置已变化，请重新验证" : "已配置，尚未连接验证";
}
