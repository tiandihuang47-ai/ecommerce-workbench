import {
  findModel,
  findProvider,
  logModelCall,
  resolveProvider,
  resolveRoute,
  type ResolvedRoute
} from "@/lib/model-router/config";
import {
  callAnthropicCompatibleChat,
  callOpenAiCompatibleChat,
  callOpenAiCompatibleVision,
  type ProtocolMessage,
  type VisionContentBlock
} from "@/lib/model-router/adapters";

export * from "@/lib/model-router/config";
export { maskSecrets } from "@/lib/model-router/adapters";
export { streamOpenAiCompatibleChat } from "@/lib/model-router/adapters";
export type { VisionContentBlock } from "@/lib/model-router/adapters";

/**
 * Model Router · 对外 API
 *
 * 业务代码只写 Route，不写模型：
 *   const { text } = await generateTextByRoute({ routeKey: "script_generation", system, user });
 *   const { value } = await generateJsonByRoute<X>({ routeKey: "comment_insight", system, user });
 *   const { value } = await generateVisionJsonByRoute<X>({ routeKey: "product_image_understanding", system, content });
 *
 * 模型名、Provider、Base URL、API Key 全部由 config/ 决定；换模型只改 YAML。
 */

export interface RouteGenerationResult {
  text: string;
  routeKey: string;
  modelAlias: string;
  modelId: string;
  provider: string;
  source: "route" | "fallback";
}

export interface RouteGenerationJsonResult<T> extends RouteGenerationResult {
  value: T;
}

export interface GenerateOptions {
  routeKey: string;
  system: string;
  /** 单轮输入 */
  user?: string;
  /** 多轮输入（AI 对话）；与 user 二选一，优先 messages */
  messages?: ProtocolMessage[];
  temperature?: number;
  maxTokens?: number;
  signal?: AbortSignal;
  /** Provider 专用额外字段（例如 deepseek 的 thinking 开关）；不属于通用参数。 */
  extraBody?: Record<string, unknown>;
}

function toMessages(options: GenerateOptions): ProtocolMessage[] {
  if (options.messages?.length) return options.messages;
  return [{ role: "user", content: options.user ?? "" }];
}

async function callWithRoute(options: GenerateOptions, route: ResolvedRoute): Promise<string> {
  const messages = toMessages(options);
  const temperature = options.temperature ?? route.temperature;
  if (route.provider.protocol === "anthropic_compatible") {
    return callAnthropicCompatibleChat({
      provider: route.provider,
      modelId: route.modelId,
      system: options.system,
      messages,
      temperature,
      maxTokens: options.maxTokens ?? route.maxTokens,
      signal: options.signal,
      timeoutMs: route.timeoutMs
    });
  }
  if (route.provider.protocol === "openai_compatible") {
    return callOpenAiCompatibleChat({
      provider: route.provider,
      modelId: route.modelId,
      system: options.system,
      messages,
      temperature,
      maxTokens: options.maxTokens ?? route.maxTokens,
      signal: options.signal,
      timeoutMs: route.timeoutMs,
      extraBody: options.extraBody
    });
  }
  throw new Error(`Route "${route.routeKey}" 的 Provider "${route.provider.name}" 协议是 ${route.provider.protocol}，不能用来做文本生成。`);
}

function withFallbackModel(route: ResolvedRoute, alias: string): ResolvedRoute {
  const model = findModel(alias);
  return {
    ...route,
    modelAlias: model.alias,
    modelId: model.modelId,
    provider: resolveProvider(findProvider(model.provider)),
    capabilities: model.capabilities,
    timeoutMs: model.defaultTimeoutMs ?? route.timeoutMs
  };
}

function failureMessage(route: ResolvedRoute, reason: string) {
  return `${route.label}（Route ${route.routeKey}）调用 ${route.modelId} 失败，且没有配置回退模型。原因：${reason}`;
}

export function parseLooseJson<T>(text: string): T {
  const withoutFence = text.replace(/^\s*```(?:json)?/i, "").replace(/```\s*$/, "").trim();
  const start = withoutFence.indexOf("{");
  const end = withoutFence.lastIndexOf("}");
  const candidate = start >= 0 && end > start ? withoutFence.slice(start, end + 1) : withoutFence;
  return JSON.parse(candidate) as T;
}

/** 文本生成：按 Route 解析模型；失败时按 Route 配置回退，未配置就直接报错。 */
export async function generateTextByRoute(options: GenerateOptions): Promise<RouteGenerationResult> {
  const route = resolveRoute(options.routeKey);
  const startedAt = Date.now();
  try {
    const text = await callWithRoute(options, route);
    logModelCall({ routeKey: route.routeKey, modelAlias: route.modelAlias, modelId: route.modelId, provider: route.provider.name, durationMs: Date.now() - startedAt, status: "success", source: "route" });
    return { text, routeKey: route.routeKey, modelAlias: route.modelAlias, modelId: route.modelId, provider: route.provider.name, source: "route" };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    if (!route.fallbackAlias) {
      logModelCall({ routeKey: route.routeKey, modelAlias: route.modelAlias, modelId: route.modelId, provider: route.provider.name, durationMs: Date.now() - startedAt, status: "failed", reason });
      throw new Error(failureMessage(route, reason));
    }
    const fallback = withFallbackModel(route, route.fallbackAlias);
    console.warn(`[MODEL_ROUTER] ${route.routeKey}: ${route.modelId} 不可用，按 config/model-routing.yaml 回退 ${fallback.modelId}。原因：${reason.slice(0, 200)}`);
    const text = await callWithRoute(options, fallback);
    logModelCall({ routeKey: route.routeKey, modelAlias: fallback.modelAlias, modelId: fallback.modelId, provider: fallback.provider.name, durationMs: Date.now() - startedAt, status: "success", source: "fallback" });
    return { text, routeKey: route.routeKey, modelAlias: fallback.modelAlias, modelId: fallback.modelId, provider: fallback.provider.name, source: "fallback" };
  }
}

/** JSON 生成：主模型返回非法 JSON 时同样按 Route 回退（没有回退就直接报错）。 */
export async function generateJsonByRoute<T>(options: GenerateOptions): Promise<RouteGenerationJsonResult<T>> {
  const route = resolveRoute(options.routeKey);
  const startedAt = Date.now();
  let primaryError = "";
  try {
    const text = await callWithRoute(options, route);
    const value = parseLooseJson<T>(text);
    logModelCall({ routeKey: route.routeKey, modelAlias: route.modelAlias, modelId: route.modelId, provider: route.provider.name, durationMs: Date.now() - startedAt, status: "success", source: "route" });
    return { text, value, routeKey: route.routeKey, modelAlias: route.modelAlias, modelId: route.modelId, provider: route.provider.name, source: "route" };
  } catch (error) {
    primaryError = error instanceof Error ? error.message : String(error);
  }
  if (!route.fallbackAlias) {
    logModelCall({ routeKey: route.routeKey, modelAlias: route.modelAlias, modelId: route.modelId, provider: route.provider.name, durationMs: Date.now() - startedAt, status: "failed", reason: primaryError });
    throw new Error(failureMessage(route, primaryError));
  }
  const fallback = withFallbackModel(route, route.fallbackAlias);
  console.warn(`[MODEL_ROUTER] ${route.routeKey}: ${route.modelId} 无有效 JSON，按配置回退 ${fallback.modelId}。原因：${primaryError.slice(0, 200)}`);
  const text = await callWithRoute(options, fallback);
  const value = parseLooseJson<T>(text);
  logModelCall({ routeKey: route.routeKey, modelAlias: fallback.modelAlias, modelId: fallback.modelId, provider: fallback.provider.name, durationMs: Date.now() - startedAt, status: "success", source: "fallback" });
  return { text, value, routeKey: route.routeKey, modelAlias: fallback.modelAlias, modelId: fallback.modelId, provider: fallback.provider.name, source: "fallback" };
}

/** 视觉理解（图片 / 视频帧）→ JSON。 */
export async function generateVisionJsonByRoute<T>(options: {
  routeKey: string;
  system: string;
  content: VisionContentBlock[];
  temperature?: number;
  maxTokens?: number;
  signal?: AbortSignal;
}): Promise<RouteGenerationJsonResult<T>> {
  const route = resolveRoute(options.routeKey);
  if (route.provider.protocol !== "openai_compatible") {
    throw new Error(`Route "${options.routeKey}" 的 Provider "${route.provider.name}" 协议是 ${route.provider.protocol}，暂不支持视觉理解。`);
  }
  const startedAt = Date.now();
  try {
    const text = await callOpenAiCompatibleVision({
      provider: route.provider,
      modelId: route.modelId,
      system: options.system,
      content: options.content,
      temperature: options.temperature,
      maxTokens: options.maxTokens,
      signal: options.signal,
      timeoutMs: route.timeoutMs
    });
    logModelCall({ routeKey: route.routeKey, modelAlias: route.modelAlias, modelId: route.modelId, provider: route.provider.name, durationMs: Date.now() - startedAt, status: "success", source: "route" });
    return { text, value: parseLooseJson<T>(text), routeKey: route.routeKey, modelAlias: route.modelAlias, modelId: route.modelId, provider: route.provider.name, source: "route" };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    logModelCall({ routeKey: route.routeKey, modelAlias: route.modelAlias, modelId: route.modelId, provider: route.provider.name, durationMs: Date.now() - startedAt, status: "failed", reason });
    throw new Error(failureMessage(route, reason));
  }
}

/** 取某个 Route 当前的模型 / Provider（用于状态接口与文档；不含 Key）。 */
export function describeRoute(routeKey: string) {
  const route = resolveRoute(routeKey);
  return {
    routeKey: route.routeKey,
    label: route.label,
    modelAlias: route.modelAlias,
    modelId: route.modelId,
    provider: route.provider.label,
    providerProtocol: route.provider.protocol,
    configured: Boolean(route.provider.apiKey),
    apiKeyEnv: route.provider.apiKeyEnv,
    fallbackAlias: route.fallbackAlias
  };
}

export type { ProtocolMessage };

/** Both supported audio protocols use the same registered speech_to_text route. */
export async function requestAudioByRoute(bytes: Uint8Array, format: "mp3" | "wav", signal?: AbortSignal) {
  const route = resolveRoute("speech_to_text");
  if (!route.provider.apiKey) throw new Error("请先在设置中配置语音转写模型。");
  const provider = findProvider(findModel(route.modelAlias).provider);
  if (route.provider.protocol !== "openai_compatible") throw new Error("语音转写需要 OpenAI 兼容接口。");
  const transcription = provider.audioFormat === "transcriptions";
  const form = new FormData();
  form.set("model", route.modelId);
  form.set("file", new Blob([Uint8Array.from(bytes).buffer], { type: format === "wav" ? "audio/wav" : "audio/mpeg" }), `audio.${format}`);
  const response = await fetch(`${route.provider.baseUrl}/${transcription ? "audio/transcriptions" : "chat/completions"}`, {
    method: "POST", redirect: "error",
    headers: { Authorization: `Bearer ${route.provider.apiKey}`, ...(transcription ? {} : { "Content-Type": "application/json" }) },
    body: transcription ? form : JSON.stringify({ model: route.modelId, messages: [{ role: "user", content: [{ type: "text", text: "请逐字转写音频中的人声，只输出原文；不要总结或解释。" }, { type: "input_audio", input_audio: { data: Buffer.from(bytes).toString("base64"), format } }] }], temperature: 0, max_tokens: 16000 }),
    signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(route.timeoutMs)]) : AbortSignal.timeout(route.timeoutMs)
  });
  return response;
}
