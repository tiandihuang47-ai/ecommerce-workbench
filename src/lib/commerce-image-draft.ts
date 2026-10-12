import type { CommerceImageModel, CommerceImageOutputRatio, CommerceImageQuality, CommerceImageTaskKind } from "@/lib/commerce-image-types";

/**
 * 电商图文的「未完成草稿」。
 *
 * 用户可能已经选了产品、挑了本次参考图、写了一段需求、调了参数，但还没点生成就切去别的页面。
 * 产品与参考图已经存在任务里（服务端），这里只把还没进任务的部分——输入框文字、模型/比例/数量/
 * 清晰度、内容目标、对标链接——按任务 id 存到本地，回来时原样恢复，不用重打一遍。
 */
const PREFIX = "director-platform:commerce-image:draft:";
const MAX_DRAFTS = 40;

export type CommerceImageDraft = {
  kind: CommerceImageTaskKind;
  prompt: string;
  model: CommerceImageModel;
  ratio: CommerceImageOutputRatio;
  count: number;
  quality: CommerceImageQuality;
  goal: string;
  referenceLink: string;
  updatedAt: string;
};

function keyFor(taskId: string) {
  return `${PREFIX}${taskId}`;
}

export function readCommerceImageDraft(taskId: string): CommerceImageDraft | null {
  if (typeof window === "undefined" || !taskId) return null;
  try {
    const parsed = JSON.parse(window.localStorage.getItem(keyFor(taskId)) || "null") as CommerceImageDraft | null;
    if (!parsed || typeof parsed !== "object") return null;
    return parsed;
  } catch {
    return null;
  }
}

export function saveCommerceImageDraft(taskId: string, draft: Omit<CommerceImageDraft, "updatedAt">) {
  if (typeof window === "undefined" || !taskId) return;
  try {
    window.localStorage.setItem(keyFor(taskId), JSON.stringify({ ...draft, updatedAt: new Date().toISOString() }));
    pruneDrafts();
  } catch {
    /* 本地存不下不影响创作 */
  }
}

export function clearCommerceImageDraft(taskId: string) {
  if (typeof window === "undefined" || !taskId) return;
  try {
    window.localStorage.removeItem(keyFor(taskId));
  } catch {
    /* 忽略 */
  }
}

/** 草稿只保留最近若干份，避免长期使用后本地存储越堆越多。 */
function pruneDrafts() {
  try {
    const entries: Array<{ key: string; updatedAt: string }> = [];
    for (let index = 0; index < window.localStorage.length; index += 1) {
      const key = window.localStorage.key(index);
      if (!key?.startsWith(PREFIX)) continue;
      const draft = readCommerceImageDraft(key.slice(PREFIX.length));
      entries.push({ key, updatedAt: draft?.updatedAt || "" });
    }
    if (entries.length <= MAX_DRAFTS) return;
    entries
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .slice(MAX_DRAFTS)
      .forEach((entry) => window.localStorage.removeItem(entry.key));
  } catch {
    /* 忽略 */
  }
}
