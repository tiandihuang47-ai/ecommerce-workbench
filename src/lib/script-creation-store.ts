import { createId } from "@/lib/shared/id";
import { nowIso } from "@/lib/shared/time";
import { storageGet, storageSet } from "@/lib/web-storage";
import { contentHash } from "@/lib/script-revision";
import type { TextRange } from "@/lib/script-revision";

/** 正文哈希与区间类型：实现在零依赖的 script-revision（可被自动化测试直接导入） */
export { contentHash };
export type { TextRange };

/**
 * 脚本创作提效扩展数据（2026-09 本轮开发文档 §二.3）：
 * - CreationProfile 创作档案：明确确认过的长期要求（品牌/内容账号、受众、演员称呼与人数、时长目标、表达偏好、禁用表达）。
 * - ScriptFeedback 稿件反馈：版本级采用/待改/放弃记录（采用不要求原因）。
 * - WritingExperience 创作经验：AI 提炼默认待确认，不自动成为长期规则；范围限档案/仅本条/商品/本人全部。
 * - RevisionProposal 修改建议：选区改稿的待处理/已应用/已放弃建议，含基础版本哈希与确定性检查。
 * - ScriptWorkbenchMeta 工作台扩展：每条稿件的锁定区间、采用版本、档案关联、待处理建议。
 *
 * 旧数据没有这些键时正常工作（读取返回空）；所有字段可选原则遵循文档 §二.2.4。
 */

export const creationProfilesKey = "director-platform.creationProfiles.v1";
export const scriptFeedbacksKey = "director-platform.scriptFeedbacks.v1";
export const writingExperiencesKey = "director-platform.writingExperiences.v1";
export const revisionProposalsKey = "director-platform.revisionProposals.v1";
export const scriptWorkbenchMetaKey = "director-platform.scriptWorkbenchMeta.v1";

export type CreationProfile = {
  id: string;
  name: string;
  /** 品牌/内容账号（抖音等创作身份），与系统登录账号无关 */
  contentAccount?: string;
  platform?: string;
  targetAudience?: string;
  /** 演员称呼与人数，例如 [{label:"女生",count:1}]；未填写即未知，不预设单人或搭档 */
  performers?: Array<{ label: string; count: number }>;
  /** 时长目标（秒），未填写即未知 */
  durationTargetSeconds?: number;
  /** 可用场地与素材说明 */
  venueMaterials?: string;
  /** 表达偏好（可多条） */
  preferences: string[];
  /** 禁用表达 */
  bannedExpressions: string[];
  archived: boolean;
  createdAt: string;
  updatedAt: string;
};

export type ScriptFeedbackDecision = "adopted" | "needs_change" | "discarded";

export type ScriptFeedback = {
  id: string;
  scriptId: string;
  versionId: string;
  versionNumber?: number;
  decision: ScriptFeedbackDecision;
  /** 可选原因（文档 §三.A2 的固定选项 + 自定义并入 note） */
  reasons: string[];
  note?: string;
  /** 操作人：网页模式为登录昵称；桌面模式为"本地" */
  operator: string;
  createdAt: string;
};

export type ExperienceScopeKind = "profile" | "script" | "product" | "all";

export type WritingExperience = {
  id: string;
  /** 规则正文（一条经验一句话） */
  rule: string;
  status: "pending" | "active" | "disabled";
  scope: {
    kind: ExperienceScopeKind;
    profileId?: string;
    productId?: string;
    scriptId?: string;
  };
  /** 来源稿件与版本 */
  source: {
    scriptId?: string;
    versionId?: string;
    baseVersionId?: string;
    feedbackId?: string;
    title?: string;
  };
  /** ai=提炼候选，manual=手动添加 */
  createdFrom: "ai" | "manual";
  /** 被使用的次数（用于排序参考，可缺省） */
  usedCount?: number;
  lastUsedAt?: string;
  createdAt: string;
  updatedAt: string;
};

export type RevisionProposal = {
  id: string;
  scriptId: string;
  baseVersionId?: string;
  baseContentHash: string;
  /** 建议生成时的工作区正文快照哈希（应用前必须与当前一致，否则视为过期） */
  selection: TextRange;
  replacement: string;
  instruction: string;
  status: "pending" | "applied" | "discarded";
  appliedVersionId?: string;
  createdAt: string;
  updatedAt: string;
};

export type ScriptWorkbenchMeta = {
  scriptId: string;
  currentVersionId?: string;
  adoptedVersionId?: string;
  profileId?: string;
  /** 锁定区间；用户手改导致文本快照不匹配时需重新确认，不静默取消 */
  lockedRanges: TextRange[];
  updatedAt: string;
};

function readList<T>(key: string): T[] {
  const raw = storageGet(key);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed as T[] : [];
  } catch {
    return [];
  }
}

function writeList<T>(key: string, items: T[]) {
  storageSet(key, JSON.stringify(items));
}

/* ---------------- 创作档案 ---------------- */

export function getCreationProfiles(includeArchived = false): CreationProfile[] {
  const items = readList<CreationProfile>(creationProfilesKey)
    .map(normalizeProfile)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  return includeArchived ? items : items.filter((item) => !item.archived);
}

export function getCreationProfileById(id: string): CreationProfile | null {
  if (!id) return null;
  return readList<CreationProfile>(creationProfilesKey).map(normalizeProfile).find((item) => item.id === id) ?? null;
}

export function saveCreationProfile(input: Partial<CreationProfile> & { name: string }): CreationProfile {
  const items = readList<CreationProfile>(creationProfilesKey).map(normalizeProfile);
  const now = nowIso();
  const existing = input.id ? items.find((item) => item.id === input.id) : undefined;
  const next: CreationProfile = {
    ...existing,
    id: existing?.id || createId("profile"),
    name: input.name.trim() || existing?.name || "未命名档案",
    contentAccount: input.contentAccount ?? existing?.contentAccount ?? "",
    platform: input.platform ?? existing?.platform ?? "",
    targetAudience: input.targetAudience ?? existing?.targetAudience ?? "",
    performers: Array.isArray(input.performers) ? input.performers : existing?.performers ?? [],
    durationTargetSeconds: input.durationTargetSeconds ?? existing?.durationTargetSeconds,
    venueMaterials: input.venueMaterials ?? existing?.venueMaterials ?? "",
    preferences: (input.preferences ?? existing?.preferences ?? []).map((item) => item.trim()).filter(Boolean),
    bannedExpressions: (input.bannedExpressions ?? existing?.bannedExpressions ?? []).map((item) => item.trim()).filter(Boolean),
    archived: input.archived ?? existing?.archived ?? false,
    createdAt: existing?.createdAt || now,
    updatedAt: now
  };
  const index = items.findIndex((item) => item.id === next.id);
  if (index >= 0) items[index] = next; else items.unshift(next);
  writeList(creationProfilesKey, items);
  return next;
}

/** 复制档案：新 ID、名称加后缀，重置时间 */
export function duplicateCreationProfile(id: string): CreationProfile | null {
  const source = getCreationProfileById(id);
  if (!source) return null;
  return saveCreationProfile({
    ...source,
    id: undefined as unknown as string,
    name: `${source.name} 副本`,
    archived: false
  });
}

export function archiveCreationProfile(id: string, archived: boolean) {
  return saveCreationProfile({ ...getCreationProfileById(id)!, name: getCreationProfileById(id)!.name, id, archived });
}

function normalizeProfile(value: Partial<CreationProfile>): CreationProfile {
  return {
    id: value.id || createId("profile"),
    name: value.name || "未命名档案",
    contentAccount: value.contentAccount || "",
    platform: value.platform || "",
    targetAudience: value.targetAudience || "",
    performers: Array.isArray(value.performers) ? value.performers.filter((item) => item && item.label) : [],
    durationTargetSeconds: typeof value.durationTargetSeconds === "number" ? value.durationTargetSeconds : undefined,
    venueMaterials: value.venueMaterials || "",
    preferences: Array.isArray(value.preferences) ? value.preferences.filter(Boolean) : [],
    bannedExpressions: Array.isArray(value.bannedExpressions) ? value.bannedExpressions.filter(Boolean) : [],
    archived: value.archived === true,
    createdAt: value.createdAt || nowIso(),
    updatedAt: value.updatedAt || value.createdAt || nowIso()
  };
}

/** 档案 → 本次生成的默认要求文本（可被本次明确要求覆盖） */
export function buildProfileRequirementBlock(profile: CreationProfile | null): string {
  if (!profile) return "";
  const lines: string[] = [];
  if (profile.contentAccount) lines.push(`内容账号：${profile.contentAccount}`);
  if (profile.platform) lines.push(`发布平台：${profile.platform}`);
  if (profile.targetAudience) lines.push(`目标受众：${profile.targetAudience}`);
  if (profile.performers?.length) {
    lines.push(`出镜人员：${profile.performers.map((item) => `${item.label}${item.count ? `×${item.count}` : ""}`).join("、")}`);
  }
  if (typeof profile.durationTargetSeconds === "number" && profile.durationTargetSeconds > 0) {
    lines.push(`时长目标：约 ${profile.durationTargetSeconds} 秒（预计值）`);
  }
  if (profile.venueMaterials) lines.push(`可用场地/素材：${profile.venueMaterials}`);
  if (profile.preferences.length) lines.push(`表达偏好：${profile.preferences.join("；")}`);
  if (profile.bannedExpressions.length) lines.push(`禁用表达：${profile.bannedExpressions.join("；")}`);
  if (!lines.length) return "";
  return `【创作档案 · ${profile.name}】（长期默认要求；本次明确要求优先于档案）\n${lines.join("\n")}`;
}

/* ---------------- 稿件反馈 ---------------- */

export const feedbackReasonOptions = [
  "开头绕",
  "像广告",
  "不够口语",
  "人物表达不合适",
  "卖点不清楚",
  "缺少事实依据",
  "拍摄条件不满足",
  "与近期内容重复"
] as const;

export function getScriptFeedbacks(scriptId?: string): ScriptFeedback[] {
  const items = readList<ScriptFeedback>(scriptFeedbacksKey).filter((item) => item && item.id && item.versionId);
  return scriptId ? items.filter((item) => item.scriptId === scriptId) : items;
}

export function getFeedbackForVersion(scriptId: string, versionId: string): ScriptFeedback | null {
  return getScriptFeedbacks(scriptId)
    .filter((item) => item.versionId === versionId)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0] ?? null;
}

export function saveScriptFeedback(input: {
  scriptId: string;
  versionId: string;
  versionNumber?: number;
  decision: ScriptFeedbackDecision;
  reasons?: string[];
  note?: string;
  operator?: string;
}): ScriptFeedback {
  const items = readList<ScriptFeedback>(scriptFeedbacksKey);
  const record: ScriptFeedback = {
    id: createId("feedback"),
    scriptId: input.scriptId,
    versionId: input.versionId,
    versionNumber: input.versionNumber,
    decision: input.decision,
    reasons: (input.reasons ?? []).filter(Boolean),
    note: input.note?.trim() || "",
    operator: input.operator?.trim() || "本地",
    createdAt: nowIso()
  };
  items.push(record);
  writeList(scriptFeedbacksKey, items);
  return record;
}

/* ---------------- 创作经验 ---------------- */

export function getWritingExperiences(filter?: { status?: WritingExperience["status"] }): WritingExperience[] {
  const items = readList<WritingExperience>(writingExperiencesKey).filter((item) => item && item.rule);
  if (!filter?.status) return items;
  return items.filter((item) => item.status === filter.status);
}

export function saveWritingExperience(input: Partial<WritingExperience> & { rule: string }): WritingExperience {
  const items = readList<WritingExperience>(writingExperiencesKey);
  const now = nowIso();
  const existing = input.id ? items.find((item) => item.id === input.id) : undefined;
  const next: WritingExperience = {
    ...(existing ?? {}),
    id: existing?.id || createId("exp"),
    rule: input.rule.trim() || existing?.rule || "",
    status: input.status ?? existing?.status ?? (input.createdFrom === "ai" ? "pending" : "active"),
    scope: input.scope ?? existing?.scope ?? { kind: "all" },
    source: input.source ?? existing?.source ?? {},
    createdFrom: input.createdFrom ?? existing?.createdFrom ?? "manual",
    usedCount: input.usedCount ?? existing?.usedCount ?? 0,
    lastUsedAt: input.lastUsedAt ?? existing?.lastUsedAt,
    createdAt: existing?.createdAt || now,
    updatedAt: now
  };
  const index = items.findIndex((item) => item.id === next.id);
  if (index >= 0) items[index] = next; else items.push(next);
  writeList(writingExperiencesKey, items);
  return next;
}

export function setWritingExperienceStatus(id: string, status: WritingExperience["status"]) {
  const items = readList<WritingExperience>(writingExperiencesKey);
  const index = items.findIndex((item) => item.id === id);
  if (index === -1) return null;
  items[index] = { ...items[index], status, updatedAt: nowIso() };
  writeList(writingExperiencesKey, items);
  return items[index];
}

export function markWritingExperienceUsed(id: string) {
  const items = readList<WritingExperience>(writingExperiencesKey);
  const index = items.findIndex((item) => item.id === id);
  if (index === -1) return;
  items[index] = { ...items[index], usedCount: (items[index].usedCount || 0) + 1, lastUsedAt: nowIso(), updatedAt: nowIso() };
  writeList(writingExperiencesKey, items);
}

export type ExperienceSelection = {
  experiences: WritingExperience[];
  /** 冲突的经验：不静默覆盖，交给本次需求决定（文档 §三.A3） */
  conflicts: WritingExperience[];
  adoptedCases: Array<{ scriptId: string; versionId: string; title: string; text: string }>;
};

/**
 * 确定性经验检索（首版不接向量库，文档 §三.A3）：
 * 1. 只取 status=active；
 * 2. 范围匹配：all / 当前档案 / 当前商品 / 当前稿件；
 * 3. 优先级：当前稿件 > 当前商品 > 当前档案 > 本人全部；同级取较新；
 * 4. 最多 8 条经验、3 个采用案例；超出不删除。
 */
export function selectExperiencesForTask(options: {
  profileId?: string;
  productId?: string;
  scriptId?: string;
  /** 本次被用户手动关闭的经验 ID */
  disabledForRun?: string[];
}): ExperienceSelection {
  const active = getWritingExperiences({ status: "active" })
    .filter((item) => !options.disabledForRun?.includes(item.id));

  const rankOf = (item: WritingExperience): number => {
    const scope = item.scope || { kind: "all" as const };
    if (scope.kind === "script") return options.scriptId && scope.scriptId === options.scriptId ? 0 : -1;
    if (scope.kind === "product") return options.productId && scope.productId === options.productId ? 1 : -1;
    if (scope.kind === "profile") return options.profileId && scope.profileId === options.profileId ? 2 : -1;
    return 3; // 本人全部创作
  };

  const matched = active
    .map((item) => ({ item, rank: rankOf(item) }))
    .filter((entry) => entry.rank >= 0)
    .sort((a, b) => a.rank - b.rank || b.item.updatedAt.localeCompare(a.item.updatedAt));

  const picked: WritingExperience[] = [];
  const conflicts: WritingExperience[] = [];
  const seenRules = new Map<string, WritingExperience>();
  for (const entry of matched) {
    const ruleKey = entry.item.rule.replace(/\s+/g, "");
    const existing = seenRules.get(ruleKey);
    if (existing) {
      // 同义规则不同来源：若 rank 相同取较新（已在排序中），否则视为冲突展示
      if (rankOf(existing) !== entry.rank) conflicts.push(entry.item);
      continue;
    }
    seenRules.set(ruleKey, entry.item);
    if (picked.length < 8) picked.push(entry.item);
    else conflicts.push(entry.item);
  }

  // 采用案例：与本任务同档案/商品的已采用版本正文（最多 3 条）
  const feedbacks = getScriptFeedbacks().filter((item) => item.decision === "adopted");
  const adoptedCases: ExperienceSelection["adoptedCases"] = [];
  for (const feedback of feedbacks.slice().reverse()) {
    if (adoptedCases.length >= 3) break;
    const meta = getWorkbenchMeta(feedback.scriptId);
    if (options.profileId && meta?.profileId && meta.profileId !== options.profileId) continue;
    adoptedCases.push({
      scriptId: feedback.scriptId,
      versionId: feedback.versionId,
      title: `稿件 ${feedback.scriptId.slice(-6)} V${feedback.versionNumber ?? "?"}`,
      text: ""
    });
  }

  return { experiences: picked, conflicts, adoptedCases };
}

/** 经验块 → 注入生成/推荐的文本；被使用经验由调用方记录 ID */
export function buildExperienceBlock(selection: ExperienceSelection): { text: string; ids: string[] } {
  if (!selection.experiences.length) return { text: "", ids: [] };
  const lines = selection.experiences.map((item, index) => `${index + 1}. ${item.rule}`);
  if (selection.conflicts.length) {
    lines.push(`（另有 ${selection.conflicts.length} 条与上述规则存在冲突或超出数量：本次默认不使用；如需要请在本需求中明确。）`);
  }
  return {
    text: `【已确认的创作经验】（团队/个人确认过的表达偏好，仅供表达参考；不得据此编造产品事实）\n${lines.join("\n")}`,
    ids: selection.experiences.map((item) => item.id)
  };
}

/* ---------------- 工作台扩展（每条稿件一份） ---------------- */

export function getWorkbenchMeta(scriptId: string): ScriptWorkbenchMeta | null {
  if (!scriptId) return null;
  const map = readMap();
  return map[scriptId] ?? null;
}

export function updateWorkbenchMeta(scriptId: string, patch: Partial<Omit<ScriptWorkbenchMeta, "scriptId">>): ScriptWorkbenchMeta {
  const map = readMap();
  const existing = map[scriptId] ?? { scriptId, lockedRanges: [], updatedAt: nowIso() };
  const next: ScriptWorkbenchMeta = {
    ...existing,
    ...patch,
    scriptId,
    lockedRanges: patch.lockedRanges ?? existing.lockedRanges ?? [],
    updatedAt: nowIso()
  };
  map[scriptId] = next;
  writeList(scriptWorkbenchMetaKey, Object.values(map));
  return next;
}

function readMap(): Record<string, ScriptWorkbenchMeta> {
  const items = readList<ScriptWorkbenchMeta>(scriptWorkbenchMetaKey);
  const map: Record<string, ScriptWorkbenchMeta> = {};
  for (const item of items) {
    if (item?.scriptId) map[item.scriptId] = {
      ...item,
      lockedRanges: Array.isArray(item.lockedRanges) ? item.lockedRanges.filter((range) => (
        typeof range?.start === "number" && typeof range?.end === "number" && typeof range?.text === "string"
      )) : []
    };
  }
  return map;
}

/* ---------------- 修改建议 ---------------- */

export function getRevisionProposals(scriptId?: string): RevisionProposal[] {
  const items = readList<RevisionProposal>(revisionProposalsKey).filter((item) => item && item.id);
  return (scriptId ? items.filter((item) => item.scriptId === scriptId) : items)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function getPendingRevisionProposal(scriptId: string): RevisionProposal | null {
  return getRevisionProposals(scriptId).find((item) => item.status === "pending") ?? null;
}

export function saveRevisionProposal(input: {
  scriptId: string;
  baseVersionId?: string;
  baseContentHash: string;
  selection: TextRange;
  replacement: string;
  instruction: string;
}): RevisionProposal {
  const items = readList<RevisionProposal>(revisionProposalsKey);
  const now = nowIso();
  const record: RevisionProposal = {
    id: createId("proposal"),
    scriptId: input.scriptId,
    baseVersionId: input.baseVersionId,
    baseContentHash: input.baseContentHash,
    selection: input.selection,
    replacement: input.replacement,
    instruction: input.instruction,
    status: "pending",
    createdAt: now,
    updatedAt: now
  };
  // 每条稿件只保留最近一条待处理建议；旧的待处理自动置为废弃（不删历史）
  for (const item of items) {
    if (item.scriptId === input.scriptId && item.status === "pending") item.status = "discarded";
  }
  items.push(record);
  writeList(revisionProposalsKey, items);
  return record;
}

export function setRevisionProposalStatus(id: string, status: "applied" | "discarded", appliedVersionId?: string) {
  const items = readList<RevisionProposal>(revisionProposalsKey);
  const index = items.findIndex((item) => item.id === id);
  if (index === -1) return null;
  items[index] = { ...items[index], status, appliedVersionId, updatedAt: nowIso() };
  writeList(revisionProposalsKey, items);
  return items[index];
}
