import { getResolvedProviderConfig, providerForModel } from "@/lib/commerce-image-config";
import { redactLocalSecrets } from "@/lib/model-router/profile-store";
import { readImageMetadata } from "@/lib/commerce-image-file";
import { now, since, trace } from "@/lib/perf-trace";
import type { CommerceImageQuality, CommerceImageSize, CommerceImageStructuredError, ResolvedCommerceImageModel } from "@/lib/commerce-image-types";

export class CommerceImageProviderError extends Error {
  readonly detail: CommerceImageStructuredError;

  constructor(detail: CommerceImageStructuredError) {
    super(detail.message);
    this.name = "CommerceImageProviderError";
    this.detail = detail;
  }
}

/** 中转站上游偶发 500/429（upstream_unavailable 等）时的重试退避序列。 */
export const TRANSIENT_RETRY_DELAYS_MS = [2_000, 8_000, 20_000];

/** 中转站/上游的暂时性故障（5xx、429、超时等），值得自动重试。 */
export function isTransientCommerceImageError(error: unknown): boolean {
  return error instanceof CommerceImageProviderError && error.detail.retryable;
}


export interface CommerceImageReferenceInput {
  bytes: Uint8Array;
  mimeType: string;
  name: string;
}

export interface CommerceImageGenerationInput {
  modelId: ResolvedCommerceImageModel;
  prompt: string;
  size: CommerceImageSize;
  quality?: CommerceImageQuality;
  references: CommerceImageReferenceInput[];
  transparent?: boolean;
  signal?: AbortSignal;
  /** 生成请求的超时预算，不传用默认 180 秒；大尺寸生成建议放宽。 */
  timeoutMs?: number;
}

export interface CommerceImageGenerationResult {
  bytes: Uint8Array;
  providerModelId: string;
  /** 这次真正写进 HTTP 请求的尺寸（区分「UI 选择」与「实际请求」）。 */
  requestedSize?: CommerceImageSize;
}

export async function generateCommerceImage(input: CommerceImageGenerationInput): Promise<CommerceImageGenerationResult> {
  const provider = providerForModel(input.modelId);
  const config = await getResolvedProviderConfig(provider);
  if (!config.apiKey) throw new CommerceImageProviderError({
    code: "PROVIDER_NOT_CONFIGURED",
    category: "configuration",
    message: `${providerLabel(provider)}尚未配置 API Key，请先到系统设置完成配置。`,
    retryable: false,
    provider
  });
  if (provider === "seedream" || config.imageAdapter === "seedream") return generateWithSeedream(input, config);
  return generateWithOpenAI(input, config);
}

export async function verifyCommerceImageProvider(modelId: ResolvedCommerceImageModel) {
  const provider = providerForModel(modelId);
  if (provider === "openai_v25") {
    // Minimal request for GPT Image 2.5: no size, no quality, no extra params.
    // Just model + prompt. If this succeeds, the key/model/URL are all valid.
    const config = await getResolvedProviderConfig("openai_v25");
    if (!config.apiKey) throw new CommerceImageProviderError({
      code: "PROVIDER_NOT_CONFIGURED", category: "configuration",
      message: "OpenAI GPT Image 2.5 尚未配置 API Key。", retryable: false, provider
    });
    const body = { model: config.modelId, prompt: "A simple red apple on a white background" };
    const response = await providerFetch(`${config.baseUrl}/images/generations`, {
      method: "POST",
      headers: { Authorization: `Bearer ${config.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify(body)
    }, undefined, "openai_v25");
    const payload = await readJsonResponse(response, "GPT Image");
    const encoded = findString(payload, ["b64_json", "base64"]);
    if (encoded) return { bytes: decodeBase64(encoded), providerModelId: config.modelId };
    const url = findImageUrl(payload);
    if (!url) throw providerPayloadError(payload, "openai_v25", "GPT Image 没有返回可用图片。");
    return { bytes: await downloadImage(url, undefined, "openai_v25"), providerModelId: config.modelId };
  }
  const size = provider === "seedream" || (provider === "configured" && (await getResolvedProviderConfig(provider)).imageAdapter === "seedream")
    ? { width: 2048, height: 2048, label: "2048 × 2048" }
    : { width: 1024, height: 1024, label: "1024 × 1024" };
  return generateCommerceImage({
    modelId,
    prompt: "连接测试：生成一张极简浅灰背景，中间只有一个柔和紫色圆形，不含文字、人物、品牌或水印。",
    size,
    references: []
  });
}


/** 把适配器算出的 "W*H" / "WxH" 还原成数值，便于如实记录「实际请求尺寸」。 */
function sizeFromPair(value: string, separator: "*" | "x"): CommerceImageSize | null {
  const [rawWidth, rawHeight] = value.split(separator).map((part) => Number.parseInt(part, 10));
  if (!Number.isFinite(rawWidth) || !Number.isFinite(rawHeight) || rawWidth <= 0 || rawHeight <= 0) return null;
  return { width: rawWidth, height: rawHeight, label: `${rawWidth} × ${rawHeight}` };
}

/** Map quality level to actual pixel size for Seedream (widthxheight format). */
function seedreamSizeForQuality(size: CommerceImageSize, quality?: CommerceImageQuality): string {
  const multiplier = quality === "ultra" ? 2 : quality === "high" ? 1.5 : 1;
  const w = Math.min(4096, Math.round(size.width * multiplier / 16) * 16);
  const h = Math.min(4096, Math.round(size.height * multiplier / 16) * 16);
  return `${w}x${h}`;
}

async function generateWithSeedream(
  input: CommerceImageGenerationInput,
  config: Awaited<ReturnType<typeof getResolvedProviderConfig>>
): Promise<CommerceImageGenerationResult> {
  const endpoint = config.baseUrl.endsWith("/images/generations") ? config.baseUrl : `${config.baseUrl}/images/generations`;
  const references = input.references.slice(0, 10).map(toDataUrl);
  const requestedSize = sizeFromPair(seedreamSizeForQuality(input.size, input.quality), "x") || input.size;
  const body: Record<string, unknown> = {
    model: config.modelId,
    prompt: input.prompt,
    size: seedreamSizeForQuality(input.size, input.quality),
    response_format: "b64_json",
    watermark: false
  };
  if (references.length === 1) body.image = references[0];
  if (references.length > 1) body.image = references;
  const response = await providerFetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body),
  }, input.signal, "seedream", input.timeoutMs);
  const payload = await readJsonResponse(response, "Seedream");
  const encoded = findString(payload, ["b64_json", "base64", "image_base64"]);
  if (encoded) return { bytes: decodeBase64(encoded), providerModelId: config.modelId, requestedSize };
  const url = findImageUrl(payload);
  if (!url) throw providerPayloadError(payload, "seedream", "Seedream 没有返回可用图片。");
  return { bytes: await downloadImage(url, input.signal, "seedream"), providerModelId: config.modelId, requestedSize };
}

async function generateWithOpenAI(
  input: CommerceImageGenerationInput,
  config: Awaited<ReturnType<typeof getResolvedProviderConfig>>
): Promise<CommerceImageGenerationResult> {
  const isV25 = config.provider === "openai_v25";
  let requestedSize = input.size;
  // Minimal body: only send what OpenAI accepts. Extra fields cause 400.
  const body: Record<string, unknown> = {
    model: config.modelId,
    prompt: input.prompt,
    n: 1
  };
  if (isV25) {
    // 实测中转站的 gpt-image-2.5 系列接受任意 WxH（size=1152x2048 精确生效）。
    // 不传 size 时返回尺寸不受控（实测同一段链路返回过 1448x1086 与 1672x940），
    // 会在 runner 的尺寸校验处触发 OUTPUT_SIZE_MISMATCH，所以标准比例必须显式传 size。
    body.quality = input.quality === "standard" ? "medium" : "high";
    /* OriginGateway 不带 response_format 时可能只返回临时图片 URL（实测外链下载 60 秒+
     * 会触发下载超时），显式要求 b64_json 让图片内嵌返回，不再依赖二次下载。 */
    body.response_format = "b64_json";
    /* 尺寸由 runner 用「严格比例表」算好（比例 × 清晰度档 → 精确像素），这里原样发送，
     * 不再做任何二次缩放：一缩放就容易出现 1360×2048 这种比例漂移。 */
    requestedSize = input.size;
    // 精修场景会带原图尺寸，可能为奇数；奇数尺寸可能被上游拒绝，此时保持现状不传。
    if (requestedSize.width % 2 === 0 && requestedSize.height % 2 === 0) {
      body.size = `${requestedSize.width}x${requestedSize.height}`;
    }
  } else if (config.provider === "configured") {
    // Generic Images API: avoid vendor-specific quality and output fields.
    body.size = `${input.size.width}x${input.size.height}`;
  } else {
    body.output_format = "png";
    body.quality = input.quality === "standard" ? "standard" : "hd";
    const openaiSize = openaiSizeForPixelSize(input.size.width, input.size.height);
    if (openaiSize) body.size = openaiSize;
  }
  if (input.transparent) body.background = "transparent";

  let response: Response;
  const generationTimeoutMs = input.timeoutMs;
  const refBytes = input.references.reduce((sum, reference) => sum + (reference.bytes?.byteLength || 0), 0);
  const requestStartedAt = now();
  let endpoint = "/images/edits";
  if (input.references.length) {
    const form = new FormData();
    Object.entries(body).forEach(([key, value]) => form.set(key, String(value)));
    input.references.slice(0, 8).forEach((reference) => {
      const bytes = Uint8Array.from(reference.bytes);
      form.append("image[]", new Blob([bytes.buffer], { type: reference.mimeType }), reference.name || "reference.png");
    });
    response = await providerFetch(`${config.baseUrl}/images/edits`, {
      method: "POST",
      headers: { Authorization: `Bearer ${config.apiKey}` },
      body: form
    }, input.signal, "openai_v25", generationTimeoutMs);
  } else {
    endpoint = "/images/generations";
    response = await providerFetch(`${config.baseUrl}/images/generations`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(body)
    }, input.signal, "openai_v25", generationTimeoutMs);
  }
  // fetch resolve = 已拿到响应头；真正的大头在下面读 body（图片数据）
  const headerMs = since(requestStartedAt);
  const bodyStartedAt = now();
  const payload = await readJsonResponse(response, "GPT Image");
  const bodyMs = since(bodyStartedAt);
  const decodeStartedAt = now();
  const encoded = findString(payload, ["b64_json", "base64", "image_base64"]);
  if (encoded) {
    const bytes = decodeBase64(encoded);
    trace("provider", {
      provider: "openai_v25", endpoint, model: config.modelId,
      quality: String(body.quality || ""), size: String(body.size || "(默认)"), n: 1,
      refs: input.references.length, refKB: Math.round(refBytes / 1024),
      headerMs, bodyMs, decodeMs: since(decodeStartedAt), outKB: Math.round(bytes.byteLength / 1024),
      requestedSize: `${requestedSize.width}x${requestedSize.height}`,
      actualSize: `${readImageMetadata(bytes).width}x${readImageMetadata(bytes).height}`
    });
    return { bytes, providerModelId: config.modelId, requestedSize };
  }
  const url = findImageUrl(payload);
  if (!url) throw providerPayloadError(payload, "openai_v25", "GPT Image 没有返回可用图片。");
  const downloadStartedAt = now();
  const bytes = await downloadImage(url, input.signal, "openai_v25");
  trace("provider", {
    provider: "openai_v25", endpoint, model: config.modelId,
    quality: String(body.quality || ""), size: String(body.size || "(默认)"), n: 1,
    refs: input.references.length, refKB: Math.round(refBytes / 1024),
    headerMs, bodyMs, downloadMs: since(downloadStartedAt), outKB: Math.round(bytes.byteLength / 1024),
    requestedSize: `${requestedSize.width}x${requestedSize.height}`,
    actualSize: `${readImageMetadata(bytes).width}x${readImageMetadata(bytes).height}`
  });
  return { bytes, providerModelId: config.modelId, requestedSize };
}

/**
 * Map pixel dimensions to the closest OpenAI-supported size.
 * OpenAI Images API (DALL-E 3 / gpt-image-*) only accepts:
 *   1024x1024, 1024x1792, 1792x1024
 * Our seven ratios produce other pixel sizes, so we snap to the nearest
 * supported value. The generated image will be resized/cropped client-side.
 */
const OPENAI_SUPPORTED_SIZES = ["1024x1024", "1024x1792", "1792x1024"];

function openaiSizeForPixelSize(width: number, height: number): string {
  const ratio = width / height;
  if (ratio < 0.85) return "1024x1792";  // portrait (9:16, 2:3, 3:4)
  if (ratio > 1.18) return "1792x1024";  // landscape (16:9, 3:2, 4:3)
  return "1024x1024";                    // square or close (1:1)
}


async function readJsonResponse(response: Response, provider: string): Promise<unknown> {
  const text = await response.text();
  let payload: unknown = {};
  try {
    payload = text ? JSON.parse(text) : {};
  } catch {
    payload = {};
  }
  if (!response.ok) {
    const message = extractProviderMessage(payload) || text.slice(0, 300) || `HTTP ${response.status}`;
    throw classifyProviderError(response.status, payload, provider, message);
  }
  return payload;
}

async function downloadImage(url: string, signal: AbortSignal | undefined, provider: "seedream" | "openai" | "openai_v25" | "configured") {
  let lastStatus = 0;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    /* 中转站返回的临时图片外链实测可能慢到 25KB/s（1.6MB 需 60 秒以上），60 秒会把
     * 「慢但能下完」的下载判成超时，白白浪费一次已计费的生成。放宽到 120 秒。 */
    const response = await providerFetch(url, {}, signal, provider, 120_000);
    if (response.ok) {
      const bytes = new Uint8Array(await response.arrayBuffer());
      if (bytes.byteLength) return bytes;
    }
    lastStatus = response.status;
  }
  throw new CommerceImageProviderError({
    code: `IMAGE_DOWNLOAD_${lastStatus || "EMPTY"}`,
    category: "unknown",
    message: `模型已完成生成，但临时图片下载失败${lastStatus ? `（${lastStatus}）` : ""}。为避免重复计费，系统不会重新发起生图。`,
    retryable: false,
    provider
  });
}

async function providerFetch(
  url: string,
  init: RequestInit,
  externalSignal: AbortSignal | undefined,
  provider: "seedream" | "openai" | "openai_v25" | "configured",
  /* 实测 GPT Image 2.5 单张常见 90-160 秒，偶发超过 3 分钟；原来的 180 秒会把
   * 这类「慢但成功」的请求判成超时，用户既拿不到图又已经付费。放宽到 5 分钟。 */
  timeoutMs = 300_000
) {
  const controller = new AbortController();
  let timedOut = false;
  const abortFromExternal = () => controller.abort();
  externalSignal?.addEventListener("abort", abortFromExternal, { once: true });
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (error) {
    if (externalSignal?.aborted) throw error;
    if (timedOut) {
      throw new CommerceImageProviderError({
        code: "REQUEST_TIMEOUT",
        category: "unknown",
        message: "模型请求超时。该请求可能已经计费，系统不会自动重复请求；请先检查服务商任务记录。",
        retryable: false,
        provider
      });
    }
    throw error;
  } finally {
    clearTimeout(timer);
    externalSignal?.removeEventListener("abort", abortFromExternal);
  }
}

function toDataUrl(reference: CommerceImageReferenceInput) {
  return `data:${reference.mimeType};base64,${Buffer.from(reference.bytes).toString("base64")}`;
}

function decodeBase64(value: string) {
  const normalized = value.includes(",") ? value.slice(value.indexOf(",") + 1) : value;
  const bytes = new Uint8Array(Buffer.from(normalized, "base64"));
  if (!bytes.byteLength) throw new Error("模型返回的图片数据为空。 ");
  return bytes;
}

function findString(value: unknown, keys: string[]): string {
  if (!value || typeof value !== "object") return "";
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findString(item, keys);
      if (found) return found;
    }
    return "";
  }
  const record = value as Record<string, unknown>;
  for (const key of keys) {
    if (typeof record[key] === "string" && record[key]) return record[key] as string;
  }
  for (const item of Object.values(record)) {
    const found = findString(item, keys);
    if (found) return found;
  }
  return "";
}

function findImageUrl(value: unknown): string {
  if (!value || typeof value !== "object") return "";
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findImageUrl(item);
      if (found) return found;
    }
    return "";
  }
  const record = value as Record<string, unknown>;
  for (const key of ["url", "image", "image_url"]) {
    const candidate = record[key];
    if (typeof candidate === "string" && /^https?:\/\//i.test(candidate)) return candidate;
  }
  for (const item of Object.values(record)) {
    const found = findImageUrl(item);
    if (found) return found;
  }
  return "";
}

function extractProviderMessage(value: unknown): string {
  if (!value || typeof value !== "object") return "";
  const record = value as Record<string, unknown>;
  for (const key of ["message", "error_msg", "msg"]) {
    if (typeof record[key] === "string") return record[key] as string;
  }
  if (record.error && typeof record.error === "object") return extractProviderMessage(record.error);
  return "";
}

function extractProviderCode(value: unknown): string {
  if (!value || typeof value !== "object") return "";
  const record = value as Record<string, unknown>;
  for (const key of ["code", "error_code", "type"]) {
    if (typeof record[key] === "string" || typeof record[key] === "number") return String(record[key]);
  }
  if (record.error && typeof record.error === "object") return extractProviderCode(record.error);
  for (const item of Object.values(record)) {
    const found = extractProviderCode(item);
    if (found) return found;
  }
  return "";
}

function extractErrorType(value: unknown): string {
  if (!value || typeof value !== "object") return "";
  const record = value as Record<string, unknown>;
  if (typeof record.type === "string") return record.type;
  if (record.error && typeof record.error === "object") return extractErrorType(record.error);
  return "";
}

function extractRequestId(value: unknown): string {
  if (!value || typeof value !== "object") return "";
  const record = value as Record<string, unknown>;
  for (const key of ["request_id", "requestId", "id"]) {
    if (typeof record[key] === "string" && record[key].length < 160) return record[key];
  }
  if (record.error && typeof record.error === "object") return extractRequestId(record.error);
  return "";
}

function providerPayloadError(value: unknown, provider: "seedream" | "openai" | "openai_v25" | "configured", fallback: string) {
  const message = extractProviderMessage(value) || fallback;
  return classifyProviderError(200, value, provider, message);
}

function classifyProviderError(status: number, payload: unknown, providerLabelValue: string, rawMessage: string) {
  const provider = providerLabelValue === "Seedream" || providerLabelValue === "seedream" ? "seedream" : "openai";
  const code = extractProviderCode(payload) || `HTTP_${status}`;
  const compact = sanitizeProviderMessage(rawMessage);
  const combined = `${code} ${compact}`;
  let category: CommerceImageStructuredError["category"] = "unknown";
  let retryable = false;
  const errorType = extractErrorType(payload);
  const errorField = errorType ? ` · ${errorType}` : "";
  let userMessage = `${providerLabel(provider)}错误 ${status}${errorField}：${compact}`;
  if (status === 401) {
    category = "authorization";
    userMessage = `${providerLabel(provider)} 401 · ${errorType || code}：${compact}`;
  } else if (status === 403) {
    category = "authorization";
    userMessage = `${providerLabel(provider)} 403 · ${errorType || code}：${compact}`;
  } else if (status === 404) {
    category = "model_access";
    userMessage = `${providerLabel(provider)} 404 · ${errorType || code}：${compact}（请检查 Base URL 和 Model ID 是否正确）`;
  } else if (/insufficient|balance|quota.+exceed|billing|credit/i.test(combined)) {
    category = "quota";
    userMessage = `${providerLabel(provider)} ${status} · ${errorType || code}：${compact}`;
  } else if (/content.?policy|safety|moderation|sensitive/i.test(combined)) {
    category = "content_policy";
    userMessage = `${providerLabel(provider)}拒绝了当前内容，请调整图片或需求后重试。`;
  } else if (status === 429 || status >= 500 || /rate.?limit|temporar|overload|service.?unavailable/i.test(combined)) {
    category = "transient";
    retryable = true;
    userMessage = `${providerLabel(provider)} ${status} · ${errorType || code}：${compact}（这是中转站上游暂时故障，不是操作问题；系统已自动重试仍未成功，可稍后点「重做当前」，或在生图模型中切换为豆包 Seedream）`;
  } else if (status === 400 || /invalid.?param|bad.?request|unsupported|size/i.test(combined)) {
    category = "validation";
    userMessage = `${providerLabel(provider)} 400 · ${errorType || code}：${compact}`;
  }
  return new CommerceImageProviderError({
    code,
    category,
    message: userMessage,
    retryable,
    provider,
    requestId: extractRequestId(payload) || undefined
  });
}

export function sanitizeProviderMessage(value: string) {
  return redactLocalSecrets(value)
    .replace(/(?:sk|ak)-[A-Za-z0-9_-]{8,}/g, "[已隐藏密钥]")
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, "Bearer [已隐藏]")
    .slice(0, 500);
}

function providerLabel(provider: "seedream" | "openai" | "openai_v25" | "configured") {
  if (provider === "configured") return "我的生图 API";
  if (provider === "seedream") return "Seedream";
  if (provider === "openai_v25") return "GPT Image 2.5";
  return "GPT Image";
}
