import { createHash, randomUUID } from "node:crypto";
import { closeSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { parseDocument } from "yaml";
import { activeProfileDir, baseConfigDir, configSignature, profileRoot } from "./profile-store";
import { loadModelCatalog, loadRouteTable, resetModelRouterCache, resolveRoute } from "./config";
import { kindCapabilities, type ApiSetupSummary, type ConnectionProtocol, type ModelKind, type SetupCapability } from "./settings-types";

interface Connection { id: string; name: string; baseUrl: string; protocol: ConnectionProtocol; apiKey: string }
interface SetupModel { alias: string; connectionId: string; modelId: string; kind: ModelKind; verifiedAt?: string }
interface State {
  connections: Connection[];
  models: SetupModel[];
  defaults: Partial<Record<SetupCapability, string>>;
  overrides: Record<string, string>;
}
export class SetupError extends Error { constructor(message: string, public status = 400) { super(message); } }
const empty = (): State => ({ connections: [], models: [], defaults: {}, overrides: {} });
function readState(): State {
  const dir = activeProfileDir();
  return dir ? JSON.parse(readFileSync(path.join(dir, "connections.json"), "utf8")) : empty();
}
function revision() { return createHash("sha256").update(configSignature()).digest("hex"); }
function text(value: unknown, max = 300): string {
  if (typeof value !== "string" || value.length > max) throw new SetupError("配置内容为空或过长。");
  return value.trim();
}
function endpoint(value: unknown) {
  const url = new URL(text(value, 1000));
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new SetupError("API 地址必须是完整的 HTTP(S) 地址，不要包含密码或查询参数。");
  return url.toString().replace(/\/+$/, "");
}
function connectionFrom(body: Record<string, unknown>, state: State): Connection {
  const id = body.connectionId ? text(body.connectionId, 80) : randomUUID();
  const previous = state.connections.find((c) => c.id === id);
  if (body.connectionId && !previous) throw new SetupError("API 连接不存在，请刷新页面。");
  const key = typeof body.apiKey === "string" ? text(body.apiKey, 4096) : "";
  const protocol = body.protocol || previous?.protocol || "openai_compatible";
  if (protocol !== "openai_compatible" && protocol !== "anthropic_compatible") throw new SetupError("不支持该接口协议。");
  const baseUrl = endpoint(body.baseUrl || previous?.baseUrl);
  const name = text(body.name || previous?.name || new URL(baseUrl).hostname, 80);
  if (!name) throw new SetupError("请填写连接名称。");
  if (!key && !previous?.apiKey) throw new SetupError("请填写自己的 API Key。");
  return { id, name, baseUrl, protocol, apiKey: key || previous!.apiKey };
}

export function getApiSetupSummary(): ApiSetupSummary {
  const state = readState();
  const catalog = loadModelCatalog();
  return {
    revision: revision(),
    connections: state.connections.map(({ id, name, baseUrl, protocol, apiKey }) => ({ id, name, baseUrl, protocol, configured: Boolean(apiKey) })),
    models: catalog.models.map((model) => {
      const local = state.models.find((m) => m.alias === model.alias);
      const provider = catalog.providers.find((p) => p.name === model.provider)!;
      const configured = local ? Boolean(state.connections.find((c) => c.id === local.connectionId)?.apiKey) : Boolean(provider && (provider.apiKeyEnv && process.env[provider.apiKeyEnv] || provider.apiKeyFallbackEnv && process.env[provider.apiKeyFallbackEnv]));
      return { alias: model.alias, label: model.label, modelId: model.modelId, capabilities: model.capabilities, configured, connectionId: local?.connectionId, kind: local?.kind, verifiedAt: local?.verifiedAt };
    }),
    defaults: state.defaults,
    overrides: state.overrides,
    presets: catalog.providers.filter((p) => !p.connectionStore?.startsWith("local:") && p.protocol !== "image_generation").map((p) => ({ name: p.label, baseUrl: p.baseUrl, protocol: p.protocol as ConnectionProtocol })),
    routes: loadRouteTable().map((r) => { const resolved = resolveRoute(r.key); return { key: r.key, label: r.label, capability: r.capability, alias: r.model, modelId: resolved.modelId, configured: Boolean(resolved.provider.apiKey) }; })
  };
}

// Readers see either the previous complete profile or the next complete profile.
// The checked-in YAML and original environment/provider secrets are never rewritten.
function mutate(expected: unknown, edit: (state: State) => void) {
  const root = profileRoot();
  mkdirSync(root, { recursive: true, mode: 0o700 });
  const lock = path.join(root, "write.lock");
  let fd: number;
  try { fd = openSync(lock, "wx", 0o600); } catch { throw new SetupError("另一项配置正在保存，请稍后刷新重试。", 409); }
  let target = "";
  try {
    if (expected !== revision()) throw new SetupError("配置已在其他页面更新，请刷新后重试。", 409);
    const state = readState();
    edit(state);
    const modelsDoc = parseDocument(readFileSync(path.join(baseConfigDir(), "models.yaml"), "utf8"));
    const routesDoc = parseDocument(readFileSync(path.join(baseConfigDir(), "model-routing.yaml"), "utf8"));
    if (modelsDoc.errors.length || routesDoc.errors.length) throw new SetupError("原模型配置不是合法 YAML，请先修复。", 500);
    for (const model of state.models) {
      const c = state.connections.find((item) => item.id === model.connectionId);
      if (!c) throw new SetupError("模型引用的连接不存在。");
      const provider = `local_${c.id.replace(/-/g, "")}_${model.kind}`;
      const cap = kindCapabilities[model.kind];
      modelsDoc.setIn(["providers", provider], { label: c.name, protocol: cap === "image_generation" ? "image_generation" : c.protocol, base_url: c.baseUrl, connection_store: `local:${c.id}`, ...(cap === "image_generation" ? { image_adapter: model.kind === "image_seedream" ? "seedream" : "openai" } : {}), ...(cap === "speech_to_text" ? { audio_format: model.kind === "audio_transcriptions" ? "transcriptions" : "chat" } : {}) });
      modelsDoc.setIn(["models", model.alias], { label: `${c.name} · ${model.modelId}`, provider, model_id: model.modelId, capabilities: cap === "text" ? ["text", "structured_output"] : [cap], default_timeout_ms: 180000 });
    }
    const models = modelsDoc.toJS().models;
    for (const [key, route] of Object.entries(routesDoc.toJS().routes) as [string, { capability?: SetupCapability }][]) {
      const cap = route.capability || "text";
      const alias = state.overrides[key] || state.defaults[cap];
      if (!alias) continue;
      if (!models[alias]?.capabilities?.includes(cap)) throw new SetupError(`模型不支持此功能需要的${cap}能力。`);
      routesDoc.setIn(["routes", key, "model"], alias);
      routesDoc.setIn(["routes", key, "fallback"], "none");
      if (cap === "image_generation") {
        routesDoc.setIn(["routes", key, "fallback_models"], []);
        routesDoc.setIn(["routes", key, "retouch_models"], []);
      }
    }
    const id = randomUUID();
    target = path.join(root, "revisions", id);
    mkdirSync(target, { recursive: true, mode: 0o700 });
    for (const [name, content] of Object.entries({ "models.yaml": modelsDoc.toString(), "model-routing.yaml": routesDoc.toString(), "connections.json": JSON.stringify(state) })) writeFileSync(path.join(target, name), content, { mode: 0o600 });
    const pointer = path.join(root, `${id}.tmp`);
    writeFileSync(pointer, JSON.stringify({ revision: id }), { mode: 0o600 });
    renameSync(pointer, path.join(root, "active.json"));
    target = "";
    resetModelRouterCache();
    return getApiSetupSummary();
  } finally {
    if (target) rmSync(target, { recursive: true, force: true });
    closeSync(fd);
    rmSync(lock, { force: true });
  }
}

export function saveSetupConnection(body: Record<string, unknown>) {
  return mutate(body.revision, (state) => {
    const connection = connectionFrom(body, state);
    if (connection.protocol === "anthropic_compatible" && state.models.some((m) => m.connectionId === connection.id && m.kind !== "text")) throw new SetupError("此连接已供看图、生图或语音使用，请另外添加 Anthropic 文字连接，避免影响原有功能。");
    const changed = state.connections.find((c) => c.id === connection.id);
    if (changed && JSON.stringify(changed) !== JSON.stringify(connection)) state.models.filter((m) => m.connectionId === connection.id).forEach((m) => { delete m.verifiedAt; });
    state.connections = [...state.connections.filter((c) => c.id !== connection.id), connection];
    const kind = text(body.kind, 40) as ModelKind;
    if (!Object.hasOwn(kindCapabilities, kind)) throw new SetupError("请选择模型用途。");
    if (kind !== "text" && connection.protocol !== "openai_compatible") throw new SetupError("此用途目前需要 OpenAI 兼容接口；Anthropic 接口可用于文字功能。");
    const modelId = text(body.modelId, 200);
    if (!modelId || /[\r\n]/.test(modelId)) throw new SetupError("请填写或选择模型名称。");
    const alias = `local_${createHash("sha256").update(`${connection.id}:${kind}:${modelId}`).digest("hex").slice(0, 20)}`;
    if (!state.models.some((m) => m.alias === alias)) state.models.push({ alias, connectionId: connection.id, modelId, kind });
    if (body.applyDefault === true) {
      const cap = kindCapabilities[kind];
      state.defaults[cap] = alias;
      // Explicitly applying a shared default removes previous per-feature overrides in that group.
      for (const r of loadRouteTable().filter((r) => r.capability === cap)) delete state.overrides[r.key];
    }
  });
}

export function saveSetupAssignments(body: Record<string, unknown>) {
  return mutate(body.revision, (state) => {
    if (body.restore === true) { state.defaults = {}; state.overrides = {}; return; }
    if (body.defaults && typeof body.defaults === "object" && !Array.isArray(body.defaults)) {
      for (const [cap, alias] of Object.entries(body.defaults)) {
        if (!["text", "vision", "speech_to_text", "image_generation"].includes(cap)) throw new SetupError("无效的功能类型。");
        if (alias) state.defaults[cap as SetupCapability] = text(alias, 100); else delete state.defaults[cap as SetupCapability];
      }
    }
    if (body.routeKey) {
      const key = text(body.routeKey, 100);
      if (!loadRouteTable().some((r) => r.key === key)) throw new SetupError("功能不存在。");
      if (body.alias) state.overrides[key] = text(body.alias, 100); else delete state.overrides[key];
    }
  });
}

export function setupConnectionForProbe(body: Record<string, unknown>) { return connectionFrom(body, readState()); }
export async function discoverSetupModels(body: Record<string, unknown>) {
  const c = setupConnectionForProbe(body);
  const url = c.protocol === "anthropic_compatible" ? `${c.baseUrl.replace(/\/v1$/, "")}/v1/models` : `${c.baseUrl}/models`;
  try {
    const response = await fetch(url, { headers: c.protocol === "anthropic_compatible" ? { "x-api-key": c.apiKey, "anthropic-version": "2023-06-01" } : { Authorization: `Bearer ${c.apiKey}` }, signal: AbortSignal.timeout(15000), redirect: "error", cache: "no-store" });
    if (!response.ok) throw new SetupError(`模型列表获取失败（HTTP ${response.status}）。可手动填写模型名称。`, 502);
    const payload = await response.json();
    const models = Array.isArray(payload.data) ? payload.data.filter((m: { id?: unknown }) => typeof m.id === "string").map((m: { id: string }) => m.id).slice(0, 500) : [];
    return models as string[];
  } catch (e) {
    if (e instanceof SetupError) throw e;
    throw new SetupError("未能获取模型列表，请检查地址和网络，也可手动填写模型名称。", 502);
  }
}

export function verificationRoute(alias: string) {
  const summary = getApiSetupSummary();
  const route = summary.routes.find((r) => r.alias === alias);
  if (!route) throw new SetupError("请先把此模型设为默认或分配给一个功能，再验证。");
  return route;
}
export function markSetupVerified(alias: string, expected: string) {
  return mutate(expected, (state) => {
    const model = state.models.find((m) => m.alias === alias);
    if (!model) throw new SetupError("仅对本机新增的模型记录验证状态。");
    model.verifiedAt = new Date().toISOString();
  });
}

// Provider responses can echo arbitrary credentials, not just keys starting with sk-.
export function redactSetupError(error: unknown) {
  let message = error instanceof Error ? error.message : "配置操作失败。";
  try {
    for (const c of readState().connections) if (c.apiKey) message = message.split(c.apiKey).join("[已隐藏]");
  } catch { return "本机 API 配置读取失败，请检查私有配置或恢复备份。"; }
  return message.slice(0, 600);
}
