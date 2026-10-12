/**
 * 选区改稿的确定性算术（2026-09 开发文档 §三.C1/C2/C3）。
 * 本文件保持零运行时依赖，便于自动化测试；组件层只调用这里，不自己拼装。
 */

/** 正文哈希：同步、稳定，仅用于"内容是否变化"的一致性判断 */
export function contentHash(text: string): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i);
    h1 = (h1 ^ code) >>> 0;
    h1 = Math.imul(h1, 0x01000193) >>> 0;
    h2 = (h2 + Math.imul(code + i, 0x85ebca6b)) >>> 0;
  }
  return `${h1.toString(16).padStart(8, "0")}${h2.toString(16).padStart(8, "0")}${text.length.toString(16)}`;
}

export type TextRange = { start: number; end: number; text: string };

export type SelectionProposal = {
  baseContentHash: string;
  selection: TextRange;
  replacement: string;
};

export type ApplyProposalResult =
  | { ok: true; content: string; adjustedLocks: TextRange[] }
  | { ok: false; reason: "content_changed" | "selection_changed" | "lock_overlap" | "lock_violated" };

/**
 * 应用选区修改建议。全部为确定性检查，任何一项不过都拒绝应用：
 * 1. 正文哈希必须与建议生成时一致（过期拒绝）；
 * 2. 选区文本必须逐字一致；
 * 3. 建议范围不得与锁定区间重叠；
 * 4. 应用后所有锁定区间文本必须逐字不变（含区间平移后）。
 */
export function applySelectionProposal(
  content: string,
  proposal: SelectionProposal,
  lockedRanges: TextRange[]
): ApplyProposalResult {
  if (contentHash(content) !== proposal.baseContentHash) return { ok: false, reason: "content_changed" };
  const { start, end, text } = proposal.selection;
  if (content.slice(start, end) !== text) return { ok: false, reason: "selection_changed" };

  const delta = proposal.replacement.length - (end - start);
  for (const range of lockedRanges) {
    if (start < range.end && end > range.start) return { ok: false, reason: "lock_overlap" };
  }
  const nextContent = content.slice(0, start) + proposal.replacement + content.slice(end);
  const adjustedLocks: TextRange[] = [];
  for (const range of lockedRanges) {
    const adjustedStart = range.start >= end ? range.start + delta : range.start;
    const adjustedEnd = range.end >= end ? range.end + delta : range.end;
    if (nextContent.slice(adjustedStart, adjustedEnd) !== range.text) {
      return { ok: false, reason: "lock_violated" };
    }
    adjustedLocks.push({ ...range, start: adjustedStart, end: adjustedEnd });
  }
  return { ok: true, content: nextContent, adjustedLocks };
}

/** 手动编辑后检查哪些锁定已失效（文本快照对不上） */
export function invalidLockRanges(content: string, lockedRanges: TextRange[]): TextRange[] {
  return lockedRanges.filter((range) => range.end > content.length || content.slice(range.start, range.end) !== range.text);
}

/** 全局改稿/重新生成的结果必须仍包含全部锁定文本，否则拒绝采用 */
export function locksSurvivedIn(nextContent: string, lockedRanges: TextRange[]): boolean {
  for (const range of lockedRanges) {
    if (!nextContent.includes(range.text)) return false;
  }
  return true;
}
