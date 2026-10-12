import OpenAI from "openai";
import { generateCopywritingText } from "@/lib/copywriting-service";
import { generateVisionJsonByRoute } from "@/lib/model-router";
import { getResolvedAssistantConfig, type CommerceAssistantProvider } from "@/lib/commerce-image-config";
import { sanitizeProviderMessage } from "@/lib/commerce-image-provider";

/**
 * 图像模块的模型调用。
 *
 * 文本 → 走中央模型路由（config/model-routing.yaml）：调用方必须传业务 Route，例如
 *        image_task_planning / commerce_chat / marketing_strategy / marketing_review。
 * 视觉 → 走 Route product_image_understanding（默认豆包视觉理解）。
 * 「测试连接」→ 走系统设置里配置的连接（Provider Connection），保证设置页说的是真话。
 */

export type CommerceVisionContent =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string; detail?: "low" | "high" | "auto" } };

export interface CommerceTextOptions {
  /** 业务 Route（见 config/model-routing.yaml）；缺失会明确报错，不会静默用默认模型。 */
  route?: string;
  system: string;
  user: string;
  temperature?: number;
  maxTokens?: number;
  signal?: AbortSignal;
}

/** 图像模块的文本输出：模型由 route 决定。 */
export async function callCommerceText(options: CommerceTextOptions) {
  if (!options.route) {
    throw new Error("调用文本模型时必须指定业务 Route（config/model-routing.yaml）。");
  }
  const { text } = await generateCopywritingText({
    purpose: options.route,
    system: options.system,
    user: options.user,
    temperature: options.temperature,
    maxTokens: options.maxTokens,
    signal: options.signal
  });
  return text;
}

export async function callCommerceTextJson<T>(options: CommerceTextOptions) {
  return parseLooseJson<T>(await callCommerceText(options));
}

/** 系统设置里配置的文本模型。只用于「测试连接」，不参与功能路由。 */
export async function callConfiguredCommerceText(options: {
  system: string;
  user: string;
  temperature?: number;
  maxTokens?: number;
  signal?: AbortSignal;
}) {
  const config = await requireAssistant("text");
  const client = new OpenAI({ apiKey: config.apiKey, baseURL: config.baseUrl });
  try {
    const response = await client.chat.completions.create({
      model: config.modelId,
      // V4 defaults to thinking, which shares max_tokens with the final answer.
      ...(/^deepseek-v4(?:[.-]|$)/i.test(config.modelId) ? { thinking: { type: "disabled" } } : {}),
      temperature: options.temperature ?? 0.25,
      max_tokens: options.maxTokens ?? 5000,
      stream: false,
      messages: [
        { role: "system", content: options.system },
        { role: "user", content: options.user }
      ]
    }, { signal: options.signal, timeout: 180_000, maxRetries: 1 });
    const choice = response.choices[0];
    const text = choice?.message?.content;
    if (choice?.finish_reason === "length") {
      throw new Error("文本输出达到长度上限，未生成完整结果。");
    }
    if (typeof text !== "string" || !text.trim()) {
      console.warn("[COMMERCE_TEXT_EMPTY]", JSON.stringify({
        model: config.modelId,
        finishReason: choice?.finish_reason ?? null,
        completionTokens: response.usage?.completion_tokens ?? null
      }));
      throw new Error("文本模型没有返回有效内容。");
    }
    return text.trim();
  } catch (error) {
    throw assistantError(error, "文本模型");
  }
}

/** 视觉理解的业务调用：模型由 Route 决定（默认 product_image_understanding → 豆包视觉理解）。 */
export async function callCommerceVisionJson<T>(options: {
  route?: string;
  system: string;
  content: CommerceVisionContent[];
  maxTokens?: number;
  signal?: AbortSignal;
}) {
  const { value } = await generateVisionJsonByRoute<T>({
    routeKey: options.route || "product_image_understanding",
    system: options.system,
    content: options.content,
    maxTokens: options.maxTokens,
    signal: options.signal
  });
  return value;
}

/** 系统设置里配置的视觉模型。只用于「测试连接」。 */
export async function callConfiguredCommerceVisionJson<T>(options: {
  system: string;
  content: CommerceVisionContent[];
  maxTokens?: number;
  signal?: AbortSignal;
}) {
  const config = await requireAssistant("vision");
  const client = new OpenAI({ apiKey: config.apiKey, baseURL: config.baseUrl });
  try {
    const response = await client.chat.completions.create({
      model: config.modelId,
      temperature: 0.1,
      max_tokens: options.maxTokens ?? 7000,
      stream: false,
      messages: [
        { role: "system", content: options.system },
        { role: "user", content: options.content }
      ]
    } as never, { signal: options.signal, timeout: 180_000, maxRetries: 1 });
    const text = response.choices[0]?.message?.content;
    if (typeof text !== "string" || !text.trim()) throw new Error("视觉模型没有返回有效内容。");
    return parseLooseJson<T>(text);
  } catch (error) {
    throw assistantError(error, "视觉模型");
  }
}

export async function verifyCommerceAssistant(provider: CommerceAssistantProvider) {
  if (provider === "text") {
    await callConfiguredCommerceText({ system: "你是连接测试助手。", user: "只回复 OK。", maxTokens: 128, temperature: 0 });
    return;
  }
  const transparentPixel = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
  await callConfiguredCommerceVisionJson({
    system: "你是连接测试助手，只输出 JSON。",
    content: [
      { type: "text", text: "识别图片并只返回 {\"ok\":true}。" },
      { type: "image_url", image_url: { url: transparentPixel, detail: "low" } }
    ],
    maxTokens: 30
  });
}

export function parseLooseJson<T>(value: string): T {
  const cleaned = value.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
  try {
    return JSON.parse(cleaned) as T;
  } catch {
    const objectStart = cleaned.indexOf("{");
    const objectEnd = cleaned.lastIndexOf("}");
    if (objectStart >= 0 && objectEnd > objectStart) return JSON.parse(cleaned.slice(objectStart, objectEnd + 1)) as T;
    throw new Error("模型返回的数据无法解析，请重试。");
  }
}

async function requireAssistant(provider: CommerceAssistantProvider) {
  const config = await getResolvedAssistantConfig(provider);
  if (!config.apiKey) {
    throw new Error(provider === "text"
      ? "未配置文本模型连接，请先到系统设置完成配置。"
      : "未配置豆包视觉理解模型，请先到系统设置完成配置。");
  }
  if (!config.modelId || !config.baseUrl) throw new Error("AI 模型配置不完整，请到系统设置检查 Base URL 和 Model ID。");
  return config;
}

function assistantError(error: unknown, label: string) {
  if (error instanceof Error && /未配置|配置不完整/.test(error.message)) return error;
  const message = sanitizeProviderMessage(error instanceof Error ? error.message : String(error));
  return new Error(`${label}调用失败：${message || "未知错误"}`);
}
