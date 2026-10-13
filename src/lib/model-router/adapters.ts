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
    throw new Error(`未配置 ${provider.apiKeyEnv || "API Key"}（Provider：${provider.label}）。请到设置中添加 API 连接，或在 .env.local 中填写后重启应用。`);
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
    const baseUrl = options.provider.baseUrl.replace(/\/+$/, "").replace(/\/v1$/, "");
    const response = await fetch(`${baseUrl}/v1/messages`, {
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
      throw new Error(`${options.provider.label} 返回 ${response.status}：${maskSecrets(raw.split(options.provider.apiKey).join("[已隐藏]")).slice(0, 300)}`);
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
  const raw = error instanceof Error ? error.message : String(error);
  const message = maskSecrets(provider.apiKey ? raw.split(provider.apiKey).join("[已隐藏]") : raw);
  return new Error(`${provider.label} 调用失败：${message}`);
}

/** OpenAI-compatible streaming, including the existing chat Skill tool loop. */
export async function streamOpenAiCompatibleChat(options: {
  provider: ResolvedProvider; modelId: string; system: string;
  messages: import("@/lib/opus-chat-service").AnthropicMessage[];
  tools?: import("@/lib/opus-chat-service").ChatToolDefinition[];
  temperature?: number; maxTokens: number; timeoutMs: number; signal?: AbortSignal;
  onDelta: (text: string) => void; onToolUseStart?: (tool: { id: string; name: string }) => void;
}): Promise<import("@/lib/opus-chat-service").StreamChatResult> {
  assertKey(options.provider);
  const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [{ role: "system", content: options.system }];
  for (const m of options.messages) {
    if (typeof m.content === "string") { messages.push({ role: m.role, content: m.content }); continue; }
    if (m.role === "assistant") {
      const tools = m.content.filter((b) => b.type === "tool_use");
      messages.push({ role: "assistant", content: m.content.filter((b) => b.type === "text").map((b) => b.type === "text" ? b.text : "").join("\n") || null, ...(tools.length ? { tool_calls: tools.map((b) => ({ id: b.type === "tool_use" ? b.id : "", type: "function" as const, function: { name: b.type === "tool_use" ? b.name : "", arguments: JSON.stringify(b.type === "tool_use" ? b.input : {}) } })) } : {}) });
    } else for (const b of m.content) {
      if (b.type === "tool_result") messages.push({ role: "tool", tool_call_id: b.tool_use_id, content: b.content });
      else if (b.type === "text") messages.push({ role: "user", content: b.text });
    }
  }
  const client = new OpenAI({ apiKey: options.provider.apiKey, baseURL: options.provider.baseUrl });
  try {
    const stream = await client.chat.completions.create({ model: options.modelId, messages, stream: true, temperature: options.temperature ?? 0.7, max_tokens: options.maxTokens,
      ...(options.tools?.length ? { tools: options.tools.map((t) => ({ type: "function" as const, function: { name: t.name, description: t.description, parameters: t.input_schema } })) } : {})
    }, { signal: options.signal, timeout: options.timeoutMs, maxRetries: 0 });
    let text = ""; let stopReason = "";
    const calls = new Map<number, { id: string; name: string; json: string }>();
    for await (const chunk of stream) {
      const c = chunk.choices[0];
      if (c?.delta.content) { text += c.delta.content; options.onDelta(c.delta.content); }
      if (c?.finish_reason) stopReason = c.finish_reason;
      for (const d of c?.delta.tool_calls || []) {
        const call = calls.get(d.index) || { id: "", name: "", json: "" };
        if (d.id) call.id = d.id;
        if (d.function?.name) { call.name += d.function.name; options.onToolUseStart?.({ id: call.id, name: call.name }); }
        if (d.function?.arguments) call.json += d.function.arguments;
        calls.set(d.index, call);
      }
    }
    if (!stopReason) throw new Error("流式回复中断，未收到结束标记，请重试。");
    if (stopReason === "length") throw new Error("回复达到长度上限，请缩短输入或提高输出上限。");
    const toolUses = [...calls.values()].map((c) => ({ id: c.id, name: c.name, input: JSON.parse(c.json || "{}") as unknown }));
    if (!text && !toolUses.length) throw new Error("模型没有返回有效内容。");
    return { text, toolUses, assistantBlocks: [...(text ? [{ type: "text" as const, text }] : []), ...toolUses.map((t) => ({ type: "tool_use" as const, ...t }))], stopReason };
  } catch (error) { throw adapterError(error, options.provider); }
}
