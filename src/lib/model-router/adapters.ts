import OpenAI from "openai";
import type { ResolvedProvider } from "@/lib/model-router/config";

/**
 * Model Router · Provider Adapter 层
 *
 * 只做协议适配：谁（Provider）用什么协议发请求。
 * 业务代码不直接调用这里的函数，而是走 model-router 的 generate*ByRoute。
 * 这里绝不读取任何 API Key：Key 由 config.ts 按 Provider 定义从环境变量解析后传进来。
 */

export type ProtocolMessage = { role: "user" | "assistant"; content: string };

/** 任何进入日志 / 报错的字符串都先脱敏。 */
export function maskSecrets(value: string) {
  return value.replace(/sk-[A-Za-z0-9_-]{8,}/g, "sk-***");
}

function assertKey(provider: ResolvedProvider) {
  if (!provider.apiKey) {
    throw new Error(`未配置 ${provider.apiKeyEnv || "API Key"}（Provider：${provider.label}）。请在 .env.local 中填写后重启应用。`);
  }
}

export async function callOpenAiCompatibleChat(options: {
  provider: ResolvedProvider;
  modelId: string;
  system: string;
  messages: ProtocolMessage[];
  temperature?: number;
  maxTokens?: number;
  signal?: AbortSignal;
  timeoutMs: number;
  extraBody?: Record<string, unknown>;
}): Promise<string> {
  assertKey(options.provider);
  const client = new OpenAI({ apiKey: options.provider.apiKey, baseURL: options.provider.baseUrl });
  try {
    const completion = await client.chat.completions.create({
      model: options.modelId,
      temperature: options.temperature ?? 0.7,
      max_tokens: options.maxTokens,
      stream: false,
      messages: [
        { role: "system", content: options.system },
        ...options.messages.map((message) => ({ role: message.role, content: message.content }))
      ],
      ...(options.extraBody || {})
    } as never, { signal: options.signal, timeout: options.timeoutMs, maxRetries: 1 });
    const text = completion.choices[0]?.message?.content;
    if (typeof text !== "string" || !text.trim()) throw new Error("模型没有返回有效内容。");
    return text.trim();
  } catch (error) {
    throw adapterError(error, options.provider);
  }
}

export async function callAnthropicCompatibleChat(options: {
  provider: ResolvedProvider;
  modelId: string;
  system: string;
  messages: ProtocolMessage[];
  temperature?: number;
  maxTokens?: number;
  signal?: AbortSignal;
  timeoutMs: number;
}): Promise<string> {
  assertKey(options.provider);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs);
  const abortFromCaller = () => controller.abort();
  options.signal?.addEventListener("abort", abortFromCaller, { once: true });
  try {
    const response = await fetch(`${options.provider.baseUrl}/v1/messages`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": options.provider.apiKey,
        "anthropic-version": "2023-06-01"
      },
      body: JSON.stringify({
        model: options.modelId,
        max_tokens: options.maxTokens ?? 8000,
        temperature: options.temperature ?? 0.7,
        system: options.system,
        messages: options.messages.map((message) => ({ role: message.role, content: message.content }))
      }),
      signal: controller.signal
    });
    const raw = await response.text();
    if (!response.ok) {
      throw new Error(`${options.provider.label} 返回 ${response.status}：${maskSecrets(raw).slice(0, 300)}`);
    }
    const parsed = JSON.parse(raw) as { content?: Array<{ type?: string; text?: string }> };
    const text = (parsed.content || [])
      .filter((block) => block?.type === "text" && typeof block.text === "string")
      .map((block) => block.text as string)
      .join("\n")
      .trim();
    if (!text) throw new Error("模型没有返回文本内容。");
    return text;
  } catch (error) {
    throw adapterError(error, options.provider);
  } finally {
    clearTimeout(timeout);
    options.signal?.removeEventListener("abort", abortFromCaller);
  }
}

export type VisionContentBlock =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string; detail?: "low" | "high" | "auto" } };

export async function callOpenAiCompatibleVision(options: {
  provider: ResolvedProvider;
  modelId: string;
  system: string;
  content: VisionContentBlock[];
  temperature?: number;
  maxTokens?: number;
  signal?: AbortSignal;
  timeoutMs: number;
}): Promise<string> {
  assertKey(options.provider);
  const client = new OpenAI({ apiKey: options.provider.apiKey, baseURL: options.provider.baseUrl });
  try {
    const completion = await client.chat.completions.create({
      model: options.modelId,
      temperature: options.temperature ?? 0.1,
      max_tokens: options.maxTokens ?? 7000,
      stream: false,
      messages: [
        { role: "system", content: options.system },
        { role: "user", content: options.content }
      ]
    } as never, { signal: options.signal, timeout: options.timeoutMs, maxRetries: 1 });
    const text = completion.choices[0]?.message?.content;
    if (typeof text !== "string" || !text.trim()) throw new Error("视觉模型没有返回有效内容。");
    return text.trim();
  } catch (error) {
    throw adapterError(error, options.provider);
  }
}

function adapterError(error: unknown, provider: ResolvedProvider) {
  const message = maskSecrets(error instanceof Error ? error.message : String(error));
  return new Error(`${provider.label} 调用失败：${message}`);
}
