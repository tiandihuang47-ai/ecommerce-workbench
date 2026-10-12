export type AIChatRole = "user" | "assistant" | "system";
export type AIChatMessageStatus = "sending" | "success" | "failed";
export type AIChatContextSource = "none" | "product" | "script" | "transcript" | "deconstruction" | "review" | "asset";

/** 会话角色：决定服务端使用哪套系统提示词与本地编导规则库。 */
export type AIChatAssistantKind = "general" | "script" | "deconstruction" | "review";

export const aiChatAssistantOptions: Array<{ value: AIChatAssistantKind; label: string; hint: string }> = [
  { value: "general", label: "通用助手", hint: "脚本、拍摄、剪辑、复盘都能问" },
  { value: "script", label: "脚本编导", hint: "带上本地脚本结构与爆款元素规则库" },
  { value: "deconstruction", label: "拆片专家", hint: "带上拆片与可迁移结构规则库" },
  { value: "review", label: "数据复盘", hint: "从数据倒推下一条怎么改" }
];

export interface AIChatMessage {
  id: string;
  role: AIChatRole;
  content: string;
  createdAt: string;
  status: AIChatMessageStatus;
  errorMessage?: string;
}

/** 一条被显式引用的资料（用户点选，不自动检索）。 */
export interface AIChatContextRef {
  id: string;
  source: AIChatContextSource;
  refId: string;
  label: string;
  createdAt: string;
}

export interface AIChatSession {
  id: string;
  title: string;
  messages: AIChatMessage[];
  /** 新版：一次对话可显式引用 0-3 条资料。 */
  contextRefs: AIChatContextRef[];
  /** 会话角色，默认 general。 */
  assistantKind: AIChatAssistantKind;
  /** 当前会话显式启用的 Skill（Installed ≠ Active，见 §34）。 */
  activeSkillIds: string[];
  /** 旧版字段，仅用于兼容历史数据，读取时会被换算成 contextRefs。 */
  contextSource?: AIChatContextSource;
  /** 旧版字段，仅用于兼容历史数据。 */
  contextRefId?: string;
  createdAt: string;
  updatedAt: string;
}

/** 客户端解析好后发给服务端的引用内容。 */
export interface AIChatContextRefPayload {
  source: AIChatContextSource;
  label: string;
  content: string;
}

export interface AIChatContextPayload {
  refs?: AIChatContextRefPayload[];
  /** 旧版单引用形状，服务端继续兼容。 */
  source?: AIChatContextSource;
  content?: string;
}
