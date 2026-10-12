import type { CommerceImageTask, CommerceImageTaskKind } from "@/lib/commerce-image-types";
import { storageGet, storageSet } from "@/lib/web-storage";

/**
 * 「最近一次在用的生图任务」记忆。
 *
 * 用户离开电商图文再回来时，默认应该回到他上次操作的那一个任务，
 * 而不是每次进入都新建空白任务。新建必须是明确点击「新建」才发生。
 *
 * 只存 id（任务本体在服务端），并按任务类型分别记一份：这样从首页点
 * 「对标详情图复刻」不会被上一次的「电商图文」任务顶掉。
 */
const STORAGE_KEY = "director-platform:commerce-image:last-task";

type LastTaskMap = { global: string; kinds: Partial<Record<CommerceImageTaskKind, string>> };

function read(): LastTaskMap {
  const raw = storageGet(STORAGE_KEY);
  if (!raw) return { global: "", kinds: {} };
  try {
    const parsed = JSON.parse(raw) as Partial<LastTaskMap>;
    return { global: parsed.global || "", kinds: parsed.kinds || {} };
  } catch {
    return { global: "", kinds: {} };
  }
}

function write(next: LastTaskMap) {
  try {
    storageSet(STORAGE_KEY, JSON.stringify(next));
  } catch {
    /* 存不下不影响使用 */
  }
}

export function rememberActiveCommerceTask(taskId: string, kind?: CommerceImageTaskKind) {
  if (!taskId) return;
  const current = read();
  write({ global: taskId, kinds: { ...current.kinds, ...(kind ? { [kind]: taskId } : {}) } });
}

export function forgetActiveCommerceTask(taskId: string) {
  const current = read();
  const kinds = Object.fromEntries(Object.entries(current.kinds).filter(([, id]) => id !== taskId));
  write({ global: current.global === taskId ? "" : current.global, kinds });
}

/** 电商图文与抖音图文共用同一个社交工作台，恢复时都算社交任务。 */
export function resumeKindsFor(kind: CommerceImageTaskKind): CommerceImageTaskKind[] {
  if (kind === "xiaohongshu_post" || kind === "douyin_post") return ["xiaohongshu_post", "douyin_post"];
  return [kind];
}

/**
 * 选一个「该恢复的任务」：
 *   1. 记住的那个任务（还在）→ 直接用它；
 *   2. 否则该类型里最近更新的一个；
 *   3. 一个都没有 → 返回 null，调用方这时才允许新建。
 */
export function chooseResumeTask(tasks: CommerceImageTask[], kind: CommerceImageTaskKind): CommerceImageTask | null {
  const wanted = new Set(resumeKindsFor(kind));
  const candidates = tasks.filter((task) => wanted.has(task.kind));
  if (!candidates.length) return null;
  const remembered = read();
  const ids = [remembered.kinds[kind], ...[...wanted].map((item) => remembered.kinds[item]), remembered.global].filter(Boolean) as string[];
  for (const id of ids) {
    const found = candidates.find((task) => task.id === id);
    if (found) return found;
  }
  return [...candidates].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0] || null;
}
