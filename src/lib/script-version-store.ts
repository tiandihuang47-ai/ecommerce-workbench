import { createId } from "@/lib/shared/id";
import { nowIso } from "@/lib/shared/time";
import { storageGet, storageSet } from "@/lib/web-storage";

const storageKey = "director-platform.scriptDocumentVersions";

export interface ScriptVersionItem {
  id: string;
  scriptId: string;
  version: number;
  title: string;
  text: string;
  createdAt: string;
  /** 父版本 ID（改稿/恢复时的基础版本）；手改/生成首版可缺省 */
  parentVersionId?: string;
  /** 修改来源：手改、局部改稿、整体改稿、恢复历史、新生成 */
  revisionSource?: "manual" | "selection_revise" | "global_revise" | "restore" | "generate";
  /** 本次修改要求摘要 */
  requirementSummary?: string;
  /** 是否被用户"采用"（反馈记录的版本） */
  adopted?: boolean;
  /** 生成时实际使用的经验 ID 清单 */
  experienceIds?: string[];
  /** 保存失败标记（内存中可见；能落盘时不会带此标记） */
  saveFailed?: boolean;
}

function readAll(): ScriptVersionItem[] {
  const saved = storageGet(storageKey);
  if (!saved) return [];
  try {
    const parsed = JSON.parse(saved);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/** 返回 false 表示存储写入失败（配额/网络），调用方必须把失败显示给用户 */
function writeAll(items: ScriptVersionItem[]): boolean {
  try {
    storageSet(storageKey, JSON.stringify(items));
    return true;
  } catch {
    return false;
  }
}

export function getScriptVersions(scriptId: string) {
  return readAll()
    .filter((item) => item.scriptId === scriptId)
    .sort((a, b) => a.version - b.version);
}

/**
 * 追加一个版本。返回 null 表示保存失败（不是没有版本）：
 * 调用方必须提示"保存失败，可重试"，且当前内容仍保留在工作区。
 */
export function appendScriptVersion(
  scriptId: string,
  title: string,
  text: string,
  extra?: Pick<ScriptVersionItem, "parentVersionId" | "revisionSource" | "requirementSummary" | "experienceIds">
): ScriptVersionItem | null {
  const items = readAll();
  const item: ScriptVersionItem = {
    id: createId("script_version"),
    scriptId,
    version: items.filter((entry) => entry.scriptId === scriptId).length + 1,
    title: title || "未命名脚本",
    text,
    createdAt: nowIso(),
    ...extra
  };
  const ok = writeAll([...items, item]);
  return ok ? item : null;
}

export function getLatestScriptVersion(scriptId: string) {
  const items = getScriptVersions(scriptId);
  return items[items.length - 1] || null;
}
