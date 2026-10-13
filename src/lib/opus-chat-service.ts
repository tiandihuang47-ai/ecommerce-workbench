import { resolveRoute, streamOpenAiCompatibleChat } from "@/lib/model-router";

/** AI 对话每次调用都读取中央 ai_chat Route，支持 OpenAI 与 Anthropic 文字协议。
 * 设置页保存的私有 YAML 配置即时生效；已有 Skill 工具循环与业务数据保持不变。
 * Key 仅在服务端解析，永不随模型状态返回页面。
 */
export function getAiChatConfig() {
  const route = resolveRoute("ai_chat");
  return { route, AI_CHAT_MODEL_ID: route.modelId, AI_CHAT_BASE_URL: route.provider.baseUrl, AI_CHAT_PROVIDER_LABEL: route.provider.label, AI_CHAT_TIMEOUT_MS: route.timeoutMs, AI_CHAT_PROVIDER_ENV: route.provider.apiKeyEnv };
}
export const AI_CHAT_MAX_TOKENS = Number(process.env.AI_CHAT_MAX_TOKENS || 8192);
export function isAiChatConfigured() { return Boolean(resolveRoute("ai_chat").provider.apiKey); }

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

/** HTTP 状态码 + API 服务商返回体 → 可读的中文原因。 */
export function classifyHttpError(status: number, raw: string): AiChatError {
  const { AI_CHAT_MODEL_ID } = getAiChatConfig();
  const key = getAiChatConfig().route.provider.apiKey;
  const body = maskSecrets(key ? raw.split(key).join("[已隐藏]") : raw).slice(0, 400);
  const lowered = raw.toLowerCase();

  if (status === 401 || status === 403) {
    return new AiChatError("auth", "API 服务商拒绝了这次请求：API Key 无效、已过期或没有该模型权限。", {
      status,
      hint: "请到设置中的 API 连接检查密钥和模型权限。"
    });
  }

  if (status === 404) {
    return new AiChatError("model_not_found", `API 服务商没有找到模型「${AI_CHAT_MODEL_ID}」。`, {
      status,
      hint: "请在API 服务商的模型列表中确认这个模型 ID 是否存在。"
    });
  }

  if (status === 402) {
    return new AiChatError("insufficient_balance", "API 服务商余额不足或套餐已用尽。", {
      status,
      hint: "请到API 服务商后台充值后重试。"
    });
  }

  if (status === 429) {
    return new AiChatError("rate_limit", "API 服务商限流了（请求过于频繁或并发超限）。", {
      status,
      hint: "等几秒再发一次即可；连续出现说明需要降低发送频率。"
    });
  }

  if (status === 400) {
    // 实测：API 服务商对「模型不可用」返回 400 + type=model_not_available（不是 404），所以两种都要认。
    const modelProblem = /(model_not_available|model_not_found|unsupported_model|unknown_model)/i.test(raw)
      || (/(model|模型)/i.test(lowered) && /(not\s*found|not\s*available|unsupported|invalid|不可用|不存在|不支持)/i.test(lowered));
    if (modelProblem) {
      return new AiChatError("model_not_found", `API 服务商当前不提供模型「${AI_CHAT_MODEL_ID}」：${body.slice(0, 200)}`, {
        status,
        hint: "请在API 服务商模型列表里确认这个模型 ID 是否可用，或在设置中选择其他文字模型。"
      });
    }
    if (/(balance|quota|credit|余额|额度)/i.test(lowered)) {
      return new AiChatError("insufficient_balance", `API 服务商提示额度问题：${body.slice(0, 200)}`, { status });
    }
    return new AiChatError("unknown", `API 服务商认为请求不合法（HTTP 400）：${body.slice(0, 200)}`, { status });
  }

  if (status >= 500) {
    return new AiChatError("server", `API 服务商暂时不可用（HTTP ${status}）。`, {
      status,
      hint: "稍后重试；连续多次失败可检查API 服务商状态页。"
    });
  }

  return new AiChatError("unknown", `API 服务商返回 HTTP ${status}：${body.slice(0, 200)}`, { status });
}

/** 网络层/中断/异常 → 可读中文原因。 */
export function classifyThrown(error: unknown): AiChatError {
  const { AI_CHAT_BASE_URL } = getAiChatConfig();
  if (error instanceof AiChatError) return error;

  const message = error instanceof Error ? error.message : String(error);
  const name = error instanceof Error ? error.name : "";

  if (name === "AbortError" || /aborted|abort/i.test(message)) {
    return new AiChatError("stopped", "已停止生成。");
  }
  if (/(ENOTFOUND|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN|fetch failed|network|socket hang up|CERT|TLS)/i.test(message)) {
    if (/ENOTFOUND|EAI_AGAIN|getaddrinfo/i.test(message)) {
      return new AiChatError("base_url", `连不上API 服务商地址 ${AI_CHAT_BASE_URL}（域名解析失败）。`, {
        hint: "请确认 TEAMOROUTER_BASE_URL 是否正确、本机网络是否可用。"
      });
    }
    return new AiChatError("network", `网络请求失败：${maskSecrets(message).slice(0, 200)}`, {
      hint: "请检查网络或代理设置后重试。"
    });
  }
  if (/timeout/i.test(message)) {
    return new AiChatError("network", "等待API 服务商响应超时。", { hint: "长回复可适当调大 AI_CHAT_TIMEOUT_MS。" });
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
 * 流式调用API 服务商的 Anthropic Messages 接口。
 * 逐段回调文本增量（前端就是靠它做「逐字显示」），并把 tool_use 块解析出来交给调用方。
 */
export async function streamAiChat(options: StreamChatOptions): Promise<StreamChatResult> {
  const { route, AI_CHAT_MODEL_ID, AI_CHAT_BASE_URL, AI_CHAT_TIMEOUT_MS, AI_CHAT_PROVIDER_ENV } = getAiChatConfig();
  if (route.provider.protocol === "openai_compatible") {
    return streamOpenAiCompatibleChat({ ...options, provider: route.provider, modelId: route.modelId, maxTokens: options.maxTokens ?? AI_CHAT_MAX_TOKENS, timeoutMs: options.timeoutMs ?? route.timeoutMs });
  }
  const apiKey = route.provider.apiKey;
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
    const response = await fetch(`${AI_CHAT_BASE_URL.replace(/\/v1$/, "")}/v1/messages`, {
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
      throw new AiChatError("stream_interrupted", "API 服务商没有返回流式内容。");
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
          const detail = payload.error?.message || "API 服务商在流式过程中返回错误";
          throw new AiChatError("server", maskSecrets(detail.split(apiKey).join("[已隐藏]")).slice(0, 300));
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
        hint: "重新发送一次即可；连续出现请检查API 服务商稳定性。"
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
