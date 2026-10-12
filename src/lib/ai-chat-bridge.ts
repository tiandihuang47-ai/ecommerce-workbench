"use client";

import type { AIChatContextRef, AIChatContextSource } from "@/lib/ai-chat-types";
import { resolveContextRef } from "@/lib/ai-chat-context";

/** 新版跨模块握手 key。 */
export const aiChatHandoffKey = "director-platform.aiChatHandoff";
/** 旧版只传一句话的 key，保留读取以兼容历史入口。 */
export const legacyAiChatDraftPromptKey = "director-platform.aiChatDraftPrompt";

export const aiChatPath = "/ai-chat";

export interface AIChatHandoffReferenceInput {
  source: AIChatContextSource;
  refId: string;
  label?: string;
}

export interface AIChatHandoff {
  version: 1;
  prompt: string;
  references: AIChatContextRef[];
  /** 跳到 AI 对话后要自动挂载的 Skill（来自 Skill 中心的「使用」）。 */
  skillIds: string[];
  /** 跳到 AI 对话后是否直接发送。 */
  autoSend: boolean;
}

export interface AIChatHandoffInput {
  prompt?: string;
  references?: AIChatHandoffReferenceInput[];
  skillIds?: string[];
  /** 默认 false：只把内容放进输入框，用户自己按发送。 */
  autoSend?: boolean;
}

export function buildAIChatHandoff(input: AIChatHandoffInput): AIChatHandoff {
  const stamp = Date.now();
  return {
    version: 1,
    prompt: (input.prompt || "").trim(),
    autoSend: Boolean(input.autoSend),
    skillIds: Array.from(new Set((input.skillIds || []).filter(Boolean))).slice(0, 3),
    references: (input.references || [])
      .filter((item) => item && item.source && item.source !== "none" && item.refId)
      .map((item, index) => ({
        id: `ref_${stamp}_${index}`,
        source: item.source,
        refId: item.refId,
        label: item.label || resolveContextRef({ source: item.source, refId: item.refId }).label,
        createdAt: new Date().toISOString()
      }))
  };
}

/** 写入握手数据。只写不跳转，跳转由调用方决定（便于兼容 window.location.assign）。 */
export function writeAIChatHandoff(handoff: AIChatHandoff) {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(aiChatHandoffKey, JSON.stringify(handoff));
  } catch {
    // 存储失败不阻塞跳转，用户仍可手动输入。
  }
}

/** 读取并清空握手数据，含旧版 key 兼容。 */
export function consumeAIChatHandoff(): AIChatHandoff | null {
  if (typeof window === "undefined") return null;

  try {
    const raw = window.sessionStorage.getItem(aiChatHandoffKey);
    if (raw) {
      window.sessionStorage.removeItem(aiChatHandoffKey);
      const parsed = JSON.parse(raw) as Partial<AIChatHandoff>;
      if (parsed && typeof parsed === "object") {
        return {
          version: 1,
          prompt: typeof parsed.prompt === "string" ? parsed.prompt : "",
          autoSend: Boolean(parsed.autoSend),
          references: Array.isArray(parsed.references) ? parsed.references.filter(Boolean) as AIChatContextRef[] : [],
          skillIds: Array.isArray(parsed.skillIds) ? parsed.skillIds.filter((item) => typeof item === "string") : []
        };
      }
      return null;
    }
  } catch {
    try {
      window.sessionStorage.removeItem(aiChatHandoffKey);
    } catch {
      // 忽略
    }
    return null;
  }

  try {
    const legacy = window.sessionStorage.getItem(legacyAiChatDraftPromptKey);
    if (legacy) {
      window.sessionStorage.removeItem(legacyAiChatDraftPromptKey);
      return { version: 1, prompt: legacy, references: [], skillIds: [], autoSend: false };
    }
  } catch {
    return null;
  }

  return null;
}

/**
 * 一步到位：写入握手数据并返回要跳转的路径。
 * 调用方用 router.push(handOffToAIChat({...}))，或用 window.location.assign(...)。
 */
export function handOffToAIChat(input: AIChatHandoffInput = {}) {
  writeAIChatHandoff(buildAIChatHandoff(input));
  return aiChatPath;
}
