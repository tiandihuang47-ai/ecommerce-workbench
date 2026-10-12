"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  Archive,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Copy,
  FileSearch,
  FileText,
  FileVideo,
  Link2,
  Loader2,
  Pencil,
  Plus,
  Save,
  Search,
  Sparkles,
  Upload
} from "lucide-react";
import { SectionCard } from "@/components/design-system";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  getDeconstructionRecordById,
  getLatestDeconstructionRecord,
  saveDeconstructionRecord
} from "@/lib/deconstruction-store";
import { commentsToText, normalizeCommentRecords, parseManualComments } from "@/lib/comment-insights";
import { getProductRecords, nowIso, saveResourceItem, saveScriptRecord } from "@/lib/pipeline-storage";
import type { CommentRecord, HighLikeCommentInsights, ProductRecord, ProductReferenceSnapshot, SimpleDeconstructionRecord } from "@/lib/pipeline-types";
import { createProductReferenceSnapshot, formatProductReferenceForPrompt } from "@/lib/product-reference";
import { platformLabels, type VideoPlatform } from "@/lib/video-link-parser";
import { cn } from "@/lib/utils";
import { assetFromScriptRecord, createAsset, type ContentAssetPlatform } from "@/lib/stores/asset-store";
import { consumeDeconstructionReuseDraft } from "@/lib/asset-reuse-client";
import { createId } from "@/lib/shared/id";
import {
  deconstructionToResource,
  deconstructionToScriptRecord,
  generateLocalDeconstruction,
  parseAiDeconstruction,
  type DeconstructionInput
} from "@/services/simpleContentService";

type Mode = "link" | "upload" | "manual";
type StepStatus = "idle" | "running" | "done" | "error" | "manual" | "skipped";
type SaveStatus = "idle" | "saving" | "saved" | "error";
type RewriteReferenceSource = "structure" | "comments" | "structure_comments";
type AnalysisSectionKey = "transcript" | "structure" | "comments" | "summary";

interface ProcessStep {
  key: string;
  label: string;
  status: StepStatus;
  message: string;
}

interface AnalyzePayload {
  success: boolean;
  stage?: string;
  platform?: VideoPlatform;
  title?: string;
  author?: string;
  description?: string;
  coverUrl?: string;
  videoUrl?: string;
  audioUrl?: string;
  rawText?: string;
  comments?: Array<{ author?: string; content: string; likeCount?: number; authorName?: string; commentId?: string; id?: string }>;
  structuredJson?: Record<string, unknown>;
  error?: string;
  attempts?: Array<{ parser: string; stage: string; success: boolean; message: string; detail?: string }>;
  normalizedUrl?: string;
  videoPath?: string;
  audioPath?: string;
  transcript?: string;
  message?: string;
  fallbackRequired?: boolean;
}

interface LinkAnalyzeJobPayload {
  id: string;
  status: "queued" | "running" | "success" | "failed";
  stage: string;
  progress: Array<{ stage: string; label: string; status: "pending" | "running" | "done" | "error"; message: string }>;
  result: (AnalyzePayload & {
    url?: string;
    coverUrl?: string;
    rawText?: string;
    structuredJson?: Record<string, unknown>;
  }) | null;
  deconstructionMarkdown: string;
  rewriteMarkdown: string;
  error: string;
}

interface DebugPayload {
  success: boolean;
  extractedUrl: string;
  normalizedUrl: string;
  platform: string;
  redirectedUrl: string;
  chromeProfiles: Array<{ name: string; hasCookies: boolean }>;
  ytDlpAttempts: Array<{ strategy: string; success: boolean; command: string; stdoutSummary: string; stderrSummary: string; errorSummary: string }>;
  finalReason: string;
  finalSuggestion: string;
  steps: Array<{ stepName: string; status: "success" | "failed" | "skipped"; command: string; stdoutSummary: string; stderrSummary: string; nextSuggestion: string }>;
}

const rewriteGoals: SimpleDeconstructionRecord["rewriteGoal"][] = ["涨粉", "建信任", "引流", "成交", "直播间引流"];
const rewriteStyles: SimpleDeconstructionRecord["rewriteStyle"][] = ["犀利", "接地气", "专业", "口语化", "情绪化", "成交转化"];
const contentFormats = ["短视频口播", "电商带货", "小红书种草", "图文笔记", "直播切片", "评论回复", "老板 IP", "达人口播", "竞品对比", "避坑科普"];
const publishPlatforms = ["抖音", "小红书", "快手", "视频号", "淘宝内容", "私域朋友圈"];
const COMMENT_LIMIT = 10;

const baseSteps: ProcessStep[] = [
  { key: "platform_detect", label: "提取链接", status: "idle", message: "" },
  { key: "video_download", label: "解析视频", status: "idle", message: "" },
  { key: "asr", label: "提取逐字稿", status: "idle", message: "" },
  { key: "deconstruction", label: "拆解结构", status: "idle", message: "" },
  { key: "comment_fetch", label: "抓取高赞评论", status: "idle", message: "" },
  { key: "comment_insights", label: "分析评论洞察", status: "idle", message: "" },
  { key: "rewrite", label: "生成仿写", status: "idle", message: "" },
  { key: "finish", label: "已保存", status: "idle", message: "" }
];

const initialForm = {
  sourceUrl: "",
  sourceTitle: "",
  transcript: "",
  manualDescription: "",
  comments: "",
  targetIndustry: "",
  targetProduct: "",
  targetAudience: "",
  sellingPoint: "",
  painPoint: "",
  publishPlatform: "抖音",
  contentFormat: "短视频口播",
  rewriteGoal: "成交" as SimpleDeconstructionRecord["rewriteGoal"],
  rewriteStyle: "口语化" as SimpleDeconstructionRecord["rewriteStyle"],
  rewriteReferenceSource: "structure_comments" as RewriteReferenceSource,
  extraRequirement: ""
};

const sourceTypeLabels: Record<Mode, string> = {
  link: "链接分析",
  upload: "上传视频",
  manual: "手动输入"
};

const analysisSections: Array<{ key: AnalysisSectionKey; label: string }> = [
  { key: "transcript", label: "逐字稿" },
  { key: "structure", label: "视频结构" },
  { key: "comments", label: "评论洞察" },
  { key: "summary", label: "总结分析" }
];

export function LinkDeconstructionPage() {
  const rewriteScrollRef = useRef<HTMLDivElement | null>(null);
  const [mode, setMode] = useState<Mode>("link");
  const [form, setForm] = useState(initialForm);
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [analyzeInfo, setAnalyzeInfo] = useState<AnalyzePayload | null>(null);
  const [platform, setPlatform] = useState<VideoPlatform>("unknown");
  const [steps, setSteps] = useState<ProcessStep[]>(baseSteps);
  const [generated, setGenerated] = useState<SimpleDeconstructionRecord | null>(null);
  const [analyzeLoading, setAnalyzeLoading] = useState(false);
  const [generateLoading, setGenerateLoading] = useState(false);
  const [debugLoading, setDebugLoading] = useState(false);
  const [debugReport, setDebugReport] = useState<DebugPayload | null>(null);
  const [message, setMessage] = useState("");
  const [useBrowserCookies, setUseBrowserCookies] = useState(false);
  const [currentRecordId, setCurrentRecordId] = useState("");
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");
  const [topComments, setTopComments] = useState<CommentRecord[]>([]);
  const [commentInsights, setCommentInsights] = useState<HighLikeCommentInsights | null>(null);
  const [commentsSource, setCommentsSource] = useState<SimpleDeconstructionRecord["commentsSource"]>("");
  const [commentsFetchStatus, setCommentsFetchStatus] = useState<SimpleDeconstructionRecord["commentsFetchStatus"]>("idle");
  const [commentsFetchError, setCommentsFetchError] = useState("");
  const [products, setProducts] = useState<ProductRecord[]>([]);
  const [selectedProductId, setSelectedProductId] = useState("");
  const [selectedProductSnapshot, setSelectedProductSnapshot] = useState<ProductReferenceSnapshot | undefined>();

  useEffect(() => {
    const availableProducts = getProductRecords();
    setProducts(availableProducts);
    const reuseDraft = consumeDeconstructionReuseDraft();
    if (reuseDraft) {
      const now = nowIso();
      restoreRecord({
        ...reuseDraft,
        id: createId("deconstruction"),
        savedScriptId: undefined,
        createdAt: now,
        updatedAt: now
      }, false, availableProducts, true);
      return;
    }
    const recordId = new URLSearchParams(window.location.search).get("record");
    const selected = recordId ? getDeconstructionRecordById(recordId) : getLatestDeconstructionRecord();
    if (selected) {
      restoreRecord(selected, Boolean(recordId), availableProducts);
    }
    const activeJobId = window.localStorage.getItem("director-platform.activeLinkAnalyzeJob");
    if (activeJobId) {
      void pollAnalyzeJob(activeJobId, false);
    }
  }, []);

  useEffect(() => {
    rewriteScrollRef.current?.scrollTo({ top: 0 });
  }, [currentRecordId]);

  useEffect(() => {
    if (generated?.rewrittenScript) {
      rewriteScrollRef.current?.scrollTo({ top: 0, behavior: "smooth" });
    }
  }, [generated?.rewrittenScript]);

  const canGenerate = useMemo(() => {
    const sourceContent = [form.sourceTitle, form.transcript, form.manualDescription].filter(Boolean).join("");
    return Boolean(sourceContent.trim().length >= 8 && form.targetProduct.trim() && form.targetAudience.trim());
  }, [form]);

  function restoreRecord(record: SimpleDeconstructionRecord, notify = true, availableProducts = products, asNewDraft = false) {
    const sourceType = record.sourceType === "upload" || record.sourceType === "manual" ? record.sourceType : "link";
    setMode(sourceType);
    setCurrentRecordId(asNewDraft ? "" : record.id);
    setSaveStatus(asNewDraft ? "idle" : "saved");
    setGenerated(record.status === "failed" ? null : record);
    setPlatform(record.platform || "unknown");
    setTopComments(record.topComments || []);
    setCommentInsights(record.commentInsights || null);
    setCommentsSource(record.commentsSource || "");
    setCommentsFetchStatus(record.commentsFetchStatus || "idle");
    setCommentsFetchError(record.commentsFetchError || "");
    setAnalyzeInfo({
      success: record.status !== "failed",
      platform: record.platform,
      title: record.sourceTitle || record.title,
      author: record.sourceAuthor,
      description: record.sourceDescription,
      coverUrl: record.sourceCover,
      videoUrl: record.videoUrl,
      audioUrl: record.audioUrl,
      rawText: record.rawText,
      comments: parseComments(record.comments),
      structuredJson: parseStructuredJson(record.structuredJson),
      normalizedUrl: record.cleanUrl || record.normalizedUrl || record.sourceUrl,
      videoPath: record.videoPath,
      audioPath: record.audioPath,
      transcript: record.transcript,
      message: record.errorMessage || "已从拆片记录恢复。",
      error: record.errorMessage,
      attempts: parseAttempts(record.parseAttempts)
    });
    setForm({
      sourceUrl: record.sourceUrl || record.cleanUrl || record.normalizedUrl || "",
      sourceTitle: record.sourceTitle || record.title || "",
      transcript: record.transcript || "",
      manualDescription: record.manualDescription || record.sourceDescription || "",
      comments: record.comments || "",
      targetIndustry: record.targetIndustry || "",
      targetProduct: record.targetProduct || "",
      targetAudience: record.targetAudience || "",
      sellingPoint: record.reusableStructure || "",
      painPoint: record.coreTheme || "",
      publishPlatform: platformLabelFromRecord(record),
      contentFormat: "短视频口播",
      rewriteGoal: record.rewriteGoal || "成交",
      rewriteStyle: record.rewriteStyle || "口语化",
      rewriteReferenceSource: "structure_comments",
      extraRequirement: ""
    });
    const matchedProduct = availableProducts.find((item) => item.id === record.productId)
      || availableProducts.find((item) => item.name === record.targetProduct);
    setSelectedProductId(matchedProduct?.id || "");
    setSelectedProductSnapshot(record.productSnapshot || (matchedProduct ? createProductReferenceSnapshot(matchedProduct) : undefined));
    if (record.status === "failed") {
      markFailedStage("finish", record.errorMessage || "历史记录显示本次分析失败。");
    } else if (record.rewrittenScript) {
      setSteps(buildRestoredSteps(record, true));
    } else if (record.transcript) {
      setSteps(buildRestoredSteps(record, false));
    }
    if (asNewDraft) {
      setMessage("已从资产库恢复原视频分析、产品资料和仿写简报；重新生成会保存为新拆片，不会覆盖原记录。");
    } else if (notify) {
      setMessage("已打开拆片记录，不会重新请求 API。");
    }
  }

  function persistRecord(record: SimpleDeconstructionRecord, successMessage?: string, showResult = true) {
    setSaveStatus("saving");
    try {
      const saved = saveDeconstructionRecord(record);
      saveDeconstructionAsset(saved);
      if (saved.commentInsights || saved.topComments?.length) {
        saveCommentInsightAsset(saved);
      }
      setCurrentRecordId(saved.id);
      if (showResult && saved.status !== "failed") {
        setGenerated(saved);
      }
      setSaveStatus("saved");
      if (saved.status === "completed") {
        markStep("finish", "done", "已保存到拆片记录。");
      }
      if (successMessage) setMessage(successMessage);
      return saved;
    } catch {
      setSaveStatus("error");
      setMessage("历史记录读取失败，请刷新页面或清理本地缓存。");
      return null;
    }
  }

  function buildRecordFromCurrent(status: SimpleDeconstructionRecord["status"], patch: Partial<SimpleDeconstructionRecord> = {}) {
    const input = buildInput();
    const base = generated || generateLocalDeconstruction(input);
    const now = nowIso();
    return {
      ...base,
      ...patch,
      id: currentRecordId || patch.id || base.id,
      sourceType: patch.sourceType || mode,
      title: patch.title || form.sourceTitle || analyzeInfo?.title || base.title,
      sourceUrl: patch.sourceUrl || form.sourceUrl || base.sourceUrl,
      platform: patch.platform || platform || base.platform || "unknown",
      normalizedUrl: patch.normalizedUrl || analyzeInfo?.normalizedUrl || base.normalizedUrl || form.sourceUrl,
      cleanUrl: patch.cleanUrl || patch.normalizedUrl || analyzeInfo?.normalizedUrl || form.sourceUrl || base.normalizedUrl,
      sourceTitle: patch.sourceTitle || form.sourceTitle || analyzeInfo?.title || base.sourceTitle,
      sourceDescription: patch.sourceDescription || analyzeInfo?.description || form.manualDescription || base.sourceDescription,
      sourceAuthor: patch.sourceAuthor || analyzeInfo?.author || base.sourceAuthor,
      sourceCover: patch.sourceCover || analyzeInfo?.coverUrl || base.sourceCover,
      videoUrl: patch.videoUrl || analyzeInfo?.videoUrl || base.videoUrl || "",
      audioUrl: patch.audioUrl || analyzeInfo?.audioUrl || base.audioUrl || "",
      rawText: patch.rawText || analyzeInfo?.rawText || form.transcript || base.rawText || "",
      structuredJson: patch.structuredJson || stringifyJson(analyzeInfo?.structuredJson) || base.structuredJson || "",
      transcript: patch.transcript || form.transcript || analyzeInfo?.transcript || base.transcript,
      videoPath: patch.videoPath || analyzeInfo?.videoPath || base.videoPath || "",
      audioPath: patch.audioPath || analyzeInfo?.audioPath || base.audioPath || "",
      asrProvider: patch.asrProvider || base.asrProvider || (form.transcript ? "豆包语音转写 / 手动输入" : ""),
      asrMessage: patch.asrMessage || analyzeInfo?.message || base.asrMessage || "",
      parseStrategy: patch.parseStrategy || analyzeInfo?.stage || base.parseStrategy || "",
      parseAttempts: patch.parseAttempts || stringifyJson(analyzeInfo?.attempts) || base.parseAttempts || "",
      analysisResult: patch.analysisResult || patch.analysisMarkdown || base.analysisResult || base.analysisMarkdown || "",
      manualDescription: patch.manualDescription || form.manualDescription || base.manualDescription,
      comments: hasPatch(patch, "comments") ? patch.comments || "" : form.comments || base.comments,
      topComments: hasPatch(patch, "topComments") ? patch.topComments || [] : topComments || base.topComments || [],
      commentInsights: hasPatch(patch, "commentInsights") ? patch.commentInsights : commentInsights || base.commentInsights,
      commentsSource: hasPatch(patch, "commentsSource") ? patch.commentsSource || "" : commentsSource || base.commentsSource || "",
      commentsFetchStatus: hasPatch(patch, "commentsFetchStatus") ? patch.commentsFetchStatus || "idle" : commentsFetchStatus || base.commentsFetchStatus || "idle",
      commentsFetchError: hasPatch(patch, "commentsFetchError") ? patch.commentsFetchError || "" : commentsFetchError || base.commentsFetchError || "",
      commentBasedTopicIdeas: patch.commentBasedTopicIdeas || commentInsights?.topicIdeas?.join("\n") || base.commentBasedTopicIdeas || "",
      commentBasedShootingSuggestions: patch.commentBasedShootingSuggestions || commentInsights?.shootingSuggestions?.join("\n") || base.commentBasedShootingSuggestions || "",
      commentBasedHookIdeas: patch.commentBasedHookIdeas || commentInsights?.hookIdeas?.join("\n") || base.commentBasedHookIdeas || "",
      productId: hasPatch(patch, "productId") ? patch.productId || "" : selectedProductId || base.productId || "",
      productSnapshot: hasPatch(patch, "productSnapshot") ? patch.productSnapshot : selectedProductSnapshot || base.productSnapshot,
      targetIndustry: patch.targetIndustry || form.targetIndustry || base.targetIndustry,
      targetProduct: patch.targetProduct || form.targetProduct || base.targetProduct,
      targetAudience: patch.targetAudience || form.targetAudience || base.targetAudience,
      rewriteGoal: patch.rewriteGoal || form.rewriteGoal || base.rewriteGoal,
      rewriteStyle: patch.rewriteStyle || form.rewriteStyle || base.rewriteStyle,
      status,
      errorMessage: status === "failed" ? patch.errorMessage || analyzeInfo?.error || message || "分析失败。" : patch.errorMessage || "",
      favorite: patch.favorite ?? base.favorite ?? false,
      tags: patch.tags || [form.publishPlatform, form.contentFormat, form.rewriteStyle].filter(Boolean).join("、"),
      createdAt: patch.createdAt || base.createdAt || now,
      updatedAt: now
    } satisfies SimpleDeconstructionRecord;
  }

  async function analyzeLink() {
    if (!form.sourceUrl.trim()) {
      setMessage("链接不能为空，请先粘贴平台视频链接。");
      markFailedStage("platform_detect", "链接不能为空。");
      return;
    }

    setAnalyzeLoading(true);
    setDebugReport(null);
    setGenerated(null);
    setMessage("");
    setSteps(baseSteps.map((step) => ({ ...step, status: step.key === "platform_detect" ? "running" : "idle", message: "" })));
    persistRecord(buildRecordFromCurrent("analyzing", {
      sourceType: "link",
      sourceUrl: form.sourceUrl,
      title: form.sourceTitle || form.sourceUrl,
      sourceTitle: form.sourceTitle || "链接分析中",
      errorMessage: ""
    }), undefined, false);

    try {
      markStep("video_download", "running", "正在解析或下载视频。");
      const response = await fetch("/api/link-analyzer/jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url: form.sourceUrl,
          targetProduct: form.targetProduct,
          targetAudience: form.targetAudience,
          rewriteGoal: form.rewriteGoal,
          rewriteStyle: form.rewriteStyle,
          extraRequirement: form.extraRequirement,
          useBrowserCookies
        })
      });
      const payload = await response.json() as { success: boolean; job?: LinkAnalyzeJobPayload; message?: string };
      if (!response.ok || !payload.success || !payload.job) {
        const errorMessage = payload.message || "链接分析任务创建失败。";
        markFailedStage("platform_detect", errorMessage);
        setMessage(errorMessage);
        persistRecord(buildRecordFromCurrent("failed", { sourceType: "link", errorMessage }), undefined, false);
        return;
      }

      window.localStorage.setItem("director-platform.activeLinkAnalyzeJob", payload.job.id);
      await pollAnalyzeJob(payload.job.id, true);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "链接分析失败，请改用上传视频或手动输入。";
      markFailedStage("video_download", errorMessage);
      setMessage(errorMessage);
      persistRecord(buildRecordFromCurrent("failed", { sourceType: "link", errorMessage }), undefined, false);
    } finally {
      setAnalyzeLoading(false);
    }
  }

  async function pollAnalyzeJob(jobId: string, startedByUser: boolean) {
    if (startedByUser) {
      setMessage("正在后台分析链接。切换页面不会取消任务。");
    }

    for (let index = 0; index < 240; index += 1) {
      const response = await fetch(`/api/link-analyzer/jobs/${jobId}`);
      const payload = await response.json() as { success: boolean; job?: LinkAnalyzeJobPayload; message?: string };
      if (!response.ok || !payload.success || !payload.job) {
        setMessage(payload.message || "链接分析任务状态读取失败。");
        return;
      }

      await applyJobState(payload.job);
      if (payload.job.status === "success" || payload.job.status === "failed") {
        window.localStorage.removeItem("director-platform.activeLinkAnalyzeJob");
        saveLinkJobHistory(payload.job);
        return;
      }
      await sleep(1800);
    }
    setMessage("任务仍在后台处理中，稍后刷新页面会继续尝试读取状态。");
  }

  async function applyJobState(job: LinkAnalyzeJobPayload) {
    const analysisRecordId = currentRecordId || `deconstruction_${job.id}`;
    setSteps(job.progress.map((item): ProcessStep => ({
      key: mapJobStage(item.stage),
      label: mapStepLabel(item.stage, item.label),
      status: item.status === "pending" ? "idle" : item.status === "done" ? "done" : item.status === "error" ? "error" : "running",
      message: item.message
    })).filter((step, index, list) => list.findIndex((entry) => entry.key === step.key) === index));

    if (job.result) {
      const result = job.result;
      setAnalyzeInfo({
        ...result,
        success: job.status === "success",
        message: result.message || job.error || (job.status === "success" ? "链接分析完成。" : "链接分析失败。")
      });
      setPlatform(result.platform || "unknown");
      setForm((current) => ({
        ...current,
        sourceUrl: result.normalizedUrl || current.sourceUrl,
        sourceTitle: current.sourceTitle || result.title || "",
        manualDescription: current.manualDescription || result.description || result.rawText || "",
        comments: current.comments || (result.comments || []).map((item) => item.content).join("\n"),
        transcript: result.transcript || current.transcript
      }));
      const recordStatus = job.status === "failed" ? "failed" : job.status === "success" ? "completed" : "analyzing";
      persistRecord(buildRecordFromCurrent(recordStatus, {
        id: analysisRecordId,
        sourceType: "link",
        sourceUrl: form.sourceUrl || result.normalizedUrl || "",
        normalizedUrl: result.normalizedUrl || form.sourceUrl,
        cleanUrl: result.normalizedUrl || form.sourceUrl,
        platform: result.platform || "unknown",
        title: result.title || form.sourceTitle || "链接分析结果",
        sourceTitle: result.title || form.sourceTitle || "链接分析结果",
        sourceAuthor: result.author || "",
        sourceDescription: result.description || result.rawText || "",
        sourceCover: result.coverUrl || "",
        videoUrl: result.videoUrl || "",
        audioUrl: result.audioUrl || "",
        rawText: result.rawText || "",
        structuredJson: stringifyJson(result.structuredJson),
        transcript: result.transcript || form.transcript,
        videoPath: result.videoPath || "",
        audioPath: result.audioPath || "",
        comments: (result.comments || []).map((item) => item.content).join("\n") || form.comments,
        parseStrategy: result.stage || "link-analyzer",
        parseAttempts: stringifyJson(result.attempts),
        errorMessage: job.status === "failed" ? job.error || result.error || "链接分析失败。" : ""
      }), undefined, false);
    }

    if (job.status === "success") {
      setMessage(job.deconstructionMarkdown ? "链接分析和视频结构拆解已完成。" : "链接分析完成，正在拆解视频结构。");
      if (job.result) {
        void fetchCommentsAndInsights({
          url: job.result.normalizedUrl || form.sourceUrl,
          platform: job.result.platform || platform || "unknown",
          existingComments: normalizeCommentRecords(job.result.comments || [], {
            platform: job.result.platform || platform || "unknown",
            videoUrl: job.result.normalizedUrl || form.sourceUrl,
            limit: COMMENT_LIMIT
          })
        });
      }
      if (job.result?.platform && job.deconstructionMarkdown) {
        const content = job.deconstructionMarkdown;
        const input = {
          ...buildInput(),
          platform: job.result.platform,
          normalizedUrl: job.result.normalizedUrl || form.sourceUrl,
          title: job.result.title || form.sourceTitle || "平台链接分析结果",
          sourceDescription: job.result.description || "",
          sourceAuthor: job.result.author || "",
          sourceCover: job.result.coverUrl || "",
          transcript: job.result.transcript || job.result.rawText || ""
        };
        const record = toStructureOnlyRecord(parseAiDeconstruction(content, input), content);
        const enriched = {
          ...record,
          id: analysisRecordId,
          sourceType: "link" as const,
          status: "completed" as const,
          cleanUrl: job.result.normalizedUrl || form.sourceUrl,
          sourceCover: job.result.coverUrl || record.sourceCover,
          videoUrl: job.result.videoUrl || "",
          audioUrl: job.result.audioUrl || "",
          rawText: job.result.rawText || "",
          structuredJson: JSON.stringify(job.result.structuredJson || {}, null, 2),
          analysisMarkdown: content,
          analysisResult: content,
          rewriteMarkdown: ""
        };
        setGenerated(enriched);
        persistRecord(enriched);
        markStep("deconstruction", "done", "视频结构拆解完成。");
      } else if (job.result) {
        await analyzeSourceStructure({
          ...buildInput(),
          platform: job.result.platform || "unknown",
          normalizedUrl: job.result.normalizedUrl || form.sourceUrl,
          title: job.result.title || form.sourceTitle || "平台链接分析结果",
          sourceDescription: job.result.description || job.result.rawText || "",
          sourceAuthor: job.result.author || "",
          sourceCover: job.result.coverUrl || "",
          transcript: job.result.transcript || job.result.rawText || "",
          videoPath: job.result.videoPath || "",
          audioPath: job.result.audioPath || "",
          asrMessage: job.result.message || ""
        }, "link", analysisRecordId);
      }
    }
    if (job.status === "failed") {
      const errorMessage = job.error || job.result?.error || "链接分析失败，请改用上传视频或手动输入。";
      setMessage(errorMessage);
      persistRecord(buildRecordFromCurrent("failed", { sourceType: "link", errorMessage }), undefined, false);
    }
  }

  async function analyzeSourceStructure(input: DeconstructionInput, sourceType: Mode, recordId?: string) {
    const sourceContent = [input.transcript, input.manualDescription, input.sourceDescription, input.title].filter(Boolean).join("\n").trim();
    if (sourceContent.length < 8) {
      const errorMessage = "用于拆解结构的内容太少，请补充逐字稿或视频内容。";
      markStep("deconstruction", "error", errorMessage);
      setMessage(errorMessage);
      return null;
    }

    markStep("deconstruction", "running", "正在拆解开头钩子、内容结构、节奏和可复用方法。");

    const fallback = toStructureOnlyRecord(generateLocalDeconstruction(input));
    let content = "";
    let successMessage = "视频结构拆解完成并已自动保存。";

    try {
      const response = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "deconstruction",
          input: {
            videoTitle: input.title,
            videoContent: sourceContent,
            ownIndustry: input.targetIndustry || "待补充产品行业",
            instruction: "只分析原视频的主题、开头钩子、爆款元素、内容结构、情绪节奏、转化位置和可复用结构，不生成产品仿写脚本。"
          }
        })
      });
      const payload = await response.json() as { content?: string; error?: string };

      if (response.ok && payload.content?.trim()) {
        content = payload.content.trim();
      } else {
        successMessage = `${payload.error || "AI 结构分析暂不可用"}，已使用本地规则生成基础结构并保存。`;
      }
    } catch (error) {
      successMessage = `${error instanceof Error ? error.message : "AI 结构分析失败"}，已使用本地规则生成基础结构并保存。`;
    }

    const parsed = content ? toStructureOnlyRecord(parseAiDeconstruction(content, input), content) : fallback;
    const analysisMarkdown = content || formatStructureAnalysis(parsed);
    const record = {
      ...parsed,
      id: recordId || currentRecordId || parsed.id,
      sourceType,
      status: "completed" as const,
      analysisMarkdown,
      analysisResult: analysisMarkdown,
      rewriteMarkdown: "",
      errorMessage: ""
    };

    setGenerated(record);
    persistRecord(record, successMessage);
    markStep("deconstruction", "done", content ? "已使用 AI 完成视频结构拆解。" : "已使用本地规则完成基础结构拆解。");
    return record;
  }

  async function analyzeUpload() {
    if (!uploadFile) {
      setMessage("请先选择要上传的视频文件。");
      return;
    }

    const allowed = [".mp4", ".mov", ".m4v", ".webm"];
    const lowerName = uploadFile.name.toLowerCase();
    if (!allowed.some((extension) => lowerName.endsWith(extension))) {
      setMessage("暂只支持 mp4、mov、m4v、webm 格式。");
      return;
    }
    if (uploadFile.size > 1024 * 1024 * 1024) {
      setMessage("视频文件超过 1GB，请压缩后再上传，或改用手动输入逐字稿。");
      return;
    }

    setAnalyzeLoading(true);
    setGenerated(null);
    setMessage("");
    setSteps(baseSteps.map((step) => ({ ...step, status: step.key === "asr" ? "running" : step.key === "platform_detect" || step.key === "video_download" ? "done" : "idle", message: "" })));

    try {
      // 流式上传：原始字节流直传，服务端边落盘边转写
      const response = await fetch("/api/video/upload-analyze", {
        method: "POST",
        headers: {
          "Content-Type": "application/octet-stream",
          "x-file-name": encodeURIComponent(uploadFile.name || "video.mp4")
        },
        body: uploadFile
      });
      const payload = await response.json() as AnalyzePayload;
      setAnalyzeInfo(payload);

      if (!response.ok || !payload.success) {
        const errorMessage = payload.message || "上传视频分析失败，请改用手动输入。";
        markFailedStage(payload.stage || "asr", errorMessage);
        setMessage(errorMessage);
        persistRecord(buildRecordFromCurrent("failed", {
          sourceType: "upload",
          title: uploadFile.name,
          sourceTitle: uploadFile.name,
          errorMessage
        }), undefined, false);
        return;
      }

      setPlatform("unknown");
      const sourceTitle = form.sourceTitle || payload.title || uploadFile.name;
      const transcript = payload.transcript || form.transcript;
      setForm((current) => ({ ...current, sourceTitle: current.sourceTitle || sourceTitle, transcript: transcript || current.transcript }));
      finishAnalyzeSteps(payload.message || "上传视频转写成功。");
      setMessage("上传视频已成功转成逐字稿，正在拆解视频结构。");
      const interimRecord = persistRecord(buildRecordFromCurrent("analyzing", {
        sourceType: "upload",
        platform: payload.platform || "unknown",
        title: sourceTitle,
        sourceTitle,
        transcript,
        videoPath: payload.videoPath || "",
        audioPath: payload.audioPath || "",
        asrMessage: payload.message || "上传视频转写成功。",
        errorMessage: ""
      }), undefined, false);
      await analyzeSourceStructure({
        ...buildInput(),
        title: sourceTitle,
        transcript,
        platform: payload.platform || "unknown",
        normalizedUrl: "",
        videoPath: payload.videoPath || "",
        audioPath: payload.audioPath || "",
        asrMessage: payload.message || "上传视频转写成功。"
      }, "upload", interimRecord?.id);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "上传视频分析失败，请改用手动输入。";
      markFailedStage("asr", errorMessage);
      setMessage(errorMessage);
      persistRecord(buildRecordFromCurrent("failed", { sourceType: "upload", title: uploadFile.name, sourceTitle: uploadFile.name, errorMessage }), undefined, false);
    } finally {
      setAnalyzeLoading(false);
    }
  }

  async function analyzeManualSource() {
    const sourceContent = [form.transcript, form.manualDescription, form.sourceTitle].filter(Boolean).join("\n").trim();
    if (sourceContent.length < 8) {
      setMessage("请先粘贴逐字稿或补充视频内容，再开始分析。");
      markFailedStage("deconstruction", "手动输入内容太少。");
      return;
    }

    setAnalyzeLoading(true);
    setGenerated(null);
    setPlatform("unknown");
    setAnalyzeInfo({
      success: true,
      platform: "unknown",
      title: form.sourceTitle || "手动输入内容",
      rawText: form.transcript || form.manualDescription,
      transcript: form.transcript,
      message: "已读取手动输入内容。"
    });
    setSteps(baseSteps.map((step): ProcessStep => {
      if (step.key === "platform_detect" || step.key === "video_download") {
        return { ...step, status: "skipped", message: "手动输入无需执行此步骤。" };
      }
      if (step.key === "asr") {
        return { ...step, status: "manual", message: "已读取手动逐字稿。" };
      }
      return { ...step, status: "idle", message: "" };
    }));

    try {
      const interimRecord = persistRecord(buildRecordFromCurrent("analyzing", {
        sourceType: "manual",
        platform: "unknown",
        title: form.sourceTitle || "手动输入内容",
        sourceTitle: form.sourceTitle || "手动输入内容",
        transcript: form.transcript,
        rawText: form.transcript || form.manualDescription,
        manualDescription: form.manualDescription,
        errorMessage: ""
      }), undefined, false);
      await analyzeSourceStructure(buildInput(), "manual", interimRecord?.id);
    } finally {
      setAnalyzeLoading(false);
    }
  }

  async function generate() {
    if (!canGenerate) {
      setMessage("请先补齐原视频内容、我的产品/业务和目标人群。");
      return;
    }

    setGenerateLoading(true);
    setMessage("");
    if (generated?.structure) {
      markStep("deconstruction", "done", "沿用已完成的原视频结构拆解。");
    } else {
      markStep("deconstruction", "running", "正在拆结构、钩子、情绪和转化路径。");
    }
    markStep("rewrite", "running", "正在生成原创仿写脚本。");

    const input = buildInput();
    const commentContext = buildCommentContextText();
    const referenceText = referenceSourceLabel(form.rewriteReferenceSource);
    try {
      const response = await fetch("/api/deconstruction/rewrite", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          transcript: input.transcript,
          sourceTitle: input.title,
          sourceUrl: input.sourceUrl,
          platform: platformLabels[input.platform || "unknown"],
          manualDescription: input.manualDescription || "",
          comments: input.comments || "",
          targetIndustry: input.targetIndustry || "",
          targetProduct: input.productName,
          targetAudience: input.targetAudience || "",
          rewriteGoal: input.rewriteGoal || "",
          rewriteStyle: input.rewriteStyle || "",
          extraRequirement: [
            `仿写参考来源：${referenceText}`,
            `发布平台：${form.publishPlatform}`,
            `内容形式：${form.contentFormat}`,
            form.sellingPoint ? `核心卖点：${form.sellingPoint}` : "",
            form.painPoint ? `用户痛点：${form.painPoint}` : "",
            formatProductReferenceForPrompt(input.productSnapshot),
            commentContext ? `高赞评论洞察：\n${commentContext}` : "",
            input.extraRequirement || ""
          ].filter(Boolean).join("\n")
        })
      });
      const payload = await response.json();
      const content = String(payload.analysis || payload.rewrittenScript || payload.fallback || "");

      if (!content) {
        throw new Error(payload.message || "拆片仿写失败");
      }

      const record = parseAiDeconstruction(content, input);
      const savedRecord = {
        ...record,
        id: currentRecordId || record.id,
        sourceType: mode,
        status: "completed" as const,
        cleanUrl: input.normalizedUrl,
        analysisMarkdown: content,
        analysisResult: content,
        rewriteMarkdown: String(payload.rewrittenScript || content),
        topComments,
        commentInsights: commentInsights || undefined,
        commentsSource,
        commentsFetchStatus,
        commentsFetchError,
        commentBasedTopicIdeas: commentInsights?.topicIdeas?.join("\n") || "",
        commentBasedShootingSuggestions: commentInsights?.shootingSuggestions?.join("\n") || "",
        commentBasedHookIdeas: commentInsights?.hookIdeas?.join("\n") || "",
        tags: [form.publishPlatform, form.contentFormat, form.rewriteStyle].join("、")
      };
      setGenerated(savedRecord);
      persistRecord(savedRecord, payload.message || (payload.source === "fallback" ? "已使用本地规则生成基础拆片和仿写脚本，并自动保存。" : "已使用 DeepSeek 完成拆片和原创仿写，并自动保存。"));
      markStep("deconstruction", response.ok && payload.success ? "done" : "error", response.ok && payload.success ? "拆片完成。" : payload.message || "DeepSeek 失败，已使用本地基础版本。");
      markStep("rewrite", "done", "仿写完成。");
      markStep("finish", "done", "结果已保存。");
    } catch (error) {
      const fallbackRecord = generateLocalDeconstruction(input);
      const record = {
        ...fallbackRecord,
        id: currentRecordId || fallbackRecord.id,
        sourceType: mode,
        status: "completed" as const,
        topComments,
        commentInsights: commentInsights || undefined,
        commentsSource,
        commentsFetchStatus,
        commentsFetchError,
        commentBasedTopicIdeas: commentInsights?.topicIdeas?.join("\n") || "",
        commentBasedShootingSuggestions: commentInsights?.shootingSuggestions?.join("\n") || "",
        commentBasedHookIdeas: commentInsights?.hookIdeas?.join("\n") || "",
        errorMessage: error instanceof Error ? error.message : "AI 请求失败",
        tags: [form.publishPlatform, form.contentFormat, form.rewriteStyle].join("、")
      };
      setGenerated(record);
      persistRecord(record, `${error instanceof Error ? error.message : "AI 请求失败"}，已自动使用本地规则生成基础拆片和仿写脚本并保存。`);
      markStep("deconstruction", "error", error instanceof Error ? error.message : "AI 请求失败。");
      markStep("rewrite", "done", "已使用本地规则生成基础版本。");
    } finally {
      setGenerateLoading(false);
    }
  }

  async function fetchCommentsAndInsights(params?: {
    url?: string;
    platform?: VideoPlatform;
    existingComments?: CommentRecord[];
  }) {
    const url = params?.url || analyzeInfo?.normalizedUrl || form.sourceUrl;
    const currentPlatform = params?.platform || platform || "unknown";
    const existing = params?.existingComments || [];

    if (!url && !existing.length) {
      setCommentsFetchStatus("failed");
      setCommentsFetchError("暂未获取到视频链接，可手动粘贴评论继续分析。");
      markStep("comment_fetch", "error", "暂未获取到视频链接。");
      return;
    }

    setCommentsFetchStatus("fetching");
    setCommentsFetchError("");
    markStep("comment_fetch", "running", "正在尝试获取点赞量最高的评论。");

    let comments = existing;
    let source: SimpleDeconstructionRecord["commentsSource"] = existing.length ? "existing-parser" : "";
    let fetchMessage = existing.length ? `已从解析结果中读取 ${existing.length} 条评论。` : "";

    if (!comments.length) {
      try {
        const response = await fetch("/api/video/comments", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            url,
            platform: currentPlatform,
            limit: COMMENT_LIMIT,
            sortBy: "likeCount"
          })
        });
        const payload = await response.json();
        comments = normalizeCommentRecords(payload.comments || [], { platform: currentPlatform, videoUrl: url, limit: COMMENT_LIMIT });
        source = payload.source || (comments.length ? "crawler-service" : "unsupported");
        fetchMessage = [
          payload.stage ? `失败阶段：${payload.stage}` : "",
          payload.message ? `失败原因：${payload.message}` : "",
          payload.suggestion ? `解决建议：${payload.suggestion}` : ""
        ].filter(Boolean).join("\n") || String(payload.message || "");
      } catch (error) {
        const rawMessage = error instanceof Error ? error.message : "评论抓取失败。";
        fetchMessage = /fetch failed|ECONNREFUSED|Failed to fetch/i.test(rawMessage)
          ? "失败阶段：comments\n失败原因：crawler-service 未启动或无法连接。\n解决建议：请运行 npm run crawler:dev，或手动粘贴评论继续分析。"
          : rawMessage;
        source = "unsupported";
      }
    }

    if (!comments.length) {
      console.log("[comments] fetch result", {
        success: false,
        commentsCount: 0,
        source,
        error: fetchMessage || "评论为空"
      });
      setTopComments([]);
      setCommentInsights(null);
      setCommentsSource(source || "unsupported");
      setCommentsFetchStatus("failed");
      setCommentsFetchError(fetchMessage || "当前平台评论抓取暂未成功，可手动粘贴评论区内容继续分析。");
      markStep("comment_fetch", "error", fetchMessage || "评论抓取失败，可手动粘贴评论。");
      console.log("[progress] comments step status", "failed");
      persistRecord(buildRecordFromCurrent("completed", {
        topComments: [],
        commentsSource: source || "unsupported",
        commentsFetchStatus: "failed",
        commentsFetchError: fetchMessage || "评论抓取失败。",
        commentInsights: undefined,
        comments: form.comments
      }), undefined, false);
      return;
    }

    setTopComments(comments);
    setCommentsSource(source || "crawler-service");
    setCommentsFetchStatus("success");
    setForm((current) => ({ ...current, comments: current.comments || commentsToText(comments) }));
    markStep("comment_fetch", "done", `抓取高赞评论：成功，已获取 ${comments.length} 条。`);
    console.log("[comments] fetch result", {
      success: true,
      commentsCount: comments.length,
      source: source || "crawler-service",
      error: ""
    });
    console.log("[progress] comments step status", "success");
    persistRecord(buildRecordFromCurrent("completed", {
      topComments: comments,
      commentsSource: source || "crawler-service",
      commentsFetchStatus: "success",
      commentsFetchError: "",
      comments: commentsToText(comments)
    }), undefined, false);

    await analyzeCommentInsights(comments, source || "crawler-service");
  }

  async function analyzeManualComments(rawComments: string) {
    const url = analyzeInfo?.normalizedUrl || form.sourceUrl || currentRecordId;
    const comments = parseManualComments(rawComments, { platform, videoUrl: url, limit: COMMENT_LIMIT });
    if (!comments.length) {
      setCommentsFetchStatus("failed");
      setCommentsFetchError("没有识别到有效评论，请按“一行一条评论”的方式粘贴。");
      console.log("[comments] fetch result", {
        success: false,
        commentsCount: 0,
        source: "manual",
        error: "没有识别到有效评论"
      });
      markStep("comment_insights", "error", "手动评论为空。");
      return;
    }
    setTopComments(comments);
    setCommentsSource("manual");
    setCommentsFetchStatus("manual");
    setCommentsFetchError("");
    setForm((current) => ({ ...current, comments: commentsToText(comments) }));
    markStep("comment_fetch", "manual", `抓取高赞评论：手动补充，已读取 ${comments.length} 条。`);
    console.log("[progress] comments step status", "manual");
    persistRecord(buildRecordFromCurrent("completed", {
      topComments: comments,
      commentsSource: "manual",
      commentsFetchStatus: "manual",
      commentsFetchError: "",
      comments: commentsToText(comments)
    }), undefined, false);
    await analyzeCommentInsights(comments, "manual");
  }

  async function analyzeCommentInsights(comments: CommentRecord[], source: SimpleDeconstructionRecord["commentsSource"]) {
    if (!comments.length) return;
    markStep("comment_insights", "running", "正在分析评论里的真实痛点和选题机会。");
    try {
      const response = await fetch("/api/comments/insights", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          videoInfo: {
            platform,
            url: analyzeInfo?.normalizedUrl || form.sourceUrl,
            title: form.sourceTitle || analyzeInfo?.title || "",
            author: analyzeInfo?.author || ""
          },
          comments,
          productContext: {
            targetProduct: form.targetProduct,
            targetAudience: form.targetAudience,
            sellingPoint: form.sellingPoint,
            painPoint: form.painPoint,
            rewriteGoal: form.rewriteGoal
          },
          analysisGoal: "shooting_inspiration"
        })
      });
      const payload = await response.json();
      const insights = payload.insights as HighLikeCommentInsights | undefined;
      if (!response.ok || !payload.success || !insights) {
        throw new Error(payload.message || "评论洞察分析失败。");
      }
      setCommentInsights(insights);
      markStep("comment_insights", "done", payload.message || "评论洞察已生成。");
      persistRecord(buildRecordFromCurrent("completed", {
        topComments: comments,
        commentInsights: insights,
        commentsSource: source,
        commentsFetchStatus: source === "manual" ? "manual" : "success",
        commentsFetchError: "",
        commentBasedTopicIdeas: insights.topicIdeas?.join("\n") || "",
        commentBasedShootingSuggestions: insights.shootingSuggestions?.join("\n") || "",
        commentBasedHookIdeas: insights.hookIdeas?.join("\n") || ""
      }), "已根据高赞评论生成拍摄建议。", false);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "评论洞察分析失败。";
      setCommentsFetchError(errorMessage);
      markStep("comment_insights", "error", `${errorMessage} 可手动调整评论后重试。`);
      persistRecord(buildRecordFromCurrent("completed", {
        topComments: comments,
        commentsSource: source,
        commentsFetchStatus: source === "manual" ? "manual" : "success",
        commentsFetchError: errorMessage
      }), undefined, false);
    }
  }

  async function debugDouyin() {
    if (!form.sourceUrl.trim()) {
      setMessage("请先粘贴抖音链接或分享文案。");
      return;
    }

    setDebugLoading(true);
    setMessage("正在诊断抖音链接。");
    try {
      const response = await fetch("/api/video/debug-douyin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: form.sourceUrl })
      });
      const payload = await response.json() as DebugPayload;
      setDebugReport(payload);
      setMessage(payload.finalSuggestion || (response.ok ? "诊断完成。" : "诊断完成，但链路未跑通。"));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "诊断失败，请稍后重试。");
    } finally {
      setDebugLoading(false);
    }
  }

  function buildInput(): DeconstructionInput {
    return {
      title: form.sourceTitle || analyzeInfo?.title || "未命名爆款视频",
      sourceUrl: form.sourceUrl,
      transcript: form.transcript,
      productName: form.targetProduct,
      productId: selectedProductId,
      productSnapshot: selectedProductSnapshot,
      platform,
      normalizedUrl: analyzeInfo?.normalizedUrl || form.sourceUrl,
      sourceDescription: analyzeInfo?.description || form.manualDescription,
      sourceAuthor: analyzeInfo?.author || "",
      manualDescription: form.manualDescription,
      comments: form.comments,
      topComments,
      commentInsights: commentInsights || undefined,
      commentsSource,
      commentsFetchStatus,
      commentsFetchError,
      rewriteReferenceSource: form.rewriteReferenceSource,
      targetIndustry: form.targetIndustry,
      targetAudience: form.targetAudience,
      rewriteGoal: form.rewriteGoal,
      rewriteStyle: form.rewriteStyle,
      extraRequirement: form.extraRequirement,
      videoPath: analyzeInfo?.videoPath || "",
      audioPath: analyzeInfo?.audioPath || "",
      asrMessage: analyzeInfo?.message || ""
    };
  }

  function buildCommentContextText() {
    if (!commentInsights) return "";
    const includeComments = form.rewriteReferenceSource === "comments" || form.rewriteReferenceSource === "structure_comments";
    if (!includeComments) return "";
    return [
      commentInsights.userPainPoints?.length ? `用户真实痛点：${commentInsights.userPainPoints.join("；")}` : "",
      commentInsights.purchaseObjections?.length ? `购买顾虑：${commentInsights.purchaseObjections.join("；")}` : "",
      commentInsights.shootingSuggestions?.length ? `拍摄建议：${commentInsights.shootingSuggestions.join("；")}` : "",
      commentInsights.topicIdeas?.length ? `选题方向：${commentInsights.topicIdeas.join("；")}` : "",
      commentInsights.hookIdeas?.length ? `开头钩子：${commentInsights.hookIdeas.join("；")}` : "",
      commentInsights.conversionOpportunities?.length ? `成交机会：${commentInsights.conversionOpportunities.join("；")}` : "",
      topComments.length ? `高赞评论：${topComments.slice(0, 8).map((item) => `${item.likeCount || 0}赞 ${item.content}`).join(" / ")}` : ""
    ].filter(Boolean).join("\n");
  }

  function saveRecord() {
    const record = generated || buildRecordFromCurrent("completed");
    persistRecord({ ...record, updatedAt: nowIso() }, "已保存到拆片记录。");
  }

  function saveScript() {
    if (!generated) return;
    const script = deconstructionToScriptRecord(generated);
    saveScriptRecord(script);
    assetFromScriptRecord(script);
    const updated = persistRecord({ ...generated, savedScriptId: script.id, updatedAt: nowIso() }, generated.savedScriptId ? "已另存为新脚本，并更新拆片记录关联。" : "仿写脚本已保存到脚本资产。");
    if (updated) setGenerated(updated);
  }

  function saveResource() {
    if (!generated) return;
    saveResourceItem(deconstructionToResource(generated));
    setMessage("拆片结构已保存到资料库。");
  }

  function resetAll() {
    setForm(initialForm);
    setUploadFile(null);
    setAnalyzeInfo(null);
    setPlatform("unknown");
    setGenerated(null);
    setCurrentRecordId("");
    setSaveStatus("idle");
    setMessage("");
    setDebugReport(null);
    setSteps(baseSteps);
    setTopComments([]);
    setCommentInsights(null);
    setCommentsSource("");
    setCommentsFetchStatus("idle");
    setCommentsFetchError("");
    setSelectedProductId("");
    setSelectedProductSnapshot(undefined);
    rewriteScrollRef.current?.scrollTo({ top: 0 });
    window.history.replaceState(null, "", "/deconstruction");
  }

  function applyProductRecord(productId: string) {
    setSelectedProductId(productId);
    const product = products.find((item) => item.id === productId);
    if (!product) {
      setSelectedProductSnapshot(undefined);
      return;
    }
    const productSnapshot = createProductReferenceSnapshot(product);
    const productPatch = {
      targetProduct: product.name,
      targetAudience: product.targetAudience,
      sellingPoint: [product.coreSellingPoints, product.secondarySellingPoints].filter(Boolean).join("\n"),
      painPoint: [product.painPoints, product.objections].filter(Boolean).join("\n"),
      targetIndustry: product.category,
      extraRequirement: [
        form.extraRequirement,
        product.forbiddenWords ? `禁忌词：${product.forbiddenWords}` : "",
        product.forbiddenClaims ? `不能承诺：${product.forbiddenClaims}` : "",
        product.useScenarios ? `使用场景：${product.useScenarios}` : ""
      ].filter(Boolean).join("\n")
    };
    setSelectedProductSnapshot(productSnapshot);
    setForm((current) => ({ ...current, ...productPatch }));
    if (currentRecordId) {
      persistRecord(buildRecordFromCurrent(generated?.status || "analyzing", {
        productId: product.id,
        productSnapshot,
        targetProduct: productPatch.targetProduct,
        targetAudience: productPatch.targetAudience,
        targetIndustry: productPatch.targetIndustry
      }), undefined, false);
    }
    setMessage(`已引用产品资料：${product.name}`);
  }

  function saveEditedTranscript(value: string) {
    const transcript = value.trim();
    if (!transcript) {
      setMessage("逐字稿不能为空，请保留内容后再保存。");
      return false;
    }

    const saved = persistRecord(buildRecordFromCurrent(generated?.status || "analyzing", {
      transcript,
      rawText: transcript
    }), "逐字稿修改已保存，后续仿写会使用新内容。", Boolean(generated));
    if (!saved) return false;

    setForm((current) => ({ ...current, transcript }));
    setAnalyzeInfo((current) => current ? { ...current, transcript, rawText: transcript } : current);
    return true;
  }

  function saveEditedRewrite(value: string) {
    const rewrittenScript = value.trim();
    if (!rewrittenScript) {
      setMessage("仿写逐字稿不能为空，请保留内容后再保存。");
      return false;
    }

    const saved = persistRecord(buildRecordFromCurrent("completed", {
      rewrittenScript,
      rewriteMarkdown: "",
      newScriptDirections: rewrittenScript,
      errorMessage: ""
    }), "仿写逐字稿修改已保存；后续复制和保存到脚本资产都会使用新内容。", true);
    return Boolean(saved);
  }

  function markStep(key: string, status: StepStatus, stepMessage: string) {
    setSteps((current) => normalizeSteps(current).map((step) => step.key === key ? { ...step, status, message: stepMessage } : step));
  }

  function markFailedStage(stage: string, errorMessage: string) {
    const mapped = mapJobStage(stage);
    setSteps((current) => normalizeSteps(current).map((step) => {
      if (step.key === mapped) {
        return { ...step, status: "error", message: errorMessage };
      }
      if (step.status === "running") {
        return { ...step, status: "idle", message: "" };
      }
      return step;
    }));
  }

  function finishAnalyzeSteps(stepMessage: string) {
    setSteps((current) => normalizeSteps(current).map((step) => {
      if (["platform_detect", "video_download", "asr"].includes(step.key)) {
        return { ...step, status: "done", message: step.key === "asr" ? stepMessage : "已完成。" };
      }
      return step;
    }));
  }

  function buildRestoredSteps(record: SimpleDeconstructionRecord, hasRewrite: boolean) {
    return baseSteps.map((step): ProcessStep => {
      if (["platform_detect", "video_download", "asr"].includes(step.key)) {
        return { ...step, status: "done", message: step.key === "asr" ? "已恢复逐字稿。" : "已完成。" };
      }
      if (step.key === "deconstruction") {
        const hasStructure = Boolean(record.structure?.trim() || record.hook?.trim() || record.analysisMarkdown?.trim());
        return hasStructure ? { ...step, status: "done", message: "视频结构已恢复。" } : step;
      }
      if (step.key === "comment_fetch") {
        return commentFetchStepFromRecord(record);
      }
      if (step.key === "comment_insights") {
        if (record.commentInsights) return { ...step, status: "done", message: "评论洞察已恢复。" };
        if (record.commentsFetchStatus === "failed") return { ...step, status: "idle", message: "自动评论抓取失败，可手动粘贴评论分析。" };
        if (record.commentsFetchStatus === "manual" && record.topComments?.length) return { ...step, status: "running", message: "可继续分析手动评论洞察。" };
        return step;
      }
      if (step.key === "rewrite") {
        return hasRewrite ? { ...step, status: "done", message: "仿写结果已恢复。" } : step;
      }
      if (step.key === "finish") {
        return { ...step, status: "done", message: "已恢复历史记录。" };
      }
      return step;
    });
  }

  function commentFetchStepFromRecord(record: SimpleDeconstructionRecord): ProcessStep {
    const base = baseSteps.find((step) => step.key === "comment_fetch")!;
    const count = record.topComments?.length || 0;
    if (record.commentsFetchStatus === "success" && count > 0) {
      return { ...base, status: "done", message: `抓取高赞评论：成功，已获取 ${count} 条。` };
    }
    if (record.commentsFetchStatus === "manual" && count > 0) {
      return { ...base, status: "manual", message: `抓取高赞评论：手动补充，已读取 ${count} 条。` };
    }
    if (record.commentsFetchStatus === "failed") {
      return { ...base, status: "error", message: record.commentsFetchError || "评论抓取失败，可手动粘贴评论继续分析。" };
    }
    if (record.commentsFetchStatus === "idle") {
      return base;
    }
    return { ...base, status: "skipped", message: "评论抓取暂未完成。" };
  }

  return (
    <div className="desktop-page flex flex-col overflow-hidden">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <h1 className="text-2xl font-semibold text-slate-950 dark:text-slate-100">拆片</h1>
            <p className="text-sm text-slate-500 dark:text-slate-400">分析原视频，提炼结构并生成自己的口播脚本。</p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" asChild><Link href="/assets"><Archive className="h-4 w-4" />资产库</Link></Button>
          <Button size="sm" onClick={resetAll}><Plus className="h-4 w-4" />新建拆解</Button>
        </div>
      </div>

      {message ? (
        <p className="mb-3 rounded-2xl bg-slate-100 px-4 py-3 text-sm text-slate-600 dark:bg-slate-800 dark:text-slate-300">{message}</p>
      ) : null}

      <div className="mt-3 grid min-h-0 flex-1 grid-cols-1 gap-4 xl:grid-cols-[minmax(0,0.98fr)_minmax(0,1.02fr)]">
        <section className="min-h-[520px] min-w-0 overflow-hidden rounded-[22px] border border-slate-200/80 bg-white shadow-[0_12px_32px_rgba(15,23,42,0.05)] dark:border-slate-800/80 dark:bg-slate-900/60 dark:shadow-none">
          <div className="border-b border-slate-200/70 px-5 py-4 dark:border-slate-800">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold text-slate-950 dark:text-slate-100">原视频分析</h2>
                <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">只处理别人的视频：链接、上传或手动粘贴。</p>
              </div>
              <Badge variant={analyzeInfo?.success ? "default" : "secondary"}>{analyzeInfo?.success ? "已提取" : "待分析"}</Badge>
            </div>
          </div>
          <div data-deconstruction-scroll="source" className="h-[calc(100vh-180px)] min-h-[520px] overflow-y-auto px-4 py-4 md:px-5 scrollbar-subtle">
            <SourceAnalyzePanel
              mode={mode}
              setMode={setMode}
              form={form}
              setForm={setForm}
              uploadFile={uploadFile}
              setUploadFile={setUploadFile}
              analyzeInfo={analyzeInfo}
              platform={platform}
              analyzeLoading={analyzeLoading}
              debugLoading={debugLoading}
              debugReport={debugReport}
              useBrowserCookies={useBrowserCookies}
              setUseBrowserCookies={setUseBrowserCookies}
              onAnalyzeLink={analyzeLink}
              onAnalyzeUpload={analyzeUpload}
              onAnalyzeManual={analyzeManualSource}
              onDebugDouyin={debugDouyin}
              topComments={topComments}
              commentInsights={commentInsights}
              commentsSource={commentsSource}
              commentsFetchStatus={commentsFetchStatus}
              commentsFetchError={commentsFetchError}
              generated={generated}
              onSaveTranscript={saveEditedTranscript}
              onFetchComments={() => fetchCommentsAndInsights()}
              onAnalyzeManualComments={analyzeManualComments}
              onUseCommentsForRewrite={() => {
                setForm((current) => ({ ...current, rewriteReferenceSource: "structure_comments" }));
                setMessage("已把高赞评论洞察加入右侧仿写参考。");
              }}
              onClear={resetAll}
            />
          </div>
        </section>

        <section className="min-h-[520px] min-w-0 overflow-hidden rounded-[22px] border border-slate-200/80 bg-white shadow-[0_12px_32px_rgba(15,23,42,0.05)] dark:border-slate-800/80 dark:bg-slate-900/60 dark:shadow-none">
          <div className="border-b border-slate-200/70 px-5 py-4 dark:border-slate-800">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold text-slate-950 dark:text-slate-100">我的视频仿写</h2>
                <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">把原视频结构迁移成自己的产品脚本。</p>
              </div>
              <Badge variant={generated?.rewrittenScript ? "default" : "secondary"}>{generated?.rewrittenScript ? "已生成" : "待仿写"}</Badge>
            </div>
          </div>
          <div ref={rewriteScrollRef} className="h-[calc(100vh-180px)] min-h-[520px] overflow-y-auto px-4 py-4 md:px-5 scrollbar-subtle">
            <RewritePanel
              form={form}
              setForm={setForm}
              canGenerate={canGenerate}
              generated={generated}
              generateLoading={generateLoading}
              commentInsights={commentInsights}
              products={products}
              selectedProductId={selectedProductId}
              saveStatus={saveStatus}
              onSelectProduct={applyProductRecord}
              onGenerate={generate}
              onSaveRewrite={saveEditedRewrite}
              onSaveScript={saveScript}
            />
          </div>
        </section>
      </div>
    </div>
  );
}

function SourceAnalyzePanel({
  mode,
  setMode,
  form,
  setForm,
  uploadFile,
  setUploadFile,
  analyzeInfo,
  platform,
  analyzeLoading,
  debugLoading,
  debugReport,
  useBrowserCookies,
  setUseBrowserCookies,
  onAnalyzeLink,
  onAnalyzeUpload,
  onAnalyzeManual,
  onDebugDouyin,
  topComments,
  commentInsights,
  commentsSource,
  commentsFetchStatus,
  commentsFetchError,
  generated,
  onSaveTranscript,
  onFetchComments,
  onAnalyzeManualComments,
  onUseCommentsForRewrite,
  onClear
}: {
  mode: Mode;
  setMode: (mode: Mode) => void;
  form: typeof initialForm;
  setForm: (form: typeof initialForm) => void;
  uploadFile: File | null;
  setUploadFile: (file: File | null) => void;
  analyzeInfo: AnalyzePayload | null;
  platform: VideoPlatform;
  analyzeLoading: boolean;
  debugLoading: boolean;
  debugReport: DebugPayload | null;
  useBrowserCookies: boolean;
  setUseBrowserCookies: (checked: boolean) => void;
  onAnalyzeLink: () => void;
  onAnalyzeUpload: () => void;
  onAnalyzeManual: () => void;
  onDebugDouyin: () => void;
  topComments: CommentRecord[];
  commentInsights: HighLikeCommentInsights | null;
  commentsSource: SimpleDeconstructionRecord["commentsSource"];
  commentsFetchStatus: SimpleDeconstructionRecord["commentsFetchStatus"];
  commentsFetchError: string;
  generated: SimpleDeconstructionRecord | null;
  onSaveTranscript: (value: string) => boolean;
  onFetchComments: () => void;
  onAnalyzeManualComments: (rawComments: string) => void | Promise<void>;
  onUseCommentsForRewrite: () => void;
  onClear: () => void;
}) {
  const hasResultContent = Boolean(generated || analyzeInfo?.success);
  const analysisContainerRef = useRef<HTMLDivElement | null>(null);
  const [activeAnalysisSection, setActiveAnalysisSection] = useState<AnalysisSectionKey>("transcript");

  useEffect(() => {
    if (!hasResultContent) return;
    const container = analysisContainerRef.current;
    const scrollRoot = container?.closest('[data-deconstruction-scroll="source"]') as HTMLElement | null;
    if (!container || !scrollRoot) return;

    const updateActiveSection = () => {
      const rootTop = scrollRoot.getBoundingClientRect().top + 64;
      let nextSection: AnalysisSectionKey = "transcript";
      for (const section of analysisSections) {
        const element = container.querySelector<HTMLElement>(`[data-analysis-section="${section.key}"]`);
        if (element && element.getBoundingClientRect().top <= rootTop) {
          nextSection = section.key;
        }
      }
      setActiveAnalysisSection(nextSection);
    };

    updateActiveSection();
    scrollRoot.addEventListener("scroll", updateActiveSection, { passive: true });
    return () => scrollRoot.removeEventListener("scroll", updateActiveSection);
  }, [hasResultContent]);

  function scrollToAnalysisSection(sectionKey: AnalysisSectionKey) {
    const container = analysisContainerRef.current;
    const target = container?.querySelector<HTMLElement>(`[data-analysis-section="${sectionKey}"]`);
    if (!target) return;

    setActiveAnalysisSection(sectionKey);
    target.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  const inputArea = (
    <>
      <div className="grid grid-cols-3 gap-1 rounded-2xl border border-slate-200 bg-slate-100/80 p-1 dark:border-slate-800 dark:bg-slate-950/60">
        <TabButton active={mode === "link"} onClick={() => setMode("link")}><Link2 className="h-4 w-4" />链接分析</TabButton>
        <TabButton active={mode === "upload"} onClick={() => setMode("upload")}><Upload className="h-4 w-4" />上传视频</TabButton>
        <TabButton active={mode === "manual"} onClick={() => setMode("manual")}><FileText className="h-4 w-4" />手动输入</TabButton>
      </div>

      {mode === "link" ? (
        <WorkBlock title="链接分析" description="默认不读取浏览器 Cookie，失败时可改用上传视频或手动输入。">
          <Field label="平台视频链接">
            <Input value={form.sourceUrl} onChange={(event) => setForm({ ...form, sourceUrl: event.target.value })} placeholder="粘贴完整分享文案或 http 链接" />
          </Field>
          <details className="rounded-2xl border border-slate-200/70 bg-slate-50/70 p-4 dark:border-slate-800 dark:bg-slate-900/40">
            <summary className="cursor-pointer text-sm font-medium text-slate-800 dark:text-slate-200">高级选项</summary>
            <label className="mt-4 flex items-start gap-3 text-sm leading-6 text-slate-600 dark:text-slate-300">
              <input type="checkbox" className="mt-1 h-4 w-4 rounded border-slate-300" checked={useBrowserCookies} onChange={(event) => setUseBrowserCookies(event.target.checked)} />
              <span>使用浏览器登录态解析。默认关闭，仅在公开链接解析失败时再尝试。</span>
            </label>
            <Button className="mt-3" variant="outline" size="sm" onClick={onDebugDouyin} disabled={debugLoading}>
              {debugLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <AlertTriangle className="h-4 w-4" />}
              诊断抖音链接
            </Button>
            {debugReport ? (
              <div className="mt-3 rounded-xl border border-slate-200/70 bg-white/70 p-3 text-xs leading-5 text-slate-500 dark:border-slate-800 dark:bg-slate-950/40 dark:text-slate-400">
                {debugReport.finalSuggestion || "诊断完成，可根据结果调整解析方式。"}
              </div>
            ) : null}
          </details>
          <ActionRow>
            <Button onClick={onAnalyzeLink} disabled={analyzeLoading}>
              {analyzeLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileSearch className="h-4 w-4" />}
              {analyzeLoading ? "分析中..." : "开始分析"}
            </Button>
            <Button variant="ghost" onClick={onClear}>新建拆解</Button>
          </ActionRow>
        </WorkBlock>
      ) : null}

      {mode === "upload" ? (
        <WorkBlock title="上传视频" description="上传本地视频，先提取音频再转成逐字稿。">
          <Field label="视频文件">
            <Input type="file" accept=".mp4,.mov,.m4v,.webm,video/mp4,video/quicktime,video/webm" onChange={(event) => setUploadFile(event.target.files?.[0] || null)} />
          </Field>
          {uploadFile ? <p className="text-sm text-slate-500 dark:text-slate-400">已选择：{uploadFile.name}，大小 {formatFileSize(uploadFile.size)}</p> : null}
          <ActionRow>
            <Button onClick={onAnalyzeUpload} disabled={analyzeLoading}>
              {analyzeLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
              {analyzeLoading ? "上传中..." : "开始分析"}
            </Button>
            <Button variant="ghost" onClick={onClear}>新建拆解</Button>
          </ActionRow>
        </WorkBlock>
      ) : null}

      {mode === "manual" ? (
        <WorkBlock title="手动输入" description="没有链接或视频时，直接粘贴逐字稿或画面描述。">
          <Field label="视频标题"><Input value={form.sourceTitle} onChange={(event) => setForm({ ...form, sourceTitle: event.target.value })} /></Field>
          <Field label="视频逐字稿"><Textarea className="min-h-36" value={form.transcript} onChange={(event) => setForm({ ...form, transcript: event.target.value })} placeholder="粘贴原视频口播文案或字幕。" /></Field>
          <Field label="视频大概内容 / 画面描述"><Textarea value={form.manualDescription} onChange={(event) => setForm({ ...form, manualDescription: event.target.value })} /></Field>
          <ActionRow>
            <Button onClick={onAnalyzeManual} disabled={analyzeLoading}>
              {analyzeLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileSearch className="h-4 w-4" />}
              {analyzeLoading ? "分析中..." : "开始分析"}
            </Button>
            <Button variant="ghost" onClick={onClear}>新建拆解</Button>
          </ActionRow>
        </WorkBlock>
      ) : null}
    </>
  );

  return (
    <div className="space-y-5">
      {hasResultContent ? (
        <details className="rounded-3xl border border-slate-200/70 bg-slate-50/70 p-4 dark:border-slate-800 dark:bg-slate-900/35">
          <summary className="flex cursor-pointer list-none items-center justify-between text-sm font-semibold text-slate-800 dark:text-slate-200">
            <span className="min-w-0 truncate">
              当前来源：{sourceTypeLabels[mode]} · {form.sourceTitle || analyzeInfo?.title || uploadFile?.name || form.sourceUrl || "已完成分析"}
            </span>
            <span className="ml-3 flex shrink-0 items-center gap-1 text-xs font-medium text-slate-500 dark:text-slate-400">
              更换或重新分析
              <ChevronDown className="h-4 w-4" />
            </span>
          </summary>
          <div className="mt-4 space-y-5">{inputArea}</div>
        </details>
      ) : inputArea}
      <div ref={analysisContainerRef} className="overflow-hidden rounded-3xl border border-slate-200/70 bg-slate-50/55 dark:border-slate-800 dark:bg-slate-900/25">
        {hasResultContent ? (
          <div className="sticky top-0 z-20 grid grid-cols-4 gap-1 border-b border-slate-200/80 bg-white/95 p-2 backdrop-blur dark:border-slate-800 dark:bg-slate-950/95">
            {analysisSections.map((section) => (
              <button
                key={section.key}
                type="button"
                onClick={() => scrollToAnalysisSection(section.key)}
                className={cn(
                  "rounded-xl px-2 py-2 text-xs font-medium transition-colors sm:text-sm",
                  activeAnalysisSection === section.key
                    ? "bg-slate-950 text-white dark:bg-slate-100 dark:text-slate-950"
                    : "text-slate-500 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-100"
                )}
              >
                {section.label}
              </button>
            ))}
          </div>
        ) : null}
        <SourceResult
          analyzeInfo={analyzeInfo}
          platform={platform}
          transcript={form.transcript}
          sourceTitle={form.sourceTitle}
          generated={generated}
          onSaveTranscript={onSaveTranscript}
        />
        <CommentInsightsBlock
          comments={topComments}
          insights={commentInsights}
          source={commentsSource}
          status={commentsFetchStatus}
          errorMessage={commentsFetchError}
          rawManualComments={form.comments}
          onManualChange={(value) => setForm({ ...form, comments: value })}
          onFetchComments={onFetchComments}
          onAnalyzeManualComments={onAnalyzeManualComments}
          onUseForRewrite={onUseCommentsForRewrite}
        />
        <VideoSummaryBlock
          generated={generated}
          title={form.sourceTitle || analyzeInfo?.title || ""}
          description={form.manualDescription || analyzeInfo?.description || ""}
          transcript={form.transcript || analyzeInfo?.rawText || ""}
        />
      </div>
    </div>
  );
}

function RewritePanel({
  form,
  setForm,
  canGenerate,
  generated,
  generateLoading,
  commentInsights,
  products,
  selectedProductId,
  saveStatus,
  onSelectProduct,
  onGenerate,
  onSaveRewrite,
  onSaveScript
}: {
  form: typeof initialForm;
  setForm: (form: typeof initialForm) => void;
  canGenerate: boolean;
  generated: SimpleDeconstructionRecord | null;
  generateLoading: boolean;
  commentInsights: HighLikeCommentInsights | null;
  products: ProductRecord[];
  selectedProductId: string;
  saveStatus: SaveStatus;
  onSelectProduct: (productId: string) => void;
  onGenerate: () => void;
  onSaveRewrite: (value: string) => boolean;
  onSaveScript: () => void;
}) {
  const [productQuery, setProductQuery] = useState("");
  const [editingSetup, setEditingSetup] = useState(!generated?.rewrittenScript);
  const normalizedProductQuery = productQuery.trim().toLowerCase();
  const filteredProducts = products.filter((item) => {
    if (!normalizedProductQuery) return true;
    return [item.name, item.brandName, item.category]
      .filter(Boolean)
      .join(" ")
      .toLowerCase()
      .includes(normalizedProductQuery);
  });
  const selectedProduct = products.find((item) => item.id === selectedProductId) || null;

  useEffect(() => {
    if (generated?.rewrittenScript) {
      setEditingSetup(false);
    }
  }, [generated?.rewrittenScript]);

  const setupPanel = (
    <WorkBlock title="引用我的产品" description="选择产品资料、发布平台和仿写方向，即可生成自己的口播逐字稿。">
        <Field label="产品资料库">
          <div className="relative mb-2">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <Input
              className="pl-9"
              value={productQuery}
              onChange={(event) => setProductQuery(event.target.value)}
              placeholder="搜索产品名称、品牌或品类"
            />
          </div>
          <Select
            value={selectedProductId}
            onChange={(event) => onSelectProduct(event.target.value)}
            options={[
              {
                label: products.length
                  ? filteredProducts.length
                    ? `请选择产品资料（${filteredProducts.length}）`
                    : "没有找到匹配产品"
                  : "资料库暂无产品，可手动填写",
                value: ""
              },
              ...filteredProducts.map((item) => ({ label: item.name, value: item.id }))
            ]}
          />
        </Field>
        {form.targetProduct ? (
          <ProductReferenceSummary product={selectedProduct} form={form} />
        ) : (
          <div className="rounded-2xl border border-dashed border-slate-300 p-4 text-sm text-slate-500 dark:border-slate-700 dark:text-slate-400">
            优先选择资料库产品；没有产品资料时，可使用下方的临时手动填写。
          </div>
        )}
        <details className="rounded-2xl border border-slate-200/70 bg-slate-50/70 p-3 dark:border-slate-800 dark:bg-slate-900/40">
          <summary className="cursor-pointer text-sm font-medium text-slate-700 dark:text-slate-300">没有产品资料？临时手动填写</summary>
          <div className="mt-4 grid gap-4">
            <Field label="我的产品 / 业务"><Input value={form.targetProduct} onChange={(event) => setForm({ ...form, targetProduct: event.target.value })} /></Field>
            <Field label="目标人群"><Input value={form.targetAudience} onChange={(event) => setForm({ ...form, targetAudience: event.target.value })} /></Field>
            <Field label="核心卖点"><Textarea value={form.sellingPoint} onChange={(event) => setForm({ ...form, sellingPoint: event.target.value })} /></Field>
            <Field label="用户痛点"><Textarea value={form.painPoint} onChange={(event) => setForm({ ...form, painPoint: event.target.value })} /></Field>
          </div>
        </details>
        <div className="grid gap-4 md:grid-cols-2">
          <Field label="发布平台"><Select value={form.publishPlatform} onChange={(event) => setForm({ ...form, publishPlatform: event.target.value })} options={publishPlatforms.map(toOption)} /></Field>
          <Field label="仿写方向"><Select value={form.rewriteGoal} onChange={(event) => setForm({ ...form, rewriteGoal: event.target.value as SimpleDeconstructionRecord["rewriteGoal"] })} options={rewriteGoals.map(toOption)} /></Field>
        </div>
        <details className="rounded-2xl border border-slate-200/70 bg-slate-50/70 p-3 dark:border-slate-800 dark:bg-slate-900/40">
          <summary className="cursor-pointer text-sm font-medium text-slate-700 dark:text-slate-300">更多设置</summary>
          <div className="mt-4 grid gap-4">
            <div className="grid gap-4 md:grid-cols-2">
              <Field label="仿写风格"><Select value={form.rewriteStyle} onChange={(event) => setForm({ ...form, rewriteStyle: event.target.value as SimpleDeconstructionRecord["rewriteStyle"] })} options={rewriteStyles.map(toOption)} /></Field>
              <Field label="内容形式"><Select value={form.contentFormat} onChange={(event) => setForm({ ...form, contentFormat: event.target.value })} options={contentFormats.map(toOption)} /></Field>
            </div>
            <Field label="仿写参考来源">
              <Select
                value={form.rewriteReferenceSource}
                onChange={(event) => setForm({ ...form, rewriteReferenceSource: event.target.value as RewriteReferenceSource })}
                options={[
                  { label: "原视频结构", value: "structure" },
                  { label: "高赞评论洞察", value: "comments" },
                  { label: "原视频结构 + 高赞评论洞察", value: "structure_comments" }
                ]}
              />
            </Field>
            {commentInsights ? (
              <div className="rounded-2xl border border-emerald-200 bg-emerald-50/70 p-3 text-xs leading-5 text-emerald-700 dark:border-emerald-900/60 dark:bg-emerald-950/25 dark:text-emerald-200">
                已接入高赞评论洞察：{commentInsights.topicIdeas?.slice(0, 2).join("；") || "可用于生成更贴近用户顾虑的脚本。"}
              </div>
            ) : null}
            <Field label="所属行业"><Input value={form.targetIndustry} onChange={(event) => setForm({ ...form, targetIndustry: event.target.value })} /></Field>
            <Field label="补充要求"><Textarea value={form.extraRequirement} onChange={(event) => setForm({ ...form, extraRequirement: event.target.value })} /></Field>
          </div>
        </details>
        <ActionRow>
          <Button className="w-full" onClick={onGenerate} disabled={generateLoading || !canGenerate}>
            {generateLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
            {generateLoading ? "仿写中..." : generated?.rewrittenScript ? "重新生成逐字稿" : "开始仿写"}
          </Button>
        </ActionRow>
    </WorkBlock>
  );

  if (!generated?.rewrittenScript || editingSetup) {
    return (
      <div className="space-y-5">
        {generated?.rewrittenScript ? (
          <div className="flex items-center justify-between gap-3 rounded-2xl border border-slate-200/70 bg-white/80 px-4 py-3 dark:border-slate-800 dark:bg-slate-950/40">
            <div>
              <div className="text-sm font-semibold text-slate-950 dark:text-slate-100">修改仿写条件</div>
              <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">修改产品、平台或方向后重新生成。</p>
            </div>
            <Button size="sm" variant="outline" onClick={() => setEditingSetup(false)}>返回逐字稿</Button>
          </div>
        ) : null}
        {setupPanel}
        {!generated?.rewrittenScript ? <CompactEmpty text="左侧完成原视频分析后，选择产品资料并点击“开始仿写”。" /> : null}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="sticky top-0 z-20 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200/80 bg-white/95 p-3 shadow-sm backdrop-blur dark:border-slate-800 dark:bg-slate-950/95">
        <div className="min-w-0">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <span className="max-w-full truncate text-sm font-semibold text-slate-950 dark:text-slate-100">{form.targetProduct || "当前产品"}</span>
            <Badge variant="secondary">{form.publishPlatform}</Badge>
            <Badge variant="secondary">{form.rewriteGoal}</Badge>
          </div>
          <RewriteSaveFeedback status={saveStatus} savedScriptId={generated.savedScriptId} />
        </div>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="ghost" onClick={() => setEditingSetup(true)}>修改条件</Button>
          <Button size="sm" variant="outline" onClick={onGenerate} disabled={generateLoading || !canGenerate}>
            {generateLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
            {generateLoading ? "生成中..." : "重新生成"}
          </Button>
          <Button size="sm" variant="outline" onClick={() => copyText(generated.rewrittenScript || formatRewrite(generated))}><Copy className="h-4 w-4" />复制</Button>
          <Button size="sm" onClick={onSaveScript}><Save className="h-4 w-4" />保存</Button>
        </div>
      </div>

      <RewriteResult item={generated} onSave={onSaveRewrite} />
    </div>
  );
}

function SourceResult({
  analyzeInfo,
  platform,
  transcript,
  sourceTitle,
  generated,
  onSaveTranscript
}: {
  analyzeInfo: AnalyzePayload | null;
  platform: VideoPlatform;
  transcript: string;
  sourceTitle: string;
  generated: SimpleDeconstructionRecord | null;
  onSaveTranscript: (value: string) => boolean;
}) {
  const title = analyzeInfo?.title || "";
  const author = analyzeInfo?.author || "";
  const transcriptText = transcript || analyzeInfo?.rawText || "";
  return (
    <>
      <DocumentSection sectionKey="transcript" title="逐字稿" description="链接或上传分析成功后直接展示，不再折叠。">
        <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
          <Badge variant="secondary">{platformLabels[platform || "unknown"] || "未知平台"}</Badge>
          <span className="truncate">{sourceTitle || title || "未解析到标题"}</span>
          {author ? <span>作者：{author}</span> : null}
          {transcriptText ? <Button size="sm" variant="ghost" onClick={() => copyText(transcriptText)}><Copy className="h-4 w-4" />复制逐字稿</Button> : null}
        </div>
        {analyzeInfo?.error ? <div className="mt-3"><MiniInfo tone="danger" label="失败原因" value={analyzeInfo.error} /></div> : null}
        {transcriptText ? (
          <TranscriptReader value={transcriptText} onSave={onSaveTranscript} />
        ) : null}
        {!transcriptText ? <CompactEmpty text="还没有逐字稿。可以先链接分析、上传视频，或切换到手动输入粘贴逐字稿。" /> : null}
      </DocumentSection>

      <DocumentSection sectionKey="structure" title="视频结构" description="只保留拆片最关键的钩子、结构、节奏和可复用方法。">
        {generated ? (
          <StructureResult generated={generated} />
        ) : (
          <CompactEmpty text="完成分析后，这里会显示视频结构、钩子、爆款元素和可复用结构。" />
        )}
      </DocumentSection>
    </>
  );
}

function VideoSummaryBlock({
  generated,
  title,
  description,
  transcript
}: {
  generated: SimpleDeconstructionRecord | null;
  title: string;
  description: string;
  transcript: string;
}) {
  const summarySections = buildVideoSummarySections(generated, { title, description, transcript });
  const summaryText = summarySections.map((section) => `${section.title}：\n${section.value}`).join("\n\n");
  return (
    <DocumentSection sectionKey="summary" title="这条视频的总结分析" description="帮你快速判断这条视频为什么有效，以及最值得借鉴的部分。" isLast>
      <div className="flex justify-end">
        <Button size="sm" variant="ghost" onClick={() => copyText(summaryText)}>
          <Copy className="h-4 w-4" />
          复制总结
        </Button>
      </div>
      <div className="mt-3 grid gap-3">
        {summarySections.map((section) => (
          <div key={section.title} className="rounded-2xl border border-slate-200/80 bg-white/70 p-4 dark:border-slate-800 dark:bg-slate-950/35">
            <div className="mb-2 flex items-start justify-between gap-3">
              <div>
                <div className="text-xs font-semibold text-slate-400 dark:text-slate-500">{section.label}</div>
                <div className="mt-1 text-sm font-semibold text-slate-900 dark:text-slate-100">{section.title}</div>
              </div>
              <Button size="sm" variant="ghost" onClick={() => copyText(section.value)}>
                <Copy className="h-4 w-4" />
                复制
              </Button>
            </div>
            <div className="whitespace-pre-wrap text-sm leading-7 text-slate-700 dark:text-slate-300">{section.value}</div>
          </div>
        ))}
      </div>
    </DocumentSection>
  );
}

function CommentInsightsBlock({
  comments,
  insights,
  source,
  status,
  errorMessage,
  rawManualComments,
  onManualChange,
  onFetchComments,
  onAnalyzeManualComments,
  onUseForRewrite
}: {
  comments: CommentRecord[];
  insights: HighLikeCommentInsights | null;
  source: SimpleDeconstructionRecord["commentsSource"];
  status: SimpleDeconstructionRecord["commentsFetchStatus"];
  errorMessage: string;
  rawManualComments: string;
  onManualChange: (value: string) => void;
  onFetchComments: () => void;
  onAnalyzeManualComments: (value: string) => void | Promise<void>;
  onUseForRewrite: () => void;
}) {
  const sourceLabel: Record<string, string> = {
    "crawler-service": "自动抓取",
    "third-party-api": "第三方接口",
    "yt-dlp": "yt-dlp",
    manual: "手动粘贴",
    unsupported: "暂不支持",
    "existing-parser": "解析结果"
  };
  const hasInsights = Boolean(insights);
  const commentTags = new Map((insights?.commentTags || []).map((item) => [item.commentId, item.tags]));
  const concernItems = mergeUniqueText(insights?.topConcerns, insights?.userPainPoints, insights?.purchaseObjections);
  const shootingItems = mergeUniqueText(insights?.topicIdeas, insights?.shootingSuggestions, insights?.contentAngles);
  const openingItems = mergeUniqueText(insights?.hookIdeas, insights?.scriptDirections, insights?.conversionOpportunities);
  const shootingText = shootingItems.map((item, index) => `${index + 1}. ${item}`).join("\n");
  const openingText = openingItems.map((item, index) => `${index + 1}. ${item}`).join("\n");
  const isFetchFailed = status === "failed";
  const statusText = comments.length
    ? `${comments.length} 条评论`
    : status === "fetching"
      ? "抓取中"
      : isFetchFailed
        ? "自动抓取失败"
        : status === "manual"
          ? "手动评论"
          : "暂无评论";

  return (
    <DocumentSection
      sectionKey="comments"
      title="高赞评论洞察"
      description="从评论区提炼真实痛点、购买顾虑和下一条可拍内容。评论抓不到时可手动粘贴。"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
          <Badge
            variant={comments.length ? "default" : "secondary"}
            className={isFetchFailed ? "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-200" : undefined}
          >
            {statusText}
          </Badge>
          <span>来源：{source ? sourceLabel[source] || source : "未开始"}</span>
          {isFetchFailed && errorMessage ? <span className="text-amber-600 dark:text-amber-300">{errorMessage}</span> : null}
        </div>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" onClick={onFetchComments}>
            <FileSearch className="h-4 w-4" />
            重新抓取
          </Button>
          {hasInsights ? (
            <Button size="sm" variant="outline" onClick={onUseForRewrite}>
              <ChevronRight className="h-4 w-4" />
              用于仿写
            </Button>
          ) : null}
        </div>
      </div>

      {isFetchFailed && !hasInsights ? (
        <div className="rounded-2xl border border-amber-200 bg-amber-50/80 p-4 text-sm dark:border-amber-900/60 dark:bg-amber-950/25">
          <div className="font-semibold text-amber-900 dark:text-amber-100">自动抓评论没成功，但拆片可以继续</div>
          <div className="mt-2 leading-6 text-amber-800 dark:text-amber-200">
            失败原因：{errorMessage || "评论抓取服务暂时不可用。"}
          </div>
          <div className="mt-3 grid gap-2 text-amber-800 dark:text-amber-200">
            <div>1. 从平台评论区复制几条高赞评论。</div>
            <div>2. 粘贴到下方“手动粘贴评论”。</div>
            <div>3. 点击“分析粘贴的评论”，仍然可以生成拍摄建议和选题方向。</div>
          </div>
        </div>
      ) : null}

      {insights ? (
        <div className="space-y-4">
          {concernItems.length ? (
            <div className="rounded-2xl border border-slate-200/70 bg-white/75 p-4 dark:border-slate-800 dark:bg-slate-950/35">
              <div className="mb-3 flex items-center justify-between gap-3">
                <div>
                  <div className="text-sm font-semibold text-slate-900 dark:text-slate-100">用户最关心什么</div>
                  <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">这些点决定下一条视频该回答什么。</p>
                </div>
                <Badge variant="secondary">{concernItems.length} 个关注点</Badge>
              </div>
              <div className="flex flex-wrap gap-2">
                {concernItems.slice(0, 8).map((item) => (
                  <span key={item} className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs leading-5 text-slate-700 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300">
                    {item}
                  </span>
                ))}
              </div>
            </div>
          ) : null}

          {shootingItems.length ? (
            <div className="rounded-2xl border border-slate-200/70 bg-white/75 p-4 dark:border-slate-800 dark:bg-slate-950/35">
              <div className="mb-3 flex items-center justify-between gap-3">
                <div>
                  <div className="text-sm font-semibold text-slate-900 dark:text-slate-100">下一条可以拍什么</div>
                  <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">优先从这些选题里挑一个直接仿写。</p>
                </div>
                <Button size="sm" variant="ghost" onClick={() => copyText(shootingText)}><Copy className="h-4 w-4" />复制</Button>
              </div>
              <div className="grid gap-2">
                {shootingItems.slice(0, 5).map((item, index) => (
                  <div key={item} className="rounded-xl border border-slate-200/70 bg-slate-50/80 p-3 dark:border-slate-800 dark:bg-slate-900/45">
                    <div className="mb-1 text-xs font-semibold text-slate-400">选题 {index + 1}</div>
                    <div className="text-sm leading-6 text-slate-800 dark:text-slate-200">{item}</div>
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          {openingItems.length ? (
            <div className="rounded-2xl border border-slate-200/70 bg-white/75 p-4 dark:border-slate-800 dark:bg-slate-950/35">
              <div className="mb-3 flex items-center justify-between gap-3">
                <div>
                  <div className="text-sm font-semibold text-slate-900 dark:text-slate-100">开头可以怎么说</div>
                  <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">适合直接放在视频前 3 秒。</p>
                </div>
                <Button size="sm" variant="ghost" onClick={() => copyText(openingText)}><Copy className="h-4 w-4" />复制</Button>
              </div>
              <ul className="space-y-2">
                {openingItems.slice(0, 5).map((item) => (
                  <li key={item} className="rounded-xl bg-slate-50/80 px-3 py-2 text-sm leading-6 text-slate-800 dark:bg-slate-900/45 dark:text-slate-200">
                    {item}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      ) : (
        <CompactEmpty text="抓到评论或手动粘贴后，会在这里生成用户关注点、拍摄方向和开头话术。" />
      )}

      <details className="rounded-2xl border border-slate-200/70 bg-white/70 p-3 dark:border-slate-800 dark:bg-slate-950/40" open={isFetchFailed && !insights}>
        <summary className="flex cursor-pointer list-none items-center justify-between text-sm font-medium text-slate-700 dark:text-slate-200">
          <span>{isFetchFailed && !insights ? "手动粘贴评论继续分析" : "评论原文与手动补充"}</span>
          <span className="flex items-center gap-2 text-xs font-normal text-slate-400">
            {comments.length ? `Top ${Math.min(comments.length, COMMENT_LIMIT)}` : "可手动补充"}
            <ChevronDown className="h-4 w-4" />
          </span>
        </summary>

        {comments.length ? (
          <div className="mt-3 space-y-2">
            {comments.map((item, index) => (
              <div key={item.id || item.commentId || index} className="border-b border-slate-200/70 py-3 last:border-b-0 dark:border-slate-800">
                <div className="flex items-start justify-between gap-3">
                  <div className="text-sm leading-6 text-slate-700 dark:text-slate-300">{item.content}</div>
                  <Badge variant="secondary" className="shrink-0">{item.likeCount || 0}赞</Badge>
                </div>
                {commentTags.get(item.commentId)?.length ? (
                  <div className="mt-2 flex flex-wrap gap-1">
                    {commentTags.get(item.commentId)?.map((tag) => <Badge key={tag} variant="secondary">{tag}</Badge>)}
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        ) : <p className="mt-3 text-sm leading-6 text-slate-500 dark:text-slate-400">暂未获取到评论，可以直接粘贴高赞评论继续分析。</p>}

        <div className="mt-3 border-t border-slate-200/70 pt-3 dark:border-slate-800">
          <div className="text-xs font-semibold text-slate-500 dark:text-slate-400">手动粘贴评论</div>
        <Textarea
          className="mt-3 min-h-28"
          value={rawManualComments}
          onChange={(event) => onManualChange(event.target.value)}
          placeholder={"一行一条评论，例如：\n325赞 这个红色会不会显老啊？\n128赞 适合 40 岁穿吗？"}
        />
        <Button className="mt-3" size="sm" onClick={() => onAnalyzeManualComments(rawManualComments)} disabled={!rawManualComments.trim()}>
          <Sparkles className="h-4 w-4" />
          分析粘贴的评论
        </Button>
        </div>
      </details>
    </DocumentSection>
  );
}

function mergeUniqueText(...groups: Array<string[] | undefined>) {
  return [...new Set(groups.flatMap((group) => group || []).map((item) => item.trim()).filter(Boolean))].slice(0, 8);
}

function extractKeyTranscriptLines(value: string) {
  const sentences = value
    .replace(/\s+/g, " ")
    .split(/(?<=[。！？!?；;])\s*/)
    .map((item) => item.trim())
    .filter((item) => item.length >= 12);
  const keywords = ["问题", "痛点", "难", "核心", "关键", "真正", "不是", "但是", "所以", "一定", "必须", "结果", "解决", "方法", "比如", "如果", "为什么", "怎么", "不能", "可以"];
  const ranked = sentences
    .map((sentence, index) => ({
      sentence,
      index,
      score: keywords.reduce((total, keyword) => total + (sentence.includes(keyword) ? 1 : 0), 0) + (index < 5 ? 1 : 0)
    }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .slice(0, 8)
    .sort((a, b) => a.index - b.index)
    .map((item, index) => `${index + 1}. ${item.sentence}`);

  return ranked.length ? ranked : sentences.slice(0, 5).map((item, index) => `${index + 1}. ${item}`);
}

function RewriteResult({ item, onSave }: { item: SimpleDeconstructionRecord; onSave: (value: string) => boolean }) {
  const script = item.rewrittenScript || "还没有生成仿写逐字稿。";
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(script);
  const [feedback, setFeedback] = useState("");
  const [editError, setEditError] = useState(false);
  const title = item.rewrittenTitle || item.rewrittenTopic || `${item.targetProduct || "我的产品"}口播脚本`;
  const scriptSections = splitRewriteScript(script, {
    hook: item.rewrittenHook,
    cta: item.endingCTA
  });
  const metaItems = [
    item.targetProduct ? `产品：${item.targetProduct}` : "",
    item.targetAudience ? `人群：${item.targetAudience}` : "",
    item.rewriteGoal ? `目标：${item.rewriteGoal}` : "",
    item.rewriteStyle ? `风格：${item.rewriteStyle}` : ""
  ].filter(Boolean);
  const supportItems = [
    item.rewrittenHook ? { title: "开头钩子", value: item.rewrittenHook } : null,
    item.shootingTips ? { title: "拍摄提醒", value: item.shootingTips } : null,
    item.overlaySuggestions ? { title: "画中画建议", value: item.overlaySuggestions } : null,
    item.endingCTA ? { title: "结尾引导", value: item.endingCTA } : null
  ].filter(Boolean) as Array<{ title: string; value: string }>;

  useEffect(() => {
    if (!editing) setDraft(script);
  }, [editing, script]);

  function startEditing() {
    setDraft(script);
    setFeedback("");
    setEditError(false);
    setEditing(true);
  }

  function cancelEditing() {
    setDraft(script);
    setFeedback("");
    setEditError(false);
    setEditing(false);
  }

  function saveEditing() {
    if (!draft.trim()) {
      setFeedback("仿写逐字稿不能为空。");
      setEditError(true);
      return;
    }
    if (!onSave(draft)) {
      setFeedback("保存失败，请检查本地存储空间后重试。");
      setEditError(true);
      return;
    }
    setFeedback("修改已保存，复制和保存脚本时会使用新内容。");
    setEditError(false);
    setEditing(false);
  }

  return (
    <article className="overflow-hidden rounded-3xl border border-slate-200/70 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-950/55">
      <div className="border-b border-slate-200/70 bg-slate-50/80 px-5 py-4 dark:border-slate-800 dark:bg-slate-900/50">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">可拍摄口播稿</div>
            <h3 className="mt-2 line-clamp-2 text-lg font-semibold leading-7 text-slate-950 dark:text-slate-100">{title}</h3>
          </div>
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            <Badge variant="secondary">{estimateScriptDuration(script)}</Badge>
            {!editing ? (
              <Button size="sm" variant="outline" onClick={startEditing}>
                <Pencil className="h-4 w-4" />
                编辑仿写稿
              </Button>
            ) : null}
          </div>
        </div>
        {metaItems.length ? (
          <div className="mt-3 flex flex-wrap gap-2">
            {metaItems.map((meta) => <Badge key={meta} variant="secondary">{meta}</Badge>)}
          </div>
        ) : null}
        <p className="mt-3 text-xs leading-5 text-slate-500 dark:text-slate-400">下面这段就是最终口播正文，可直接复制给老板、主播或拍摄同事使用。</p>
      </div>

      {feedback && !editing ? (
        <p className={cn("px-5 pt-4 text-xs", editError ? "text-red-600 dark:text-red-400" : "text-emerald-600 dark:text-emerald-400")}>{feedback}</p>
      ) : null}

      {editing ? (
        <div className="space-y-3 p-5">
          <Textarea
            className="min-h-[420px] resize-y bg-white text-sm leading-7 dark:bg-slate-950/70"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            autoFocus
            aria-label="编辑仿写逐字稿内容"
          />
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className={cn("text-xs leading-5", editError ? "text-red-600 dark:text-red-400" : "text-slate-500 dark:text-slate-400")}>
              {feedback || "保存后会更新当前拆片记录和资产；再点上方“保存”可写入脚本资产。"}
            </p>
            <div className="flex items-center gap-2">
              <Button size="sm" variant="ghost" onClick={cancelEditing}>取消</Button>
              <Button size="sm" onClick={saveEditing}><Save className="h-4 w-4" />保存修改</Button>
            </div>
          </div>
        </div>
      ) : (
      <div className="p-5">
        <div className="rounded-2xl border border-slate-200/70 bg-slate-50/70 p-4 dark:border-slate-800 dark:bg-slate-900/35">
          <div className="mb-3 flex items-center justify-between gap-3">
            <div className="text-sm font-semibold text-slate-800 dark:text-slate-200">分段口播稿</div>
            <span className="text-xs text-slate-400">{script.length} 字</span>
          </div>
          <div className="space-y-3">
            {scriptSections.map((section) => (
              <div key={section.label} className="rounded-2xl border border-slate-200/70 bg-white/80 p-4 dark:border-slate-800 dark:bg-slate-950/35">
                <div className="mb-2 flex items-center justify-between gap-3">
                  <div>
                    <div className="text-xs font-semibold text-slate-400">{section.label}</div>
                    <div className="mt-1 text-sm font-semibold text-slate-900 dark:text-slate-100">{section.title}</div>
                  </div>
                  <Button size="sm" variant="ghost" onClick={() => copyText(section.value)}>
                    <Copy className="h-4 w-4" />
                    复制
                  </Button>
                </div>
                <div className="whitespace-pre-wrap text-sm leading-7 text-slate-700 dark:text-slate-300">{section.value || "暂无内容"}</div>
              </div>
            ))}
          </div>
          <details className="mt-4 rounded-2xl border border-slate-200/70 bg-white/70 p-3 dark:border-slate-800 dark:bg-slate-950/35">
            <summary className="cursor-pointer text-sm font-semibold text-slate-800 dark:text-slate-200">查看完整逐字稿</summary>
            <ReadableTextBlock value={script} maxHeightClass="max-h-[420px]" readingControls />
          </details>
        </div>

        {supportItems.length ? (
          <ShootingChecklist items={supportItems} />
        ) : null}
      </div>
      )}
    </article>
  );
}

function ShootingChecklist({ items }: { items: Array<{ title: string; value: string }> }) {
  const fullText = items.map((item) => `${item.title}：\n${item.value}`).join("\n\n");

  return (
    <section className="mt-4 rounded-2xl border border-slate-200/70 bg-slate-50/60 p-4 dark:border-slate-800 dark:bg-slate-900/25">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="text-sm font-semibold text-slate-800 dark:text-slate-200">拍摄执行清单</div>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">把这些交给拍摄或剪辑同事，按条执行即可。</p>
        </div>
        <Button size="sm" variant="ghost" onClick={() => copyText(fullText)}>
          <Copy className="h-4 w-4" />
          复制清单
        </Button>
      </div>
      <div className="grid gap-3">
        {items.map((item, index) => (
          <div key={item.title} className="rounded-2xl border border-slate-200/70 bg-white/80 p-4 dark:border-slate-800 dark:bg-slate-950/35">
            <div className="mb-2 flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <span className="flex h-6 w-6 items-center justify-center rounded-full bg-slate-950 text-xs font-semibold text-white dark:bg-slate-100 dark:text-slate-950">{index + 1}</span>
                <div className="text-sm font-semibold text-slate-900 dark:text-slate-100">{item.title}</div>
              </div>
              <Button size="sm" variant="ghost" onClick={() => copyText(item.value)}>
                <Copy className="h-4 w-4" />
                复制
              </Button>
            </div>
            <div className="whitespace-pre-wrap text-sm leading-7 text-slate-700 dark:text-slate-300">{item.value}</div>
          </div>
        ))}
      </div>
    </section>
  );
}

function estimateScriptDuration(value: string) {
  const count = value.replace(/\s/g, "").length;
  if (count <= 220) return "约 30 秒";
  if (count <= 420) return "约 60 秒";
  if (count <= 700) return "约 90 秒";
  return "长口播";
}

function splitRewriteScript(script: string, hints: { hook?: string; cta?: string }) {
  const cleaned = script.trim();
  const sentences = cleaned
    .replace(/\n+/g, "\n")
    .split(/(?<=[。！？!?；;])\s*/)
    .map((item) => item.trim())
    .filter(Boolean);
  const opening = hints.hook?.trim() || sentences.slice(0, Math.min(sentences.length, 2)).join("");
  const ending = hints.cta?.trim() || sentences.slice(Math.max(sentences.length - 2, 0)).join("");
  const bodySentences = sentences.slice(opening ? 2 : 0, ending ? Math.max(sentences.length - 2, 0) : sentences.length);
  const body = bodySentences.join("") || cleaned;

  return [
    { label: "开头", title: "先抓住注意力", value: opening || cleaned },
    { label: "正文", title: "讲清痛点、卖点和理由", value: body },
    { label: "结尾", title: "给出行动引导", value: ending || "按你的真实成交路径补一句自然引导。" }
  ];
}

function DocumentSection({
  sectionKey,
  title,
  description,
  children,
  isLast = false
}: {
  sectionKey?: AnalysisSectionKey;
  title: string;
  description?: string;
  children: React.ReactNode;
  isLast?: boolean;
}) {
  return (
    <section data-analysis-section={sectionKey} className={cn("scroll-mt-16 p-4 md:p-5", !isLast && "border-b border-slate-200/70 dark:border-slate-800")}>
      <div className="mb-4">
        <h3 className="text-sm font-semibold text-slate-950 dark:text-slate-100">{title}</h3>
        {description ? <p className="mt-1 text-xs leading-5 text-slate-500 dark:text-slate-400">{description}</p> : null}
      </div>
      <div className="space-y-4">{children}</div>
    </section>
  );
}

function CompactEmpty({ text }: { text: string }) {
  return (
    <div className="flex min-h-28 items-center justify-center rounded-2xl border border-dashed border-slate-300 px-5 text-center text-sm leading-6 text-slate-500 dark:border-slate-700 dark:text-slate-400">
      {text}
    </div>
  );
}

function WorkBlock({ title, description, children }: { title: string; description?: string; children: React.ReactNode }) {
  return (
    <div className="rounded-3xl border border-slate-200/70 bg-slate-50/70 p-4 dark:border-slate-800 dark:bg-slate-900/35">
      <div className="mb-4">
        <div className="text-sm font-semibold text-slate-950 dark:text-slate-100">{title}</div>
        {description ? <p className="mt-1 text-xs leading-5 text-slate-500 dark:text-slate-400">{description}</p> : null}
      </div>
      <div className="space-y-4">{children}</div>
    </div>
  );
}

function ActionRow({ children }: { children: React.ReactNode }) {
  return <div className="flex flex-wrap gap-2">{children}</div>;
}

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex min-w-0 items-center justify-center gap-2 rounded-xl px-2 py-2.5 text-sm font-medium transition-all",
        active
          ? "bg-white text-slate-950 shadow-sm ring-1 ring-slate-200 dark:bg-slate-800 dark:text-slate-100 dark:ring-slate-700"
          : "text-slate-500 hover:bg-white/70 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-900 dark:hover:text-slate-100"
      )}
    >
      {children}
    </button>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <Label className="text-sm font-medium text-slate-700 dark:text-slate-300">{label}</Label>
      {children}
    </div>
  );
}

function MiniInfo({ label, value, tone = "default" }: { label: string; value: string; tone?: "default" | "danger" }) {
  return (
    <div className={cn("rounded-2xl border p-3", tone === "danger" ? "border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-900/60 dark:bg-rose-950/30 dark:text-rose-200" : "border-slate-200/70 bg-white/70 dark:border-slate-800 dark:bg-slate-950/40")}>
      <div className="text-xs font-medium text-slate-400">{label}</div>
      <div className="mt-1 whitespace-pre-wrap text-sm leading-6 text-slate-700 dark:text-slate-300">{value || "未填写"}</div>
    </div>
  );
}

function ProductReferenceSummary({ product, form }: { product: ProductRecord | null; form: typeof initialForm }) {
  const sellingPoint = product?.coreSellingPoints || form.sellingPoint;
  const painPoint = product?.painPoints || form.painPoint;
  const forbidden = [product?.forbiddenWords, product?.forbiddenClaims].filter(Boolean).join("\n");
  const summaryItems = [
    { label: "核心卖点", value: sellingPoint },
    { label: "用户痛点", value: painPoint },
    { label: "禁忌提醒", value: forbidden }
  ].filter((item) => item.value);

  return (
    <div className="rounded-2xl border border-emerald-200 bg-emerald-50/70 p-4 dark:border-emerald-900/60 dark:bg-emerald-950/20">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-xs font-semibold text-emerald-700 dark:text-emerald-200">{product ? "已引用产品资料" : "已填写临时产品"}</div>
          <div className="mt-1 truncate text-base font-semibold text-slate-950 dark:text-slate-100">{form.targetProduct}</div>
        </div>
        <div className="flex flex-wrap gap-2">
          {product?.brandName ? <Badge variant="secondary">{product.brandName}</Badge> : null}
          {(product?.category || form.targetIndustry) ? <Badge variant="secondary">{product?.category || form.targetIndustry}</Badge> : null}
          {form.targetAudience ? <Badge variant="secondary">{form.targetAudience}</Badge> : null}
        </div>
      </div>

      {summaryItems.length ? (
        <div className="mt-3 grid gap-2">
          {summaryItems.map((item) => (
            <div key={item.label} className="rounded-xl border border-white/80 bg-white/70 p-3 dark:border-emerald-900/30 dark:bg-slate-950/35">
              <div className="text-xs font-medium text-slate-400">{item.label}</div>
              <div className="mt-1 line-clamp-2 whitespace-pre-wrap text-xs leading-5 text-slate-700 dark:text-slate-300">{item.value}</div>
            </div>
          ))}
        </div>
      ) : (
        <p className="mt-3 text-xs leading-5 text-slate-500 dark:text-slate-400">当前产品资料内容较少，仍可继续仿写；建议后续补充卖点和痛点。</p>
      )}
    </div>
  );
}

function RewriteSaveFeedback({ status, savedScriptId }: { status: SaveStatus; savedScriptId?: string }) {
  if (savedScriptId) {
    return (
      <p className="mt-1 text-xs leading-5 text-emerald-600 dark:text-emerald-300">
        仿写脚本已保存到脚本资产，
        <Link href="/assets" className="font-medium underline underline-offset-4">
          可在资产库查看
        </Link>
        。
      </p>
    );
  }

  const statusText: Record<SaveStatus, string> = {
    idle: "仿写已完成，可直接复制；点击保存后会进入脚本资产。",
    saving: "正在保存，请稍等。",
    saved: "拆片记录已自动保存；如要复用这条仿写脚本，请点击保存。",
    error: "保存失败，请稍后重试。"
  };
  return (
    <p className={cn("mt-1 text-xs leading-5", status === "error" ? "text-rose-500 dark:text-rose-300" : "text-slate-500 dark:text-slate-400")}>
      {statusText[status]}
    </p>
  );
}

function StructureResult({ generated }: { generated: SimpleDeconstructionRecord }) {
  const sections = [
    { label: "开头钩子", value: generated.hook },
    { label: "内容推进", value: generated.structure },
    { label: "爆款元素", value: generated.viralElements },
    { label: "节奏与情绪", value: generated.visualRhythm || generated.emotionFlow },
    { label: "可复用结构", value: generated.reusableStructure }
  ];
  const fullText = sections.map((section) => `${section.label}：\n${section.value || "暂未提炼"}`).join("\n\n");

  return (
    <div className="mt-3 space-y-3">
      <div className="flex justify-end">
        <Button size="sm" variant="ghost" onClick={() => copyText(fullText)}>
          <Copy className="h-4 w-4" />
          复制全部结构
        </Button>
      </div>
      <div className="grid gap-3">
        {sections.map((section) => (
          <div key={section.label} className="rounded-2xl border border-slate-200/70 bg-white/80 p-4 dark:border-slate-800 dark:bg-slate-950/35">
            <div className="mb-2 flex items-center justify-between gap-3">
              <div className="text-sm font-semibold text-slate-900 dark:text-slate-100">{section.label}</div>
              <Button size="sm" variant="ghost" onClick={() => copyText(section.value || "")}>
                <Copy className="h-4 w-4" />
                复制
              </Button>
            </div>
            <div className="whitespace-pre-wrap text-sm leading-7 text-slate-700 dark:text-slate-300">{section.value || "暂未提炼"}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function TranscriptReader({ value, onSave }: { value: string; onSave: (value: string) => boolean }) {
  const [viewMode, setViewMode] = useState<"full" | "key">("full");
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const [feedback, setFeedback] = useState("");
  const [editError, setEditError] = useState(false);
  const keySentences = useMemo(() => extractKeyTranscriptLines(value), [value]);
  const hasKeySentences = keySentences.length > 0;
  const displayValue = viewMode === "key" ? keySentences.join("\n") : value;

  useEffect(() => {
    if (!editing) setDraft(value);
  }, [editing, value]);

  function startEditing() {
    setDraft(value);
    setFeedback("");
    setEditError(false);
    setEditing(true);
  }

  function cancelEditing() {
    setDraft(value);
    setFeedback("");
    setEditError(false);
    setEditing(false);
  }

  function saveEditing() {
    if (!draft.trim()) {
      setFeedback("逐字稿不能为空。");
      setEditError(true);
      return;
    }
    if (!onSave(draft)) {
      setFeedback("保存失败，请检查本地存储空间后重试。");
      setEditError(true);
      return;
    }
    setFeedback("修改已保存，后续仿写会使用新逐字稿。");
    setEditError(false);
    setEditing(false);
  }

  return (
    <div className="mt-3 rounded-2xl border border-slate-200/70 bg-slate-50/70 p-3 dark:border-slate-800 dark:bg-slate-900/35">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        {!editing ? (
          <div className="inline-flex rounded-xl border border-slate-200 bg-white p-1 text-xs dark:border-slate-800 dark:bg-slate-950/50">
            <button
              type="button"
              onClick={() => setViewMode("full")}
              className={cn(
                "rounded-lg px-3 py-1.5 transition-colors",
                viewMode === "full"
                  ? "bg-slate-950 text-white dark:bg-slate-100 dark:text-slate-950"
                  : "text-slate-500 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-100"
              )}
            >
              完整逐字稿
            </button>
            <button
              type="button"
              onClick={() => setViewMode("key")}
              disabled={!hasKeySentences}
              className={cn(
                "rounded-lg px-3 py-1.5 transition-colors disabled:cursor-not-allowed disabled:opacity-45",
                viewMode === "key"
                  ? "bg-slate-950 text-white dark:bg-slate-100 dark:text-slate-950"
                  : "text-slate-500 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-100"
              )}
            >
              只看重点句
            </button>
          </div>
        ) : <span className="text-sm font-semibold text-slate-800 dark:text-slate-200">编辑逐字稿</span>}
        <div className="flex flex-wrap items-center gap-2">
          {editing ? (
            <>
              <Button size="sm" variant="ghost" onClick={cancelEditing}>取消</Button>
              <Button size="sm" onClick={saveEditing}><Save className="h-4 w-4" />保存修改</Button>
            </>
          ) : (
            <>
              <Button size="sm" variant="outline" onClick={startEditing}><Pencil className="h-4 w-4" />编辑逐字稿</Button>
              <Button size="sm" variant="ghost" onClick={() => copyText(displayValue)}>
                <Copy className="h-4 w-4" />
                {viewMode === "key" ? "复制重点句" : "复制全文"}
              </Button>
            </>
          )}
        </div>
      </div>

      {editing ? (
        <div className="space-y-2">
          <Textarea
            className="min-h-[280px] resize-y bg-white text-sm leading-7 dark:bg-slate-950/70"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            autoFocus
            aria-label="编辑逐字稿内容"
          />
          <p className="text-xs leading-5 text-slate-500 dark:text-slate-400">保存后会更新当前拆片记录和资产，并作为后续仿写的逐字稿；已有视频结构不会自动重新拆解。</p>
        </div>
      ) : viewMode === "key" && !hasKeySentences ? (
        <CompactEmpty text="这段逐字稿暂时没有识别出明显重点句，可直接查看完整逐字稿。" />
      ) : (
        <ReadableTextBlock value={displayValue} maxHeightClass="max-h-[360px]" readingControls />
      )}
      {feedback ? <p className={cn("mt-3 text-xs", editError ? "text-red-600 dark:text-red-400" : "text-emerald-600 dark:text-emerald-400")}>{feedback}</p> : null}
    </div>
  );
}

function ReadableTextBlock({
  value,
  maxHeightClass = "max-h-72",
  readingControls = false
}: {
  value: string;
  maxHeightClass?: string;
  readingControls?: boolean;
}) {
  const [readingMode, setReadingMode] = useState<"compact" | "comfortable" | "large">("comfortable");
  const [focusedWidth, setFocusedWidth] = useState(false);
  const readingClass = {
    compact: "text-sm leading-6",
    comfortable: "text-sm leading-7",
    large: "text-base leading-8"
  }[readingMode];
  return (
    <div className="mt-3 space-y-2">
      {readingControls ? (
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500 dark:text-slate-400">
          <div className="inline-flex rounded-xl border border-slate-200 bg-white p-1 dark:border-slate-800 dark:bg-slate-950/50">
            {(["compact", "comfortable", "large"] as const).map((mode) => (
              <button
                key={mode}
                type="button"
                onClick={() => setReadingMode(mode)}
                className={cn(
                  "rounded-lg px-2.5 py-1.5 transition-colors",
                  readingMode === mode ? "bg-slate-950 text-white dark:bg-slate-100 dark:text-slate-950" : "hover:bg-slate-100 dark:hover:bg-slate-800"
                )}
              >
                {{ compact: "紧凑", comfortable: "舒适", large: "大字" }[mode]}
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={() => setFocusedWidth((current) => !current)}
            className="rounded-lg px-2.5 py-1.5 transition-colors hover:bg-slate-100 hover:text-slate-900 dark:hover:bg-slate-800 dark:hover:text-slate-100"
          >
            {focusedWidth ? "切换全宽" : "聚焦阅读"}
          </button>
        </div>
      ) : null}
      <div className={cn("overflow-y-auto rounded-2xl border border-slate-200/80 bg-white p-4 text-slate-700 dark:border-slate-800 dark:bg-slate-950/40 dark:text-slate-300 scrollbar-subtle", maxHeightClass)}>
        <div className={cn("whitespace-pre-wrap", readingClass, focusedWidth && "mx-auto max-w-2xl")}>{value || "暂无内容"}</div>
      </div>
    </div>
  );
}

function CollapsibleText({ title, value, lines = 5, copyable = false }: { title: string; value: string; lines?: number; copyable?: boolean }) {
  if (!value) return <MiniInfo label={title} value="未填写" />;
  const preview = value.split("\n").slice(0, lines).join("\n");
  const needsFold = value.split("\n").length > lines || value.length > 360;
  if (!needsFold) {
    return (
      <div className="rounded-2xl border border-slate-200/70 bg-white/70 p-3 dark:border-slate-800 dark:bg-slate-950/40">
        <div className="mb-2 flex items-center justify-between gap-3">
          <div className="text-xs font-medium text-slate-400">{title}</div>
          {copyable ? <Button size="sm" variant="ghost" onClick={() => copyText(value)}><Copy className="h-4 w-4" />复制</Button> : null}
        </div>
        <div className="whitespace-pre-wrap text-sm leading-7 text-slate-700 dark:text-slate-300">{value}</div>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-slate-200/70 bg-white/70 p-3 dark:border-slate-800 dark:bg-slate-950/40">
      <div className="mb-2 flex items-center justify-between gap-3">
        <div className="text-xs font-medium text-slate-400">{title}</div>
        {copyable ? <Button size="sm" variant="ghost" onClick={() => copyText(value)}><Copy className="h-4 w-4" />复制</Button> : null}
      </div>
      <div className="whitespace-pre-wrap text-sm leading-7 text-slate-700 dark:text-slate-300">{preview}</div>
      <details className="mt-3 rounded-2xl border border-slate-200/70 bg-white/60 p-3 dark:border-slate-800 dark:bg-slate-900/40">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-sm font-medium text-slate-700 dark:text-slate-300">
          展开完整内容
          <ChevronDown className="h-4 w-4" />
        </summary>
        <div className="mt-3 whitespace-pre-wrap text-sm leading-7 text-slate-700 dark:text-slate-300">{value}</div>
      </details>
    </div>
  );
}

function ContentRiskNotice({ text }: { text: string }) {
  const words = ["全网最低", "第一", "100%", "永久", "根治", "治愈", "绝对", "最低价", "唯一"];
  const hits = words.filter((word) => text.includes(word));
  return (
    <div className={cn("rounded-2xl border p-3", hits.length ? "border-amber-200 bg-amber-50 dark:border-amber-900/60 dark:bg-amber-950/30" : "border-emerald-200 bg-emerald-50 dark:border-emerald-900/60 dark:bg-emerald-950/30")}>
      <div className="flex items-center gap-2 text-sm font-semibold text-slate-900 dark:text-slate-100">
        {hits.length ? <AlertTriangle className="h-4 w-4 text-amber-600" /> : <CheckCircle2 className="h-4 w-4 text-emerald-600" />}
        风险检查
      </div>
      <p className="mt-2 text-sm leading-6 text-slate-600 dark:text-slate-300">
        {hits.length ? `检测到高风险表达：${hits.join("、")}。建议改成更稳妥、可证明的事实表达。` : "暂未发现明显绝对化高风险词。发布前仍需核对价格、功效、背书和产品资料。"}
      </p>
    </div>
  );
}

function CurrentSaveStatus({ status, recordId, record }: { status: SaveStatus; recordId: string; record: SimpleDeconstructionRecord | null }) {
  if (status === "idle" && !recordId) return null;
  const statusText: Record<SaveStatus, string> = { idle: "未保存", saving: "保存中", saved: "已保存", error: "保存失败" };
  return (
    <div className="rounded-2xl border border-slate-200/70 bg-slate-50/70 p-3 text-xs leading-5 text-slate-500 dark:border-slate-800 dark:bg-slate-950/40 dark:text-slate-400">
      <div>保存状态：{statusText[status]}</div>
      {recordId ? <div>当前记录：{recordId}</div> : null}
      {record?.createdAt ? <div>创建时间：{formatDateTime(record.createdAt)}</div> : null}
    </div>
  );
}

function hasPatch<T extends object>(patch: T, key: keyof T) {
  return Object.prototype.hasOwnProperty.call(patch, key);
}

function normalizeSteps(steps: ProcessStep[]) {
  return baseSteps.map((base) => {
    const matched = steps.find((step) => mapJobStage(step.key) === base.key);
    return matched ? { ...base, ...matched, key: base.key, label: base.label } : base;
  });
}

function mapJobStage(stage: string) {
  if (["system_check", "platform_detect", "metadata", "resolve"].includes(stage)) return "platform_detect";
  if (["video_download", "download", "parse", "audio_extract"].includes(stage)) return "video_download";
  if (["asr", "transcript", "upload"].includes(stage)) return "asr";
  if (stage === "deconstruction") return "deconstruction";
  if (stage === "comment_fetch" || stage === "comments") return "comment_fetch";
  if (stage === "comment_insights") return "comment_insights";
  if (stage === "rewrite") return "rewrite";
  if (stage === "finish") return "finish";
  return stage;
}

function mapStepLabel(stage: string, fallback: string) {
  return baseSteps.find((step) => step.key === mapJobStage(stage))?.label || fallback;
}

function platformLabelFromRecord(record: SimpleDeconstructionRecord) {
  if (record.platform === "xiaohongshu") return "小红书";
  if (record.platform === "kuaishou") return "快手";
  if (record.platform === "wechat_channels") return "视频号";
  if (record.platform === "bilibili") return "抖音";
  return "抖音";
}

function toStructureOnlyRecord(record: SimpleDeconstructionRecord, analysisMarkdown = "") {
  return {
    ...record,
    analysisMarkdown: analysisMarkdown || record.analysisMarkdown || "",
    analysisResult: analysisMarkdown || record.analysisResult || record.analysisMarkdown || "",
    rewriteMarkdown: "",
    rewrittenTopic: "",
    rewrittenTitle: "",
    rewrittenHook: "",
    rewrittenScript: "",
    shotSuggestions: "",
    shootingTips: "",
    endingCTA: "",
    extendedTopics: "",
    newTopicIdeas: "",
    newScriptDirections: ""
  } satisfies SimpleDeconstructionRecord;
}

function formatStructureAnalysis(record: SimpleDeconstructionRecord) {
  return [
    "# 原视频结构拆解",
    "",
    "## 视频核心主题",
    record.coreTheme,
    "",
    "## 开头钩子",
    record.hook,
    "",
    "## 爆款元素",
    record.viralElements,
    "",
    "## 内容结构",
    record.structure,
    "",
    "## 情绪与节奏",
    [record.emotionFlow, record.visualRhythm].filter(Boolean).join("\n"),
    "",
    "## 转化路径",
    record.conversionPoint,
    "",
    "## 可迁移结构",
    record.reusableStructure
  ].join("\n");
}

function formatDeconstruction(item: SimpleDeconstructionRecord) {
  return item.analysisMarkdown || [
    `平台来源：${platformLabels[item.platform || "unknown"]}`,
    `视频核心主题：${item.coreTheme}`,
    `目标人群：${item.targetAudience}`,
    `开头钩子：${item.hook}`,
    `爆款元素：${item.viralElements}`,
    `内容结构：\n${item.structure}`,
    `情绪变化：\n${item.emotionFlow}`,
    `节奏设计：\n${item.visualRhythm}`,
    `转化路径：${item.conversionPoint}`,
    `可迁移结构：\n${item.reusableStructure}`
  ].join("\n\n");
}

function formatRewrite(item: SimpleDeconstructionRecord) {
  return item.rewriteMarkdown || [
    `新选题：${item.rewrittenTopic}`,
    `标题：${item.rewrittenTitle}`,
    `开头 3 秒钩子：${item.rewrittenHook}`,
    `完整口播脚本：\n${item.rewrittenScript}`,
    `分镜建议：\n${item.shotSuggestions}`,
    `画中画建议：\n${item.overlaySuggestions}`,
    `拍摄提醒：\n${item.shootingTips}`,
    `结尾引导：${item.endingCTA}`,
    `延展选题：\n${item.extendedTopics}`
  ].join("\n\n");
}

function saveDeconstructionAsset(item: SimpleDeconstructionRecord) {
  createAsset({
    id: `asset_deconstruction_${item.id}`,
    type: "deconstruction",
    title: item.sourceTitle || item.title || item.rewrittenTitle || item.sourceUrl || "拆片结果",
    summary: item.coreTheme || item.hook || item.analysisResult || item.reusableStructure || "拆片结构",
    content: [formatDeconstruction(item), item.rewrittenScript ? `仿写结果：\n${formatRewrite(item)}` : ""].filter(Boolean).join("\n\n"),
    rawData: item,
    sourceModule: "deconstruction",
    platform: mapAssetPlatform(item.platform),
    productId: item.productId || "",
    productName: item.targetProduct,
    tags: [item.rewriteGoal, item.rewriteStyle].filter(Boolean).map(String),
    favorite: Boolean(item.favorite),
    status: item.status === "failed" ? "failed" : item.status === "analyzing" ? "draft" : "completed",
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
    linkedRecordIds: [item.id, item.savedScriptId].filter((value): value is string => Boolean(value)),
  });
}

function saveCommentInsightAsset(item: SimpleDeconstructionRecord) {
  const insights = item.commentInsights;
  if (!insights && !item.topComments?.length) return;
  const comments = item.topComments?.slice(0, COMMENT_LIMIT).map((comment) => `${comment.likeCount || 0}赞 ${comment.content}`).join("\n") || "";
  const content = [
    comments ? `高赞评论：\n${comments}` : "",
    insights?.userPainPoints?.length ? `用户真实痛点：\n${insights.userPainPoints.join("\n")}` : "",
    insights?.purchaseObjections?.length ? `购买顾虑：\n${insights.purchaseObjections.join("\n")}` : "",
    insights?.shootingSuggestions?.length ? `拍摄建议：\n${insights.shootingSuggestions.join("\n")}` : "",
    insights?.topicIdeas?.length ? `选题方向：\n${insights.topicIdeas.join("\n")}` : "",
    insights?.hookIdeas?.length ? `开头钩子：\n${insights.hookIdeas.join("\n")}` : "",
  ].filter(Boolean).join("\n\n");
  createAsset({
    id: `asset_comment_insight_${item.id}`,
    type: "comment_insight",
    title: `${item.sourceTitle || item.title || "拆片"} - 评论洞察`,
    summary: insights?.topConcerns?.join("；") || insights?.userPainPoints?.join("；") || "高赞评论洞察",
    content,
    rawData: { comments: item.topComments || [], insights, productSnapshot: item.productSnapshot },
    sourceModule: "deconstruction",
    platform: mapAssetPlatform(item.platform),
    productId: item.productId || "",
    productName: item.targetProduct,
    tags: ["高赞评论", "选题灵感"],
    favorite: false,
    status: item.commentsFetchStatus === "failed" ? "failed" : "completed",
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
    linkedRecordIds: [item.id],
  });
}

function mapAssetPlatform(platform?: string): ContentAssetPlatform {
  if (platform === "xiaohongshu") return "xiaohongshu";
  if (platform === "kuaishou") return "kuaishou";
  if (platform === "wechat_channels") return "shipinhao";
  if (platform === "douyin") return "douyin";
  return "unknown";
}

function toOption(value: string) {
  return { label: value, value };
}

function referenceSourceLabel(value: RewriteReferenceSource) {
  if (value === "structure") return "原视频结构";
  if (value === "comments") return "高赞评论洞察";
  return "原视频结构 + 高赞评论洞察";
}

function buildVideoSummarySections(
  item: SimpleDeconstructionRecord | null,
  fallback: { title: string; description: string; transcript: string }
) {
  if (!item) {
    const hasSource = [fallback.title, fallback.description, fallback.transcript].some((value) => value.trim());
    return [
      {
        label: "判断",
        title: "为什么有效",
        value: hasSource
          ? "已经拿到原始内容，但还没有完成结构拆解。建议先点击开始分析，提炼开头钩子、痛点和转化路径。"
          : "完成链接分析、上传视频或手动输入逐字稿后，这里会总结这条视频为什么可能有效。"
      },
      {
        label: "复用",
        title: "最值得借鉴",
        value: "完成拆片后，这里会提炼最适合迁移到你自己产品里的结构、节奏和表达方法。"
      },
      {
        label: "避坑",
        title: "不建议照搬",
        value: "不要照抄原视频的人设、案例和承诺。后续只迁移结构和表达方法，再结合自己的真实产品资料。"
      }
    ];
  }

  const whyEffective = [
    item.coreTheme ? `核心主题清楚：${item.coreTheme}` : "",
    item.hook ? `开头能抓住人：${item.hook}` : "",
    item.viralElements ? `爆款元素明确：${item.viralElements}` : "",
    item.conversionPoint ? `转化位置清晰：${item.conversionPoint}` : "",
  ].filter(Boolean).join("\n") || "这条视频的有效点主要来自清晰主题、直接开头、稳定节奏和明确转化路径。";

  const bestToBorrow = [
    item.reusableStructure ? `可迁移结构：${item.reusableStructure}` : "",
    item.structure ? `内容推进方式：${item.structure}` : "",
    item.visualRhythm ? `节奏方法：${item.visualRhythm}` : "",
  ].filter(Boolean).join("\n") || "优先借鉴它的开头方式、内容推进顺序和转化逻辑，不要直接照搬原文。";

  const avoidCopying = [
    "不要照抄原视频逐字稿，也不要复制对方的人设、案例和承诺。",
    item.conversionPoint ? `转化表达要改成自己的真实成交路径，原视频转化点只作参考：${item.conversionPoint}` : "",
    "如果原视频涉及价格、效果、数据或背书，必须用自己的产品资料核实后再写。"
  ].filter(Boolean).join("\n");

  return [
    { label: "判断", title: "为什么有效", value: whyEffective },
    { label: "复用", title: "最值得借鉴", value: bestToBorrow },
    { label: "避坑", title: "不建议照搬", value: avoidCopying }
  ];
}

function copyText(value: string) {
  if (typeof navigator === "undefined") return;
  void navigator.clipboard.writeText(value);
}

function sleep(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function parseAttempts(value?: string) {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function parseStructuredJson(value?: string) {
  if (!value) return undefined;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" ? parsed as Record<string, unknown> : undefined;
  } catch {
    return undefined;
  }
}

function parseComments(value?: string) {
  if (!value) return [];
  return value.split("\n").map((content) => content.trim()).filter(Boolean).map((content) => ({ content }));
}

function stringifyJson(value: unknown) {
  if (!value) return "";
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return "";
  }
}

function formatDateTime(value?: string) {
  if (!value) return "未知时间";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}

function saveLinkJobHistory(job: LinkAnalyzeJobPayload) {
  try {
    const key = "director-platform.linkAnalyzeHistory";
    const raw = window.localStorage.getItem(key);
    const list = raw ? JSON.parse(raw) : [];
    const next = Array.isArray(list)
      ? [{ id: job.id, status: job.status, updatedAt: new Date().toISOString(), result: job.result, deconstructionMarkdown: job.deconstructionMarkdown }, ...list.filter((item: { id?: string }) => item.id !== job.id)].slice(0, 30)
      : [{ id: job.id, status: job.status, updatedAt: new Date().toISOString(), result: job.result, deconstructionMarkdown: job.deconstructionMarkdown }];
    window.localStorage.setItem(key, JSON.stringify(next));
  } catch {
    // 历史任务写入失败不影响本次分析结果。
  }
}

function formatFileSize(size: number) {
  if (size >= 1024 * 1024 * 1024) return `${(size / 1024 / 1024 / 1024).toFixed(2)}GB`;
  if (size >= 1024 * 1024) return `${(size / 1024 / 1024).toFixed(1)}MB`;
  return `${Math.ceil(size / 1024)}KB`;
}
