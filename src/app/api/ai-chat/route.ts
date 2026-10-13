import { denyIfUnauthenticated } from "@/lib/auth/guard";
import { NextResponse } from "next/server";
import { getDeepSeekRulesContext } from "@/lib/deepseek";
import {
  getAiChatConfig,
  AiChatError,
  buildAnthropicMessages,
  classifyThrown,
  isAiChatConfigured,
  streamAiChat,
  type AnthropicContentBlock,
  type AnthropicMessage,
  type ChatToolDefinition
} from "@/lib/opus-chat-service";
import { buildActiveSkillContext } from "@/lib/skills/chat-context";
import { executeSkillTool } from "@/lib/skills/tool-executor";
import type {
  AIChatAssistantKind,
  AIChatContextPayload,
  AIChatContextRefPayload,
  AIChatContextSource
} from "@/lib/ai-chat-types";

/**
 * AI 对话接口。
 *
 * 模型和协议由中央路由 ai_chat 决定，支持 Anthropic 与 OpenAI 兼容连接。
 * 这里不再调用 DeepSeek —— 脚本 / 爆款复刻 / 生图 / ASR / 复盘等其他模块仍然各自使用原模型。
 * （本文件只从 @/lib/deepseek 复用「本地编导规则库」这一份纯数据，不发起任何 DeepSeek 请求。）
 */

type IncomingMessage = {
  role: "user" | "assistant" | "system";
  content: string;
};

const legacyPictureTerm = `b${"roll"}`;

/** 请求预算：与 docs/CROSS_PLATFORM_DEVELOPMENT_SPEC.md 第 6.4 节保持一致。 */
const maxHistoryMessages = 24;
const maxMessageChars = 12000;
const maxHistoryChars = 40000;
const maxRefs = 3;
const maxRefChars = 4000;
/** 逐字稿是整篇引用：25 分钟视频约 6000-9000 字，放宽到 12000，避免长视频被静默截断。 */
const maxTranscriptRefChars = 12000;
/** 引用总预算：3 份 × 12000 字逐字稿可以完整进入（不再把长逐字稿二次截断）。 */
const maxRefsTotalChars = 36000;

/** 资料被部分发送时产生的提示（发给前端展示，保证“不是暗中只读前半篇”）。 */
export type RefNotice = {
  label: string;
  kind: string;
  totalChars: number;
  sentChars: number;
};

/** 流式输出时至少保留这么多字符不下发，避免替换词被切在两个分片中间。 */
const streamHoldbackChars = 12;
/** 一次回复里最多允许几轮 Skill 工具调用。 */
const maxToolRounds = 4;

const baseSystemPrompt = `
你是「中小企业 AI 内容生产中台」里的电商内容 AI 助手，服务对象是中小电商公司、本地生活商家、工厂老板和小品牌内容团队。
你擅长短视频脚本、爆款拆解、产品卖点提炼、拍摄建议、剪辑建议、图文笔记、直播话术、评论区选题和数据复盘。
回答要直接、可执行、适合团队落地。
不要编造产品价格、销量、检测报告、明星代言、全网最低价等没有依据的信息。
涉及画面补充时，一律使用「画中画」，不要使用 ${legacyPictureTerm} 这个词。
对于用户提供的产品资料，要优先基于资料回答；资料没有的信息，要明确说明没有依据，不能编造。
输出格式：用「## 小标题 + 有序/无序列表」组织内容，短句、可复制；不要用表格，不要写成大段连续文字。
信息不足时，先用一句话列出你还需要用户确认的 1-3 个信息，再基于已有信息给出可用版本。
`.trim();

const roleSystemPrompts: Record<Exclude<AIChatAssistantKind, "general">, string> = {
  script: "当前会话角色：短视频脚本编导。按下面的本地编导规则库出稿，务必给出可直接开拍的逐字稿与分镜，而不是泛泛的建议。",
  deconstruction: "当前会话角色：拆片专家。按下面的本地拆片规则分析结构与可迁移点，不要照搬原文、不要洗稿，迁移到用户自己的产品和人群。",
  review: "当前会话角色：数据复盘顾问。先看数据定位问题，再给出下一条内容的具体修改动作；没有数据支撑的判断必须标注为推测。"
};

const roleRuleTypes: Record<Exclude<AIChatAssistantKind, "general">, "script" | "deconstruction" | "link_deconstruction_rewrite"> = {
  script: "script",
  deconstruction: "deconstruction",
  review: "script"
};

export async function POST(request: Request) {
  const { AI_CHAT_MODEL_ID, AI_CHAT_PROVIDER_LABEL } = getAiChatConfig();
  const deny = await denyIfUnauthenticated(request);
  if (deny) return deny;
  try {
    const body = (await request.json()) as {
      messages?: IncomingMessage[];
      context?: AIChatContextPayload;
      assistantKind?: AIChatAssistantKind;
      stream?: boolean;
      skillIds?: string[];
    };

    const messages = sanitizeMessages(body.messages || []);
    if (messages.length === 0) {
      return NextResponse.json({ success: false, message: "请先输入要和 AI 讨论的问题。" }, { status: 400 });
    }

    if (!isAiChatConfigured()) {
      return NextResponse.json(
        {
          success: false,
          code: "missing_key",
          message: "请在设置中添加自己的 API，并设为默认文字模型。",
          model: AI_CHAT_MODEL_ID
        },
        { status: 500 }
      );
    }

    const assistantKind = normalizeAssistantKind(body.assistantKind);
    const { contextPrompt, refNotices } = buildContextPrompt(body.context);
    // 只加载当前会话启用的 Skill（Installed ≠ Active）。
    const skillContext = await buildActiveSkillContext(Array.isArray(body.skillIds) ? body.skillIds : []);
    const system = buildSystemPrompt(assistantKind, contextPrompt, skillContext.systemPrompt);
    const conversation = buildAnthropicMessages(messages);
    const tools = toAnthropicTools(skillContext.tools);

    if (body.stream === true) {
      return streamCompletion({ system, conversation, tools, toolRoutes: skillContext.toolRoutes, refNotices });
    }

    // 非流式兜底：接口契约保持不变，内部同样是 Opus。
    let collected = "";
    const result = await streamAiChat({
      system,
      messages: conversation,
      tools: tools.length ? tools : undefined,
      temperature: 0.72,
      onDelta: (chunk) => {
        collected += chunk;
      }
    });
    const content = (result.text || collected).trim();
    if (!content) {
      return NextResponse.json({ success: false, message: "模型没有返回有效内容。", model: AI_CHAT_MODEL_ID }, { status: 502 });
    }
    return NextResponse.json({
      success: true,
      content: sanitizeLegacyTerm(content),
      model: AI_CHAT_MODEL_ID,
      provider: AI_CHAT_PROVIDER_LABEL,
      refNotices
    });
  } catch (error) {
    const classified = classifyThrown(error);
    return NextResponse.json(
      { success: false, message: classified.message, code: classified.code, hint: classified.hint, model: AI_CHAT_MODEL_ID },
      { status: classified.code === "missing_key" ? 500 : 502 }
    );
  }
}

/**
 * SSE 流式分支：逐段下发 {delta}，需要执行 Skill 时下发 {tool}，结束 {done}，出错 {error,code}。
 * 前端帧格式与切换模型前完全一致，所以发送/停止/逐字显示体验不变。
 */
function streamCompletion(options: {
  system: string;
  conversation: AnthropicMessage[];
  tools: ChatToolDefinition[];
  toolRoutes: Record<string, string>;
  refNotices: RefNotice[];
}) {
  const { AI_CHAT_MODEL_ID, AI_CHAT_PROVIDER_LABEL } = getAiChatConfig();
  const encoder = new TextEncoder();
  const readable = new ReadableStream<Uint8Array>({
    async start(controller) {
      const emit = (payload: Record<string, unknown>) => {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`));
        } catch {
          // 客户端已经断开，忽略
        }
      };

      // 资料超限提示先发给前端：让用户知道哪些资料只发送了部分内容
      if (options.refNotices.length > 0) {
        emit({ refNotices: options.refNotices });
      }

      // 术语替换的 holdback 缓冲：避免替换词被切在两个分片中间。
      let hold = "";
      const emitDelta = (chunk: string) => {
        hold += chunk;
        if (hold.length > streamHoldbackChars) {
          const cut = hold.length - streamHoldbackChars;
          emit({ delta: sanitizeLegacyTerm(hold.slice(0, cut)) });
          hold = hold.slice(cut);
        }
      };

      const conversation: AnthropicMessage[] = [...options.conversation];
      const startedAt = Date.now();

      try {
        for (let round = 0; round < maxToolRounds; round += 1) {
          const result = await streamAiChat({
            system: options.system,
            messages: conversation,
            tools: options.tools.length ? options.tools : undefined,
            temperature: 0.72,
            onDelta: emitDelta,
            onToolUseStart: (tool) => {
              const skillId = options.toolRoutes[tool.name] || "";
              emit({ tool: { name: tool.name, skillId, label: "正在执行 Skill…" } });
            }
          });

          if (hold) {
            emit({ delta: sanitizeLegacyTerm(hold) });
            hold = "";
          }

          if (result.toolUses.length === 0) {
            console.info(
              `[MODEL_CALL] purpose=ai_chat model=${AI_CHAT_MODEL_ID} provider=${AI_CHAT_PROVIDER_LABEL} duration=${((Date.now() - startedAt) / 1000).toFixed(1)}s status=success source=route`
            );
            emit({ done: true, model: AI_CHAT_MODEL_ID });
            return;
          }

          conversation.push({ role: "assistant", content: result.assistantBlocks });

          const toolResults: AnthropicContentBlock[] = [];
          for (const tool of result.toolUses) {
            const skillId = options.toolRoutes[tool.name] || "";
            if (!skillId) {
              toolResults.push({ type: "tool_result", tool_use_id: tool.id, content: "未知的工具调用。", is_error: true });
              continue;
            }
            const execution = await executeSkillTool(skillId, tool.input);
            toolResults.push({
              type: "tool_result",
              tool_use_id: tool.id,
              content: execution.content.slice(0, 20000),
              is_error: !execution.ok
            });
          }
          conversation.push({ role: "user", content: toolResults });
        }

        console.info(
          `[MODEL_CALL] purpose=ai_chat model=${AI_CHAT_MODEL_ID} provider=${AI_CHAT_PROVIDER_LABEL} duration=${((Date.now() - startedAt) / 1000).toFixed(1)}s status=success source=route`
        );
        emit({ done: true, model: AI_CHAT_MODEL_ID });
      } catch (error) {
        const classified = error instanceof AiChatError ? error : classifyThrown(error);
        console.warn(
          `[MODEL_CALL] purpose=ai_chat model=${AI_CHAT_MODEL_ID} provider=${AI_CHAT_PROVIDER_LABEL} duration=${((Date.now() - startedAt) / 1000).toFixed(1)}s status=error code=${classified.code} reason=${classified.message.slice(0, 200)}`
        );
        emit({ error: classified.message, code: classified.code, hint: classified.hint });
      } finally {
        try {
          controller.close();
        } catch {
          // 正常路径已经关闭
        }
      }
    },
    cancel() {
      // 客户端主动断开（停止生成）：上游 fetch 会随 request signal 一起中断。
    }
  });

  return new Response(readable, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no"
    }
  });
}

/** 把会话角色、引用资料、启用中的 Skill 拼成一份 system 提示词。 */
function buildSystemPrompt(kind: AIChatAssistantKind, contextPrompt: string, skillPrompt: string) {
  const parts = [baseSystemPrompt];

  if (kind !== "general") {
    parts.push(roleSystemPrompts[kind], "【本地编导规则库】", JSON.stringify(getDeepSeekRulesContext(roleRuleTypes[kind]), null, 2));
  }
  if (contextPrompt) parts.push(contextPrompt);
  if (skillPrompt) parts.push(skillPrompt);

  return parts.filter(Boolean).join(String.fromCharCode(10) + String.fromCharCode(10));
}

/** Skill 工具定义转成 Anthropic 的 tools 形状（input_schema）。 */
function toAnthropicTools(tools: Array<{ function: { name: string; description: string; parameters: Record<string, unknown> } }>): ChatToolDefinition[] {
  return tools
    .filter((tool) => tool?.function?.name)
    .map((tool) => ({
      name: tool.function.name,
      description: tool.function.description,
      input_schema: (tool.function.parameters || { type: "object", properties: {} }) as Record<string, unknown>
    }));
}

function normalizeAssistantKind(kind?: AIChatAssistantKind): AIChatAssistantKind {
  return kind === "script" || kind === "deconstruction" || kind === "review" ? kind : "general";
}

function sanitizeLegacyTerm(content: string) {
  return content.replace(new RegExp(`\\bb[\\s-]?${"roll"}\\b`, "gi"), "画中画");
}

/** 只保留最近的 N 条，并同时受「条数」与「总字数」两个预算约束（超出丢最旧）。 */
function sanitizeMessages(messages: IncomingMessage[]) {
  const cleaned = messages
    .filter((message) => ["user", "assistant", "system"].includes(message.role) && message.content?.trim())
    .map((message) => ({
      role: message.role,
      content: message.content.trim().slice(0, maxMessageChars)
    }));

  const kept: typeof cleaned = [];
  let used = 0;
  for (let index = cleaned.length - 1; index >= 0; index -= 1) {
    const message = cleaned[index];
    if (kept.length >= maxHistoryMessages) break;
    if (kept.length > 0 && used + message.content.length > maxHistoryChars) break;
    used += message.content.length;
    kept.unshift(message);
  }
  return kept;
}

/** 支持新版多引用（refs）与旧版单引用（source + content）两种形状；不再静默截断，只做规范化。 */
function normalizeRefs(context?: AIChatContextPayload): Array<AIChatContextRefPayload & { limit: number }> {
  if (!context) return [];

  const incoming = Array.isArray(context.refs) ? context.refs : [];
  const refs = incoming
    .filter((ref): ref is AIChatContextRefPayload => Boolean(ref && typeof ref.content === "string" && ref.content.trim()))
    .map((ref) => {
      const source = normalizeSource(ref.source);
      const content = ref.content.trim();
      return {
        source,
        label: typeof ref.label === "string" && ref.label.trim() ? ref.label.trim().slice(0, 60) : contextLabel(source),
        content,
        limit: source === "transcript" ? maxTranscriptRefChars : maxRefChars
      };
    })
    .slice(0, maxRefs);

  if (refs.length > 0) return refs;

  if (context.source && context.source !== "none" && context.content?.trim()) {
    return [{
      source: context.source,
      label: contextLabel(context.source),
      content: context.content.trim(),
      limit: maxRefChars
    }];
  }

  return [];
}

function buildContextPrompt(context?: AIChatContextPayload): { contextPrompt: string; refNotices: RefNotice[] } {
  const refNotices: RefNotice[] = [];

  const refs = normalizeRefs(context).reduce<AIChatContextRefPayload[]>((list, ref) => {
    const used = list.reduce((total, item) => total + item.content.length, 0);
    // 单条上限 + 总预算，两条限制取更小者；超出部分不再“暗中只读前半篇”，而是显式生成提示
    const allowed = Math.min(ref.limit, Math.max(0, maxRefsTotalChars - used));
    const sentChars = Math.min(ref.content.length, allowed);
    if (sentChars < ref.content.length) {
      refNotices.push({
        label: ref.label,
        kind: contextLabel(ref.source),
        totalChars: ref.content.length,
        sentChars
      });
    }
    if (sentChars <= 0) return list;
    list.push({ source: ref.source, label: ref.label, content: ref.content.slice(0, sentChars) });
    return list;
  }, []);

  if (refs.length === 0) return { contextPrompt: "", refNotices };

  const sections = refs.map((ref, index) => [
    `--- 引用 ${index + 1}/${refs.length}：${contextLabel(ref.source)} · ${ref.label} ---`,
    ref.content
  ].join(String.fromCharCode(10)));

  const contextPrompt = [
    "【用户主动引用的资料】",
    ...sections,
    "",
    "请优先基于以上资料回答。资料里没有的信息必须说明没有依据，不能编造；也不要假设用户还引用了其他没有出现在上面的资料。"
  ].join(String.fromCharCode(10));

  return { contextPrompt, refNotices };
}

function normalizeSource(source?: AIChatContextSource): AIChatContextSource {
  const allowed: AIChatContextSource[] = ["none", "product", "script", "transcript", "deconstruction", "review", "asset"];
  return source && allowed.includes(source) ? source : "asset";
}

function contextLabel(source: AIChatContextSource) {
  const labels: Record<AIChatContextSource, string> = {
    none: "不使用上下文",
    product: "产品资料",
    script: "脚本资产库",
    transcript: "逐字稿",
    deconstruction: "拆片记录",
    review: "数据复盘",
    asset: "资产库"
  };

  return labels[source] || "资料";
}
