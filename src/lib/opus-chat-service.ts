import { resolveRoute } from "@/lib/model-router";

/**
 * AiChatModelService —— 「AI 对话」模块专用的模型入口。
 *
 * 模块级模型绑定（不碰全局默认模型）：
 * - 走这里：/api/ai-chat（AI 对话页面）。
 * - 不走这里：脚本、爆款复刻、AI 生图、ASR、复盘 —— 继续使用各自原来的模型（DeepSeek / 豆包）。
 *
 * 中转站：TeamoRouter（**不是** Anthropic 官方 API）。
 * 协议：Anthropic Messages（POST /v1/messages）。
 * 复用现有配置，不新建第二套 Key：
 *   - Base URL / API Key / Model ID 全部由 config/models.yaml 中 ai_chat Route 指向的 Provider 决定
 *   - API Key 只读服务端环境变量，绝不下发前端
 */

/**
 * 「AI 对话」的模型配置全部来自中央模型路由的 ai_chat Route
 * （config/model-routing.yaml → config/models.yaml → Provider）。
 * 想换 AI 对话模型：改 config/model-routing.yaml 的 ai_chat.model，不要改这个文件。
 */
const AI_CHAT_ROUTE = resolveRoute("ai_chat");

export const AI_CHAT_MODEL_ID = AI_CHAT_ROUTE.modelId;
export const AI_CHAT_BASE_URL = AI_CHAT_ROUTE.provider.baseUrl;
export const AI_CHAT_PROVIDER_LABEL = AI_CHAT_ROUTE.provider.label;
export const AI_CHAT_TIMEOUT_MS = AI_CHAT_ROUTE.timeoutMs;
export const AI_CHAT_MAX_TOKENS = Number(process.env.AI_CHAT_MAX_TOKENS || 8192);
export const AI_CHAT_PROVIDER_ENV = AI_CHAT_ROUTE.provider.apiKeyEnv;

export function isAiChatConfigured() {
  return Boolean(AI_CHAT_ROUTE.provider.apiKey);
}

/* ------------------------------------------------------------------ 类型 */

export interface AnthropicTextBlock {
  type: "text";
  text: string;
}

export interface AnthropicToolUseBlock {
  type: "tool_use";
  id: string;
  name: string;
  input: unknown;
}

export interface AnthropicToolResultBlock {
  type: "tool_result";
  tool_use_id: string;
  content: string;
  is_error?: boolean;
}

export type AnthropicContentBlock = AnthropicTextBlock | AnthropicToolUseBlock | AnthropicToolResultBlock;

export interface AnthropicMessage {
  role: "user" | "assistant";
  content: string | AnthropicContentBlock[];
}

export interface ChatToolDefinition {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

export interface StreamChatResult {
  text: string;
  toolUses: Array<{ id: string; name: string; input: unknown }>;
  assistantBlocks: AnthropicContentBlock[];
  stopReason: string;
}

/* ------------------------------------------------------------------ 错误分类（§10） */

export type AiChatErrorCode =
  | "missing_key"
  | "auth"
  | "base_url"
  | "model_not_found"
  | "insufficient_balance"
  | "rate_limit"
  | "network"
  | "server"
  | "stream_interrupted"
  | "empty"
  | "stopped"
  | "unknown";

export class AiChatError extends Error {
  code: AiChatErrorCode;
  status: number;
  hint: string;

  constructor(code: AiChatErrorCode, message: string, options: { status?: number; hint?: string } = {}) {
    super(message);
    this.name = "AiChatError";
    this.code = code;
    this.status = options.status ?? 0;
    this.hint = options.hint || "";
  }
}

export function maskSecrets(value: string) {
  return value
    .replace(/sk-[A-Za-z0-9_-]{8,}/g, "sk-***")
    .replace(/["']?x-api-key["']?\s*[:=]\s*["'][^"']+["']/gi, "x-api-key=***");
}

/** HTTP 状态码 + 中转站返回体 → 可读的中文原因。 */
export function classifyHttpError(status: number, raw: string): AiChatError {
  const body = maskSecrets(raw).slice(0, 400);
  const lowered = raw.toLowerCase();

  if (status === 401 || status === 403) {
    return new AiChatError("auth", "中转站拒绝了这次请求：API Key 无效、已过期或没有该模型权限。", {
      status,
      hint: "请检查 .env.local 里的 TEAMOROUTER_API_KEY 是否为当前有效的中转站 Key。"
    });
  }

  if (status === 404) {
    return new AiChatError("model_not_found", `中转站没有找到模型「${AI_CHAT_MODEL_ID}」。`, {
      status,
      hint: "请在中转站的模型列表中确认这个模型 ID 是否存在。"
    });
  }

  if (status === 402) {
    return new AiChatError("insufficient_balance", "中转站余额不足或套餐已用尽。", {
      status,
      hint: "请到中转站后台充值后重试。"
    });
  }

  if (status === 429) {
    return new AiChatError("rate_limit", "中转站限流了（请求过于频繁或并发超限）。", {
      status,
      hint: "等几秒再发一次即可；连续出现说明需要降低发送频率。"
    });
  }

  if (status === 400) {
    // 实测：中转站对「模型不可用」返回 400 + type=model_not_available（不是 404），所以两种都要认。
    const modelProblem = /(model_not_available|model_not_found|unsupported_model|unknown_model)/i.test(raw)
      || (/(model|模型)/i.test(lowered) && /(not\s*found|not\s*available|unsupported|invalid|不可用|不存在|不支持)/i.test(lowered));
    if (modelProblem) {
      return new AiChatError("model_not_found", `中转站当前不提供模型「${AI_CHAT_MODEL_ID}」：${body.slice(0, 200)}`, {
        status,
        hint: "请在中转站模型列表里确认这个模型 ID 是否可用，或改用 AI_CHAT_MODEL 指定其他模型。"
      });
    }
    if (/(balance|quota|credit|余额|额度)/i.test(lowered)) {
      return new AiChatError("insufficient_balance", `中转站提示额度问题：${body.slice(0, 200)}`, { status });
    }
    return new AiChatError("unknown", `中转站认为请求不合法（HTTP 400）：${body.slice(0, 200)}`, { status });
  }

  if (status >= 500) {
    return new AiChatError("server", `中转站暂时不可用（HTTP ${status}）。`, {
      status,
      hint: "稍后重试；连续多次失败可检查中转站状态页。"
    });
  }

  return new AiChatError("unknown", `中转站返回 HTTP ${status}：${body.slice(0, 200)}`, { status });
}

/** 网络层/中断/异常 → 可读中文原因。 */
export function classifyThrown(error: unknown): AiChatError {
  if (error instanceof AiChatError) return error;

  const message = error instanceof Error ? error.message : String(error);
  const name = error instanceof Error ? error.name : "";

  if (name === "AbortError" || /aborted|abort/i.test(message)) {
    return new AiChatError("stopped", "已停止生成。");
  }
  if (/(ENOTFOUND|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN|fetch failed|network|socket hang up|CERT|TLS)/i.test(message)) {
    if (/ENOTFOUND|EAI_AGAIN|getaddrinfo/i.test(message)) {
      return new AiChatError("base_url", `连不上中转站地址 ${AI_CHAT_BASE_URL}（域名解析失败）。`, {
        hint: "请确认 TEAMOROUTER_BASE_URL 是否正确、本机网络是否可用。"
      });
    }
    return new AiChatError("network", `网络请求失败：${maskSecrets(message).slice(0, 200)}`, {
      hint: "请检查网络或代理设置后重试。"
    });
  }
  if (/timeout/i.test(message)) {
    return new AiChatError("network", "等待中转站响应超时。", { hint: "长回复可适当调大 AI_CHAT_TIMEOUT_MS。" });
  }
  return new AiChatError("unknown", maskSecrets(message).slice(0, 300) || "AI 回复失败，请稍后重试。");
}

/* ------------------------------------------------------------------ 调用（流式） */

export interface StreamChatOptions {
  system: string;
  messages: AnthropicMessage[];
  tools?: ChatToolDefinition[];
  temperature?: number;
  maxTokens?: number;
  signal?: AbortSignal;
  timeoutMs?: number;
  onDelta: (text: string) => void;
  onToolUseStart?: (tool: { id: string; name: string }) => void;
}

/**
 * 流式调用中转站的 Anthropic Messages 接口。
 * 逐段回调文本增量（前端就是靠它做「逐字显示」），并把 tool_use 块解析出来交给调用方。
 */
export async function streamAiChat(options: StreamChatOptions): Promise<StreamChatResult> {
  const apiKey = AI_CHAT_ROUTE.provider.apiKey;
  if (!apiKey) {
    throw new AiChatError("missing_key", `AI 对话模型还没有配置（缺少 ${AI_CHAT_PROVIDER_ENV || "API Key"}）。`, {
      hint: `请在 .env.local 中配置 ${AI_CHAT_PROVIDER_ENV || "TEAMOROUTER_API_KEY"}。`
    });
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? AI_CHAT_TIMEOUT_MS);
  const abortFromCaller = () => controller.abort();
  options.signal?.addEventListener("abort", abortFromCaller, { once: true });

  const body: Record<string, unknown> = {
    model: AI_CHAT_MODEL_ID,
    max_tokens: options.maxTokens ?? AI_CHAT_MAX_TOKENS,
    temperature: options.temperature ?? 0.7,
    system: options.system,
    messages: options.messages,
    stream: true
  };
  if (options.tools && options.tools.length > 0) body.tools = options.tools;

  try {
    const response = await fetch(`${AI_CHAT_BASE_URL}/v1/messages`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01"
      },
      body: JSON.stringify(body),
      signal: controller.signal
    });

    if (!response.ok) {
      throw classifyHttpError(response.status, await response.text().catch(() => ""));
    }
    if (!response.body) {
      throw new AiChatError("stream_interrupted", "中转站没有返回流式内容。");
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let text = "";
    let stopReason = "";
    let sawMessageStop = false;
    const toolUses: Array<{ id: string; name: string; input: unknown; json: string }> = [];
    let currentToolIndex = -1;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      const frames = buffer.split(String.fromCharCode(10) + String.fromCharCode(10));
      buffer = frames.pop() || "";

      for (const frame of frames) {
        if (!frame.trim()) continue;
        let dataLine = "";
        for (const line of frame.split(String.fromCharCode(10))) {
          if (line.startsWith("data:")) dataLine += line.slice(5).trim();
        }
        if (!dataLine) continue;

        let payload: {
          type?: string;
          index?: number;
          content_block?: { type?: string; id?: string; name?: string };
          delta?: { type?: string; text?: string; partial_json?: string; stop_reason?: string };
          error?: { type?: string; message?: string };
        };
        try {
          payload = JSON.parse(dataLine);
        } catch {
          continue;
        }

        if (payload.type === "error" || payload.error) {
          const detail = payload.error?.message || "中转站在流式过程中返回错误";
          throw new AiChatError("server", maskSecrets(detail).slice(0, 300));
        }

        if (payload.type === "content_block_start" && payload.content_block?.type === "tool_use") {
          currentToolIndex = toolUses.length;
          toolUses.push({
            id: payload.content_block.id || `tool_${currentToolIndex}`,
            name: payload.content_block.name || "",
            input: {},
            json: ""
          });
          options.onToolUseStart?.({ id: toolUses[currentToolIndex].id, name: toolUses[currentToolIndex].name });
          continue;
        }

        if (payload.type === "content_block_delta") {
          if (payload.delta?.type === "text_delta" && typeof payload.delta.text === "string" && payload.delta.text) {
            text += payload.delta.text;
            options.onDelta(payload.delta.text);
          } else if (payload.delta?.type === "input_json_delta" && typeof payload.delta.partial_json === "string" && currentToolIndex >= 0) {
            toolUses[currentToolIndex].json += payload.delta.partial_json;
          }
          continue;
        }

        if (payload.type === "content_block_stop") {
          if (currentToolIndex >= 0) {
            const tool = toolUses[currentToolIndex];
            try {
              tool.input = tool.json.trim() ? JSON.parse(tool.json) : {};
            } catch {
              tool.input = { input: tool.json };
            }
            currentToolIndex = -1;
          }
          continue;
        }

        if (payload.type === "message_delta" && payload.delta?.stop_reason) {
          stopReason = payload.delta.stop_reason;
          continue;
        }

        if (payload.type === "message_stop") {
          sawMessageStop = true;
        }
      }
    }

    const resolvedToolUses = toolUses.map((tool) => ({ id: tool.id, name: tool.name, input: tool.input }));

    if (!sawMessageStop && !text && resolvedToolUses.length === 0) {
      throw new AiChatError("stream_interrupted", "流式回复中途断开，没有拿到完整内容。", {
        hint: "重新发送一次即可；连续出现请检查中转站稳定性。"
      });
    }

    const assistantBlocks: AnthropicContentBlock[] = [];
    if (text) assistantBlocks.push({ type: "text", text });
    resolvedToolUses.forEach((tool) => {
      assistantBlocks.push({ type: "tool_use", id: tool.id, name: tool.name, input: tool.input });
    });

    return { text, toolUses: resolvedToolUses, assistantBlocks, stopReason };
  } catch (error) {
    throw classifyThrown(error);
  } finally {
    clearTimeout(timeout);
    options.signal?.removeEventListener("abort", abortFromCaller);
  }
}

/**
 * 把扁平的对话历史整理成 Anthropic Messages 需要的形状：
 * - 角色只能是 user / assistant，且必须 user 开头；
 * - 连续同角色要合并（Anthropic 不接受连续两条同角色消息）。
 */
export function buildAnthropicMessages(history: Array<{ role: "user" | "assistant" | "system"; content: string }>): AnthropicMessage[] {
  const cleaned = history
    .filter((item) => item.content && item.content.trim())
    .map((item) => ({ role: item.role === "assistant" ? ("assistant" as const) : ("user" as const), content: item.content.trim() }));

  while (cleaned.length > 0 && cleaned[0].role !== "user") cleaned.shift();

  const merged: AnthropicMessage[] = [];
  for (const item of cleaned) {
    const last = merged[merged.length - 1];
    if (last && last.role === item.role) {
      last.content = `${last.content}\n\n${item.content}`;
      continue;
    }
    merged.push({ role: item.role, content: item.content });
  }
  return merged;
}
