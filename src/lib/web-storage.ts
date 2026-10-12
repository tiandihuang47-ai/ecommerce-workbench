"use client";

import { useEffect, useState } from "react";
import { fetchAuthState } from "@/lib/auth/use-auth-user";

/**
 * Web 存储桥接层。
 *
 * - 桌面端（无需登录）：所有读写照旧走 localStorage，行为与历史版本完全一致。
 * - 网页端（登录后）：按账号读写服务器上的数据（/api/storage/[key]），每个账号只看得到自己的数据。
 * - 读写函数保持同步签名：网页模式下读内存快照、写内存 + 防抖上传，各 store 无需改动调用方。
 *
 * 可靠性保障（对应“数据保存、同步与迁移”要求）：
 * - 每个键有独立状态：加载中 / 已加载 / 加载失败；保存中 / 已保存 / 保存失败 / 版本冲突；
 * - 加载失败的键不允许把空数据上传覆盖服务器记录（修改只留在本页，状态栏提示可重试）；
 * - 保存携带 If-Match 版本号，服务器版本不一致 → 409 冲突，不盲目覆盖；
 * - 失败自动重试（有上限），并提供手动重试入口；
 * - 旧数据迁移：服务器没有该键而本机浏览器有旧数据时，先收集起来，由用户在界面确认后再迁入；
 *   每台浏览器只提示一次，切换账号不会把上一个账号的数据自动迁给新账号。
 */

export type WebStorageMode = "unknown" | "local" | "web";

/** 需要按账号隔离的所有存储键（与各 store / 组件中的 localStorage 键一一对应） */
export const PER_USER_STORAGE_KEYS = [
  // 资产库 / 产品资料 / 设置 / 对话会话（asset-store）
  "CONTENT_CENTER_ASSETS_V1",
  "CONTENT_CENTER_PRODUCTS_V1",
  "CONTENT_CENTER_SETTINGS_V1",
  "CONTENT_CENTER_CHAT_SESSIONS_V1",
  // 脚本版本（script-version-store）
  "director-platform.scriptDocumentVersions",
  // 爆款复刻 Prompt 任务与草稿（replica-store）
  "director-platform.replicaTasks.v1",
  "director-platform.replicaDraft.v1",
  // AI 对话历史（ai-chat-store）
  "director-platform.aiChatSessions",
  // 脚本创作提效（script-creation-store：档案/反馈/经验/修改建议/工作台扩展）
  "director-platform.creationProfiles.v1",
  "director-platform.scriptFeedbacks.v1",
  "director-platform.writingExperiences.v1",
  "director-platform.revisionProposals.v1",
  "director-platform.scriptWorkbenchMeta.v1",
  // 生图最近任务指针（commerce-image-last-task）
  "director-platform:commerce-image:last-task",
  // 创作草稿与复用入口（script-workbench-page / asset-reuse-client / ai-chat-bridge）
  "director-platform.scriptWorkbenchDraft",
  "director-platform.scriptGeneratorDraft",
  "director-platform.imageGeneratorDraft",
  "director-platform.deconstructionReuseDraft",
  "director-platform.aiChatHandoff",
  "director-platform.aiChatDraftPrompt",
  // 逐字稿库（pipeline-storage）
  "director-platform.scriptTranscripts",
  // pipeline-storage 全部业务记录（产品/脚本/复盘/资料库/拆片等，按账号隔离）
  "director-platform.projects",
  "director-platform.products",
  "director-platform.videoTasks",
  "director-platform.topics",
  "director-platform.scripts",
  "director-platform.shotLists",
  "director-platform.editBriefs",
  "director-platform.publishPlans",
  "director-platform.reviewRecords",
  "director-platform.contentAssets",
  "director-platform.deconstructionRecords",
  "director-platform.approvalRecords",
  "director-platform.versionRecords",
  "director-platform.taskComments",
  "director-platform.teamMembers",
  "director-platform.taskRisks",
  "director-platform.viralAnalyses",
  "director-platform.directorMethods",
  "director-platform.scriptRecords",
  "director-platform.simpleReviewRecords",
  "director-platform.simpleDeconstructionRecords",
  "director-platform.resourceItems",
  "director-platform.productRecords",
  "director-platform.commentInsightRecords",
  // 批量扒稿最近一次结果（batch-transcript-dialog）
  "director-platform.batch-transcript.last"
] as const;

/** 状态栏里展示的键名中文名（未列出的键显示原名） */
const KEY_LABELS: Record<string, string> = {
  CONTENT_CENTER_ASSETS_V1: "资产库",
  CONTENT_CENTER_PRODUCTS_V1: "产品资料",
  CONTENT_CENTER_SETTINGS_V1: "个人设置",
  CONTENT_CENTER_CHAT_SESSIONS_V1: "工作台对话",
  "director-platform.scriptDocumentVersions": "脚本版本",
  "director-platform.replicaTasks.v1": "爆款复刻记录",
  "director-platform.replicaDraft.v1": "爆款复刻草稿",
  "director-platform.aiChatSessions": "AI 对话历史",
  "director-platform:commerce-image:last-task": "生图任务指针",
  "director-platform.scriptWorkbenchDraft": "脚本工作台草稿",
  "director-platform.scriptGeneratorDraft": "脚本生成草稿",
  "director-platform.imageGeneratorDraft": "生图草稿",
  "director-platform.deconstructionReuseDraft": "拆片复用草稿",
  "director-platform.aiChatHandoff": "对话交接内容",
  "director-platform.aiChatDraftPrompt": "对话草稿",
  "director-platform.scriptTranscripts": "逐字稿库",
  "director-platform.projects": "选题项目",
  "director-platform.products": "产品档案",
  "director-platform.videoTasks": "视频任务",
  "director-platform.topics": "选题库",
  "director-platform.scripts": "脚本列表",
  "director-platform.shotLists": "分镜清单",
  "director-platform.editBriefs": "剪辑要点",
  "director-platform.publishPlans": "发布计划",
  "director-platform.reviewRecords": "复盘记录",
  "director-platform.contentAssets": "内容资产",
  "director-platform.deconstructionRecords": "拆片记录",
  "director-platform.approvalRecords": "审批记录",
  "director-platform.versionRecords": "版本记录",
  "director-platform.taskComments": "任务评论",
  "director-platform.teamMembers": "团队成员",
  "director-platform.taskRisks": "任务风险",
  "director-platform.viralAnalyses": "爆款分析",
  "director-platform.directorMethods": "编导方法",
  "director-platform.scriptRecords": "脚本记录",
  "director-platform.simpleReviewRecords": "简单复盘",
  "director-platform.simpleDeconstructionRecords": "简单拆片",
  "director-platform.resourceItems": "资料库",
  "director-platform.productRecords": "产品资料",
  "director-platform.commentInsightRecords": "评论洞察",
  "director-platform.batch-transcript.last": "批量扒稿记录"
};

export function storageKeyLabel(key: string) {
  return KEY_LABELS[key] || key;
}

const VALUE_LIMIT = 8 * 1024 * 1024;
const FLUSH_DELAY_MS = 600;
const MAX_AUTO_RETRY = 5;

export type LoadStatus = "loading" | "ready" | "failed";
export type SaveStatus = "idle" | "saving" | "saved" | "failed" | "conflict" | "too-large";

export type KeyStorageState = {
  key: string;
  load: LoadStatus;
  save: SaveStatus;
  /** 最近一次已知的服务器版本号（null 表示还没从服务器读到过） */
  version: number | null;
  dirty: boolean;
  attempts: number;
  message?: string;
};

type KeyState = {
  load: LoadStatus;
  save: SaveStatus;
  version: number | null;
  dirty: boolean;
  attempts: number;
  message?: string;
};

export type StorageStatusSnapshot = {
  mode: WebStorageMode;
  keys: KeyStorageState[];
  /** 汇总状态，供状态栏直接展示 */
  summary: "idle" | "loading" | "saving" | "saved" | "load-failed" | "save-failed" | "conflict" | "too-large";
};

/** 旧数据迁移（只读展示给用户确认后才执行） */
export type MigrationOffer = {
  keys: Array<{ key: string; label: string; chars: number }>;
  totalChars: number;
};

let mode: WebStorageMode = "unknown";
let readyPromise: Promise<WebStorageMode> | null = null;
const memory = new Map<string, string>();
const states = new Map<string, KeyState>();
const dirtyKeys = new Set<string>();
const saveChains = new Map<string, Promise<void>>();
let flushTimer: ReturnType<typeof setTimeout> | null = null;
let retryTimer: ReturnType<typeof setTimeout> | null = null;

// 旧数据迁移
let migrationOfferAvailable = false;
const migrationCandidates = new Map<string, number>();

// 状态订阅
type StatusListener = (snapshot: StorageStatusSnapshot) => void;
const statusListeners = new Set<StatusListener>();
let notifyScheduled = false;

export function getWebStorageMode(): WebStorageMode {
  return mode;
}

function getState(key: string): KeyState {
  let state = states.get(key);
  if (!state) {
    state = { load: "loading", save: "idle", version: null, dirty: false, attempts: 0 };
    states.set(key, state);
  }
  return state;
}

function notifyListeners() {
  if (notifyScheduled) return;
  notifyScheduled = true;
  Promise.resolve().then(() => {
    notifyScheduled = false;
    const snapshot: StorageStatusSnapshot = {
      mode,
      keys: PER_USER_STORAGE_KEYS.map((key) => {
        const state = states.get(key);
        return {
          key,
          load: state?.load ?? "loading",
          save: state?.save ?? "idle",
          version: state?.version ?? null,
          dirty: state?.dirty ?? false,
          attempts: state?.attempts ?? 0,
          message: state?.message
        };
      }),
      summary: summarize()
    };
    for (const listener of statusListeners) listener(snapshot);
  });
}

function summarize(): StorageStatusSnapshot["summary"] {
  const list = PER_USER_STORAGE_KEYS.map((key) => states.get(key)).filter(Boolean) as KeyState[];
  if (list.some((s) => s.load === "loading")) return "loading";
  if (list.some((s) => s.load === "failed")) return "load-failed";
  if (list.some((s) => s.save === "conflict")) return "conflict";
  if (list.some((s) => s.save === "too-large")) return "too-large";
  if (list.some((s) => s.save === "saving")) return "saving";
  if (list.some((s) => s.save === "failed")) return "save-failed";
  return "idle";
}

export function subscribeStorageStatus(listener: StatusListener): () => void {
  statusListeners.add(listener);
  listener(buildSnapshot());
  return () => statusListeners.delete(listener);
}

function buildSnapshot(): StorageStatusSnapshot {
  return {
    mode,
    keys: PER_USER_STORAGE_KEYS.map((key) => {
      const state = states.get(key);
      return {
        key,
        load: state?.load ?? "loading",
        save: state?.save ?? "idle",
        version: state?.version ?? null,
        dirty: state?.dirty ?? false,
        attempts: state?.attempts ?? 0,
        message: state?.message
      };
    }),
    summary: mode === "web" ? summarize() : "idle"
  };
}

function storageUrl(key: string) {
  return `/api/storage/${encodeURIComponent(key)}`;
}

function scheduleFlush() {
  if (flushTimer) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    void flush();
  }, FLUSH_DELAY_MS);
}

function scheduleRetry(attempts: number) {
  if (retryTimer) return;
  const delay = Math.min(30000, 2000 * Math.pow(2, attempts));
  retryTimer = setTimeout(() => {
    retryTimer = null;
    void flush();
  }, delay);
}

/** 把某个键的上传动作排进它自己的串行队列，保证同键请求按序执行 */
function enqueueKeySave(key: string, op: () => Promise<void>) {
  const chain = (saveChains.get(key) || Promise.resolve()).then(op, op);
  saveChains.set(key, chain.catch(() => undefined));
  return chain;
}

async function uploadKey(key: string): Promise<void> {
  const state = getState(key);
  const value = memory.get(key);
  if (value === undefined) return;
  state.save = "saving";
  state.message = undefined;
  notifyListeners();
  try {
    const headers: Record<string, string> = { "Content-Type": "text/plain" };
    // 版本检查：知道服务器版本时携带 If-Match，防止旧请求覆盖较新的修改
    if (state.version !== null) headers["If-Match"] = String(state.version);
    const res = await fetch(storageUrl(key), { method: "PUT", headers, body: value, keepalive: true });
    if (res.status === 409) {
      const data = (await res.json().catch(() => ({}))) as { version?: number };
      state.save = "conflict";
      state.version = typeof data.version === "number" ? data.version : state.version;
      state.message = "其他窗口或设备修改了这份数据";
      state.attempts = 0;
      notifyListeners();
      return;
    }
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = (await res.json()) as { version?: number };
    state.version = typeof data.version === "number" ? data.version : (state.version ?? 0) + 1;
    state.save = "saved";
    state.attempts = 0;
    state.message = undefined;
    // 上传期间没有新的修改才把脏标记清掉；有新修改则留在队列里等下一次 flush
    if (memory.get(key) === value) {
      state.dirty = false;
      dirtyKeys.delete(key);
    }
    notifyListeners();
  } catch {
    state.attempts += 1;
    if (state.attempts >= MAX_AUTO_RETRY) {
      state.save = "failed";
      state.message = "保存失败，你的修改还保留在本页";
    } else {
      state.save = "saving"; // 仍在自动重试
      state.message = `保存失败，正在重试（${state.attempts}/${MAX_AUTO_RETRY}）`;
      scheduleRetry(state.attempts);
    }
    notifyListeners();
  }
}

async function flush() {
  if (mode !== "web" || dirtyKeys.size === 0) return;
  const keys = Array.from(dirtyKeys);
  for (const key of keys) {
    const state = getState(key);
    // 加载失败的键不允许上传：避免把“内存里的空数据”当成最新值覆盖服务器记录
    if (state.load === "failed") continue;
    if (state.save === "conflict") continue;
    if (memory.get(key) === undefined) {
      dirtyKeys.delete(key);
      continue;
    }
    state.dirty = true;
    enqueueKeySave(key, () => uploadKey(key));
  }
}

async function loadKeyFromServer(key: string): Promise<boolean> {
  const state = getState(key);
  const res = await fetch(storageUrl(key), { cache: "no-store" });
  if (res.status === 404) {
    // 服务器还没有这个键。本机浏览器若有旧数据，登记为迁移候选（等用户确认，不自动上传）
    const localRaw = window.localStorage.getItem(key);
    if (localRaw !== null && localRaw.length > 0 && localRaw.length <= VALUE_LIMIT) {
      migrationCandidates.set(key, localRaw.length);
      migrationOfferAvailable = true;
    }
    memory.set(key, "");
    state.load = "ready";
    state.version = null;
    notifyListeners();
    return true;
  }
  if (res.status === 401) {
    state.load = "failed";
    state.message = "登录状态已过期，请重新登录";
    notifyListeners();
    return false;
  }
  if (!res.ok) {
    state.load = "failed";
    state.message = `加载失败（${res.status}）`;
    notifyListeners();
    return false;
  }
  const data = (await res.json()) as { value?: string; version?: number };
  const serverValue = data.value ?? "";
  const wasDirty = state.dirty && memory.get(key) !== serverValue;
  if (wasDirty) {
    // 本页在加载失败期间有修改：先把服务器当前值备份到服务器上的冲突备份键（双方都保留），
    // 然后保留本页修改；下一次 flush 会带着最新版本号上传，不会再冲突。
    const backupKey = `${key}.conflict.${Date.now()}`;
    await fetch(storageUrl(backupKey), {
      method: "PUT",
      headers: { "Content-Type": "text/plain" },
      body: serverValue
    }).catch(() => undefined);
    state.message = "已把服务器上的旧版本备份，保留了你本页的修改";
  } else {
    memory.set(key, serverValue);
  }
  state.version = typeof data.version === "number" ? data.version : null;
  state.load = "ready";
  notifyListeners();
  return true;
}

async function hydrateKey(key: string) {
  const state = getState(key);
  try {
    await loadKeyFromServer(key);
  } catch {
    state.load = "failed";
    state.message = "网络异常，数据没有加载完整";
    notifyListeners();
  }
}

/** 手动重试：重新加载失败的键（加载成功后保留本页修改，必要时自动备份服务器旧值） */
export async function retryLoadFailedKeys(): Promise<void> {
  if (mode !== "web") return;
  const failed = PER_USER_STORAGE_KEYS.filter((key) => states.get(key)?.load === "failed");
  await Promise.all(failed.map((key) => hydrateKey(key)));
  if (dirtyKeys.size > 0) void flush();
}

/** 覆盖前把服务器当前值备份到独立键（双方版本都保留）；失败返回 false，调用方不应继续覆盖 */
async function backupServerValue(key: string): Promise<boolean> {
  try {
    const res = await fetch(storageUrl(key), { cache: "no-store" });
    if (res.status === 404) return true;
    if (!res.ok) return false;
    const data = (await res.json()) as { value?: string };
    const serverValue = data.value ?? "";
    if (serverValue.length === 0) return true;
    const put = await fetch(storageUrl(`${key}.conflict.${Date.now()}`), {
      method: "PUT",
      headers: { "Content-Type": "text/plain" },
      body: serverValue
    });
    return put.ok;
  } catch {
    return false;
  }
}

/** 手动重试：重新上传保存失败的键；冲突的键先备份服务器当前值再保留本页修改 */
export async function retrySaveFailedKeys(): Promise<void> {
  if (mode !== "web") return;
  const conflictKeys = PER_USER_STORAGE_KEYS.filter((key) => states.get(key)?.save === "conflict");
  for (const key of conflictKeys) {
    const backedUp = await backupServerValue(key);
    const state = getState(key);
    if (!backedUp) {
      // 备份失败就不覆盖：保持冲突状态，用户可重试或改选「采用最新数据」
      state.message = "备份服务器版本失败，暂未覆盖；可稍后重试，或改用「采用最新数据」";
      notifyListeners();
      continue;
    }
    state.attempts = 0;
    state.save = "idle";
    state.message = "已把服务器上的版本备份，保留了你本页的修改";
    dirtyKeys.add(key);
  }
  for (const key of PER_USER_STORAGE_KEYS) {
    const state = states.get(key);
    if (state?.save === "failed") {
      state.attempts = 0;
      dirtyKeys.add(key);
    }
  }
  notifyListeners();
  void flush();
}

/** 版本冲突处理：采用服务器上的最新数据（之后建议刷新页面让各模块重新读取） */
export async function adoptServerValue(key: string): Promise<void> {
  const state = getState(key);
  state.save = "idle";
  state.dirty = false;
  dirtyKeys.delete(key);
  state.attempts = 0;
  state.message = undefined;
  notifyListeners();
  await hydrateKey(key);
}

/* ------------------------------------------------------------------ 迁移确认 */

/** 是否有等待确认的旧数据迁移（每台浏览器只提示一次；结果不自动决定） */
export function getMigrationOffer(): MigrationOffer | null {
  if (mode !== "web" || !migrationOfferAvailable || migrationCandidates.size === 0) return null;
  if (migrationOfferMarker() !== "pending") return null;
  const keys = Array.from(migrationCandidates.entries()).map(([key, chars]) => ({
    key,
    label: storageKeyLabel(key),
    chars
  }));
  return { keys, totalChars: keys.reduce((sum, item) => sum + item.chars, 0) };
}

const MIGRATION_MARKER_KEY = "director-platform.migrationOffer";

function migrationOfferMarker(): "pending" | "done" {
  try {
    return window.localStorage.getItem(MIGRATION_MARKER_KEY) === "done" ? "done" : "pending";
  } catch {
    return "done";
  }
}

function setMigrationMarkerDone() {
  try {
    window.localStorage.setItem(MIGRATION_MARKER_KEY, "done");
  } catch {
    /* ignore */
  }
}

/** 用户确认迁入：把本机旧数据上传为当前账号的数据；本机原始数据保持不动 */
export async function acceptMigration(): Promise<{ migrated: number }> {
  const offer = getMigrationOffer();
  if (!offer) return { migrated: 0 };
  let migrated = 0;
  for (const { key } of offer.keys) {
    const localRaw = window.localStorage.getItem(key);
    if (localRaw === null) continue;
    try {
      const res = await fetch(storageUrl(key), {
        method: "PUT",
        headers: { "Content-Type": "text/plain" },
        body: localRaw
      });
      if (!res.ok) continue;
      const data = (await res.json()) as { version?: number };
      memory.set(key, localRaw);
      const state = getState(key);
      state.version = typeof data.version === "number" ? data.version : 1;
      state.load = "ready";
      migrated += 1;
    } catch {
      /* 单键失败不影响其他键；标记保持 pending，可安全重试 */
    }
  }
  if (migrated === offer.keys.length) setMigrationMarkerDone();
  migrationOfferAvailable = false;
  notifyListeners();
  return { migrated };
}

/** 用户选择暂不迁入：本次不再提示；本机数据保持原样 */
export function declineMigration(): void {
  setMigrationMarkerDone();
  migrationOfferAvailable = false;
  notifyListeners();
}

/* ------------------------------------------------------------------ 水合与读写 */

/** 在渲染任何业务页面之前调用；AppShell 负责等待它完成 */
export function ensureWebStorageReady(): Promise<WebStorageMode> {
  if (readyPromise) return readyPromise;
  readyPromise = (async () => {
    const auth = await fetchAuthState();
    if (!auth.authEnabled || typeof window === "undefined") {
      mode = "local";
      return mode;
    }
    mode = "web";
    notifyListeners();
    await Promise.all(PER_USER_STORAGE_KEYS.map((key) => hydrateKey(key)));
    return mode;
  })();
  return readyPromise;
}

/** 同步读取（供各 store 使用；必须在 ensureWebStorageReady 完成后调用才有网页数据） */
export function storageGet(key: string): string | null {
  if (mode === "web") {
    const value = memory.get(key);
    return value === undefined ? null : value;
  }
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(key);
}

/** 同步写入：网页模式写内存 + 防抖上传；桌面模式写 localStorage */
export function storageSet(key: string, value: string): void {
  if (mode === "web") {
    const state = getState(key);
    if (value.length > VALUE_LIMIT) {
      // 超大内容：留在内存里保证页面可用，但明确标记“没保存上”，不在控制台悄悄吞掉
      memory.set(key, value);
      state.save = "too-large";
      state.message = `内容超过 ${Math.round(VALUE_LIMIT / 1024 / 1024)}MB，暂时无法保存`;
      notifyListeners();
      return;
    }
    const previous = memory.get(key);
    memory.set(key, value);
    if (previous !== value) {
      state.dirty = true;
      if (state.save !== "conflict") {
        state.save = "idle";
        state.message = undefined;
      }
      dirtyKeys.add(key);
      scheduleFlush();
      notifyListeners();
    }
    return;
  }
  if (typeof window === "undefined") return;
  window.localStorage.setItem(key, value);
}

export function storageRemove(key: string): void {
  if (mode === "web") {
    memory.delete(key);
    dirtyKeys.delete(key);
    const state = states.get(key);
    if (state) {
      state.dirty = false;
      state.save = "idle";
      state.message = undefined;
    }
    // 删除排在同键队列最后：不会再被稍后返回的旧保存请求“恢复”
    void enqueueKeySave(key, async () => {
      await fetch(storageUrl(key), { method: "DELETE" }).catch(() => undefined);
    });
    notifyListeners();
    return;
  }
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(key);
}

if (typeof window !== "undefined") {
  // 页面隐藏/关闭前尽力把未上传的改动冲刷出去
  const flushOnHide = () => {
    if (document.visibilityState === "hidden") void flush();
  };
  document.addEventListener("visibilitychange", flushOnHide);
  window.addEventListener("pagehide", () => void flush());
  // 还有未保存修改时，提醒用户（上传仍会用 keepalive 尽力完成）
  window.addEventListener("beforeunload", (event) => {
    if (mode !== "web" || dirtyKeys.size === 0) return;
    const pending = Array.from(dirtyKeys).filter((key) => states.get(key)?.load !== "failed");
    if (pending.length === 0) return;
    event.preventDefault();
    event.returnValue = "";
  });
}

/** AppShell 用：等待存储模式确定 + 网页数据水合完成 */
export function useWebStorageReady(): boolean {
  const [ready, setReady] = useState(mode !== "unknown");

  useEffect(() => {
    if (mode !== "unknown") {
      setReady(true);
      return;
    }
    let mounted = true;
    ensureWebStorageReady().then(() => {
      if (mounted) setReady(true);
    });
    return () => {
      mounted = false;
    };
  }, []);

  return ready;
}
