import type {
  AIChatAssistantKind,
  AIChatContextRef,
  AIChatContextSource,
  AIChatMessage,
  AIChatSession
} from "@/lib/ai-chat-types";
import { storageGet, storageSet } from "@/lib/web-storage";

const storageKey = "director-platform.aiChatSessions";

export function createAIChatId(prefix: string) {
  return `${prefix}_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`;
}

export function getAIChatNow() {
  return new Date().toISOString();
}

export function getAIChatSessions() {
  return readSessions().sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export function getAIChatSessionById(id: string) {
  return readSessions().find((session) => session.id === id) || null;
}

export function getLatestAIChatSession() {
  return getAIChatSessions()[0] || null;
}

export function createAIChatSession(patch: Partial<AIChatSession> = {}) {
  const now = getAIChatNow();
  const session: AIChatSession = {
    id: createAIChatId("chat"),
    title: "新对话",
    messages: [],
    contextRefs: [],
    assistantKind: "general",
    activeSkillIds: [],
    createdAt: now,
    updatedAt: now,
    ...patch
  };

  writeSessions([normalizeSession(session), ...readSessions()]);
  return normalizeSession(session);
}

export function updateAIChatSession(id: string, patch: Partial<AIChatSession>) {
  let updated: AIChatSession | null = null;
  const next = readSessions().map((session) => {
    if (session.id !== id) return session;
    updated = normalizeSession({ ...session, ...patch, updatedAt: patch.updatedAt || getAIChatNow() });
    return updated;
  });
  writeSessions(next);
  return updated;
}

export function deleteAIChatSession(id: string) {
  writeSessions(readSessions().filter((session) => session.id !== id));
}

export function renameAIChatSession(id: string, title: string) {
  const cleaned = title.trim().slice(0, 40);
  if (!cleaned) return null;
  return updateAIChatSession(id, { title: cleaned });
}

export function setAIChatSessionRefs(id: string, contextRefs: AIChatContextRef[]) {
  return updateAIChatSession(id, { contextRefs: contextRefs.slice(0, 3) });
}

export function setAIChatAssistantKind(id: string, assistantKind: AIChatAssistantKind) {
  return updateAIChatSession(id, { assistantKind });
}

export function setAIChatActiveSkills(id: string, activeSkillIds: string[]) {
  return updateAIChatSession(id, { activeSkillIds: activeSkillIds.slice(0, 3) });
}

export function saveAIChatMessage(sessionId: string, message: AIChatMessage) {
  let saved: AIChatMessage | null = null;
  const next = readSessions().map((session) => {
    if (session.id !== sessionId) return session;
    const exists = session.messages.some((item) => item.id === message.id);
    const messages = exists ? session.messages.map((item) => (item.id === message.id ? message : item)) : [...session.messages, message];
    saved = message;
    return normalizeSession({ ...session, messages, updatedAt: getAIChatNow() });
  });
  writeSessions(next);
  return saved;
}

export function updateAIChatMessage(sessionId: string, messageId: string, patch: Partial<AIChatMessage>) {
  let updated: AIChatMessage | null = null;
  const next = readSessions().map((session) => {
    if (session.id !== sessionId) return session;
    const messages = session.messages.map((message) => {
      if (message.id !== messageId) return message;
      updated = { ...message, ...patch };
      return updated;
    });
    return normalizeSession({ ...session, messages, updatedAt: getAIChatNow() });
  });
  writeSessions(next);
  return updated;
}

export function deleteAIChatMessage(sessionId: string, messageId: string) {
  let removed = false;
  const next = readSessions().map((session) => {
    if (session.id !== sessionId) return session;
    const messages = session.messages.filter((message) => message.id !== messageId);
    if (messages.length === session.messages.length) return session;
    removed = true;
    return normalizeSession({ ...session, messages, updatedAt: getAIChatNow() });
  });
  if (removed) writeSessions(next);
  return removed;
}

export function clearAIChatSession(sessionId: string) {
  return updateAIChatSession(sessionId, { messages: [], updatedAt: getAIChatNow() });
}

function readSessions(): AIChatSession[] {
  const raw = storageGet(storageKey);
  if (!raw) return [];

  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.map(normalizeSession) : [];
  } catch {
    return [];
  }
}

function writeSessions(sessions: AIChatSession[]) {
  try {
    storageSet(storageKey, JSON.stringify(sessions.map(normalizeSession)));
  } catch {
    // 页面会在调用处展示保存失败提示，这里保持 store 不抛异常，避免整页崩溃。
  }
}

/**
 * 旧数据兼容：
 * 1. 已有 contextSource/contextRefId 的会话 -> 换算成 contextRefs 里的一条引用；
 * 2. 缺少 contextRefs/assistantKind 的会话 -> 补默认值。
 * 这里刻意不做跨 store 查询（不解析引用标题），避免每次读会话都触发其他模块的 localStorage 读写；
 * 真实标题由界面在渲染时用 resolveContextRef 补齐。
 */
function normalizeSession(session: Partial<AIChatSession>): AIChatSession {
  const now = getAIChatNow();
  const contextRefs = normalizeRefs(session);
  return {
    id: session.id || createAIChatId("chat"),
    title: session.title || "新对话",
    messages: Array.isArray(session.messages) ? session.messages.map(normalizeMessage) : [],
    contextRefs,
    assistantKind: normalizeAssistantKind(session.assistantKind),
    activeSkillIds: normalizeActiveSkillIds(session.activeSkillIds),
    createdAt: session.createdAt || now,
    updatedAt: session.updatedAt || session.createdAt || now
  };
}

function normalizeRefs(session: Partial<AIChatSession>): AIChatContextRef[] {
  const list = Array.isArray(session.contextRefs) ? session.contextRefs : [];
  const refs = list
    .filter((item): item is AIChatContextRef => Boolean(item && item.source && item.refId))
    .map((item) => ({
      id: item.id || createAIChatId("ref"),
      source: item.source,
      refId: item.refId,
      label: item.label || legacySourceLabel(item.source),
      createdAt: item.createdAt || getAIChatNow()
    }))
    .slice(0, 3);

  if (refs.length > 0) return refs;

  const legacySource = session.contextSource;
  const legacyRefId = session.contextRefId;
  if (legacySource && legacySource !== "none" && legacyRefId) {
    return [{
      id: `ref_${legacySource}_${legacyRefId}`,
      source: legacySource,
      refId: legacyRefId,
      label: legacySourceLabel(legacySource),
      createdAt: getAIChatNow()
    }];
  }

  return [];
}

function legacySourceLabel(source: AIChatContextSource) {
  const labels: Record<AIChatContextSource, string> = {
    none: "不使用引用",
    product: "产品资料",
    script: "脚本",
    transcript: "逐字稿",
    deconstruction: "拆片记录",
    review: "数据复盘",
    asset: "资产库"
  };
  return labels[source] || "资料";
}

function normalizeActiveSkillIds(value?: string[]) {
  if (!Array.isArray(value)) return [];
  return Array.from(new Set(value.filter((item) => typeof item === "string" && item.trim()))).slice(0, 3);
}

function normalizeAssistantKind(value?: AIChatAssistantKind): AIChatAssistantKind {
  return value === "script" || value === "deconstruction" || value === "review" ? value : "general";
}

function normalizeMessage(message: Partial<AIChatMessage>): AIChatMessage {
  return {
    id: message.id || createAIChatId("msg"),
    role: message.role || "user",
    content: message.content || "",
    createdAt: message.createdAt || getAIChatNow(),
    status: message.status || "success",
    errorMessage: message.errorMessage || ""
  };
}
