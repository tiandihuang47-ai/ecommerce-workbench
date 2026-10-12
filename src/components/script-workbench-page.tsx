"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  Archive,
  Check,
  ClipboardCopy,
  Clock,
  FilePlus2,
  FileText,
  FileVideo,
  FileUp,
  History,
  Link2,
  Loader2,
  RefreshCw,
  RotateCw,
  Send,
  Sparkles,
  WandSparkles,
  X
} from "lucide-react";
import { assetFromScriptRecord } from "@/lib/stores/asset-store";
import { detectScriptIntent } from "@/lib/script-intent";
import {
  buildAnalysisSample,
  buildCommentContextBlock,
  cleanComments,
  commentsHash,
  createCommentsState,
  douyinCommentConfig,
  type CommentInsights,
  type CommentRecord,
  type DouyinCommentsState
} from "@/lib/douyin-comments";
import { createProductReferenceSnapshot } from "@/lib/product-reference";
import {
  getProductRecords,
  getScriptRecords,
  saveScriptRecord,
  saveScriptTranscriptRecord,
  updateScriptTranscriptRecordText
} from "@/lib/pipeline-storage";
import type { ProductRecord, ScriptRecord, ScriptRecordStatus } from "@/lib/pipeline-types";
import { createId } from "@/lib/shared/id";
import { nowIso } from "@/lib/shared/time";
import {
  buildProductMetaLine,
  buildProductPromptText,
  createDouyinTranscriptState,
  documentToCopyText,
  documentToPlainText,
  douyinTranscriptToReference,
  estimateDurationSeconds,
  oldRecordToDocument,
  toCopyOnlyDocument,
  type DirectionOption,
  type DouyinTranscriptState,
  type ReferenceItem,
  type ReferenceKind,
  type ScriptDocument
} from "@/lib/script-workbench";
import {
  appendScriptVersion,
  getScriptVersions,
  type ScriptVersionItem
} from "@/lib/script-version-store";
import {
  archiveCreationProfile,
  buildExperienceBlock,
  buildProfileRequirementBlock,
  duplicateCreationProfile,
  feedbackReasonOptions,
  getCreationProfiles,
  getFeedbackForVersion,
  getPendingRevisionProposal,
  getScriptFeedbacks,
  getWritingExperiences,
  getWorkbenchMeta,
  markWritingExperienceUsed,
  saveCreationProfile,
  saveRevisionProposal,
  saveScriptFeedback,
  saveWritingExperience,
  selectExperiencesForTask,
  setRevisionProposalStatus,
  setWritingExperienceStatus,
  updateWorkbenchMeta,
  type CreationProfile,
  type RevisionProposal,
  type WritingExperience
} from "@/lib/script-creation-store";
import {
  applySelectionProposal,
  contentHash,
  invalidLockRanges,
  locksSurvivedIn as locksSurvivedInPure
} from "@/lib/script-revision";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { storageGet, storageSet } from "@/lib/web-storage";

const workbenchDraftKey = "director-platform.scriptWorkbenchDraft";
const legacyScriptDraftKey = "director-platform.scriptGeneratorDraft";

/**
 * 解析完抖音逐字稿后的快捷动作：前三个直接在逐字稿上动手，不用先点「分析并推荐方向」。
 * 第四个是可选的方向推荐，保持原样。
 */
const transcriptQuickActions: Array<{ label: string; instruction: string }> = [
  {
    label: "基于原稿仿写",
    instruction: "基于这份逐字稿仿写一版：结构、节奏、信息顺序都保持，换一套自己的说法，不要照抄原句。"
  },
  {
    label: "优化原稿",
    instruction: "把这份逐字稿优化一下：更口语、更顺、更抓人，保留原有结构和全部信息，不要大改。"
  },
  {
    label: "换成我的产品",
    instruction: "把它换成我的产品：保持原结构和表达逻辑，只把产品、卖点、场景替换成当前产品资料里的真实信息，不要编造参数。"
  }
];

/** 「只问不改」模式下的快捷问题：点一下直接问，不动稿子。 */
const askQuickPrompts = [
  "评论区大家最关心什么？",
  "观众最怕的是什么？",
  "这条脚本哪里没讲清楚？",
  "下一条应该拍什么？"
];

// 只保留和文案有关的指令：镜头/画面相关的要求已经不再需要。
const assistantQuickPrompts = [
  "更自然一点",
  "更口语、更短一点",
  "更有冲击力",
  "优化结尾引导",
  "检查问题"
];

const referenceKindLabel: Record<ReferenceKind, string> = {
  video: "参考视频",
  text: "参考文案",
  document: "产品文档"
};

const referenceStatusLabel: Record<ReferenceItem["status"], string> = {
  uploading: "上传中",
  analyzing: "分析中",
  done: "已解析",
  failed: "失败"
};

interface WorkbenchDraft {
  productId?: string;
  brief?: string;
  directions?: DirectionOption[];
  selectedDirectionId?: string;
  references?: ReferenceItem[];
  document?: ScriptDocument | null;
  currentScriptId?: string;
  douyinInput?: string;
  douyinTranscript?: DouyinTranscriptState | null;
  /** 抖音评论 + 评论洞察（与逐字稿同属当前脚本任务，随草稿持久化）。 */
  douyinComments?: DouyinCommentsState | null;
  archived?: WorkbenchSession[];
}

// 「新建脚本」收起的那一份内容；结构和工作区一致，便于整份恢复。
interface WorkbenchSession {
  id: string;
  archivedAt: string;
  productId: string;
  brief: string;
  directions: DirectionOption[];
  selectedDirectionId: string;
  references: ReferenceItem[];
  document: ScriptDocument | null;
  currentScriptId: string;
  douyinInput: string;
  douyinTranscript: DouyinTranscriptState | null;
  douyinComments?: DouyinCommentsState | null;
}

const archivedSessionLimit = 3;

function draftReferences(items: ReferenceItem[]) {
  // 草稿持久化保留全文（超出存储上限时由 web-storage 统一提示，不再悄悄截断）
  return items;
}

function draftDouyinTranscript(state: DouyinTranscriptState | null) {
  return state;
}

// 收起/恢复时不能停留在「正在解析…」。
function normalizeDouyinTranscript(state: DouyinTranscriptState | null) {
  if (!state) return null;
  return state.status === "running"
    ? { ...state, status: "failed" as const, stage: "INTERRUPTED", error: "上次解析被中断，请重试" }
    : state;
}

function sessionTitle(session: WorkbenchSession) {
  const title = session.document?.title?.trim();
  if (title) return title;
  const brief = session.brief.trim();
  if (brief) return brief.slice(0, 24);
  return session.douyinTranscript?.title?.trim() || "未命名脚本";
}

function sessionSummary(session: WorkbenchSession) {
  const parts: string[] = [];
  if (session.document) parts.push(`脚本 ${session.document.sections.length} 段`);
  if (session.directions.length) parts.push(`${session.directions.length} 个方向`);
  const referenceCount = session.references.filter((item) => item.status === "done").length
    + (douyinTranscriptToReference(session.douyinTranscript) ? 1 : 0);
  if (referenceCount) parts.push(`${referenceCount} 项资料`);
  return parts.join(" · ") || "未生成内容";
}

function sessionTime(iso: string) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/**
 * 「当前这一份脚本」的所有状态。
 * 新建脚本 = 把整份替换成 createEmptyWorkspace()，
 * 所以以后新增任何属于当前脚本的字段，只要加进这个接口和 createEmptyWorkspace()，就不会再漏清。
 */
interface WorkspaceState {
  currentProductId: string;
  brief: string;
  references: ReferenceItem[];
  directions: DirectionOption[];
  selectedDirectionId: string;
  document: ScriptDocument | null;
  currentScriptId: string;
  versions: ScriptVersionItem[];
  douyinInput: string;
  douyinTranscript: DouyinTranscriptState | null;
  douyinComments: DouyinCommentsState | null;
  showDouyin: boolean;
  showPaste: boolean;
  pasteText: string;
  assistantInput: string;
  editingKey: string;
  customInstruction: string;
  customEditingKey: string;
  notice: string;
  recommending: boolean;
  generating: boolean;
  assistantBusy: boolean;
}

/** 全新空白脚本工作台：和第一次打开脚本页时完全一致。 */
function createEmptyWorkspace(notice = ""): WorkspaceState {
  return {
    currentProductId: "",
    brief: "",
    references: [],
    directions: [],
    selectedDirectionId: "",
    document: null,
    currentScriptId: "",
    versions: [],
    douyinInput: "",
    douyinTranscript: null,
    douyinComments: null,
    showDouyin: false,
    showPaste: false,
    pasteText: "",
    assistantInput: "",
    editingKey: "",
    customInstruction: "",
    customEditingKey: "",
    notice,
    recommending: false,
    generating: false,
    assistantBusy: false
  };
}

function buildLegacyRecord(
  document: ScriptDocument | null,
  product: ProductRecord | null,
  brief: string,
  previous?: ScriptRecord | null,
  douyinSource?: ScriptRecord["douyinSource"]
): ScriptRecord {
  const text = document ? documentToCopyText(document) : brief.trim();
  const section = (key: string) => document?.sections.find((item) => item.key === key)?.content || "";
  const title = document?.title?.trim() || (brief.trim() ? brief.trim().slice(0, 30) : "未命名脚本");
  return {
    id: createId("script"),
    title,
    productId: product?.id || "",
    productSnapshot: product ? createProductReferenceSnapshot(product) : undefined,
    productName: product?.name || "",
    targetAudience: product?.targetAudience || "",
    painPoint: product?.painPoints || "",
    sellingPoint: product?.coreSellingPoints || "",
    contentType: "短视频口播",
    platform: "抖音",
    contentFormat: "短视频口播",
    materialSource: product ? "产品资料" : "手动输入",
    videoGoal: "成交",
    hook: section("hook"),
    scriptText: section("script") || section("dialog") || text,
    // 现在只生产文案：这些字段不再生成；旧记录里已有的内容原样带回，不主动清空。
    shotSuggestions: section("shots") || previous?.shotSuggestions || "",
    overlaySuggestions: section("overlay") || previous?.overlaySuggestions || "",
    shootingTips: section("actions") || section("tips") || previous?.shootingTips || "",
    endingCTA: section("ending") || previous?.endingCTA || "",
    status: "草稿" as ScriptRecordStatus,
    tags: "",
    favorite: false,
    createdBy: "编导",
    createdAt: nowIso(),
    updatedAt: nowIso(),
    reviewId: "",
    sourceType: "脚本生成",
    sourceDeconstructionId: "",
    ...(douyinSource ? { douyinSource } : {})
  };
}

export function ScriptWorkbenchPage() {
  const [products, setProducts] = useState<ProductRecord[]>([]);
  const [currentProductId, setCurrentProductId] = useState("");
  const [brief, setBrief] = useState("");
  const [references, setReferences] = useState<ReferenceItem[]>([]);
  const [directions, setDirections] = useState<DirectionOption[]>([]);
  const [selectedDirectionId, setSelectedDirectionId] = useState("");
  const [document, setDocument] = useState<ScriptDocument | null>(null);
  const [currentScriptId, setCurrentScriptId] = useState("");
  const [versions, setVersions] = useState<ScriptVersionItem[]>([]);
  const [notice, setNotice] = useState("");
  const [recommending, setRecommending] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [assistantBusy, setAsssistantBusy] = useState(false);
  const [assistantInput, setAssistantInput] = useState("");
  /** 「只问不改」：提问模式只返回回答，不产出/修改脚本。 */
  const [askMode, setAskMode] = useState(false);
  const [assistantAnswer, setAssistantAnswer] = useState("");
  const [editingKey, setEditingKey] = useState("");
  const [customInstruction, setCustomInstruction] = useState("");
  const [customEditingKey, setCustomEditingKey] = useState("");
  const [showPaste, setShowPaste] = useState(false);
  const [pasteText, setPasteText] = useState("");
  const [showDouyin, setShowDouyin] = useState(false);
  const [douyinInput, setDouyinInput] = useState("");
  const [douyinTranscript, setDouyinTranscript] = useState<DouyinTranscriptState | null>(null);
  const [douyinComments, setDouyinComments] = useState<DouyinCommentsState | null>(null);
  const [showAllComments, setShowAllComments] = useState(false);
  const [archived, setArchived] = useState<WorkbenchSession[]>([]);
  const [draftReady, setDraftReady] = useState(false);

  /* ---- 创作提效：档案 / 经验 / 反馈 / 选区改稿（2026-09 开发文档 A/B/C）---- */
  const [profiles, setProfiles] = useState<CreationProfile[]>([]);
  const [activeProfileId, setActiveProfileId] = useState("");
  const [profileDraft, setProfileDraft] = useState<CreationProfile | null>(null);
  const [experiences, setExperiences] = useState<WritingExperience[]>([]);
  const [runDisabledExperienceIds, setRunDisabledExperienceIds] = useState<string[]>([]);
  const [usedExperienceIds, setUsedExperienceIds] = useState<string[]>([]);
  const [manualExperienceRule, setManualExperienceRule] = useState("");
  const [feedbackVersionId, setFeedbackVersionId] = useState("");
  const [feedbackReasons, setFeedbackReasons] = useState<string[]>([]);
  const [feedbackNote, setFeedbackNote] = useState("");
  const [pendingProposal, setPendingProposal] = useState<RevisionProposal | null>(null);
  const [reviseInstruction, setReviseInstruction] = useState("");
  const [reviseBusy, setReviseBusy] = useState(false);
  const [selection, setSelection] = useState<{ start: number; end: number } | null>(null);
  const [lastAdoption, setLastAdoption] = useState<{ versionId: string; baseVersionId: string } | null>(null);
  const [extracting, setExtracting] = useState(false);

  const currentProduct = useMemo(
    () => products.find((item) => item.id === currentProductId) || null,
    [products, currentProductId]
  );

  /* ---- 创作提效：派生数据 ---- */
  const activeProfile = useMemo(() => profiles.find((item) => item.id === activeProfileId) || null, [profiles, activeProfileId]);
  const profileBlock = useMemo(() => buildProfileRequirementBlock(activeProfile), [activeProfile]);
  const experienceSelection = useMemo(
    () => selectExperiencesForTask({
      profileId: activeProfileId || undefined,
      productId: currentProductId || undefined,
      scriptId: currentScriptId || undefined,
      disabledForRun: runDisabledExperienceIds
    }),
    [activeProfileId, currentProductId, currentScriptId, runDisabledExperienceIds]
  );
  const experienceBlock = useMemo(() => buildExperienceBlock(experienceSelection), [experienceSelection]);
  const scriptMeta = useMemo(() => (currentScriptId ? getWorkbenchMeta(currentScriptId) : null), [currentScriptId, pendingProposal, versions]);
  /** 锁定内容块：注入生成提示词 + 客户端结果校验，双保险防绕过 */
  const lockBlock = useMemo(() => {
    const ranges = scriptMeta?.lockedRanges || [];
    if (!ranges.length) return "";
    return `【锁定内容（用户要求保护，必须逐字保留在结果中）】\n${ranges.map((range) => range.text).join("\n---\n")}`;
  }, [scriptMeta]);
  /** 失效锁定：用户手改后文本快照对不上，需要明确提示，不静默取消 */
  const invalidLocks = useMemo(() => {
    const content = document?.sections[0]?.content;
    if (!content || !scriptMeta?.lockedRanges?.length) return [];
    return invalidLockRanges(content, scriptMeta.lockedRanges);
  }, [document, scriptMeta]);

  function refreshCreationData() {
    setProfiles(getCreationProfiles());
    setExperiences(getWritingExperiences());
  }

  // 档案/经验与存储桥接层一样，都要等水合完成后再读（AppShell 已保证 pageReady）
  useEffect(() => {
    refreshCreationData();
  }, [draftReady]);

  // 切换稿件时：恢复该稿的档案关联与待处理修改建议
  useEffect(() => {
    setSelection(null);
    setLastAdoption(null);
    if (!currentScriptId) {
      setPendingProposal(null);
      return;
    }
    setPendingProposal(getPendingRevisionProposal(currentScriptId));
    const meta = getWorkbenchMeta(currentScriptId);
    if (meta?.profileId) setActiveProfileId(meta.profileId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentScriptId]);

  function handleSwitchProfile(profileId: string) {
    setActiveProfileId(profileId);
    const profile = profiles.find((item) => item.id === profileId) || null;
    if (currentScriptId) {
      updateWorkbenchMeta(currentScriptId, { profileId: profileId || undefined });
    }
    // 切换档案后带入默认要求：仅当本次要求为空时预填，不覆盖已输入内容
    if (profile && !brief.trim()) {
      const defaults = [profile.preferences.join("；"), profile.targetAudience ? `面向：${profile.targetAudience}` : ""]
        .filter(Boolean).join("。");
      if (defaults) setBrief(defaults);
    }
  }

  function submitProfileDraft() {
    if (!profileDraft?.name.trim()) {
      setNotice("档案名称不能为空。");
      return;
    }
    const saved = saveCreationProfile(profileDraft);
    refreshCreationData();
    setProfileDraft(null);
    setActiveProfileId(saved.id);
    if (currentScriptId) updateWorkbenchMeta(currentScriptId, { profileId: saved.id });
    setNotice(`创作档案「${saved.name}」已保存。`);
  }

  /* ---- 稿件反馈（A2）：采用/待改/放弃，绑定具体版本 ---- */
  function submitFeedback(version: ScriptVersionItem, decision: "adopted" | "needs_change" | "discarded") {
    if (!currentScriptId) return;
    saveScriptFeedback({
      scriptId: currentScriptId,
      versionId: version.id,
      versionNumber: version.version,
      decision,
      reasons: decision === "adopted" ? [] : feedbackReasons,
      note: feedbackNote,
      operator: "本地"
    });
    if (decision === "adopted") {
      updateWorkbenchMeta(currentScriptId, { adoptedVersionId: version.id });
      const baseVersionId = version.parentVersionId
        || versions.filter((item) => item.version < version.version).slice(-1)[0]?.id
        || "";
      if (baseVersionId) setLastAdoption({ versionId: version.id, baseVersionId });
      setNotice(`已采用 V${version.version}。` + (baseVersionId ? "可点「提炼经验」把这次的修改沉淀为经验。" : ""));
    } else if (decision === "discarded") {
      setNotice(`V${version.version} 已标记放弃。稿件仍保留，不影响其他版本。`);
    } else {
      setNotice(`V${version.version} 已标记待改。`);
    }
    setFeedbackVersionId("");
    setFeedbackReasons([]);
    setFeedbackNote("");
  }

  /* ---- 经验提炼与手动添加（A3）---- */
  async function extractExperienceFromAdoption() {
    if (!lastAdoption || !currentScriptId) return;
    const base = versions.find((item) => item.id === lastAdoption.baseVersionId);
    const adopted = versions.find((item) => item.id === lastAdoption.versionId);
    if (!base || !adopted) {
      setNotice("找不到基础版本，无法对比提炼。");
      return;
    }
    setExtracting(true);
    try {
      const data = await requestWorkbench({
        action: "extractExperience",
        baseText: base.text,
        text: adopted.text
      });
      const rules = Array.isArray(data.rules) ? (data.rules as string[]) : [];
      if (!data.success || rules.length === 0) {
        setNotice(typeof data.message === "string" && data.message ? data.message : "这两版差异较小，没有提炼出可复用经验。");
        return;
      }
      for (const rule of rules) {
        saveWritingExperience({
          rule,
          createdFrom: "ai",
          status: "pending",
          scope: activeProfileId ? { kind: "profile", profileId: activeProfileId } : { kind: "all" },
          source: { scriptId: currentScriptId, versionId: adopted.id, baseVersionId: base.id }
        });
      }
      refreshCreationData();
      setNotice(`已提炼 ${rules.length} 条经验候选（待确认），可在「创作经验」中启用后用于下次创作。`);
    } finally {
      setExtracting(false);
    }
  }

  function addManualExperience() {
    const rule = manualExperienceRule.trim();
    if (!rule) return;
    saveWritingExperience({
      rule,
      createdFrom: "manual",
      status: "active",
      scope: activeProfileId ? { kind: "profile", profileId: activeProfileId } : { kind: "all" }
    });
    setManualExperienceRule("");
    refreshCreationData();
    setNotice("经验已启用。范围：" + (activeProfileId ? "当前创作档案" : "本人全部创作") + "。");
  }

  /* ---- 选区改稿（C1/C2）：只改选中，锁定范围程序保护 ---- */
  function currentContent(): string {
    return document?.sections[0]?.content ?? "";
  }

  function startSelectionRevise() {
    const content = currentContent();
    if (!content || !selection || selection.end <= selection.start) {
      setNotice("请先在正文中选中要修改的文字。");
      return;
    }
    const scriptId = currentScriptId || saveDraftAndReturnId();
    const meta = getWorkbenchMeta(scriptId);
    const insideLock = (meta?.lockedRanges || []).some(
      (range) => selection.start < range.end && selection.end > range.start
    );
    if (insideLock) {
      setNotice("选中区域包含已锁定内容。请先解除对应锁定，再修改。");
      return;
    }
    if (!reviseInstruction.trim()) {
      setNotice("请先填写这一段怎么改。");
      return;
    }
    const before = content.slice(Math.max(0, selection.start - 60), selection.start);
    const after = content.slice(selection.end, selection.end + 60);
    setReviseBusy(true);
    setNotice("正在按选区生成修改建议…");
    void (async () => {
      try {
        const data = await requestWorkbench({
          action: "revise",
          baseText: content,
          selectionStart: selection.start,
          selectionEnd: selection.end,
          baseContentHash: contentHash(content),
          instruction: reviseInstruction,
          productText: buildProductPromptText(currentProduct || undefined),
          profileBlock,
          experienceBlock,
          context: `${before}【选中】${content.slice(selection.start, selection.end)}【选中结束】${after}`
        });
        if (!data.success || typeof data.replacement !== "string") {
          setNotice(typeof data.message === "string" ? data.message : "未生成修改建议，正文未改动。");
          return;
        }
        const versionsNow = getScriptVersions(scriptId);
        const proposal = saveRevisionProposal({
          scriptId,
          baseVersionId: versionsNow[versionsNow.length - 1]?.id,
          baseContentHash: contentHash(content),
          selection: { start: selection.start, end: selection.end, text: content.slice(selection.start, selection.end) },
          replacement: data.replacement,
          instruction: reviseInstruction
        });
        setPendingProposal(proposal);
        setNotice("修改建议已生成，请查看前后对比后选择应用或放弃。");
      } finally {
        setReviseBusy(false);
      }
    })();
  }

  /** 应用建议：确定性检查（正文未变、选区未变、锁定未变），任何一项不过都拒绝应用 */
  function applyProposal() {
    if (!pendingProposal || !document) return;
    const content = currentContent();
    const meta = getWorkbenchMeta(currentScriptId);
    const result = applySelectionProposal(content, pendingProposal, meta?.lockedRanges || []);
    if (!result.ok) {
      const reasonText: Record<string, string> = {
        content_changed: "正文在你生成建议后已变化，这条建议已过期。当前文字未改动。",
        selection_changed: "选中区域内容已变化，建议已过期。请重新选中再生成。",
        lock_overlap: "建议范围与锁定内容重叠，已拒绝应用。请先解除对应锁定。",
        lock_violated: "应用会导致锁定内容变化，已拒绝应用。"
      };
      setNotice(reasonText[result.reason]);
      return;
    }
    const nextContent = result.content;
    const nextDocument: ScriptDocument = {
      ...document,
      sections: document.sections.map((section) => section.key === "script" ? { ...section, content: nextContent } : section)
    };
    setDocument(nextDocument);
    updateWorkbenchMeta(currentScriptId, { lockedRanges: result.adjustedLocks });
    const version = commitScriptVersion(nextDocument, {
      parentVersionId: pendingProposal.baseVersionId,
      revisionSource: "selection_revise",
      requirementSummary: pendingProposal.instruction
    });
    setRevisionProposalStatus(pendingProposal.id, "applied", version?.id);
    setPendingProposal(null);
    setReviseInstruction("");
    setSelection(null);
    setNotice(version ? "已应用修改建议，保存为新版本。" : "修改已应用到正文，但版本保存失败：请点「保存版本」重试。");
  }

  function discardProposal() {
    if (!pendingProposal) return;
    setRevisionProposalStatus(pendingProposal.id, "discarded");
    setPendingProposal(null);
    setNotice("已放弃这条修改建议，正文未改动。");
  }

  function toggleLockSelection() {
    const content = currentContent();
    if (!content || !selection || selection.end <= selection.start) {
      setNotice("请先在正文中选中要锁定（或解锁）的文字。");
      return;
    }
    const scriptId = currentScriptId || saveDraftAndReturnId();
    const meta = getWorkbenchMeta(scriptId);
    const ranges = [...(meta?.lockedRanges || [])];
    const text = content.slice(selection.start, selection.end);
    const index = ranges.findIndex((range) => range.start === selection.start && range.end === selection.end);
    if (index >= 0) {
      ranges.splice(index, 1);
      updateWorkbenchMeta(scriptId, { lockedRanges: ranges });
      setNotice("已解除锁定。");
    } else {
      ranges.push({ start: selection.start, end: selection.end, text });
      updateWorkbenchMeta(scriptId, { lockedRanges: ranges });
      setNotice(`已锁定选中内容（共 ${ranges.length} 处）。全局改稿、重新生成都不会改动它。`);
    }
  }

  function confirmInvalidLocks() {
    if (!currentScriptId) return;
    const meta = getWorkbenchMeta(currentScriptId);
    const content = currentContent();
    const valid = (meta?.lockedRanges || []).filter(
      (range) => range.end <= content.length && content.slice(range.start, range.end) === range.text
    );
    updateWorkbenchMeta(currentScriptId, { lockedRanges: valid });
    setNotice(`已清除 ${((meta?.lockedRanges?.length || 0) - valid.length)} 处失效锁定（原文本已改动）。其余锁定仍受保护。`);
  }

  // 当前脚本会话的代号：新建/切换会话时 +1，让还在飞的上传、解析、生成结果作废，
  // 避免它们把上一份脚本的内容写回新工作区（这是「点了新建旧内容又回来」的根因之一）。
  const sessionEpoch = useRef(0);
  const isStaleSession = (epoch: number) => epoch !== sessionEpoch.current;

  // AI 输入框随内容自动增高，最多 160px，超过后内部滚动。
  const assistantInputRef = useRef<HTMLTextAreaElement | null>(null);
  useEffect(() => {
    const element = assistantInputRef.current;
    if (!element) return;
    element.style.height = "auto";
    element.style.height = `${Math.min(element.scrollHeight, 160)}px`;
  }, [assistantInput, document]);

  /** 一次性写入整份工作区状态，和 createEmptyWorkspace() 一一对应。 */
  function applyWorkspace(next: WorkspaceState) {
    setCurrentProductId(next.currentProductId);
    setBrief(next.brief);
    setReferences(next.references);
    setDirections(next.directions);
    setSelectedDirectionId(next.selectedDirectionId);
    setDocument(next.document);
    setCurrentScriptId(next.currentScriptId);
    setVersions(next.versions);
    setDouyinInput(next.douyinInput);
    setDouyinTranscript(next.douyinTranscript);
    setDouyinComments(next.douyinComments);
    setShowDouyin(next.showDouyin);
    setShowPaste(next.showPaste);
    setPasteText(next.pasteText);
    setAssistantInput(next.assistantInput);
    setEditingKey(next.editingKey);
    setCustomInstruction(next.customInstruction);
    setCustomEditingKey(next.customEditingKey);
    setNotice(next.notice);
    setRecommending(next.recommending);
    setGenerating(next.generating);
    setAsssistantBusy(next.assistantBusy);
  }

  /** 开一段新的脚本会话：作废在飞请求，并清掉地址栏上的 ?record= / ?reuseAsset=。 */
  function beginNewSession() {
    sessionEpoch.current += 1;
    if (typeof window !== "undefined" && window.location.search) {
      window.history.replaceState(null, "", window.location.pathname);
    }
  }

  useEffect(() => {
    const availableProducts = getProductRecords();
    setProducts(availableProducts);

    try {
      const params = new URLSearchParams(window.location.search);
      const recordId = params.get("record");
      const reuseAsset = params.get("reuseAsset");

      // 恢复也走同一份 createEmptyWorkspace()，保证「恢复出来的」和「新建的」字段集合完全一致。
      const next = createEmptyWorkspace();

      if (reuseAsset) {
        const legacy = storageGet(legacyScriptDraftKey);
        if (legacy) {
          const parsed = JSON.parse(legacy) as Record<string, unknown>;
          if (typeof parsed.productId === "string") next.currentProductId = parsed.productId;
          const extra = typeof parsed.extra === "string" ? parsed.extra : "";
          if (extra && !extra.includes("基于历史资产继续创作")) next.brief = extra;
        }
        next.notice = "已从资产库恢复产品资料和脚本创作简报，可直接调整后重新生成。";
        applyWorkspace(next);
      } else if (recordId) {
        const record = getScriptRecords().find((item) => item.id === recordId);
        if (record) {
          next.currentProductId = record.productId || "";
          next.document = oldRecordToDocument(record);
          next.currentScriptId = record.id;
          next.versions = getScriptVersions(record.id);
          next.notice = "已打开历史脚本，可以直接编辑或保存新版本。";
          // 历史脚本里存过抖音来源资产就直接恢复，不再重新抓评论（§二十八）。
          const source = record.douyinSource;
          if (source && (source.transcript || (source.comments || []).length)) {
            next.douyinInput = source.url || "";
            next.showDouyin = Boolean(source.url || source.transcript);
            if (source.transcript) {
              next.douyinTranscript = {
                status: "done",
                link: source.url || "",
                transcript: source.transcript,
                title: "",
                authorName: "",
                durationSeconds: 0,
                stage: "",
                error: "",
                retryable: true,
                updatedAt: source.commentsFetchedAt || ""
              };
            }
            const restoredComments: CommentRecord[] = (source.comments || []).map((item) => ({
              commentId: String(item.commentId || ""),
              awemeId: source.awemeId || "",
              text: String(item.text || ""),
              createdAt: String(item.createdAt || ""),
              likeCount: Number(item.likeCount || 0),
              replyCount: Number(item.replyCount || 0),
              user: { nickname: String(item.nickname || "") },
              isReply: false,
              ipLocation: item.ipLocation ? String(item.ipLocation) : undefined
            })).filter((item) => item.commentId && item.text);
            next.douyinComments = {
              status: restoredComments.length ? "success" : "partial",
              awemeId: source.awemeId || "",
              url: source.url || "",
              comments: restoredComments,
              totalFetched: restoredComments.length,
              totalReported: 0,
              hasMore: false,
              fetchedAt: source.commentsFetchedAt || "",
              includeReplies: false,
              stage: "RESTORED",
              error: "",
              insights: (source.commentInsights as CommentInsights | null) || null,
              insightStatus: source.commentInsights ? "done" : "idle"
            };
          }
          applyWorkspace(next);
        }
      } else {
        const saved = storageGet(workbenchDraftKey);
        if (saved) {
          const parsed = JSON.parse(saved) as WorkbenchDraft;
          if (parsed.productId) next.currentProductId = parsed.productId;
          if (parsed.brief) next.brief = parsed.brief;
          if (Array.isArray(parsed.directions)) next.directions = parsed.directions;
          if (parsed.selectedDirectionId) next.selectedDirectionId = parsed.selectedDirectionId;
          if (Array.isArray(parsed.references)) next.references = parsed.references;
          if (parsed.document) next.document = toCopyOnlyDocument(parsed.document);
          if (parsed.currentScriptId) {
            next.currentScriptId = parsed.currentScriptId;
            next.versions = getScriptVersions(parsed.currentScriptId);
          }
          if (typeof parsed.douyinInput === "string") next.douyinInput = parsed.douyinInput;
          if (parsed.douyinComments && typeof parsed.douyinComments === "object") {
            // 注意：必须写进 next 再由 applyWorkspace 一次性落状态。
            // 之前这里直接调 setDouyinComments，紧接着 applyWorkspace(next) 又用 next.douyinComments(null)
            // 把它覆盖掉——表现就是「切到别的模块再回来，刚抓的评论没了，还得重新解析」。
            next.douyinComments = parsed.douyinComments.status === "fetching"
              ? { ...parsed.douyinComments, status: "failed", stage: "INTERRUPTED", error: "上次获取评论被中断，可点刷新重试" }
              : parsed.douyinComments;
          }
          if (parsed.douyinTranscript && typeof parsed.douyinTranscript === "object") {
            // 上次解析中途切页会被浏览器中断，恢复时不能停留在「正在解析…」。
            next.douyinTranscript = normalizeDouyinTranscript(parsed.douyinTranscript);
            next.showDouyin = true;
          }
          if (Array.isArray(parsed.archived)) {
            setArchived(
              parsed.archived
                .filter((item): item is WorkbenchSession => Boolean(item && typeof item === "object"))
                .slice(0, archivedSessionLimit)
                .map((item) => ({ ...item, douyinTranscript: normalizeDouyinTranscript(item.douyinTranscript || null) }))
            );
          }
          applyWorkspace(next);
        }
      }
    } catch {
      setNotice("脚本草稿恢复失败，可以继续新建内容。");
    } finally {
      setDraftReady(true);
    }
  }, []);

  useEffect(() => {
    if (!draftReady) return;
    const draft: WorkbenchDraft = {
      productId: currentProductId,
      brief,
      directions,
      selectedDirectionId,
      references: draftReferences(references),
      document,
      currentScriptId,
      douyinInput,
      douyinTranscript: draftDouyinTranscript(douyinTranscript),
      douyinComments: douyinComments
        ? {
          ...douyinComments,
          // 评论可以到 200 条，草稿里限一下长度，避免 localStorage 膨胀。
          comments: douyinComments.comments.slice(0, 300).map((item) => ({
            ...item,
            text: item.text.length > 400 ? `${item.text.slice(0, 400)}…` : item.text,
            raw: undefined
          }))
        }
        : null,
      archived
    };
    try {
      storageSet(workbenchDraftKey, JSON.stringify(draft));
    } catch {
      setNotice("草稿自动保存失败，请检查本地存储空间。");
    }
  }, [draftReady, currentProductId, brief, directions, selectedDirectionId, references, document, currentScriptId, douyinInput, douyinTranscript, douyinComments, archived]);

  /**
   * 每次仿写 / 优化 / 局部修改 / 重新创作都落一个版本（V1、V2、V3…），
   * 原逐字稿始终不动，用户随时可以回退到任意一版。
   */
  function commitScriptVersion(
    nextDocument: ScriptDocument,
    extra?: { parentVersionId?: string; revisionSource?: "manual" | "selection_revise" | "global_revise" | "restore" | "generate"; requirementSummary?: string; experienceIds?: string[] }
  ) {
    let scriptId = currentScriptId;
    if (!scriptId) {
      const saved = saveScriptRecord(buildLegacyRecord(nextDocument, currentProduct, brief, currentRecordSnapshot(), douyinSourcePayload()));
      assetFromScriptRecord(saved);
      setCurrentScriptId(saved.id);
      scriptId = saved.id;
    }
    const version = appendScriptVersion(scriptId, nextDocument.title, documentToPlainText(nextDocument), extra);
    setVersions(getScriptVersions(scriptId));
    if (!version) {
      setNotice("版本保存失败（存储空间不足或网络异常）：当前文字还在，请点「保存版本」重试。");
      return null;
    }
    return version;
  }

  // 保存前取回同一条记录：不再生产的字段（分镜/画中画/拍摄提醒/结尾引导）保持原样。
  function currentRecordSnapshot() {
    if (!currentScriptId) return null;
    return getScriptRecords().find((item) => item.id === currentScriptId) || null;
  }

  function selectProduct(productId: string) {
    setCurrentProductId(productId);
    setNotice(productId ? "已切换当前产品。" : "");
  }

  function updateReference(id: string, patch: Partial<ReferenceItem>) {
    setReferences((current) => current.map((item) => item.id === id ? { ...item, ...patch } : item));
  }

  function removeReference(id: string) {
    setReferences((current) => current.filter((item) => item.id !== id));
  }

  async function requestWorkbench(payload: Record<string, unknown>) {
    const response = await fetch("/api/script/workbench", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    const data = await response.json();
    return data as Record<string, unknown>;
  }

  // 抖音逐字稿是当前脚本任务的一份参考资料；没有逐字稿时这里是 null，旧逻辑不变。
  const douyinReference = useMemo(() => douyinTranscriptToReference(douyinTranscript), [douyinTranscript]);

  function buildReferencePayloads() {
    const payloads = references.filter((item) => item.status === "done").map((item) => ({
      kind: item.kind,
      name: item.name,
      summary: item.summary,
      analysis: item.analysis,
      transcript: item.transcript,
      extractedText: item.extractedText,
      facts: item.facts,
      inferences: item.inferences
    }));
    if (douyinReference) {
      payloads.push({
        kind: douyinReference.kind,
        name: douyinReference.name,
        summary: douyinReference.summary,
        analysis: douyinReference.analysis,
        transcript: douyinReference.transcript,
        extractedText: douyinReference.extractedText,
        facts: douyinReference.facts,
        inferences: douyinReference.inferences
      });
    }
    return payloads;
  }

  async function parseDouyinTranscript() {
    const input = (douyinInput.trim() || douyinTranscript?.link || "").trim();
    if (!input) {
      setNotice("请先粘贴抖音视频链接或整段分享文案。");
      return;
    }
    const epoch = sessionEpoch.current;
    const previousTranscript = douyinTranscript?.link === input ? douyinTranscript.transcript : "";
    setDouyinInput(input);
    setShowDouyin(true);
    setDouyinTranscript({
      ...createDouyinTranscriptState(input, previousTranscript),
      status: "running",
      updatedAt: new Date().toISOString()
    });
    setNotice("正在解析抖音视频逐字稿…");
    // 评论与视频/ASR 没有依赖：解析一开始就并行去抓，缩短总等待（§九）。
    void fetchComments({ silent: true, input });
    try {
      const response = await fetch("/api/script/douyin-transcript", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ input })
      });
      const data = await response.json().catch(() => ({})) as Record<string, unknown>;
      // 解析期间如果用户点了「新建脚本」，这份结果不能再写回工作区。
      if (isStaleSession(epoch)) return;
      const transcript = typeof data.transcript === "string" ? data.transcript.trim() : "";
      if (data.success && transcript) {
        const title = typeof data.title === "string" ? data.title : "";
        const authorName = typeof data.authorName === "string" ? data.authorName : "";
        const awemeId = typeof data.awemeId === "string" ? data.awemeId : "";
        // 解析成功即落「逐字稿库」：AI 对话可以不经过生成脚本直接引用这份逐字稿。
        // 同一视频重新解析按 awemeId / 链接命中同一条记录，只更新不重复。
        const savedTranscript = saveScriptTranscriptRecord({
          awemeId,
          link: input,
          title: title.trim(),
          authorName: authorName.trim(),
          transcript
        });
        setDouyinTranscript({
          status: "done",
          link: input,
          transcript,
          title,
          authorName,
          durationSeconds: Number(data.durationSeconds) || 0,
          awemeId,
          stage: "",
          error: "",
          transcriptRecordId: savedTranscript.id,
          updatedAt: new Date().toISOString()
        });
        setNotice("抖音逐字稿已解析成功，已作为仿写底稿：生成脚本时以它为准。");
        return;
      }
      const stage = typeof data.stage === "string" ? data.stage : "VIDEO_IMPORT_FAILED";
      // 账户类问题（例如阿里云欠费）重试没有意义，界面不再显示「重试」。
      const retryable = data.retryable !== false;
      setDouyinTranscript({
        ...createDouyinTranscriptState(input, ""),
        status: "failed",
        stage,
        retryable,
        error: typeof data.message === "string" && data.message ? data.message : douyinStageMessage(stage),
        updatedAt: new Date().toISOString()
      });
      setNotice(retryable ? douyinStageMessage(stage) : (typeof data.message === "string" && data.message ? data.message : douyinStageMessage(stage)));
    } catch {
      if (isStaleSession(epoch)) return;
      setDouyinTranscript({
        ...createDouyinTranscriptState(input, ""),
        status: "failed",
        stage: "NETWORK_ERROR",
        retryable: true,
        error: "网络请求失败，请重试。",
        updatedAt: new Date().toISOString()
      });
      setNotice("网络请求失败，请重试。");
    }
  }

  function updateDouyinTranscript(transcript: string) {
    setDouyinTranscript((current) => current
      ? { ...current, transcript, updatedAt: new Date().toISOString() }
      : current);
    // 工作台里修过的逐字稿同步回「逐字稿库」，AI 对话引用到的就是修正后的版本。
    if (douyinTranscript?.transcriptRecordId) {
      updateScriptTranscriptRecordText(douyinTranscript.transcriptRecordId, transcript);
    }
  }

  async function copyDouyinTranscript() {
    const text = douyinTranscript?.transcript?.trim() || "";
    if (!text) return;
    const ok = await writeClipboard(text);
    setNotice(ok ? "已复制逐字稿。" : "复制失败，请手动选中文字复制。");
  }

  function removeDouyinTranscript() {
    if (!window.confirm("确定删除这份抖音逐字稿吗？删除后需要重新解析。")) return;
    setDouyinTranscript(null);
    setDouyinInput("");
    setShowDouyin(false);
    setNotice("已删除抖音逐字稿。");
  }

  function hasWorkspaceContent() {
    return Boolean(
      brief.trim()
      || references.length
      || directions.length
      || document
      || douyinInput.trim()
      || douyinTranscript
    );
  }

  function snapshotWorkspace(): WorkbenchSession {
    return {
      id: createId("session"),
      archivedAt: nowIso(),
      productId: currentProductId,
      brief,
      directions,
      selectedDirectionId,
      references: draftReferences(references),
      document,
      currentScriptId,
      douyinInput,
      douyinTranscript: draftDouyinTranscript(normalizeDouyinTranscript(douyinTranscript)),
      douyinComments
    };
  }

  /**
   * 新建脚本：把当前这一份内容（含拆解结果）收起到「已收起的历史脚本」，
   * 然后整份换成空白工作区——产品、简报、参考资料、方向、脚本、版本、逐字稿、AI 助手上下文全部归零。
   * 历史脚本、已保存版本、收起的快照都不动。
   */
  function startNewScript() {
    const snapshot = hasWorkspaceContent() ? snapshotWorkspace() : null;
    if (snapshot) {
      setArchived((current) => [snapshot, ...current].slice(0, archivedSessionLimit));
    }
    // 必须在清空状态之前开新会话：先让在飞请求作废、清掉地址栏上的旧 scriptId。
    beginNewSession();
    applyWorkspace(createEmptyWorkspace(
      snapshot ? "上一份内容已收起，可以开始新脚本。" : "当前已经是空白脚本，可以直接开始。"
    ));
  }

  function restoreArchivedSession(session: WorkbenchSession) {
    if (!window.confirm(`确定恢复「${sessionTitle(session)}」吗？当前这次内容会被同时收起。`)) return;
    const current = hasWorkspaceContent() ? snapshotWorkspace() : null;
    setArchived((items) => {
      const rest = items.filter((item) => item.id !== session.id);
      return (current ? [current, ...rest] : rest).slice(0, archivedSessionLimit);
    });
    beginNewSession();
    const next = createEmptyWorkspace("已恢复收起的脚本，可以继续编辑。");
    next.currentProductId = session.productId || "";
    next.brief = session.brief || "";
    next.references = session.references || [];
    next.directions = session.directions || [];
    next.selectedDirectionId = session.selectedDirectionId || "";
    next.document = session.document || null;
    next.currentScriptId = session.currentScriptId || "";
    next.versions = session.currentScriptId ? getScriptVersions(session.currentScriptId) : [];
    next.douyinInput = session.douyinInput || "";
    next.douyinTranscript = normalizeDouyinTranscript(session.douyinTranscript || null);
    next.showDouyin = Boolean(session.douyinTranscript || session.douyinInput);
    next.douyinComments = session.douyinComments || null;
    applyWorkspace(next);
  }

  function removeArchivedSession(id: string) {
    if (!window.confirm("确定删除这份收起的脚本吗？删除后无法恢复。")) return;
    setArchived((items) => items.filter((item) => item.id !== id));
    setNotice("已删除收起的脚本。");
  }

  /**
   * 抓评论：与逐字稿解析并行触发（§九）。失败只影响评论区，不影响逐字稿与生成（§三十七）。
   */
  async function fetchComments(options?: { refresh?: boolean; silent?: boolean; input?: string }) {
    const input = (options?.input || douyinInput || douyinTranscript?.link || "").trim();
    if (!input) {
      if (!options?.silent) setNotice("请先粘贴抖音链接，再获取评论。");
      return;
    }
    const epoch = sessionEpoch.current;
    const previous = douyinComments;
    setDouyinComments({
      ...(previous || createCommentsState(input)),
      status: "fetching",
      url: input,
      stage: "FETCHING",
      error: ""
    });
    if (!options?.silent) setNotice("正在获取评论…");
    try {
      const response = await fetch("/api/script/douyin-comments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          input,
          maxComments: douyinCommentConfig.defaultMaxComments,
          includeReplies: douyinCommentConfig.includeReplies
        })
      });
      const data = await response.json().catch(() => ({})) as Record<string, unknown>;
      if (isStaleSession(epoch)) return;

      const comments = Array.isArray(data.comments) ? data.comments as CommentRecord[] : [];
      const nextState: DouyinCommentsState = {
        ...(previous || createCommentsState(input)),
        status: String(data.status || (comments.length ? "success" : "failed")) as DouyinCommentsState["status"],
        awemeId: String(data.awemeId || previous?.awemeId || ""),
        url: String(data.url || input),
        comments,
        totalFetched: Number(data.totalFetched || comments.length),
        totalReported: Number(data.totalReported || 0),
        hasMore: Boolean(data.hasMore),
        fetchedAt: String(data.fetchedAt || new Date().toISOString()),
        includeReplies: Boolean(data.includeReplies),
        stage: String(data.stage || ""),
        error: String(data.error || data.message || ""),
        insights: comments.length && previous?.insights && previous.insights.commentsHash === commentsHash(comments)
          ? previous.insights
          : previous?.insights || null,
        insightStatus: "idle"
      };
      setDouyinComments(nextState);

      if (!comments.length) {
        if (!options?.silent) setNotice(nextState.error || "暂时未获取到评论。");
        return;
      }
      if (!options?.silent) setNotice(`已获取 ${comments.length} 条评论`);
      void analyzeComments(nextState);
    } catch {
      if (isStaleSession(epoch)) return;
      setDouyinComments((current) => current
        ? { ...current, status: "failed", stage: "NETWORK_ERROR", error: "评论获取失败，可稍后重试。" }
        : current);
      if (!options?.silent) setNotice("评论获取失败，可稍后重试。");
    }
  }

  /** AI 评论洞察：同一批评论不重复分析（§六十二）。 */
  async function analyzeComments(state: DouyinCommentsState, options?: { force?: boolean }) {
    const comments = cleanComments(state.comments);
    if (!comments.length) return;
    const hash = commentsHash(comments);
    const existing = douyinComments?.insights;
    if (!options?.force && existing && existing.commentsHash === hash) return;

    const epoch = sessionEpoch.current;
    setDouyinComments((current) => current ? { ...current, insightStatus: "running" } : current);
    try {
      const response = await fetch("/api/script/comment-insights", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          awemeId: state.awemeId,
          comments,
          transcript: (douyinTranscript?.transcript || "").slice(0, 6000),
          productContext: buildProductPromptText(currentProduct || undefined)
        })
      });
      const data = await response.json().catch(() => ({})) as Record<string, unknown>;
      if (isStaleSession(epoch)) return;
      const insights = data.insights && typeof data.insights === "object" ? data.insights as DouyinCommentsState["insights"] : null;
      setDouyinComments((current) => current
        ? { ...current, insights, insightStatus: insights ? "done" : "failed" }
        : current);
      if (insights && typeof data.message === "string" && data.source === "fallback") setNotice(data.message);
    } catch {
      if (isStaleSession(epoch)) return;
      setDouyinComments((current) => current ? { ...current, insightStatus: "failed" } : current);
    }
  }

  /**
   * 保存脚本时一起落库的抖音来源资产（§二十八）：
   * 重新打开历史脚本时逐字稿/评论/洞察都在，不需要重新抓。
   */
  function douyinSourcePayload(): ScriptRecord["douyinSource"] | undefined {
    const transcript = (douyinTranscript?.transcript || "").trim();
    const comments = douyinComments?.comments || [];
    if (!transcript && !comments.length) return undefined;
    return {
      url: douyinComments?.url || douyinInput || "",
      awemeId: douyinComments?.awemeId || "",
      transcript: transcript.slice(0, 20000),
      commentCount: comments.length,
      commentsFetchedAt: douyinComments?.fetchedAt || "",
      comments: comments.slice(0, 200).map((item) => ({
        commentId: item.commentId,
        text: item.text.length > 200 ? `${item.text.slice(0, 200)}…` : item.text,
        likeCount: item.likeCount,
        replyCount: item.replyCount,
        createdAt: item.createdAt,
        nickname: item.user.nickname || "",
        ipLocation: item.ipLocation || ""
      })),
      commentInsights: douyinComments?.insights ? { ...douyinComments.insights } : null
    };
  }

  /** 评论上下文块：结构化洞察 + 少量代表性原评论（§二十四）。 */
  function buildCommentContext() {
    if (!douyinComments || !douyinComments.comments.length) return "";
    return buildCommentContextBlock(douyinComments.comments, douyinComments.insights);
  }

  async function recommend() {
    if (!currentProduct && !brief.trim()) {
      setNotice("请先选择产品资料，或填写“这次想怎么拍？”。");
      return;
    }
    const epoch = sessionEpoch.current;
    setRecommending(true);
    setNotice("正在分析资料并推荐方向…");
    // 同档案最近 30 条稿件标题做重复提醒（文档 §三.B 重复与可执行性）
    const recentTitles = getScriptRecords()
      .filter((item) => item.title)
      .slice(0, 30)
      .map((item) => item.title);
    try {
      const data = await requestWorkbench({
        action: "recommend",
        productText: buildProductPromptText(currentProduct || undefined),
        brief,
        references: buildReferencePayloads(),
        commentContext: buildCommentContext(),
        previous: directions.map((item) => item.name),
        profileBlock,
        experienceBlock,
        recentTitles
      });
      if (isStaleSession(epoch)) return;
      if (data.success) {
        const next = Array.isArray(data.directions) ? data.directions as DirectionOption[] : [];
        setDirections(next);
        setSelectedDirectionId(next[0]?.id || "");
        setNotice(typeof data.message === "string" ? data.message : "已根据当前资料推荐 3 个创作方向。");
      } else {
        setNotice(typeof data.message === "string" ? data.message : "推荐方向失败，请稍后重试。");
      }
    } catch {
      setNotice("AI 请求失败，请稍后重试。");
    } finally {
      setRecommending(false);
    }
  }

  /**
   * 主按钮：
   * - 有逐字稿且简报没要求「重新创作」→ mode=adapt：以逐字稿为底稿仿写（简报就是本次要求）。
   * - 否则 mode=fresh：和以前一样重新生成一条。
   */
  async function generate(options?: { mode?: "adapt" | "fresh" }) {
    if (!currentProduct && !brief.trim() && !hasTranscript && references.length === 0) {
      setNotice("请先选择产品资料、填写“这次想怎么拍？”，或先解析一份参考资料。");
      return;
    }
    const mode = options?.mode || (adaptFromTranscript ? "adapt" : "fresh");
    const transcriptText = hasTranscript ? (douyinTranscript?.transcript || "").trim() : "";
    const epoch = sessionEpoch.current;
    setGenerating(true);
    setNotice(mode === "adapt" ? "正在按逐字稿仿写…" : "正在生成脚本…");
    try {
      const data = await requestWorkbench({
        action: "generate",
        productText: buildProductPromptText(currentProduct || undefined),
        brief,
        references: buildReferencePayloads(),
        direction: directions.find((item) => item.id === selectedDirectionId) || null,
        generateMode: mode,
        baseText: mode === "adapt" ? transcriptText : "",
        baseTitle: douyinTranscript?.title?.trim() || "抖音逐字稿仿写",
        commentContext: buildCommentContext(),
        profileBlock,
        experienceBlock,
        lockBlock
      });
      // 生成期间点了「新建脚本」：这一份结果直接丢弃，不写回新工作区，也不落历史记录。
      if (isStaleSession(epoch)) return;
      if (data.success && data.document) {
        const nextDocument = data.document as ScriptDocument;
        // 锁定保护：全局改稿/重新生成不能绕过锁定（文档 §三.C2）
        if (!locksSurvivedIn(nextDocument)) {
          setNotice("重新生成的结果不含你锁定的段落，已保留当前稿件。如需完整重写，请先在正文中解除锁定。");
          return;
        }
        setDocument(nextDocument);
        const saved = saveScriptRecord(buildLegacyRecord(nextDocument, currentProduct, brief, currentRecordSnapshot(), douyinSourcePayload()));
        assetFromScriptRecord(saved);
        setCurrentScriptId(saved.id);
        const version = appendScriptVersion(saved.id, nextDocument.title, documentToPlainText(nextDocument), {
          revisionSource: "generate",
          experienceIds: experienceSelection.experiences.map((item) => item.id)
        });
        setVersions(getScriptVersions(saved.id));
        if (!version) {
          setNotice("脚本已生成，但版本保存失败（存储空间不足或网络异常）。当前文字还在，请点「保存版本」重试。");
          return;
        }
        // 记录本次实际使用的经验（文档 §三.A3：被使用的经验 ID 与版本随本次生成保存）
        for (const item of experienceSelection.experiences) markWritingExperienceUsed(item.id);
        setUsedExperienceIds(experienceSelection.experiences.map((item) => item.id));
        setNotice(data.source === "fallback" && typeof data.message === "string"
          ? data.message
          : mode === "adapt"
            ? `已按逐字稿仿写，并保存 V${version.version}。原逐字稿保持不变。`
            : `已生成脚本，并保存 V${version.version}。`);
      } else {
        setNotice(typeof data.message === "string" ? data.message : "生成脚本失败，请稍后重试。");
      }
    } catch {
      setNotice("AI 请求失败，请稍后重试。");
    } finally {
      setGenerating(false);
    }
  }

  function saveDraft() {
    if (!brief.trim() && !document) {
      setNotice("请先填写创作想法或生成脚本，再保存草稿。");
      return;
    }
    const saved = saveScriptRecord(buildLegacyRecord(document, currentProduct, brief, currentRecordSnapshot(), douyinSourcePayload()));
    assetFromScriptRecord(saved);
    setCurrentScriptId(saved.id);
    setNotice("草稿已保存到脚本资产和资产库。");
  }

  function saveVersion() {
    if (!document) {
      setNotice("请先生成脚本，再保存版本。");
      return;
    }
    const scriptId = currentScriptId || saveDraftAndReturnId();
    const version = appendScriptVersion(scriptId, document.title, documentToPlainText(document), { revisionSource: "manual" });
    setVersions(getScriptVersions(scriptId));
    if (!version) {
      setNotice("版本保存失败（存储空间不足或网络异常）：当前文字还在，可直接重试保存。");
      return;
    }
    setNotice(`已保存 V${version.version}`);
  }

  function saveDraftAndReturnId() {
    const saved = saveScriptRecord(buildLegacyRecord(document, currentProduct, brief, currentRecordSnapshot(), douyinSourcePayload()));
    assetFromScriptRecord(saved);
    setCurrentScriptId(saved.id);
    return saved.id;
  }

  async function copyScript() {
    if (!document) return;
    const ok = await writeClipboard(documentToCopyText(document));
    setNotice(ok ? "已复制完整脚本。" : "复制失败，请手动选中文字复制。");
  }

  function updateSection(key: string, content: string) {
    setDocument((current) => current ? {
      ...current,
      sections: current.sections.map((item) => item.key === key ? { ...item, content } : item)
    } : current);
  }

  async function editSection(key: string, mode: "natural" | "impact" | "replace" | "custom", instruction?: string) {
    if (!document) return;
    const section = document.sections.find((item) => item.key === key);
    if (!section) return;
    const epoch = sessionEpoch.current;
    setEditingKey(key);
    setNotice("正在优化这一段…");
    try {
      const data = await requestWorkbench({
        action: "editSection",
        mode,
        instruction,
        label: section.label,
        content: section.content,
        context: buildContextText()
      });
      if (isStaleSession(epoch)) return;
      if (data.success && typeof data.content === "string") {
        const nextDocument: ScriptDocument = {
          ...document,
          sections: document.sections.map((item) => item.key === key ? { ...item, content: String(data.content) } : item)
        };
        setDocument(nextDocument);
        // 局部修改也算一次改动，同样落版本，用户随时能回退。
        const version = commitScriptVersion(nextDocument);
        setNotice(!version
          ? "这一段已改到正文，但版本保存失败：请点「保存版本」重试。"
          : data.source === "fallback" && typeof data.message === "string"
            ? data.message
            : `这一段已修改，并保存 V${version.version}。`);
      } else {
        setNotice(typeof data.message === "string" ? data.message : "局部修改失败，请稍后重试。");
      }
    } catch {
      setNotice("AI 请求失败，请稍后重试。");
    } finally {
      setEditingKey("");
      setCustomEditingKey("");
    }
  }

  function buildContextText() {
    return [
      currentProduct ? `产品：${currentProduct.name}` : "",
      brief.trim() ? `创作想法：${brief.trim()}` : ""
    ].filter(Boolean).join("；");
  }

  async function sendAssistant(instruction?: string) {
    const command = (instruction ?? assistantInput).trim();
    if (!command) return;
    const transcriptText = hasTranscript ? (douyinTranscript?.transcript || "").trim() : "";

    // 「只问不改」：只拿回答，绝不产出脚本、不落版本、不动现有稿子。
    if (askMode) {
      if (!document && !transcriptText && !douyinComments?.comments.length && !currentProduct) {
        setNotice("还没有可参考的资料：先解析抖音链接或生成脚本，再来提问。");
        return;
      }
      const askEpoch = sessionEpoch.current;
      setAsssistantBusy(true);
      setAssistantAnswer("");
      setNotice("正在回答…");
      try {
        const data = await requestWorkbench({
          action: "ask",
          instruction: command,
          context: buildContextText(),
          commentContext: buildCommentContext(),
          transcript: transcriptText,
          document: document || undefined
        });
        if (isStaleSession(askEpoch)) return;
        const answer = typeof data.answer === "string" ? data.answer.trim() : "";
        if (answer) {
          setAssistantAnswer(answer);
          setNotice(data.source === "fallback" && typeof data.message === "string" ? data.message : "已回答，脚本未改动。");
        } else {
          setNotice(typeof data.message === "string" ? data.message : "没有得到回答，请换个问法。");
        }
      } catch {
        if (!isStaleSession(askEpoch)) setNotice("AI 请求失败，请稍后重试。");
      } finally {
        if (!isStaleSession(askEpoch)) {
          setAsssistantBusy(false);
          setAssistantInput("");
        }
      }
      return;
    }

    if (!document && !transcriptText) {
      setNotice("请先解析抖音逐字稿，或先点「生成脚本」。");
      return;
    }

    const epoch = sessionEpoch.current;
    setAsssistantBusy(true);
    setNotice(document ? "AI 助手正在按你的要求改这份脚本…" : "AI 助手正在按你的要求处理这份逐字稿…");
    try {
      // 已经有脚本：在脚本上继续改。
      if (document) {
        const data = await requestWorkbench({
          action: "assistant",
          instruction: command,
          document,
          context: buildContextText(),
          // 评论单独作为一块传过去，服务端会用【观众评论洞察】独立 section 呈现，
          // 这样用户在右侧直接问"评论区大家最关心什么"也能被正确回答。
          commentContext: buildCommentContext()
        });
        if (isStaleSession(epoch)) return;
        if (data.success && data.document) {
          const nextDocument = data.document as ScriptDocument;
          // 锁定保护：AI 助手全局改稿不能绕过锁定
          if (!locksSurvivedIn(nextDocument)) {
            setNotice("AI 修改结果不含你锁定的段落，已保留当前稿件。如需整体重写，请先解除锁定。");
            return;
          }
          setDocument(nextDocument);
          const version = commitScriptVersion(nextDocument, { revisionSource: "global_revise", requirementSummary: command.slice(0, 80) });
          setNotice(!version
            ? "修改已应用到正文，但版本保存失败：请点「保存版本」重试。"
            : data.source === "fallback" && typeof data.message === "string"
              ? data.message
              : `已按你的要求修改，并保存 V${version.version}。`);
        } else {
          setNotice(typeof data.message === "string" ? data.message : "AI 助手修改失败，请稍后重试。");
        }
        return;
      }

      // 只有逐字稿：直接以逐字稿为底稿处理，第一次产出就是 V1，逐字稿本身不动。
      const data = await requestWorkbench({
        action: "compose",
        instruction: command,
        // 简报是本次任务的顶层要求，右侧快捷动作同样要吃到它。
        brief,
        baseText: transcriptText,
        baseTitle: douyinTranscript?.title?.trim() || "抖音逐字稿仿写",
        productText: buildProductPromptText(currentProduct || undefined),
        references: buildReferencePayloads(),
        commentContext: buildCommentContext()
      });
      if (isStaleSession(epoch)) return;
      if (data.success && data.document) {
        const nextDocument = data.document as ScriptDocument;
        setDocument(nextDocument);
        const version = commitScriptVersion(nextDocument, { revisionSource: "generate" });
        setNotice(!version
          ? "脚本已生成到正文，但版本保存失败：请点「保存版本」重试。"
          : data.source === "fallback" && typeof data.message === "string"
            ? data.message
            : `已基于逐字稿生成脚本，并保存 V${version.version}。原逐字稿保持不变。`);
      } else {
        setNotice(typeof data.message === "string" ? data.message : "AI 助手处理失败，请稍后重试。");
      }
    } catch {
      setNotice("AI 请求失败，请稍后重试。");
    } finally {
      if (!isStaleSession(epoch)) {
        setAsssistantBusy(false);
        setAssistantInput("");
      }
    }
  }

  async function uploadVideo(file: File) {
    const epoch = sessionEpoch.current;
    const id = createId("ref_video");
    const item: ReferenceItem = { id, kind: "video", name: file.name, status: "uploading" };
    setReferences((current) => [...current, item]);

    try {
      // 流式上传：原始字节流直传，服务端边落盘边转写
      const response = await fetch("/api/video/upload-analyze", {
        method: "POST",
        headers: {
          "Content-Type": "application/octet-stream",
          "x-file-name": encodeURIComponent(file.name || "video.mp4")
        },
        body: file
      });
      const data = await response.json();
      if (isStaleSession(epoch)) return;
      if (!data.success) {
        updateReference(id, { status: "failed", error: data.message || "视频解析失败。" });
        return;
      }
      updateReference(id, { status: "analyzing", transcript: data.transcript || "" });
      const analysis = await requestWorkbench({ action: "analyzeVideo", name: file.name, transcript: data.transcript || "" });
      if (isStaleSession(epoch)) return;
      if (analysis.success) {
        updateReference(id, {
          status: "done",
          summary: String(analysis.summary || ""),
          analysis: String(analysis.analysis || "")
        });
        setNotice("参考视频已解析。");
      } else {
        updateReference(id, { status: "failed", error: String(analysis.message || "视频分析失败。") });
      }
    } catch {
      updateReference(id, { status: "failed", error: "视频上传或解析失败。" });
    }
  }

  async function analyzeText(name: string, text: string, kind: ReferenceKind, itemId?: string) {
    const epoch = sessionEpoch.current;
    const id = itemId || createId(`ref_${kind}`);
    if (!itemId) {
      setReferences((current) => [...current, { id, kind, name, status: "analyzing" }]);
    } else {
      updateReference(id, { status: "analyzing" });
    }
    try {
      const data = await requestWorkbench({
        action: kind === "document" ? "analyzeDocument" : "analyzeText",
        name,
        text
      });
      if (isStaleSession(epoch)) return;
      if (data.success) {
        updateReference(id, {
          status: "done",
          extractedText: text,
          summary: String(data.summary || ""),
          analysis: typeof data.analysis === "string" ? data.analysis : "",
          facts: Array.isArray(data.facts) ? data.facts as string[] : undefined,
          inferences: Array.isArray(data.inferences) ? data.inferences as string[] : undefined
        });
        setNotice(kind === "document" ? "产品文档已提取。" : "参考文案已解析。");
      } else {
        updateReference(id, { status: "failed", error: String(data.message || "解析失败。") });
      }
    } catch {
      updateReference(id, { status: "failed", error: "AI 请求失败，请稍后重试。" });
    }
  }

  async function uploadReferenceFile(file: File, kind: ReferenceKind) {
    const epoch = sessionEpoch.current;
    const id = createId(`ref_${kind}`);
    setReferences((current) => [...current, { id, kind, name: file.name, status: "uploading" }]);
    try {
      const form = new FormData();
      form.append("file", file);
      const response = await fetch("/api/script/reference-extract", { method: "POST", body: form });
      const data = await response.json();
      if (isStaleSession(epoch)) return;
      if (!data.success) {
        updateReference(id, { status: "failed", error: data.message || "文件读取失败。" });
        return;
      }
      await analyzeText(file.name, data.text || "", kind, id);
    } catch {
      if (isStaleSession(epoch)) return;
      updateReference(id, { status: "failed", error: "文件上传失败。" });
    }
  }

  function retryReference(item: ReferenceItem) {
    const epoch = sessionEpoch.current;
    if (item.kind === "video" && item.transcript) {
      void (async () => {
        updateReference(item.id, { status: "analyzing" });
        const analysis = await requestWorkbench({ action: "analyzeVideo", name: item.name, transcript: item.transcript });
        if (isStaleSession(epoch)) return;
        if (analysis.success) {
          updateReference(item.id, { status: "done", summary: String(analysis.summary || ""), analysis: String(analysis.analysis || "") });
        } else {
          updateReference(item.id, { status: "failed", error: String(analysis.message || "重试失败。") });
        }
      })();
      return;
    }
    if (item.extractedText) {
      void analyzeText(item.name, item.extractedText, item.kind, item.id);
      return;
    }
    setNotice("该文件需要重新上传。");
  }

  function restoreVersion(item: ScriptVersionItem) {
    if (!window.confirm(`确定恢复到 V${item.version} 吗？将以新版本保存，V${item.version} 历史保留。`)) return;
    const restored = textToDocument(item.title, item.text);
    setDocument(restored);
    // 恢复历史 = 以新版本保存，不改写历史（文档 §三.C4）
    const version = commitScriptVersion(restored, {
      parentVersionId: item.id,
      revisionSource: "restore",
      requirementSummary: `恢复自 V${item.version}`
    });
    setNotice(version ? `已恢复 V${item.version}，保存为新版本 V${version.version}。历史版本仍在。` : "已恢复到工作区，但版本保存失败：请点「保存版本」重试。");
  }

  /** 锁定保护（C2）：全局改稿/重新生成的结果必须仍包含全部锁定文本，否则拒绝采用结果 */
  function locksSurvivedIn(nextDocument: ScriptDocument): boolean {
    const meta = currentScriptId ? getWorkbenchMeta(currentScriptId) : null;
    return locksSurvivedInPure(nextDocument.sections[0]?.content ?? "", meta?.lockedRanges || []);
  }

  const duration = document ? estimateDurationSeconds(documentToPlainText(document)) : 0;
  const referencedCount = (currentProduct ? 1 : 0)
    + references.filter((item) => item.status === "done").length
    + (douyinReference ? 1 : 0);
  const douyinBusy = douyinTranscript?.status === "running";
  // 逐字稿解析成功就是当前脚本任务的正式上下文：右侧工作区立刻可用，不需要先点「分析并推荐方向」。
  const hasTranscript = douyinTranscript?.status === "done" && Boolean((douyinTranscript.transcript || "").trim());
  // 简报的意图决定主按钮叫「按逐字稿仿写」还是「生成脚本」；两边共用同一份判定。
  const briefIntent = detectScriptIntent(brief);
  const adaptFromTranscript = hasTranscript && briefIntent !== "rewrite";
  const douyinButtonLabel = douyinBusy ? "正在解析…"
    : douyinTranscript?.status === "done" ? "解析成功"
      : douyinTranscript?.status === "failed"
        ? (douyinTranscript.retryable === false ? "解析失败 · 需处理账户" : "解析失败 · 重试")
        : "解析逐字稿";

  return (
    <div className="flex min-h-[calc(100vh-4rem)] flex-col gap-3 lg:h-full lg:min-h-0 lg:flex-1">
      <div className="flex shrink-0 items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-950 dark:text-slate-50">脚本</h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">基于产品资料和创作目标，快速生成可直接拍摄的短视频脚本</p>
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" onClick={startNewScript}>
            <FilePlus2 className="h-4 w-4" />新建脚本
          </Button>
          <Button size="sm" variant="outline" asChild>
            <Link href="/scripts"><History className="h-4 w-4" />历史脚本</Link>
          </Button>
        </div>
      </div>

      {notice ? (
        <p className="shrink-0 rounded-lg bg-slate-100 px-3.5 py-2 text-[13px] text-slate-600 dark:bg-white/[0.05] dark:text-slate-300">{notice}</p>
      ) : null}

      {archived.length > 0 ? (
        <details className="shrink-0 rounded-lg border border-slate-200/70 bg-white px-3.5 py-2 dark:border-white/[0.07] dark:bg-card">
          <summary className="flex cursor-pointer items-center gap-1.5 text-xs font-medium text-slate-500 dark:text-slate-400">
            <Archive className="h-3.5 w-3.5" />
            已收起的历史脚本（{archived.length}）
          </summary>
          <div className="mt-2 space-y-1 pb-1">
            {archived.map((item) => (
              <div key={item.id} className="flex items-center justify-between gap-3 py-1">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-xs font-medium text-slate-700 dark:text-slate-200">{sessionTitle(item)}</div>
                  <div className="truncate text-[11px] text-slate-400 dark:text-slate-500">
                    {sessionSummary(item)}{sessionTime(item.archivedAt) ? " · " + sessionTime(item.archivedAt) : ""}
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <button
                    type="button"
                    onClick={() => restoreArchivedSession(item)}
                    className="text-xs text-slate-400 transition-colors hover:text-slate-700 dark:hover:text-slate-200"
                  >
                    恢复
                  </button>
                  <button
                    type="button"
                    onClick={() => removeArchivedSession(item.id)}
                    className="text-xs text-slate-400 transition-colors hover:text-red-500"
                  >
                    删除
                  </button>
                </div>
              </div>
            ))}
          </div>
          <p className="pb-2 text-[11px] text-slate-400 dark:text-slate-500">最多保留 {archivedSessionLimit} 份，超出后自动移除最早收起的一份。</p>
        </details>
      ) : null}

      <div className="grid min-h-0 gap-3 lg:flex-1 lg:grid-cols-[minmax(300px,340px)_minmax(0,1fr)] lg:grid-rows-[minmax(0,1fr)] xl:grid-cols-[minmax(340px,390px)_minmax(0,1fr)] 2xl:grid-cols-[minmax(360px,420px)_minmax(0,1fr)]">
        {/* 左侧创作区：桌面端独立滚动，资料再多也不会把脚本区顶出视口 */}
        <aside className="min-h-0 scrollbar-subtle lg:overflow-y-auto lg:pr-0.5">
          <div className="space-y-3">
            <section className="rounded-xl border border-slate-200/70 bg-white p-3.5 dark:border-white/[0.07] dark:bg-card">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-[11px] font-medium text-slate-400 dark:text-slate-500">当前产品</div>
                  <div className="mt-1 truncate text-sm font-semibold text-slate-950 dark:text-slate-100">
                    {currentProduct ? currentProduct.name : "未选择产品"}
                  </div>
                  {currentProduct ? (
                    <div className="mt-0.5 truncate text-xs text-slate-500 dark:text-slate-400">
                      {buildProductMetaLine(currentProduct) || "已读取产品资料"}
                    </div>
                  ) : null}
                </div>
                <Check className="h-4 w-4 shrink-0 text-brand" />
              </div>
              <div className="mt-2.5 flex items-center gap-2">
                <Select
                  className="h-8 flex-1 text-xs"
                  value={currentProductId}
                  onChange={(event) => selectProduct(event.target.value)}
                  options={[
                    { label: "不选择，手动输入", value: "" },
                    ...products.map((item) => ({ label: item.name, value: item.id }))
                  ]}
                />
                {currentProduct ? (
                  <Button size="sm" variant="ghost" asChild>
                    <Link href="/products">查看资料</Link>
                  </Button>
                ) : null}
              </div>
            </section>

            <section className="rounded-xl border border-slate-200/70 bg-white p-3.5 dark:border-white/[0.07] dark:bg-card">
              <div className="flex items-center justify-between gap-2">
                <div className="text-sm font-semibold text-slate-950 dark:text-slate-100">创作档案</div>
                <button
                  type="button"
                  className="text-[11px] text-brand hover:underline"
                  onClick={() => setProfileDraft({
                    id: "",
                    name: "",
                    preferences: [],
                    bannedExpressions: [],
                    performers: [],
                    archived: false,
                    createdAt: "",
                    updatedAt: ""
                  } as CreationProfile)}
                >
                  + 新建档案
                </button>
              </div>
              <Select
                className="mt-2"
                value={activeProfileId}
                onChange={(event) => handleSwitchProfile(event.target.value)}
                aria-label="选择创作档案"
                options={[
                  { label: "不使用档案（直接输入需求）", value: "" },
                  ...profiles.map((item) => ({ label: item.name, value: item.id }))
                ]}
              />
              {activeProfile ? (
                <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-slate-400 dark:text-slate-500">
                  <button type="button" className="hover:text-slate-600 dark:hover:text-slate-300" onClick={() => setProfileDraft(activeProfile)}>编辑</button>
                  <button
                    type="button"
                    className="hover:text-slate-600 dark:hover:text-slate-300"
                    onClick={() => {
                      const copy = duplicateCreationProfile(activeProfile.id);
                      if (copy) { refreshCreationData(); setActiveProfileId(copy.id); setNotice(`已复制为「${copy.name}」。`); }
                    }}
                  >
                    复制
                  </button>
                  <button
                    type="button"
                    className="hover:text-slate-600 dark:hover:text-slate-300"
                    onClick={() => {
                      if (!window.confirm(`归档档案「${activeProfile.name}」？归档后不再出现在选择列表，已关联稿件不受影响。`)) return;
                      archiveCreationProfile(activeProfile.id, true);
                      refreshCreationData();
                      setActiveProfileId("");
                      setNotice("档案已归档。");
                    }}
                  >
                    归档
                  </button>
                  <span>本次要求可临时覆盖档案默认，档案不会被修改。</span>
                </div>
              ) : (
                <p className="mt-2 text-[11px] leading-4 text-slate-400 dark:text-slate-500">
                  建一次档案，记住品牌、演员、时长目标和表达习惯，以后不用每次重新交代。
                </p>
              )}

              {profileDraft ? (
                <div className="mt-3 space-y-2 rounded-lg bg-slate-50 p-2.5 dark:bg-white/[0.03]">
                  <Input
                    value={profileDraft.name}
                    onChange={(event) => setProfileDraft({ ...profileDraft, name: event.target.value })}
                    placeholder="档案名称，例如：女装直播间账号"
                    className="h-8 text-xs"
                  />
                  <div className="grid grid-cols-2 gap-2">
                    <Input
                      value={profileDraft.contentAccount || ""}
                      onChange={(event) => setProfileDraft({ ...profileDraft, contentAccount: event.target.value })}
                      placeholder="品牌/内容账号"
                      className="h-8 text-xs"
                    />
                    <Input
                      value={profileDraft.platform || ""}
                      onChange={(event) => setProfileDraft({ ...profileDraft, platform: event.target.value })}
                      placeholder="平台（如抖音）"
                      className="h-8 text-xs"
                    />
                  </div>
                  <Input
                    value={profileDraft.targetAudience || ""}
                    onChange={(event) => setProfileDraft({ ...profileDraft, targetAudience: event.target.value })}
                    placeholder="目标受众（未填写=未知，不预设）"
                    className="h-8 text-xs"
                  />
                  <div className="grid grid-cols-2 gap-2">
                    <Input
                      value={(profileDraft.performers || []).map((item) => `${item.label}×${item.count}`).join("、")}
                      onChange={(event) => {
                        const performers = event.target.value
                          .split(/[、,，]/)
                          .map((part) => part.trim())
                          .filter(Boolean)
                          .map((part) => {
                            const match = part.match(/^(.+?)[×x*]?(\d*)$/);
                            return { label: match?.[1] || part, count: Number(match?.[2]) || 1 };
                          });
                        setProfileDraft({ ...profileDraft, performers });
                      }}
                      placeholder="演员称呼与人数，如：女生×1、老板×1"
                      className="h-8 text-xs"
                    />
                    <Input
                      value={profileDraft.durationTargetSeconds ? String(profileDraft.durationTargetSeconds) : ""}
                      onChange={(event) => setProfileDraft({
                        ...profileDraft,
                        durationTargetSeconds: Number(event.target.value) || undefined
                      })}
                      placeholder="时长目标（秒）"
                      className="h-8 text-xs"
                    />
                  </div>
                  <Input
                    value={profileDraft.venueMaterials || ""}
                    onChange={(event) => setProfileDraft({ ...profileDraft, venueMaterials: event.target.value })}
                    placeholder="可用场地/素材"
                    className="h-8 text-xs"
                  />
                  <Textarea
                    value={(profileDraft.preferences || []).join("\n")}
                    onChange={(event) => setProfileDraft({
                      ...profileDraft,
                      preferences: event.target.value.split("\n").map((item) => item.trim()).filter(Boolean)
                    })}
                    placeholder="表达偏好（一行一条）：例如 少用形容词；开头直接说结果"
                    className="min-h-16 resize-y text-xs"
                  />
                  <Textarea
                    value={(profileDraft.bannedExpressions || []).join("\n")}
                    onChange={(event) => setProfileDraft({
                      ...profileDraft,
                      bannedExpressions: event.target.value.split("\n").map((item) => item.trim()).filter(Boolean)
                    })}
                    placeholder="禁用表达（一行一条）：例如 全网最低价；宝宝们"
                    className="min-h-14 resize-y text-xs"
                  />
                  <div className="flex justify-end gap-2">
                    <Button size="sm" variant="ghost" onClick={() => setProfileDraft(null)}>取消</Button>
                    <Button size="sm" onClick={submitProfileDraft}>保存档案</Button>
                  </div>
                </div>
              ) : null}
            </section>

            <section className="rounded-xl border border-slate-200/70 bg-white p-3.5 dark:border-white/[0.07] dark:bg-card">
              <div className="text-sm font-semibold text-slate-950 dark:text-slate-100">这次想怎么拍？</div>
              <p className="mt-0.5 text-xs text-slate-400 dark:text-slate-500">
                {hasTranscript
                  ? "直接用自然语言说要求，例如：根据这份逐字稿仿写一版，结构不动，产品换成我的产品"
                  : "直接用自然语言描述你的想法"}
              </p>
              <Textarea
                className="mt-2 min-h-24 resize-y"
                value={brief}
                onChange={(event) => setBrief(event.target.value)}
                placeholder={hasTranscript
                  ? "根据这份逐字稿仿写一版：结构不动，产品换成我的产品，人群改成 35-55 岁，卖点只用产品资料里有的，结尾引导进直播间。"
                  : "想做一个路人搭话的反差短视频。路人看到女生穿雅鹿，以为她很有钱，女生有点惊讶，然后说现在反季只要200多，最后引导直播间。"}
              />
              {experienceSelection.experiences.length > 0 ? (
                <details className="mt-2">
                  <summary className="cursor-pointer text-[11px] text-slate-400 transition-colors hover:text-slate-600 dark:text-slate-500 dark:hover:text-slate-300">
                    本次将参考 {experienceSelection.experiences.length} 条已确认经验（点击查看/调整）
                  </summary>
                  <div className="mt-1.5 space-y-1 rounded-lg bg-slate-50 p-2 dark:bg-white/[0.03]">
                    {experienceSelection.experiences.map((item) => (
                      <label key={item.id} className="flex items-start gap-1.5 text-[11px] leading-4 text-slate-500 dark:text-slate-400">
                        <input
                          type="checkbox"
                          className="mt-0.5"
                          checked={!runDisabledExperienceIds.includes(item.id)}
                          onChange={(event) => setRunDisabledExperienceIds((current) => (
                            event.target.checked
                              ? current.filter((id) => id !== item.id)
                              : [...current, item.id]
                          ))}
                        />
                        <span>{item.rule}{item.scope.kind === "script" ? "（仅本条）" : item.scope.kind === "product" ? "（本商品）" : item.scope.kind === "profile" ? "（本档案）" : "（全部创作）"}</span>
                      </label>
                    ))}
                  </div>
                </details>
              ) : null}
            </section>

            <section className="rounded-xl border border-slate-200/70 bg-white p-3.5 dark:border-white/[0.07] dark:bg-card">
              <details>
                <summary className="cursor-pointer text-sm font-semibold text-slate-950 dark:text-slate-100">
                  创作经验（{experiences.filter((item) => item.status === "active").length} 条启用 / {experiences.filter((item) => item.status === "pending").length} 条待确认）
                </summary>
                <div className="mt-2 space-y-2">
                  {experiences.length === 0 ? (
                    <p className="text-[11px] leading-4 text-slate-400 dark:text-slate-500">
                      还没有经验。采用修改稿后点「提炼经验」，或在下方手动添加。
                    </p>
                  ) : null}
                  {experiences.slice(0, 20).map((item) => (
                    <div key={item.id} className="rounded-lg bg-slate-50 px-2.5 py-1.5 dark:bg-white/[0.03]">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0 text-[11px] leading-4 text-slate-600 dark:text-slate-300">
                          {item.rule}
                          <div className="mt-0.5 flex flex-wrap gap-1 text-[10px] text-slate-400 dark:text-slate-500">
                            <span className={cn(
                              "rounded px-1",
                              item.status === "active" ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-400"
                                : item.status === "pending" ? "bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-400"
                                  : "bg-slate-200 text-slate-500 dark:bg-white/10 dark:text-slate-400"
                            )}>
                              {item.status === "active" ? "已启用" : item.status === "pending" ? "待确认" : "已停用"}
                            </span>
                            <span>
                              {item.scope.kind === "script" ? "仅本条" : item.scope.kind === "product" ? `商品 ${item.scope.productId?.slice(-6)}` : item.scope.kind === "profile" ? "当前档案" : "全部创作"}
                              {item.createdFrom === "ai" ? " · AI 提炼" : " · 手动"}
                            </span>
                          </div>
                        </div>
                        <div className="flex shrink-0 items-center gap-1.5">
                          {item.status !== "active" ? (
                            <button
                              type="button"
                              className="text-[11px] text-brand hover:underline"
                              onClick={() => { setWritingExperienceStatus(item.id, "active"); refreshCreationData(); }}
                            >
                              {item.status === "pending" ? "确认启用" : "启用"}
                            </button>
                          ) : (
                            <button
                              type="button"
                              className="text-[11px] text-slate-400 hover:text-slate-600 dark:hover:text-slate-300"
                              onClick={() => { setWritingExperienceStatus(item.id, "disabled"); refreshCreationData(); }}
                            >
                              停用
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                  <div className="flex items-center gap-1.5 pt-1">
                    <Input
                      value={manualExperienceRule}
                      onChange={(event) => setManualExperienceRule(event.target.value)}
                      placeholder="手动添加经验：例如 开头 3 秒必须出现穿搭配画面"
                      className="h-8 flex-1 text-xs"
                    />
                    <Button size="sm" variant="outline" disabled={!manualExperienceRule.trim()} onClick={addManualExperience}>添加</Button>
                  </div>
                </div>
              </details>
            </section>

            <section className="rounded-xl border border-slate-200/70 bg-white p-3.5 dark:border-white/[0.07] dark:bg-card">
              <div className="text-sm font-semibold text-slate-950 dark:text-slate-100">参考资料（可多选）</div>
              <div className="mt-2.5 grid grid-cols-3 gap-1.5">
                <ReferenceUploadButton label="参考视频" icon={FileVideo} onPick={uploadVideo} accept="video/mp4,video/quicktime,video/webm" />
                <ReferenceUploadButton label="参考文案" icon={FileText} onPick={(file) => uploadReferenceFile(file, "text")} accept=".txt,.docx" />
                <ReferenceUploadButton label="产品文档" icon={FileUp} onPick={(file) => uploadReferenceFile(file, "document")} accept=".txt,.docx" />
                <button
                  type="button"
                  onClick={() => setShowDouyin((current) => !current)}
                  className="col-span-3 flex items-center justify-center gap-1.5 rounded-lg border border-dashed border-slate-200 px-2 py-2 text-center transition-colors hover:border-brand/50 hover:bg-brand/[0.04] dark:border-white/[0.12] dark:hover:border-brand/50"
                >
                  <Link2 className="h-4 w-4 text-slate-400 dark:text-slate-500" />
                  <span className="text-[11px] text-slate-500 dark:text-slate-400">抖音链接</span>
                  {douyinTranscript?.status === "done" ? <Check className="h-3.5 w-3.5 text-brand" /> : null}
                </button>
              </div>

              {showDouyin ? (
                <div className="mt-3 rounded-lg border border-slate-200/70 p-2.5 dark:border-white/[0.08]">
                  <div className="text-xs font-medium text-slate-700 dark:text-slate-200">抖音链接</div>
                  <Textarea
                    className="mt-2 min-h-24 resize-y text-xs"
                    value={douyinInput}
                    onChange={(event) => setDouyinInput(event.target.value)}
                    placeholder="粘贴抖音视频链接或整段分享文案"
                    disabled={douyinBusy}
                  />
                  <div className="mt-2 flex items-center justify-between gap-2">
                    <span className={cn(
                      "min-w-0 truncate text-[11px]",
                      douyinTranscript?.status === "done" ? "text-emerald-600 dark:text-emerald-400"
                        : douyinTranscript?.status === "failed" ? "text-red-500 dark:text-red-400"
                          : "text-slate-400 dark:text-slate-500"
                    )}>
                      {douyinBusy ? "正在解析…"
                        : douyinTranscript?.status === "done" ? "解析成功"
                          : douyinTranscript?.status === "failed" ? (douyinTranscript.error || "解析失败，请重试")
                            : "支持短链接或整段分享文案"}
                    </span>
                    <Button size="sm" disabled={douyinBusy || !douyinInput.trim()} onClick={() => void parseDouyinTranscript()}>
                      {douyinBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                      {douyinButtonLabel}
                    </Button>
                  </div>
                </div>
              ) : null}

              {references.length > 0 ? (
                <div className="mt-2.5 space-y-1">
                  {references.map((item) => (
                    <ReferenceRow
                      key={item.id}
                      item={item}
                      onRetry={() => retryReference(item)}
                      onRemove={() => removeReference(item.id)}
                    />
                  ))}
                </div>
              ) : null}

              {!showPaste ? (
                <button
                  type="button"
                  onClick={() => setShowPaste(true)}
                  className="mt-2 text-xs text-slate-400 transition-colors hover:text-slate-600 dark:hover:text-slate-200"
                >
                  + 直接粘贴文案
                </button>
              ) : (
                <div className="mt-2 space-y-2">
                  <Textarea
                    className="min-h-24 resize-y text-xs"
                    value={pasteText}
                    onChange={(event) => setPasteText(event.target.value)}
                    placeholder="粘贴一段参考文案…"
                  />
                  <div className="flex justify-end gap-2">
                    <Button size="sm" variant="ghost" onClick={() => { setShowPaste(false); setPasteText(""); }}>取消</Button>
                    <Button size="sm" disabled={!pasteText.trim()} onClick={() => {
                      void analyzeText("粘贴的参考文案", pasteText, "text");
                      setShowPaste(false);
                      setPasteText("");
                    }}>
                      分析文案
                    </Button>
                  </div>
                </div>
              )}
            </section>

            {douyinTranscript?.status === "done" ? (
              <section className="rounded-xl border border-slate-200/70 bg-white p-3.5 dark:border-white/[0.07] dark:bg-card">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="text-sm font-semibold text-slate-950 dark:text-slate-100">视频逐字稿</div>
                    <div className="mt-0.5 truncate text-xs text-slate-400 dark:text-slate-500">
                      {[douyinTranscript.authorName, douyinTranscript.title].filter(Boolean).join(" · ") || "抖音视频"}
                      {douyinTranscript.durationSeconds > 0 ? " · " + Math.round(douyinTranscript.durationSeconds) + "s" : ""}
                    </div>
                  </div>
                  <span className="shrink-0 text-[11px] text-emerald-600 dark:text-emerald-400">解析成功</span>
                </div>
                <Textarea
                  className="mt-2 min-h-28 resize-y text-xs leading-6"
                  value={douyinTranscript.transcript}
                  onChange={(event) => updateDouyinTranscript(event.target.value)}
                  aria-label="视频逐字稿"
                />
                <div className="mt-2 flex flex-wrap items-center gap-1.5">
                  <Button size="sm" variant="outline" onClick={() => void copyDouyinTranscript()}>
                    <ClipboardCopy className="h-3.5 w-3.5" />复制逐字稿
                  </Button>
                  <Button size="sm" variant="ghost" disabled={douyinBusy} onClick={() => void parseDouyinTranscript()}>
                    {douyinBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RotateCw className="h-3.5 w-3.5" />}重新解析
                  </Button>
                  <Button size="sm" variant="ghost" onClick={removeDouyinTranscript}>删除</Button>
                </div>
              </section>
            ) : null}

            {douyinComments && douyinComments.status !== "idle" ? (
              <section className="rounded-xl border border-slate-200/70 bg-white p-3.5 dark:border-white/[0.07] dark:bg-card">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="text-sm font-semibold text-slate-950 dark:text-slate-100">
                      评论{douyinComments.comments.length ? <span className="ml-1 text-slate-400 dark:text-slate-500">{douyinComments.comments.length}</span> : null}
                    </div>
                    <div className="mt-0.5 truncate text-[11px] text-slate-400 dark:text-slate-500">
                      {douyinComments.status === "fetching" ? "正在获取评论…"
                        : douyinComments.status === "failed" ? "暂时未获取到评论"
                          : douyinComments.insightStatus === "running" ? `已获取 ${douyinComments.comments.length} 条 · 正在分析评论…`
                            : `已获取 ${douyinComments.comments.length} 条评论`}
                    </div>
                  </div>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={douyinComments.status === "fetching"}
                    onClick={() => void fetchComments({ refresh: true })}
                  >
                    {douyinComments.status === "fetching" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}刷新评论
                  </Button>
                </div>

                {douyinComments.status === "failed" ? (
                  <p className="mt-2 rounded-lg bg-slate-50 px-2.5 py-2 text-[11px] leading-5 text-slate-500 dark:bg-white/[0.03] dark:text-slate-400">
                    评论暂时获取失败，稍后可重试；逐字稿与脚本生成不受影响。
                  </p>
                ) : null}

                {douyinComments.insights ? (
                  <div className="mt-2.5 rounded-lg bg-slate-50 p-2.5 dark:bg-white/[0.03]">
                    <div className="text-[11px] font-semibold text-slate-600 dark:text-slate-300">
                      评论洞察
                      <span className="ml-1 font-normal text-slate-400 dark:text-slate-500">
                        样本 {douyinComments.insights.sampleSize} 条 · 可信度 {douyinComments.insights.confidence}
                      </span>
                    </div>
                    {douyinComments.insights.highFrequencyTopics.length ? (
                      <div className="mt-1.5 flex flex-wrap gap-1">
                        {douyinComments.insights.highFrequencyTopics.slice(0, 8).map((item) => (
                          <span key={item.topic} className="rounded-md bg-white px-1.5 py-0.5 text-[11px] text-slate-500 dark:bg-white/[0.06] dark:text-slate-300">
                            {item.topic}{item.count ? ` · ${item.count}` : ""}
                          </span>
                        ))}
                      </div>
                    ) : null}
                    {[
                      { label: "购买阻力", values: douyinComments.insights.purchaseBarriers },
                      { label: "用户需求", values: douyinComments.insights.desiredOutcomes },
                      { label: "内容机会", values: douyinComments.insights.contentOpportunities.map((item) => item.angle) }
                    ].filter((group) => group.values.length).map((group) => (
                      <div key={group.label} className="mt-1.5">
                        <div className="text-[11px] text-slate-400 dark:text-slate-500">{group.label}</div>
                        <ul className="mt-0.5 space-y-0.5">
                          {group.values.slice(0, 3).map((value, index) => (
                            <li key={index} className="text-[11px] leading-5 text-slate-600 dark:text-slate-300">· {value}</li>
                          ))}
                        </ul>
                      </div>
                    ))}
                    {douyinComments.insights.summary ? (
                      <p className="mt-1.5 line-clamp-3 text-[11px] leading-5 text-slate-500 dark:text-slate-400">{douyinComments.insights.summary}</p>
                    ) : null}
                  </div>
                ) : null}

                {douyinComments.comments.length ? (
                  <div className="mt-2.5 space-y-1.5">
                    {(showAllComments ? douyinComments.comments : douyinComments.comments.slice(0, 5)).map((item) => (
                      <div key={item.commentId} className="rounded-lg bg-slate-50 px-2.5 py-1.5 dark:bg-white/[0.03]">
                        <div className="flex items-center justify-between gap-2 text-[11px] text-slate-400 dark:text-slate-500">
                          <span className="truncate">{item.user.nickname || "抖音用户"}{item.ipLocation ? ` · ${item.ipLocation}` : ""}</span>
                          <span className="shrink-0">{item.likeCount ? `♥ ${item.likeCount}` : ""}{item.replyCount ? `  回复 ${item.replyCount}` : ""}</span>
                        </div>
                        <div className={cn("mt-0.5 text-xs leading-5 text-slate-600 dark:text-slate-300", !showAllComments && "line-clamp-2")}>{item.text}</div>
                      </div>
                    ))}
                    {douyinComments.comments.length > 5 ? (
                      <button
                        type="button"
                        onClick={() => setShowAllComments((current) => !current)}
                        className="w-full rounded-lg py-1 text-[11px] text-slate-400 transition-colors hover:text-slate-600 dark:hover:text-slate-200"
                      >
                        {showAllComments ? "收起评论" : `查看全部 ${douyinComments.comments.length} 条`}
                      </button>
                    ) : null}
                  </div>
                ) : null}
              </section>
            ) : null}

            <div>
              <Button className="w-full" variant="secondary" disabled={recommending || generating} onClick={recommend}>
                {recommending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                {recommending ? "正在分析资料并推荐方向…" : "分析并推荐方向"}
              </Button>
            </div>

            {directions.length > 0 ? (
              <section className="space-y-2">
                <div className="flex items-center justify-between">
                  <div className="text-sm font-semibold text-slate-950 dark:text-slate-100">创作方向</div>
                  <Button size="sm" variant="ghost" disabled={recommending} onClick={recommend}>
                    <RefreshCw className="h-3.5 w-3.5" />换一批
                  </Button>
                </div>
                {directions.map((item) => {
                  const active = item.id === selectedDirectionId;
                  const statusLabel = item.status === "ready" ? "可直接展开"
                    : item.status === "needs_conditions" ? "需调整条件" : "需补资料";
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => setSelectedDirectionId(item.id)}
                      className={cn(
                        "w-full rounded-xl border p-2.5 text-left transition-colors duration-150",
                        active
                          ? "border-brand/50 bg-brand/[0.07] dark:border-brand/50 dark:bg-brand/10"
                          : "border-slate-200/70 bg-white hover:border-slate-300 dark:border-white/[0.07] dark:bg-card dark:hover:border-white/15"
                      )}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="text-sm font-semibold text-slate-950 dark:text-slate-100">{item.name}</div>
                        {active ? <Check className="h-4 w-4 shrink-0 text-brand" /> : null}
                      </div>
                      <div className="mt-1 text-xs leading-5 text-slate-600 dark:text-slate-300">{item.play}</div>
                      <div className="mt-1 text-[11px] leading-4 text-slate-400 dark:text-slate-500">{item.reason}</div>
                      <div className="mt-1.5 flex flex-wrap items-center gap-1">
                        <span className={cn(
                          "rounded px-1.5 py-0.5 text-[10px]",
                          item.status === "ready" ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-400"
                            : item.status === "needs_conditions" ? "bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-400"
                              : "bg-slate-200 text-slate-600 dark:bg-white/10 dark:text-slate-300"
                        )}>
                          {statusLabel}
                        </span>
                        {item.verified === false ? (
                          <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] text-amber-700 dark:bg-amber-500/15 dark:text-amber-400">
                            待验证设想
                          </span>
                        ) : item.sources?.length ? (
                          <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-500 dark:bg-white/[0.06] dark:text-slate-400">
                            依据 {item.sources.filter((source) => source.valid).length}/{item.sources.length} 条可溯源
                          </span>
                        ) : null}
                      </div>
                      {item.audience || item.basis || item.sellingPoint || item.requirements?.length || item.missing?.length || item.sources?.length ? (
                        <details className="mt-1.5" onClick={(event) => event.stopPropagation()}>
                          <summary className="cursor-pointer text-[11px] text-brand/80 hover:underline">为什么值得拍 / 能不能拍</summary>
                          <div className="mt-1.5 space-y-1 rounded-lg bg-slate-50 p-2 text-[11px] leading-4 text-slate-600 dark:bg-white/[0.04] dark:text-slate-300">
                            {item.audience ? <div><span className="text-slate-400">目标观众：</span>{item.audience}</div> : null}
                            {item.sellingPoint ? <div><span className="text-slate-400">对应卖点：</span>{item.sellingPoint}</div> : null}
                            {item.basis ? <div><span className="text-slate-400">推荐依据：</span>{item.basis}</div> : null}
                            {item.sources?.length ? (
                              <div>
                                <span className="text-slate-400">来源：</span>
                                {item.sources.map((source, index) => (
                                  <div key={index} className={cn("mt-0.5 pl-2", !source.valid && "text-amber-600 dark:text-amber-400")}>
                                    · {source.name}{source.valid ? "" : "（依据无效：本次未提供该来源）"}
                                    {source.quote ? <span className="text-slate-400">「{source.quote.slice(0, 60)}」</span> : null}
                                    {source.kind === "comment" ? <span className="ml-1 rounded bg-slate-200 px-1 text-[10px] dark:bg-white/10">观众观点</span> : null}
                                  </div>
                                ))}
                              </div>
                            ) : null}
                            {item.proofMethods?.length ? <div><span className="text-slate-400">证明方式：</span>{item.proofMethods.join("；")}</div> : null}
                            {item.requirements?.length ? <div><span className="text-slate-400">需要准备：</span>{item.requirements.join("；")}</div> : null}
                            {item.missing?.length ? <div className="text-amber-600 dark:text-amber-400"><span>还缺：</span>{item.missing.join("；")}</div> : null}
                            {item.difference ? <div><span className="text-slate-400">与近期区别：</span>{item.difference}</div> : null}
                          </div>
                        </details>
                      ) : null}
                    </button>
                  );
                })}
              </section>
            ) : null}

            <div className="grid grid-cols-2 gap-2">
              <Button variant="outline" onClick={saveDraft}>保存草稿</Button>
              <Button disabled={generating} onClick={() => void generate()}>
                {generating ? <Loader2 className="h-4 w-4 animate-spin" /> : <WandSparkles className="h-4 w-4" />}
                {generating
                  ? (adaptFromTranscript ? "正在仿写…" : "正在生成…")
                  : (adaptFromTranscript ? "按逐字稿仿写" : "生成脚本")}
              </Button>
            </div>

            {hasTranscript ? (
              <button
                type="button"
                onClick={() => void generate({ mode: "fresh" })}
                disabled={generating}
                className="w-full text-center text-[11px] text-slate-400 transition-colors hover:text-slate-600 disabled:opacity-50 dark:text-slate-500 dark:hover:text-slate-300"
              >
                不用原稿，重新创作一条
              </button>
            ) : null}
          </div>
        </aside>

        {/* 右侧脚本工作区：正文独立滚动，AI 助手固定在底部 */}
        <section className="flex min-h-[420px] flex-col overflow-hidden rounded-xl border border-slate-200/70 bg-white dark:border-white/[0.07] dark:bg-card lg:min-h-0">
          <div className="flex shrink-0 items-center justify-between gap-2 border-b border-slate-200/70 px-3.5 py-1.5 dark:border-white/[0.06]">
            <div className="flex min-w-0 items-center gap-3">
              <span className="inline-flex items-center gap-1.5 text-[11px] text-slate-400 dark:text-slate-500">
                <Clock className="h-3.5 w-3.5" />
                {document ? `预计 ${duration}s` : "预计时长 —"}
              </span>
              {versions.length > 0 ? (
                <span className="text-[11px] text-slate-400 dark:text-slate-500">当前 V{versions[versions.length - 1]?.version}</span>
              ) : null}
            </div>
            <div className="flex shrink-0 items-center gap-0.5">
              <Button size="sm" variant="ghost" onClick={copyScript} disabled={!document}>
                <ClipboardCopy className="h-4 w-4" />一键全复制
              </Button>
              <Button size="sm" variant="ghost" onClick={saveVersion} disabled={!document}>保存版本</Button>
              <Button size="sm" variant="ghost" onClick={() => void generate()} disabled={generating || !document}>
                <RotateCw className={cn("h-4 w-4", generating && "animate-spin")} />
                {adaptFromTranscript ? "重新仿写" : "重新生成"}
              </Button>
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto scrollbar-subtle">
            <div className="w-full px-5 py-4">
              {document ? (
                <>
                  <div className="mb-4">
                    <Input
                      value={document.title}
                      onChange={(event) => setDocument({ ...document, title: event.target.value })}
                      className="h-auto border-0 bg-transparent px-0 text-xl font-semibold tracking-tight text-slate-950 focus-visible:ring-0 dark:text-slate-50"
                      aria-label="脚本标题"
                    />
                    <details className="mt-2">
                      <summary className="cursor-pointer text-xs text-slate-400 transition-colors hover:text-slate-600 dark:text-slate-500 dark:hover:text-slate-300">
                        已参考 {referencedCount} 项资料
                      </summary>
                      <div className="mt-2 space-y-1 rounded-lg bg-slate-50 p-2.5 text-xs leading-5 text-slate-500 dark:bg-white/[0.03] dark:text-slate-400">
                        {currentProduct ? <div>产品资料：{currentProduct.name}</div> : null}
                        {references.filter((item) => item.status === "done").map((item) => (
                          <div key={item.id}>
                            {referenceKindLabel[item.kind]}：{item.name}
                            {item.summary ? ` · ${item.summary}` : ""}
                          </div>
                        ))}
                        {douyinReference ? (
                          <div>
                            {referenceKindLabel[douyinReference.kind]}：{douyinReference.name}
                            {douyinReference.summary ? " · " + douyinReference.summary : ""}
                          </div>
                        ) : null}
                        {referencedCount === 0 ? <div>还没有参考资料。</div> : null}
                      </div>
                    </details>
                  </div>
  
                  <div className="space-y-5">
                    {/* 选区改稿：修改建议卡片（应用前做确定性检查，越界/过期一律拒绝） */}
                    {pendingProposal ? (
                      <div className="rounded-xl border border-brand/40 bg-brand/[0.04] p-3 dark:border-brand/40 dark:bg-brand/[0.06]">
                        <div className="flex items-center justify-between gap-2">
                          <div className="text-xs font-semibold text-slate-800 dark:text-slate-100">修改建议（未应用）</div>
                          <div className="flex items-center gap-1.5">
                            <Button size="sm" variant="ghost" onClick={discardProposal}>放弃</Button>
                            <Button size="sm" onClick={applyProposal}>应用到正文</Button>
                          </div>
                        </div>
                        <div className="mt-1 text-[11px] text-slate-400 dark:text-slate-500">修改要求：{pendingProposal.instruction}</div>
                        <div className="mt-2 space-y-1.5 rounded-lg bg-white p-2.5 text-xs leading-6 dark:bg-card">
                          <div className="text-red-500 line-through decoration-red-300">{pendingProposal.selection.text}</div>
                          <div className="text-emerald-600 dark:text-emerald-400">{pendingProposal.replacement}</div>
                        </div>
                        <p className="mt-1.5 text-[10px] leading-3 text-slate-400 dark:text-slate-500">
                          应用前会检查：正文未变、选中处未变、锁定内容逐字未变。任何一项不满足都会拒绝应用。
                        </p>
                      </div>
                    ) : null}

                    {invalidLocks.length > 0 ? (
                      <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-amber-300 bg-amber-50 p-3 text-xs text-amber-700 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-400">
                        <span>有 {invalidLocks.length} 处锁定因手动编辑已失效。请重新选中确认，或清除失效锁定。</span>
                        <Button size="sm" variant="outline" onClick={confirmInvalidLocks}>清除失效锁定</Button>
                      </div>
                    ) : null}

                    {document.sections.map((section) => (
                      <SectionEditor
                        key={section.key}
                        section={section}
                        busy={editingKey === section.key}
                        customOpen={customEditingKey === section.key}
                        customValue={customInstruction}
                        onCustomValue={setCustomInstruction}
                        onChange={(content) => updateSection(section.key, content)}
                        onAction={(mode) => {
                          if (mode === "custom") {
                            setCustomEditingKey(customEditingKey === section.key ? "" : section.key);
                            return;
                          }
                          void editSection(section.key, mode);
                        }}
                        onCustomSubmit={(instruction) => {
                          void editSection(section.key, "custom", instruction);
                          setCustomInstruction("");
                        }}
                        onSelectionChange={setSelection}
                        onSelectionRevise={startSelectionRevise}
                        onToggleLock={toggleLockSelection}
                        reviseBusy={reviseBusy}
                      />
                    ))}
                    {selection && document ? (
                      <div className="flex items-center gap-2 rounded-lg bg-slate-50 p-2 dark:bg-white/[0.04]">
                        <Input
                          value={reviseInstruction}
                          onChange={(event) => setReviseInstruction(event.target.value)}
                          placeholder="选中部分想怎么改？例如：更像朋友聊天，去掉形容词"
                          className="h-8 flex-1 text-xs"
                        />
                        <Button size="sm" disabled={reviseBusy || !reviseInstruction.trim()} onClick={startSelectionRevise}>
                          {reviseBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                          生成修改建议
                        </Button>
                      </div>
                    ) : null}
                  </div>
                </>
              ) : hasTranscript ? (
                <div className="flex min-h-[320px] flex-col items-center justify-center px-6 text-center">
                  <FileText className="h-7 w-7 text-brand/60 dark:text-brand/70" />
                  <p className="mt-3 text-sm font-medium text-slate-700 dark:text-slate-200">
                    抖音逐字稿已是当前脚本的底稿
                  </p>
                  <p className="mt-1 max-w-[420px] text-xs leading-5 text-slate-500 dark:text-slate-400">
                    直接在下面的 AI 助手输入指令就能仿写、优化、换产品；原逐字稿全程保留，不会被覆盖。也可以先看「分析并推荐方向」。
                  </p>
                  <div className="mt-4 flex flex-wrap items-center justify-center gap-1.5">
                    {transcriptQuickActions.map((action) => (
                      <Button
                        key={action.label}
                        size="sm"
                        variant="outline"
                        disabled={assistantBusy}
                        onClick={() => void sendAssistant(action.instruction)}
                      >
                        {action.label}
                      </Button>
                    ))}
                    <Button size="sm" variant="ghost" disabled={recommending || assistantBusy} onClick={recommend}>
                      {recommending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
                      分析并推荐方向
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="flex min-h-[320px] flex-col items-center justify-center text-center">
                  <WandSparkles className="h-7 w-7 text-slate-300 dark:text-slate-600" />
                  <p className="mt-3 text-sm text-slate-500 dark:text-slate-400">先解析抖音逐字稿，或直接生成脚本，就可以在这里编辑。</p>
                </div>
            )}
            </div>
          </div>

          {document || hasTranscript ? (
            <div className="shrink-0 border-t border-slate-200/70 px-3.5 py-2 dark:border-white/[0.06]">
              <div className="flex items-center justify-between gap-2">
                <div className="text-xs font-semibold text-slate-600 dark:text-slate-300">
                  AI 助手
                  {!document && hasTranscript && !askMode ? <span className="ml-2 font-normal text-slate-400 dark:text-slate-500">以抖音逐字稿为底稿</span> : null}
                </div>
                {/* 改稿 / 只问：只问模式只回答问题，绝不改稿 */}
                <div className="flex shrink-0 items-center gap-0.5 rounded-md bg-slate-100 p-0.5 dark:bg-white/[0.05]">
                  {[
                    { key: false, label: "改稿" },
                    { key: true, label: "只问" }
                  ].map((item) => (
                    <button
                      key={item.label}
                      type="button"
                      onClick={() => {
                        setAskMode(item.key);
                        setAssistantAnswer("");
                      }}
                      className={cn(
                        "rounded px-1.5 py-0.5 text-[11px] transition-colors",
                        askMode === item.key
                          ? "bg-white text-slate-700 shadow-sm dark:bg-white/[0.12] dark:text-slate-100"
                          : "text-slate-400 hover:text-slate-600 dark:text-slate-500 dark:hover:text-slate-300"
                      )}
                    >
                      {item.label}
                    </button>
                  ))}
                </div>
              </div>

              {askMode && assistantAnswer ? (
                <div className="mt-1.5 rounded-lg border border-slate-200/70 bg-slate-50 p-2.5 dark:border-white/[0.08] dark:bg-white/[0.03]">
                  <div className="flex items-start justify-between gap-2">
                    <div className="text-[11px] font-semibold text-slate-600 dark:text-slate-300">回答（脚本未改动）</div>
                    <div className="flex shrink-0 items-center gap-2">
                      <button
                        type="button"
                        onClick={() => void writeClipboard(assistantAnswer).then((ok) => setNotice(ok ? "已复制回答。" : "复制失败，请手动选中复制。"))}
                        className="text-[11px] text-slate-400 transition-colors hover:text-slate-700 dark:hover:text-slate-200"
                      >
                        复制
                      </button>
                      <button
                        type="button"
                        onClick={() => setAssistantAnswer("")}
                        className="text-[11px] text-slate-400 transition-colors hover:text-red-500"
                      >
                        关闭
                      </button>
                    </div>
                  </div>
                  <p className="mt-1 max-h-40 overflow-y-auto whitespace-pre-wrap text-xs leading-5 text-slate-600 dark:text-slate-300">
                    {assistantAnswer}
                  </p>
                </div>
              ) : null}

              <div className="mt-1 flex items-end gap-2">
                  <Textarea
                    ref={assistantInputRef}
                    style={{ minHeight: 40, maxHeight: 160 }}
                    className="resize-none overflow-y-auto py-2"
                    value={assistantInput}
                    onChange={(event) => setAssistantInput(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" && !event.shiftKey) {
                        event.preventDefault();
                        void sendAssistant();
                      }
                    }}
                    placeholder={askMode
                      ? "问点什么：评论区大家最关心什么？这条脚本哪里没讲清楚？"
                      : document ? "告诉我你想对这份脚本做什么修改…" : "例如：基于这个逐字稿仿写一版；开头不动，后面换成我的产品"}
                    disabled={assistantBusy}
                  />
                  <Button size="sm" className="h-8 shrink-0" onClick={() => void sendAssistant()} disabled={assistantBusy || !assistantInput.trim()}>
                    {assistantBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                    发送
                  </Button>
                </div>
                <div className="mt-1 flex flex-wrap gap-1">
                  {(askMode
                    ? askQuickPrompts.map((label) => ({ label, instruction: label }))
                    : document ? assistantQuickPrompts.map((label) => ({ label, instruction: label })) : transcriptQuickActions).map((item) => (
                    <button
                      key={item.label}
                      type="button"
                      onClick={() => void sendAssistant(item.instruction)}
                      disabled={assistantBusy}
                      className="rounded-md bg-slate-100 px-2 py-0.5 text-[11px] text-slate-500 transition-colors hover:bg-slate-200 hover:text-slate-800 disabled:opacity-50 dark:bg-white/[0.05] dark:text-slate-400 dark:hover:bg-white/[0.1] dark:hover:text-slate-200"
                    >
                      {item.label}
                    </button>
                  ))}
                </div>
            </div>
          ) : null}
        </section>
      </div>

      {versions.length > 0 ? (
        <details className="shrink-0 rounded-lg border border-slate-200/70 bg-white px-3.5 py-2 dark:border-white/[0.07] dark:bg-card">
          <summary className="cursor-pointer text-xs font-medium text-slate-500 dark:text-slate-400">
            历史版本（{versions.length}）{lastAdoption ? " · 已有采用记录，可提炼经验" : ""}
          </summary>
          <div className="scrollbar-subtle mt-2 max-h-56 space-y-1 overflow-y-auto pb-2">
            {versions.map((item) => {
              const feedback = currentScriptId ? getFeedbackForVersion(currentScriptId, item.id) : null;
              const adopted = feedback?.decision === "adopted"
                || scriptMeta?.adoptedVersionId === item.id
                || lastAdoption?.versionId === item.id;
              return (
                <div key={item.id} className="rounded-lg px-2 py-1 hover:bg-slate-50 dark:hover:bg-white/[0.04]">
                  <div className="flex items-center justify-between gap-3 py-0.5">
                    <div className="min-w-0">
                      <span className="text-xs font-medium text-slate-700 dark:text-slate-200">V{item.version}</span>
                      <span className="ml-2 truncate text-xs text-slate-400 dark:text-slate-500">{item.title}</span>
                      {adopted ? (
                        <span className="ml-2 rounded bg-emerald-100 px-1 text-[10px] text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-400">已采用</span>
                      ) : feedback?.decision === "discarded" ? (
                        <span className="ml-2 rounded bg-slate-200 px-1 text-[10px] text-slate-500 dark:bg-white/10 dark:text-slate-400">已放弃</span>
                      ) : feedback?.decision === "needs_change" ? (
                        <span className="ml-2 rounded bg-amber-100 px-1 text-[10px] text-amber-700 dark:bg-amber-500/15 dark:text-amber-400">待改</span>
                      ) : null}
                      {item.requirementSummary ? (
                        <span className="ml-2 text-[10px] text-slate-400 dark:text-slate-500">改：{item.requirementSummary.slice(0, 24)}</span>
                      ) : null}
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          setFeedbackVersionId(feedbackVersionId === item.id ? "" : item.id);
                          setFeedbackReasons([]);
                          setFeedbackNote("");
                        }}
                        className="shrink-0 text-xs text-slate-400 transition-colors hover:text-slate-700 dark:hover:text-slate-200"
                      >
                        反馈
                      </button>
                      <button
                        type="button"
                        onClick={() => restoreVersion(item)}
                        className="shrink-0 text-xs text-slate-400 transition-colors hover:text-slate-700 dark:hover:text-slate-200"
                      >
                        恢复
                      </button>
                    </div>
                  </div>
                  {feedbackVersionId === item.id ? (
                    <div className="mb-1.5 rounded-lg border border-slate-200/70 p-2 dark:border-white/[0.08]">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <Button
                          size="sm"
                          onClick={() => submitFeedback(item, "adopted")}
                        >
                          <Check className="h-3.5 w-3.5" />采用这版
                        </Button>
                        <Button size="sm" variant="outline" onClick={() => submitFeedback(item, "needs_change")}>需要修改</Button>
                        <Button size="sm" variant="ghost" onClick={() => submitFeedback(item, "discarded")}>放弃这版</Button>
                      </div>
                      {feedbackReasons.length >= 0 && feedbackVersionId === item.id ? (
                        <div className="mt-1.5 flex flex-wrap gap-1">
                          {feedbackReasonOptions.map((reason) => (
                            <button
                              key={reason}
                              type="button"
                              onClick={() => setFeedbackReasons((current) => (
                                current.includes(reason)
                                  ? current.filter((entry) => entry !== reason)
                                  : [...current, reason]
                              ))}
                              className={cn(
                                "rounded-full border px-2 py-0.5 text-[10px] transition-colors",
                                feedbackReasons.includes(reason)
                                  ? "border-brand bg-brand text-brand-foreground"
                                  : "border-slate-200 text-slate-500 hover:border-slate-300 dark:border-white/10 dark:text-slate-400"
                              )}
                            >
                              {reason}
                            </button>
                          ))}
                          <Input
                            value={feedbackNote}
                            onChange={(event) => setFeedbackNote(event.target.value)}
                            placeholder="补充说明（可选）"
                            className="h-6 w-40 text-[11px]"
                          />
                        </div>
                      ) : null}
                      <p className="mt-1 text-[10px] text-slate-400 dark:text-slate-500">
                        采用不填原因；待改/放弃可选原因。放弃不会删除稿件。
                      </p>
                    </div>
                  ) : null}
                </div>
              );
            })}
            {lastAdoption ? (
              <div className="flex items-center justify-between gap-2 rounded-lg bg-brand/[0.06] px-2 py-1.5">
                <span className="text-[11px] text-slate-600 dark:text-slate-300">
                  已采用一版修改稿：可对比基础稿提炼表达经验（默认待确认，不会自动生效）。
                </span>
                <Button size="sm" variant="outline" disabled={extracting} onClick={() => void extractExperienceFromAdoption()}>
                  {extracting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
                  提炼经验
                </Button>
              </div>
            ) : null}
            {usedExperienceIds.length > 0 ? (
              <p className="px-2 pt-1 text-[10px] text-slate-400 dark:text-slate-500">
                最新生成使用了 {usedExperienceIds.length} 条已确认经验（已随版本记录）。
              </p>
            ) : null}
          </div>
        </details>
      ) : null}
    </div>
  );
}

function ReferenceUploadButton({
  label,
  icon: Icon,
  accept,
  onPick
}: {
  label: string;
  icon: typeof FileVideo;
  accept: string;
  onPick: (file: File) => void;
}) {
  return (
    <label className="flex cursor-pointer flex-col items-center gap-1 rounded-lg border border-dashed border-slate-200 px-2 py-2 text-center transition-colors hover:border-brand/50 hover:bg-brand/[0.04] dark:border-white/[0.12] dark:hover:border-brand/50">
      <Icon className="h-4 w-4 text-slate-400 dark:text-slate-500" />
      <span className="text-[11px] text-slate-500 dark:text-slate-400">{label}</span>
      <input type="file" accept={accept} className="hidden" onChange={(event) => {
        const file = event.target.files?.[0];
        if (file) onPick(file);
        event.target.value = "";
      }} />
    </label>
  );
}

function ReferenceRow({
  item,
  onRetry,
  onRemove
}: {
  item: ReferenceItem;
  onRetry: () => void;
  onRemove: () => void;
}) {
  return (
    <div className="flex items-center gap-2 rounded-lg bg-slate-50 px-2.5 py-1.5 dark:bg-white/[0.03]">
      <span className="min-w-0 flex-1 truncate text-xs text-slate-600 dark:text-slate-300">{item.name}</span>
      <span className={cn(
        "shrink-0 text-[11px]",
        item.status === "done" ? "text-emerald-600 dark:text-emerald-400"
          : item.status === "failed" ? "text-red-500 dark:text-red-400"
            : "text-slate-400 dark:text-slate-500"
      )}>
        {referenceStatusLabel[item.status]}
      </span>
      {item.status === "done" && item.analysis ? (
        <details className="shrink-0">
          <summary className="cursor-pointer text-[11px] text-slate-400 hover:text-slate-600 dark:hover:text-slate-200">查看分析</summary>
          <div className="absolute z-20 mt-1 max-w-sm rounded-xl border border-slate-200 bg-white p-3 text-xs leading-5 text-slate-600 shadow-lg dark:border-white/10 dark:bg-slate-900 dark:text-slate-300">
            <div className="whitespace-pre-wrap">{item.analysis}</div>
            {item.facts?.length ? (
              <div className="mt-2 border-t border-slate-100 pt-2 dark:border-white/10">
                <div className="font-medium text-emerald-600 dark:text-emerald-400">产品事实</div>
                {item.facts.map((fact, index) => <div key={index}>{fact}</div>)}
              </div>
            ) : null}
            {item.inferences?.length ? (
              <div className="mt-2 border-t border-slate-100 pt-2 dark:border-white/10">
                <div className="font-medium text-amber-600 dark:text-amber-400">AI 推测 / 创作建议</div>
                {item.inferences.map((line, index) => <div key={index}>{line}</div>)}
              </div>
            ) : null}
          </div>
        </details>
      ) : null}
      {item.status === "failed" ? (
        <button type="button" onClick={onRetry} className="shrink-0 text-[11px] text-brand hover:underline">重试</button>
      ) : null}
      <button type="button" onClick={onRemove} className="shrink-0 text-slate-400 transition-colors hover:text-red-500" aria-label="删除">
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

function SectionEditor({
  section,
  busy,
  customOpen,
  customValue,
  onCustomValue,
  onChange,
  onAction,
  onCustomSubmit,
  onSelectionChange,
  onSelectionRevise,
  onToggleLock,
  reviseBusy
}: {
  section: ScriptDocument["sections"][number];
  busy: boolean;
  customOpen: boolean;
  customValue: string;
  onCustomValue: (value: string) => void;
  onChange: (content: string) => void;
  onAction: (mode: "natural" | "impact" | "replace" | "custom") => void;
  onCustomSubmit: (instruction: string) => void;
  onSelectionChange?: (selection: { start: number; end: number } | null) => void;
  onSelectionRevise?: () => void;
  onToggleLock?: () => void;
  reviseBusy?: boolean;
}) {
  const lines = section.content.split("\n").length + 1;

  function handleSelect(event: React.UIEvent<HTMLTextAreaElement>) {
    if (!onSelectionChange) return;
    const element = event.currentTarget;
    const start = element.selectionStart ?? 0;
    const end = element.selectionEnd ?? 0;
    onSelectionChange(end > start ? { start, end } : null);
  }

  return (
    <div className="group">
      <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-400 dark:text-slate-500">
        {section.label}
      </div>
      <Textarea
        value={section.content}
        onChange={(event) => onChange(event.target.value)}
        onSelect={handleSelect}
        rows={Math.min(16, Math.max(3, lines))}
        disabled={busy}
        aria-label={`编辑${section.label}`}
        className="mt-1 min-h-0 resize-none border-0 bg-transparent px-0 text-[15px] leading-7 text-slate-800 shadow-none focus-visible:ring-0 dark:text-slate-100"
      />
      <div className="mt-1 flex flex-wrap items-center gap-1">
        {busy ? (
          <span className="inline-flex items-center gap-1 text-[11px] text-slate-400"><Loader2 className="h-3 w-3 animate-spin" />正在优化这一段…</span>
        ) : (
          <>
            <MiniAction label="更自然" onClick={() => onAction("natural")} />
            <MiniAction label="更炸一点" onClick={() => onAction("impact")} />
            <MiniAction label="换一个" onClick={() => onAction("replace")} />
            <MiniAction label="自定义修改" onClick={() => onAction("custom")} />
            {onSelectionRevise ? (
              <>
                <MiniAction
                  label={reviseBusy ? "生成建议中…" : "只改选中"}
                  disabled={!onSelectionChange || reviseBusy}
                  onClick={onSelectionRevise}
                />
                <MiniAction label="锁定/解锁选中" onClick={() => onToggleLock?.()} />
              </>
            ) : null}
          </>
        )}
      </div>
      <p className="mt-0.5 text-[10px] leading-3 text-slate-300 dark:text-slate-600">
        选中一段文字后可用「只改选中」；锁定后的内容，全局改稿和重新生成都不会动它。
      </p>
      {customOpen ? (
        <div className="mt-2 flex items-start gap-2">
          <Input
            value={customValue}
            onChange={(event) => onCustomValue(event.target.value)}
            placeholder="你想怎么改？例如：太像广告，让女生说得像普通40岁女性聊天。"
            className="h-9 flex-1 text-xs"
          />
          <Button size="sm" disabled={!customValue.trim()} onClick={() => onCustomSubmit(customValue)}>修改这一段</Button>
        </div>
      ) : null}
    </div>
  );
}

function MiniAction({ label, onClick, disabled }: { label: string; onClick: () => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="rounded-md px-1.5 py-0.5 text-[11px] text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700 disabled:cursor-not-allowed disabled:opacity-50 dark:hover:bg-white/[0.06] dark:hover:text-slate-200"
    >
      {label}
    </button>
  );
}

const douyinStageMessages: Record<string, string> = {
  INVALID_URL: "未识别到有效抖音链接",
  VIDEO_IMPORT_FAILED: "视频解析失败，请重试",
  AUDIO_EXTRACT_FAILED: "视频解析失败，请重试",
  ASR_FAILED: "语音转写失败，请重试",
  ASR_ACCOUNT_ISSUE: "阿里云语音服务欠费或未开通，请先处理账户后再试",
  NO_SPEECH: "未识别到有效语音",
  INTERRUPTED: "上次解析被中断，请重试",
  NETWORK_ERROR: "视频解析失败，请重试"
};

function douyinStageMessage(stage: string) {
  return douyinStageMessages[stage] || "视频解析失败，请重试";
}

async function writeClipboard(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const area = window.document.createElement("textarea");
      area.value = text;
      window.document.body.appendChild(area);
      area.select();
      const ok = window.document.execCommand("copy");
      window.document.body.removeChild(area);
      return ok;
    } catch {
      return false;
    }
  }
}

function truncate(value: string | undefined, length: number) {
  if (!value) return "";
  return value.length > length ? value.slice(0, length) : value;
}

function textToDocument(title: string, text: string): ScriptDocument {
  const sections: ScriptDocument["sections"] = [];
  const lines = text.split("\n");
  let currentLabel = "";
  let currentKey = "";
  let buffer: string[] = [];
  const flush = () => {
    const content = buffer.join("\n").trim();
    if (currentLabel && content) {
      sections.push({ key: currentKey, label: currentLabel, content });
    }
    buffer = [];
  };
  for (const line of lines) {
    if (/^(开头 · 0–3s|文案|对话|脚本|镜头|画中画|动作|结尾)$/.test(line.trim())) {
      flush();
      currentLabel = line.trim();
      currentKey = currentLabel.includes("开头") ? "hook"
        : currentLabel === "文案" || currentLabel === "脚本" ? "script"
          : currentLabel === "对话" ? "dialog"
          : currentLabel === "镜头" ? "shots"
            : currentLabel === "画中画" ? "overlay"
              : currentLabel === "动作" ? "actions" : "ending";
    } else {
      buffer.push(line);
    }
  }
  flush();
  // 版本里可能还是旧的五段结构，恢复时同样只保留文案。
  return toCopyOnlyDocument({ title: title || "未命名脚本", sections });
}
