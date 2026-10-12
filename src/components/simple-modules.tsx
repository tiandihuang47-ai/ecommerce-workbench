"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import {
  ArrowRight,
  Archive,
  BarChart3,
  BookOpen,
  Boxes,
  Clapperboard,
  Copy,
  Download,
  FileSearch,
  Heart,
  ImagePlus,
  Layers3,
  MessageCircle,
  MoreHorizontal,
  Package,
  PenLine,
  Plus,
  RefreshCw,
  Save,
  Search,
  Settings,
  Sparkles,
  Star,
  Trash2,
  Upload,
  WandSparkles
} from "lucide-react";
import { EmptyState, PageHeader, SectionCard } from "@/components/design-system";
import { ProductReferenceCard } from "@/components/product-reference-card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  createId,
  deleteResourceItem,
  deleteScriptRecord,
  deleteProductRecord,
  deleteCommentInsightRecord,
  deleteSimpleDeconstructionRecord,
  deleteSimpleReviewRecord,
  getPipelineData,
  getResourceItems,
  getProductRecords,
  getCommentInsightRecords,
  getScriptRecords,
  getSimpleDeconstructionRecords,
  getSimpleReviewRecords,
  nowIso,
  saveResourceItem,
  saveScriptRecord,
  saveProductRecord,
  saveCommentInsightRecord,
  saveSimpleDeconstructionRecord,
  saveSimpleReviewRecord
} from "@/lib/pipeline-storage";
import type {
  PipelineData,
  CommentInsightRecord,
  ProductRecord,
  ProductRecordSaveInput,
  ResourceItem,
  ScriptRecord,
  ScriptRecordContentFormat,
  ScriptRecordMaterialSource,
  ScriptRecordPlatform,
  ScriptRecordContentType,
  ScriptRecordStatus,
  ScriptRecordVideoGoal,
  SimpleDeconstructionRecord,
  SimpleReviewRecord
} from "@/lib/pipeline-types";
import {
  scriptRecordContentTypes,
  scriptRecordContentFormats,
  scriptRecordMaterialSources,
  scriptRecordPlatforms,
  scriptRecordStatuses,
  scriptRecordVideoGoals
} from "@/lib/pipeline-types";
import {
  deconstructionToResource,
  generateLocalDeconstruction,
  generateLocalScript,
  generateCommentInsights,
  generateReviewConclusion,
  generateSimilarScript,
  generateTopicIdeas,
  productToScriptInputPatch,
  parseAiDeconstruction,
  scriptResultToRecord,
  type ScriptGenerateResult,
  type DeconstructionInput,
  type SimpleScriptInput
} from "@/services/simpleContentService";
import { cn } from "@/lib/utils";
import { formatProductReferenceForPrompt } from "@/lib/product-reference";
import { assetFromScriptRecord, createAsset, exportAssets, getRecentAssets, type ContentAsset } from "@/lib/stores/asset-store";
import { scriptDraftStorageKey } from "@/lib/asset-reuse-client";
import { handOffToAIChat } from "@/lib/ai-chat-bridge";

type SimpleData = {
  pipeline: PipelineData;
  scripts: ScriptRecord[];
  reviews: SimpleReviewRecord[];
  deconstructions: SimpleDeconstructionRecord[];
  resources: ResourceItem[];
  products: ProductRecord[];
  commentInsights: CommentInsightRecord[];
};

const defaultScriptInput: SimpleScriptInput = {
  productName: "",
  productId: "",
  platform: "抖音",
  contentFormat: "短视频口播",
  materialSource: "手动输入",
  targetAudience: "",
  painPoint: "",
  sellingPoint: "",
  contentType: "短视频口播",
  videoGoal: "成交",
  extra: "",
  duration: "30秒",
  speakingStyle: "真实口语",
  scene: "室内口播",
  needShotList: true,
  needOverlay: true,
  needTitle: true,
  needNote: false,
  productForbiddenWords: "",
  productForbiddenClaims: "",
  comments: "",
  liveTranscript: "",
  originalScript: "",
  rewriteGoal: "更犀利",
  includeRiskCheck: true,
  includeCoverTitle: true
};

const scriptToneOptions = ["犀利", "真实口语", "老板口播", "达人种草", "专业讲解", "温和信任", "小红书真实分享"];
const scriptSceneOptions = ["室内口播", "店铺实拍", "工厂实拍", "产品细节", "街拍", "直播间切片", "其他"];
const rewriteGoalOptions = ["更犀利", "更口语", "更短", "更适合抖音", "更适合小红书", "更像老板口播", "更强成交", "降低违规风险"];

const judgementOptions = ["有效", "一般", "无效", "待观察"];

export function SimpleDashboard() {
  const router = useRouter();
  const { data, refresh } = useSimpleData();
  const [recentAssets, setRecentAssets] = useState<ContentAsset[]>([]);
  const [dashboardMessage, setDashboardMessage] = useState("");
  const pendingReviews = data.scripts.filter((item) => item.status === "已发布" && !item.reviewId).length;
  const recentScripts = data.scripts.slice(0, 5);
  const recentDeconstructions = data.deconstructions.slice(0, 5);
  const recentImagePrompts = recentAssets.filter((item) => item.type === "image_prompt").slice(0, 5);
  const recentAiChats = recentAssets.filter((item) => item.type === "ai_chat").slice(0, 5);
  const favoriteAssets = recentAssets.filter((item) => item.favorite).slice(0, 5);
  const draftOrFailedAssets = recentAssets.filter((item) => item.status === "draft" || item.status === "failed").slice(0, 5);

  useEffect(() => {
    setRecentAssets(getRecentAssets(12));
  }, []);

  function refreshAll() {
    refresh();
    setRecentAssets(getRecentAssets(12));
  }

  function exportDashboardData() {
    const dataText = JSON.stringify(exportAssets(), null, 2);
    navigator.clipboard?.writeText(dataText).catch(() => undefined);
    setDashboardMessage("全部本地数据已导出并复制。需要文件备份时，可以进入系统设置复制完整 JSON。");
  }

  return (
    <div className="desktop-page">
      <PageHeader
        eyebrow="AI 内容中台 / 工作台"
        title="中小企业 AI 内容生产中台"
        description="AI 内容中台：脚本、拆片、生图，帮中小企业把内容从想法推进到可拍、可用、可复盘。"
      />

      <section className="mb-5">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-slate-950 dark:text-slate-100">核心生产入口</h2>
          <Button variant="ghost" size="sm" onClick={refreshAll}><RefreshCw className="h-4 w-4" />刷新</Button>
        </div>
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
          <QuickAction title="写脚本" description="生成短视频、图文、直播切片等可拍内容。" onOpen={() => router.push("/script-generator")} icon={WandSparkles} />
          <QuickAction title="拆爆款" description="分析同行爆款结构，迁移成自己的内容。" onOpen={() => router.push("/deconstruction")} icon={FileSearch} />
          <QuickAction title="做图片" description="生成主图、封面、场景图、分镜图提示词。" onOpen={() => router.push("/image-generator")} icon={ImagePlus} />
          <QuickAction title="AI 对话" description="自由询问脚本、拍摄、拆片、复盘和生图问题。" onOpen={() => router.push(handOffToAIChat())} icon={MessageCircle} />
          <QuickAction title="数据复盘" description="录入内容数据，判断下一条怎么优化。" onOpen={() => router.push("/reviews")} icon={BarChart3} />
        </div>
      </section>

      <section className="mb-5">
        <h2 className="mb-3 text-lg font-semibold text-slate-950 dark:text-slate-100">内容管理</h2>
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <ManagementCard title="资产库" description="查看脚本、拆片、生图、评论洞察等历史内容。" action="查看资产" icon={Clapperboard} onOpen={() => router.push("/assets")} />
          <ManagementCard title="资料库" description="管理产品资料、用户痛点、禁忌词、竞品资料。" action="管理资料" icon={Boxes} onOpen={() => router.push("/resources")} />
          <ManagementCard title="收藏内容" description="查看收藏的脚本、拆片和生图提示词。" action="查看收藏" icon={Heart} onOpen={() => router.push("/assets")} />
          <ManagementCard title="待处理内容" description="查看草稿、失败记录、未完成内容。" action="查看待处理" icon={Archive} onOpen={() => router.push("/assets")} />
        </div>
      </section>

      <div className="mb-5 grid gap-5 xl:grid-cols-3">
        <DashboardList title="收藏内容" empty="还没有收藏资产。" onAction={() => router.push("/assets")}>
          {favoriteAssets.map((item) => <AssetRow key={item.id} item={item} onOpen={() => router.push("/assets")} />)}
        </DashboardList>
        <DashboardList title="待处理" empty="没有失败记录或草稿。" onAction={() => router.push("/assets")}>
          {draftOrFailedAssets.map((item) => <AssetRow key={item.id} item={item} onOpen={() => router.push("/assets")} />)}
        </DashboardList>
        <DashboardList title="待复盘" empty="暂无待复盘脚本。" onAction={() => router.push("/reviews")}>
          {pendingReviews ? <ReminderInline title={`${pendingReviews} 条内容待复盘`} description="进入数据复盘，把结果反哺脚本和拆片。" onOpen={() => router.push("/reviews")} /> : null}
        </DashboardList>
      </div>

      <section className="mb-5">
        <h2 className="mb-3 text-lg font-semibold text-slate-950 dark:text-slate-100">最近内容</h2>
      <div className="grid gap-5 xl:grid-cols-4">
        <DashboardList title="最近脚本" empty="还没有脚本，先生成一条。" onAction={() => router.push("/script-generator")}>
          {recentScripts.map((item) => <ScriptRow key={item.id} item={item} onOpen={() => router.push(`/scripts/${item.id}`)} />)}
        </DashboardList>
        <DashboardList title="最近拆片" empty="还没有拆片记录，先拆一个爆款。" onAction={() => router.push("/deconstruction")}>
          {recentDeconstructions.map((item) => <DeconstructionRow key={item.id} item={item} onOpen={() => router.push(`/deconstruction?record=${item.id}`)} />)}
        </DashboardList>
        <DashboardList title="最近生图" empty="还没有生图提示词。" onAction={() => router.push("/image-generator")}>
          {recentImagePrompts.map((item) => <AssetRow key={item.id} item={item} onOpen={() => router.push("/assets")} />)}
        </DashboardList>
        <DashboardList title="最近 AI 对话" empty="还没有保存 AI 对话。" onAction={() => router.push("/ai-chat")}>
          {recentAiChats.map((item) => <AssetRow key={item.id} item={item} onOpen={() => router.push("/assets")} />)}
        </DashboardList>
      </div>
      </section>

      <section>
        <h2 className="mb-3 text-lg font-semibold text-slate-950 dark:text-slate-100">系统与数据</h2>
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <ManagementCard title="系统设置" description="查看 API 配置状态、主题模式、本地存储说明。" action="进入设置" icon={Settings} onOpen={() => router.push("/settings")} />
          <ManagementCard title="数据导出" description="导出本地保存的全部内容资产。" action="导出数据" icon={Download} onOpen={exportDashboardData} />
          <ManagementCard title="数据导入" description="从备份 JSON 恢复内容资产。" action="导入数据" icon={Upload} onOpen={() => router.push("/settings")} />
          <ManagementCard title="清理归档" description="清理已归档内容，保留重要资产。" action="管理数据" icon={Trash2} onOpen={() => router.push("/settings")} />
        </div>
        {dashboardMessage ? <p className="mt-3 rounded-2xl bg-slate-100 px-4 py-3 text-sm text-slate-600 dark:bg-slate-800 dark:text-slate-300">{dashboardMessage}</p> : null}
      </section>
    </div>
  );
}

export function ScriptGeneratorPage() {
  const { data, refresh } = useSimpleData();
  const [input, setInput] = useState<SimpleScriptInput>(defaultScriptInput);
  const [generated, setGenerated] = useState<ScriptRecord | null>(null);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [topicIdeas, setTopicIdeas] = useState<string[]>([]);
  const [commentInsight, setCommentInsight] = useState<CommentInsightRecord | null>(null);
  const [draftReady, setDraftReady] = useState(false);

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(scriptDraftStorageKey);
      if (saved) {
        setInput({ ...defaultScriptInput, ...JSON.parse(saved) as Partial<SimpleScriptInput> });
      }
      if (new URLSearchParams(window.location.search).get("reuseAsset")) {
        setMessage("已从资产库恢复产品资料和脚本创作简报，可直接调整后重新生成。");
      }
    } catch {
      setMessage("脚本草稿恢复失败，可继续新建内容。");
    } finally {
      setDraftReady(true);
    }
  }, []);

  useEffect(() => {
    if (!draftReady) return;
    try {
      window.localStorage.setItem(scriptDraftStorageKey, JSON.stringify(input));
    } catch {
      setMessage("脚本草稿自动保存失败，请检查本地存储空间。");
    }
  }, [draftReady, input]);

  function selectProduct(productId: string) {
    const product = data.products.find((item) => item.id === productId);
    if (!product) {
      setInput({ ...input, productId: "", productSnapshot: undefined });
      return;
    }
    setInput({ ...input, materialSource: "产品资料", ...productToScriptInputPatch(product) });
  }

  async function generate() {
    if (!input.productName.trim() || !input.targetAudience.trim() || !input.painPoint.trim() || !input.sellingPoint.trim()) {
      setMessage("请先补齐产品 / 业务名称、目标人群、用户痛点和核心卖点。");
      return;
    }
    if (input.contentType === "评论回复" && !input.comments?.trim()) {
      setMessage("评论回复需要先粘贴评论区内容。");
      return;
    }
    if (input.contentType === "直播切片" && !input.liveTranscript?.trim()) {
      setMessage("直播切片需要先粘贴直播口播片段。");
      return;
    }
    if (input.contentType === "脚本改写" && !input.originalScript?.trim()) {
      setMessage("脚本改写需要先粘贴原脚本。");
      return;
    }

    setLoading(true);
    setMessage("");
    const normalizedInput = normalizeScriptInput(input);
    try {
      const response = await fetch("/api/script/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildScriptGeneratePayload(normalizedInput))
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.message || payload.error || "AI 生成失败");
      }
      const result = payload.result as ScriptGenerateResult;
      const record = scriptResultToRecord(result, normalizedInput);
      setGenerated(record);
      saveScriptRecord(record);
      assetFromScriptRecord(record);
      refresh();
      setMessage(payload.source === "fallback" ? payload.message || "已使用本地规则生成脚本，并自动保存到资产库。" : "已使用 AI 生成脚本，并自动保存到资产库。");
    } catch (error) {
      const fallbackRecord = generateLocalScript(normalizedInput);
      setGenerated(fallbackRecord);
      saveScriptRecord(fallbackRecord);
      assetFromScriptRecord(fallbackRecord);
      refresh();
      setMessage(`${error instanceof Error ? error.message : "AI 请求失败"}，已自动使用本地规则生成并保存到资产库。`);
    } finally {
      setLoading(false);
    }
  }

  function saveGenerated() {
    if (!generated) return;
    const saved = { ...generated, updatedAt: nowIso() };
    saveScriptRecord(saved);
    assetFromScriptRecord(saved);
    refresh();
    setMessage("已保存到脚本资产和统一资产库。");
  }

  function saveDraftAsset() {
    const normalizedInput = normalizeScriptInput(input);
    if (!normalizedInput.productName.trim()) {
      setMessage("请至少填写产品 / 业务名称，再保存草稿。");
      return;
    }
    const draft = { ...generateLocalScript(normalizedInput), status: "草稿" as ScriptRecordStatus, updatedAt: nowIso() };
    saveScriptRecord(draft);
    assetFromScriptRecord(draft);
    setGenerated(draft);
    refresh();
    setMessage("草稿已保存到资产库，后续可以在资产库或脚本资产库找到。");
  }

  function fillExample() {
    setInput({
      ...defaultScriptInput,
      productName: "雅鹿羽绒服",
      targetAudience: "40 岁以上、冬天通勤、怕冷但又想穿得有气质的女性",
      painPoint: "怕显老、怕臃肿、怕不保暖、怕买贵",
      sellingPoint: "颜色显气色，中长款保暖，版型不臃肿，适合冬季通勤",
      contentType: "电商带货",
      contentFormat: "电商带货",
      videoGoal: "成交",
      speakingStyle: "老板口播",
      extra: "开头要犀利一点，适合老板口播，不要夸大宣传。"
    });
  }

  function resetScript() {
    setInput(defaultScriptInput);
    setGenerated(null);
    setTopicIdeas([]);
    setMessage("");
    window.localStorage.removeItem(scriptDraftStorageKey);
  }

  function buildCommentInsight() {
    if (!input.comments?.trim()) {
      setMessage("请先粘贴评论区内容。");
      return;
    }
    const insight = generateCommentInsights(input.comments);
    saveCommentInsightRecord(insight);
    setCommentInsight(insight);
    setTopicIdeas(insight.topicIdeas.split("\n").filter(Boolean));
    refresh();
    setMessage("已从评论区提炼用户问题、痛点和选题方向。");
  }

  return (
    <div className="desktop-page">
      <PageHeader
        eyebrow="AI 内容中台 / 脚本"
        title="脚本"
        description="输入产品、人群和内容目标，生成可直接拍摄的脚本。"
      />

      <div className="two-pane-grid">
        <SectionCard className="editor-strip pane-scroll">
          <CardHeader>
            <div className="flex items-start justify-between gap-4">
              <div>
                <CardTitle>创作简报</CardTitle>
                <CardDescription>补齐四个核心事实，剩下交给规则库和 AI。</CardDescription>
              </div>
              <Badge>高频入口</Badge>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 md:grid-cols-2">
              <Field label="素材来源">
                <Select value={input.materialSource} onChange={(event) => setInput({ ...input, materialSource: event.target.value as ScriptRecordMaterialSource })} options={scriptRecordMaterialSources.map(toOption)} />
              </Field>
              <Field label="选择产品资料">
                <Select value={input.productId || ""} onChange={(event) => selectProduct(event.target.value)} options={[{ label: "不选择，手动输入", value: "" }, ...data.products.map((item) => ({ label: item.name, value: item.id }))]} />
              </Field>
            </div>
            <ProductReferenceCard product={input.productSnapshot} />
            <Field label="产品 / 业务"><Input value={input.productName} onChange={(event) => setInput({ ...input, productName: event.target.value })} placeholder="例如：雅鹿安哥拉红中长款羽绒服" /></Field>
            <Field label="目标人群"><Textarea value={input.targetAudience} onChange={(event) => setInput({ ...input, targetAudience: event.target.value })} placeholder="例如：40 岁以上、冬天通勤、怕冷但又想穿得有气质的女性" /></Field>
            <Field label="用户痛点"><Textarea value={input.painPoint} onChange={(event) => setInput({ ...input, painPoint: event.target.value })} placeholder="例如：怕显老、怕臃肿、怕不保暖、怕买贵" /></Field>
            <Field label="核心卖点"><Textarea value={input.sellingPoint} onChange={(event) => setInput({ ...input, sellingPoint: event.target.value })} placeholder="例如：颜色显气色、中长款保暖、版型不臃肿、适合冬季通勤" /></Field>
            <Field label="发布平台">
              <Select value={input.platform} onChange={(event) => setInput({ ...input, platform: event.target.value as ScriptRecordPlatform })} options={scriptRecordPlatforms.map(toOption)} />
            </Field>
            <div className="grid gap-4 md:grid-cols-2">
              <Field label="内容类型">
                <Select value={input.contentType} onChange={(event) => setInput(applyContentType(input, event.target.value as ScriptRecordContentType))} options={scriptRecordContentTypes.map(toOption)} />
              </Field>
              <Field label="内容目的">
                <Select value={input.videoGoal} onChange={(event) => setInput({ ...input, videoGoal: event.target.value as ScriptRecordVideoGoal })} options={scriptRecordVideoGoals.map(toOption)} />
              </Field>
            </div>
            {input.materialSource === "评论区" || input.contentType === "评论回复" ? (
              <div className="rounded-2xl border border-slate-200/70 bg-white/70 p-4 dark:border-slate-800 dark:bg-slate-950/40">
                <Field label="评论区内容">
                  <Textarea className="min-h-32" value={input.comments || ""} onChange={(event) => setInput({ ...input, comments: event.target.value })} placeholder="粘贴高赞评论、用户提问、私信问题等。" />
                </Field>
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button type="button" variant="outline" size="sm" onClick={buildCommentInsight}><Sparkles className="h-4 w-4" />生成评论区选题</Button>
                </div>
                {commentInsight ? (
                  <div className="mt-4 grid gap-3">
                    <Info label="高频用户问题 / 痛点" value={commentInsight.painPoints} />
                    <Info label="购买顾虑" value={commentInsight.objections} />
                    <Info label="评论回复话术" value={commentInsight.replyScripts} />
                  </div>
                ) : null}
              </div>
            ) : null}
            {input.contentType === "直播切片" ? (
              <Field label="直播口播片段"><Textarea className="min-h-32" value={input.liveTranscript || ""} onChange={(event) => setInput({ ...input, liveTranscript: event.target.value })} placeholder="粘贴直播间原话，系统会帮你提炼可剪切片。" /></Field>
            ) : null}
            {input.contentType === "脚本改写" ? (
              <div className="rounded-2xl border border-slate-200/70 bg-white/70 p-4 dark:border-slate-800 dark:bg-slate-950/40">
                <Field label="原脚本"><Textarea className="min-h-36" value={input.originalScript || ""} onChange={(event) => setInput({ ...input, originalScript: event.target.value })} placeholder="粘贴需要改写的原脚本。" /></Field>
                <div className="mt-4">
                  <Field label="改写目标"><Select value={input.rewriteGoal || "更犀利"} onChange={(event) => setInput({ ...input, rewriteGoal: event.target.value })} options={rewriteGoalOptions.map(toOption)} /></Field>
                </div>
              </div>
            ) : null}
            <Field label="补充要求"><Textarea value={input.extra} onChange={(event) => setInput({ ...input, extra: event.target.value })} placeholder="可以写已有选题、平台、禁忌表达、口播人设等。" /></Field>

            <details className="rounded-2xl border border-slate-200/70 bg-white/60 p-4 dark:border-slate-800 dark:bg-slate-950/40">
              <summary className="cursor-pointer text-sm font-semibold text-slate-900 dark:text-slate-100">高级设置</summary>
              <div className="mt-4 grid gap-4">
                <div className="grid gap-4 md:grid-cols-2">
                  <Field label="视频时长"><Select value={input.duration} onChange={(event) => setInput({ ...input, duration: event.target.value })} options={["15秒", "30秒", "60秒", "90秒"].map(toOption)} /></Field>
                  <Field label="语气风格"><Select value={input.speakingStyle} onChange={(event) => setInput({ ...input, speakingStyle: event.target.value })} options={scriptToneOptions.map(toOption)} /></Field>
                </div>
                <Field label="拍摄场景"><Select value={input.scene} onChange={(event) => setInput({ ...input, scene: event.target.value })} options={scriptSceneOptions.map(toOption)} /></Field>
                <div className="grid gap-2">
                  <CheckLine label="生成分镜建议" checked={input.needShotList} onChange={(checked) => setInput({ ...input, needShotList: checked })} />
                  <CheckLine label="生成画中画建议" checked={input.needOverlay} onChange={(checked) => setInput({ ...input, needOverlay: checked })} />
                  <CheckLine label="进行风控检查" checked={input.includeRiskCheck !== false} onChange={(checked) => setInput({ ...input, includeRiskCheck: checked })} />
                  <CheckLine label="生成封面标题" checked={input.includeCoverTitle !== false && input.needTitle} onChange={(checked) => setInput({ ...input, includeCoverTitle: checked, needTitle: checked })} />
                </div>
              </div>
            </details>

            {message ? <p className="rounded-2xl bg-slate-100 px-4 py-3 text-sm text-slate-600 dark:bg-slate-800 dark:text-slate-300">{message}</p> : null}
            {topicIdeas.length > 0 ? (
              <div className="rounded-2xl border border-slate-200/70 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
                <div className="text-sm font-semibold text-slate-950 dark:text-slate-100">选题参考</div>
                <div className="mt-3 space-y-2">
                  {topicIdeas.map((item) => (
                    <button key={item} type="button" onClick={() => setInput({ ...input, extra: `${input.extra ? `${input.extra}\n` : ""}选题：${item}` })} className="block w-full rounded-xl bg-slate-50 px-3 py-2 text-left text-sm text-slate-600 transition-colors hover:bg-slate-100 dark:bg-slate-950/50 dark:text-slate-300 dark:hover:bg-slate-800">
                      {item}
                    </button>
                  ))}
                </div>
              </div>
            ) : null}
            <div className="mt-2 flex flex-wrap items-center gap-2 rounded-2xl border border-slate-200/70 bg-white/70 p-3 backdrop-blur dark:border-slate-800/80 dark:bg-slate-950/40">
              <Button onClick={generate} disabled={loading}><WandSparkles className="h-4 w-4" />{loading ? "生成中..." : "生成脚本"}</Button>
              <Button variant="outline" onClick={saveDraftAsset}><Save className="h-4 w-4" />保存草稿</Button>
              <Button variant="ghost" onClick={() => setTopicIdeas(generateTopicIdeas(normalizeScriptInput(input)))}>选题参考</Button>
              <Button variant="ghost" onClick={fillExample}>示例</Button>
              <Button variant="ghost" onClick={resetScript}>清空</Button>
            </div>
          </CardContent>
        </SectionCard>

        <ScriptOutput script={generated} onSave={saveGenerated} onRegenerate={generate} loading={loading} />
      </div>
    </div>
  );
}

export function ScriptsLibraryPage() {
  const router = useRouter();
  const { data, refresh } = useSimpleData();
  const [keyword, setKeyword] = useState("");
  const [contentType, setContentType] = useState("全部");
  const [product, setProduct] = useState("全部");
  const [platform, setPlatform] = useState("全部");
  const [contentFormat, setContentFormat] = useState("全部");
  const [videoGoal, setVideoGoal] = useState("全部");
  const [status, setStatus] = useState("全部");
  const [favorite, setFavorite] = useState("全部");
  const [reviewed, setReviewed] = useState("全部");
  const [performance, setPerformance] = useState("全部");
  const [sort, setSort] = useState("最新修改");

  const productOptions = useMemo(() => Array.from(new Set(data.scripts.map((item) => item.productName).filter(Boolean))), [data.scripts]);
  const filtered = useMemo(() => {
    const list = data.scripts.filter((item) => {
      const text = [item.title, item.productName, item.targetAudience, item.tags, item.scriptText].join(" ");
      return (
        (!keyword.trim() || text.includes(keyword.trim())) &&
        (contentType === "全部" || item.contentType === contentType) &&
        (product === "全部" || item.productName === product) &&
        (platform === "全部" || item.platform === platform) &&
        (contentFormat === "全部" || item.contentFormat === contentFormat) &&
        (videoGoal === "全部" || item.videoGoal === videoGoal) &&
        (status === "全部" || item.status === status) &&
        (favorite === "全部" || (favorite === "已收藏" ? item.favorite : !item.favorite)) &&
        (reviewed === "全部" || (reviewed === "已复盘" ? Boolean(item.reviewId) : !item.reviewId)) &&
        (performance === "全部" || item.performanceLevel === performance)
      );
    });
    return [...list].sort((a, b) => sort === "最早创建" ? a.createdAt.localeCompare(b.createdAt) : b.updatedAt.localeCompare(a.updatedAt));
  }, [contentFormat, contentType, data.scripts, favorite, keyword, performance, platform, product, reviewed, sort, status, videoGoal]);

  function updateStatus(item: ScriptRecord, nextStatus: ScriptRecordStatus) {
    const saved = { ...item, status: nextStatus, updatedAt: nowIso() };
    saveScriptRecord(saved);
    assetFromScriptRecord(saved);
    refresh();
  }

  function toggleFavorite(item: ScriptRecord) {
    const saved = { ...item, favorite: !item.favorite, updatedAt: nowIso() };
    saveScriptRecord(saved);
    assetFromScriptRecord(saved);
    refresh();
  }

  function remove(id: string) {
    deleteScriptRecord(id);
    refresh();
  }

  return (
    <div className="desktop-page">
      <PageHeader
        eyebrow="AI 内容中台 / 资产库 / 脚本资产"
        title="脚本资产库"
        description="集中查看、搜索、复用和修改历史脚本。后续会统一收纳到资产库。"
      />

      <SectionCard className="mb-6">
        <CardContent className="space-y-3 p-4">
          <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_150px_150px_150px_120px]">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <Input className="pl-9" value={keyword} onChange={(event) => setKeyword(event.target.value)} placeholder="搜索标题、产品、人群、标签、正文" />
            </div>
            <Select value={product} onChange={(event) => setProduct(event.target.value)} options={[{ label: "全部产品", value: "全部" }, ...productOptions.map(toOption)]} />
            <Select value={platform} onChange={(event) => setPlatform(event.target.value)} options={[{ label: "全部平台", value: "全部" }, ...scriptRecordPlatforms.map(toOption)]} />
            <Select value={contentFormat} onChange={(event) => setContentFormat(event.target.value)} options={[{ label: "全部形式", value: "全部" }, ...scriptRecordContentFormats.map(toOption)]} />
            <Select value={favorite} onChange={(event) => setFavorite(event.target.value)} options={["全部", "已收藏", "未收藏"].map(toOption)} />
          </div>
          <details className="rounded-2xl border border-slate-200/70 bg-white/60 p-3 dark:border-slate-800 dark:bg-slate-950/35">
            <summary className="cursor-pointer text-sm font-semibold text-slate-700 dark:text-slate-300">更多筛选</summary>
            <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-6">
              <Select value={contentType} onChange={(event) => setContentType(event.target.value)} options={[{ label: "全部类型", value: "全部" }, ...scriptRecordContentTypes.map(toOption)]} />
              <Select value={videoGoal} onChange={(event) => setVideoGoal(event.target.value)} options={[{ label: "全部目的", value: "全部" }, ...scriptRecordVideoGoals.map(toOption)]} />
              <Select value={status} onChange={(event) => setStatus(event.target.value)} options={[{ label: "全部状态", value: "全部" }, ...scriptRecordStatuses.map(toOption)]} />
              <Select value={reviewed} onChange={(event) => setReviewed(event.target.value)} options={["全部", "已复盘", "未复盘"].map(toOption)} />
              <Select value={performance} onChange={(event) => setPerformance(event.target.value)} options={["全部", "表现好", "一般", "表现差"].map(toOption)} />
              <Select value={sort} onChange={(event) => setSort(event.target.value)} options={["最新修改", "最早创建"].map(toOption)} />
            </div>
          </details>
        </CardContent>
      </SectionCard>

      {filtered.length === 0 ? <EmptyState text="没有找到脚本。可以换个筛选条件，或先写一条脚本。" actionText="写脚本" onAction={() => router.push("/script-generator")} /> : null}
      <div className="grid gap-4 lg:grid-cols-2 2xl:grid-cols-3">
        {filtered.map((item) => (
          <ScriptCard
            key={item.id}
            item={item}
            onFavorite={() => toggleFavorite(item)}
            onStatus={(next) => updateStatus(item, next)}
            onDelete={() => remove(item.id)}
          />
        ))}
      </div>
    </div>
  );
}

export function ScriptDetailPage({ scriptId }: { scriptId: string }) {
  const router = useRouter();
  const { data, refresh } = useSimpleData();
  const script = data.scripts.find((item) => item.id === scriptId);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<ScriptRecord | null>(script || null);
  const linkedReviews = data.reviews.filter((item) => item.scriptId === scriptId || item.id === script?.reviewId);

  useEffect(() => {
    setDraft(script || null);
  }, [script]);

  if (!script || !draft) {
    return (
      <div>
        <PageHeader title="脚本不存在" description="这条脚本可能已经删除，返回脚本资产库继续查看。" />
        <Button asChild><Link href="/scripts">返回脚本资产库</Link></Button>
      </div>
    );
  }
  const currentScript = script;

  function saveDraft() {
    if (!draft) return;
    const saved = { ...draft, updatedAt: nowIso() };
    saveScriptRecord(saved);
    assetFromScriptRecord(saved);
    setEditing(false);
    refresh();
  }

  function remove() {
    deleteScriptRecord(currentScript.id);
    router.push("/scripts");
  }

  function createSimilar() {
    const next = generateSimilarScript(currentScript);
    saveScriptRecord(next);
    assetFromScriptRecord(next);
    refresh();
    router.push(`/scripts/${next.id}`);
  }

  return (
    <div>
      <PageHeader eyebrow="AI 内容中台 / 资产库 / 脚本详情" title={currentScript.title} description="展示口播文案和关联复盘；脚本页现在只产出文案，旧的镜头/动作字段有内容时才会显示。" />

      <div className="mb-6 flex flex-wrap gap-2">
        <Button variant="outline" onClick={() => copyText(formatScript(script))}><Copy className="h-4 w-4" />复制完整脚本</Button>
        {script.shotSuggestions?.trim() ? (
          <Button variant="outline" onClick={() => copyText(script.shotSuggestions)}><Copy className="h-4 w-4" />复制分镜</Button>
        ) : null}
        <Button variant="outline" onClick={createSimilar}><Sparkles className="h-4 w-4" />生成相似脚本</Button>
        <Button onClick={() => setEditing(!editing)}><PenLine className="h-4 w-4" />{editing ? "取消编辑" : "编辑脚本"}</Button>
        <Button variant="destructive" onClick={remove}><Trash2 className="h-4 w-4" />删除</Button>
      </div>

      {editing ? (
        <SectionCard className="mb-6">
          <CardHeader><CardTitle>编辑脚本</CardTitle></CardHeader>
          <CardContent className="grid gap-4">
            <Field label="标题"><Input value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} /></Field>
            <div className="grid gap-4 md:grid-cols-3">
              <Field label="所属产品"><Input value={draft.productName} onChange={(event) => setDraft({ ...draft, productName: event.target.value })} /></Field>
              <Field label="状态"><Select value={draft.status} onChange={(event) => setDraft({ ...draft, status: event.target.value as ScriptRecordStatus })} options={scriptRecordStatuses.map(toOption)} /></Field>
              <Field label="标签"><Input value={draft.tags} onChange={(event) => setDraft({ ...draft, tags: event.target.value })} /></Field>
            </div>
            {draft.hook?.trim() ? <Field label="开头 3 秒钩子"><Textarea value={draft.hook} onChange={(event) => setDraft({ ...draft, hook: event.target.value })} /></Field> : null}
            <Field label="口播文案"><Textarea className="min-h-56" value={draft.scriptText} onChange={(event) => setDraft({ ...draft, scriptText: event.target.value })} /></Field>
            {draft.shotSuggestions?.trim() ? <Field label="分镜建议"><Textarea value={draft.shotSuggestions} onChange={(event) => setDraft({ ...draft, shotSuggestions: event.target.value })} /></Field> : null}
            {draft.overlaySuggestions?.trim() ? <Field label="画中画建议"><Textarea value={draft.overlaySuggestions} onChange={(event) => setDraft({ ...draft, overlaySuggestions: event.target.value })} /></Field> : null}
            {draft.shootingTips?.trim() ? <Field label="拍摄提醒"><Textarea value={draft.shootingTips} onChange={(event) => setDraft({ ...draft, shootingTips: event.target.value })} /></Field> : null}
            {draft.endingCTA?.trim() ? <Field label="结尾引导"><Textarea value={draft.endingCTA} onChange={(event) => setDraft({ ...draft, endingCTA: event.target.value })} /></Field> : null}
            <Button onClick={saveDraft}><Save className="h-4 w-4" />保存修改</Button>
          </CardContent>
        </SectionCard>
      ) : null}

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="space-y-4">
          {script.hook?.trim() ? <ReadableBlock title="开头 3 秒钩子" value={script.hook} /> : null}
          <ReadableBlock title="完整口播文案" value={script.scriptText} large />
          {script.shotSuggestions?.trim() ? <ReadableBlock title="分镜建议" value={script.shotSuggestions} /> : null}
          {script.overlaySuggestions?.trim() ? <ReadableBlock title="画中画建议" value={script.overlaySuggestions} /> : null}
          {script.shootingTips?.trim() ? <ReadableBlock title="拍摄提醒" value={script.shootingTips} /> : null}
          {script.endingCTA?.trim() ? <ReadableBlock title="结尾引导" value={script.endingCTA} /> : null}
          <RiskCheckBlock result={script.riskCheckResult} />
        </div>
        <div className="space-y-4">
          <SectionCard>
            <CardHeader><CardTitle>基础信息</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              <Info label="所属产品" value={script.productName || "未填写"} />
              <Info label="目标人群" value={script.targetAudience || "未填写"} />
              <Info label="发布平台" value={script.platform || "抖音"} />
              <Info label="内容形式" value={script.contentFormat || script.contentType} />
              <Info label="素材来源" value={script.materialSource || "手动输入"} />
              <Info label="内容类型" value={script.contentType} />
              <Info label="视频目的" value={script.videoGoal} />
              <Info label="状态" value={script.status} />
              <Info label="复盘表现" value={script.performanceLevel || "未复盘"} />
              <Info label="来源" value={script.sourceType || "脚本生成"} />
              {script.sourceDeconstructionId ? <Info label="来源拆片记录" value={script.sourceDeconstructionId} /> : null}
              <Info label="创建人" value={script.createdBy || "编导"} />
              <Info label="创建时间" value={formatDate(script.createdAt)} />
              <Info label="最后修改" value={formatDate(script.updatedAt)} />
            </CardContent>
          </SectionCard>
          <SectionCard>
            <CardHeader><CardTitle>复盘结果</CardTitle><CardDescription>数据复盘关联后会自动展示。</CardDescription></CardHeader>
            <CardContent className="space-y-3">
              {linkedReviews.length === 0 ? <EmptyState text="还没有关联复盘。" actionText="填写复盘" onAction={() => router.push("/reviews")} /> : null}
              {linkedReviews.map((item) => (
                <div key={item.id} className="rounded-2xl border border-slate-200/70 bg-slate-50/70 p-4 dark:border-slate-800 dark:bg-slate-950/40">
                  <div className="text-sm font-semibold text-slate-950 dark:text-slate-100">播放 {item.views || "未填"}｜完播 {item.completionRate || "未填"}</div>
                  <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-slate-600 dark:text-slate-300">{item.conclusion || "未填写结论"}</p>
                </div>
              ))}
            </CardContent>
          </SectionCard>
        </div>
      </div>
    </div>
  );
}

export function SimpleDeconstructionPage() {
  const { data, refresh } = useSimpleData();
  const [form, setForm] = useState<DeconstructionInput>({ title: "", sourceUrl: "", transcript: "", productName: "" });
  const [generated, setGenerated] = useState<SimpleDeconstructionRecord | null>(null);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");

  async function analyze() {
    if (!form.title.trim() && !form.transcript.trim()) {
      setMessage("请先填写爆款标题或口播内容。");
      return;
    }
    setLoading(true);
    setMessage("");
    try {
      const response = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "deconstruction",
          input: {
            videoTitle: form.title,
            videoContent: form.transcript,
            ownIndustry: form.productName || "本公司产品"
          }
        })
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "AI 拆解失败");
      const parsed = parseAiDeconstruction(String(payload.content || ""), form);
      setGenerated(parsed);
      saveSimpleDeconstructionRecord(parsed);
      saveDeconstructionAsset(parsed);
      refresh();
      setMessage("已使用 AI 拆解爆款结构，并自动保存到资产库。");
    } catch (error) {
      const fallback = generateLocalDeconstruction(form);
      setGenerated(fallback);
      saveSimpleDeconstructionRecord(fallback);
      saveDeconstructionAsset(fallback);
      refresh();
      setMessage(`${error instanceof Error ? error.message : "AI 请求失败"}，已自动使用本地规则拆解并保存到资产库。`);
    } finally {
      setLoading(false);
    }
  }

  function save() {
    if (!generated) return;
    const saved = { ...generated, updatedAt: nowIso() };
    saveSimpleDeconstructionRecord(saved);
    saveDeconstructionAsset(saved);
    refresh();
    setMessage("已保存拆解记录和统一资产。");
  }

  function saveResource() {
    if (!generated) return;
    saveResourceItem(deconstructionToResource(generated));
    refresh();
    setMessage("已保存到资料库。");
  }

  return (
    <div>
      <PageHeader eyebrow="AI 内容中台 / 拆片" title="拆结构，不抄文案" description="输入爆款标题、链接、逐字稿或大概内容，拆出可迁移结构，再作为脚本生成参考。" />
      <div className="grid gap-6 xl:grid-cols-[430px_minmax(0,1fr)]">
        <SectionCard>
          <CardHeader><CardTitle>录入爆款内容</CardTitle><CardDescription>保留必要字段，避免拆片变成复杂表单。</CardDescription></CardHeader>
          <CardContent className="space-y-4">
            <Field label="爆款视频标题"><Input value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} /></Field>
            <Field label="视频链接"><Input value={form.sourceUrl} onChange={(event) => setForm({ ...form, sourceUrl: event.target.value })} /></Field>
            <Field label="逐字稿或视频内容"><Textarea className="min-h-44" value={form.transcript} onChange={(event) => setForm({ ...form, transcript: event.target.value })} /></Field>
            <Field label="想迁移到的产品 / 业务"><Input value={form.productName} onChange={(event) => setForm({ ...form, productName: event.target.value })} /></Field>
            <div className="flex flex-wrap gap-2">
              <Button onClick={analyze} disabled={loading}><FileSearch className="h-4 w-4" />{loading ? "拆解中..." : "拆解爆款"}</Button>
              <Button variant="ghost" onClick={() => { setForm({ title: "", sourceUrl: "", transcript: "", productName: "" }); setGenerated(null); setMessage(""); }}>清空</Button>
            </div>
            {message ? <p className="rounded-2xl bg-slate-100 px-4 py-3 text-sm text-slate-600 dark:bg-slate-800 dark:text-slate-300">{message}</p> : null}
          </CardContent>
        </SectionCard>
        <div className="space-y-4">
          {generated ? (
            <DeconstructionResult item={generated} onSave={save} onSaveResource={saveResource} />
          ) : (
            <EmptyState text="录入内容后开始拆解，结果可以复制，也可以保存到资料库。" />
          )}
          <h2 className="pt-2 text-lg font-semibold text-slate-950 dark:text-slate-100">已保存拆解</h2>
          {data.deconstructions.map((item) => (
            <DeconstructionResult
              key={item.id}
              item={item}
              onSave={() => saveSimpleDeconstructionRecord(item)}
              onSaveResource={() => { saveResourceItem(deconstructionToResource(item)); refresh(); }}
              onDelete={() => { deleteSimpleDeconstructionRecord(item.id); refresh(); }}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

export function SimpleReviewsPage() {
  const { data, refresh } = useSimpleData();
  const [form, setForm] = useState<SimpleReviewRecord>(() => blankReview(data.scripts[0]?.id || ""));
  const [message, setMessage] = useState("");
  const selectedScript = data.scripts.find((item) => item.id === form.scriptId);

  useEffect(() => {
    if (!form.scriptId && data.scripts[0]?.id) {
      setForm((current) => ({ ...current, scriptId: data.scripts[0].id }));
    }
  }, [data.scripts, form.scriptId]);

  async function aiConclusion() {
    const local = generateReviewConclusion(form, selectedScript);
    try {
      const response = await fetch("/api/workflow-ai", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "reviewConclusion", input: { review: form, script: selectedScript } })
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "AI 复盘失败");
      const result = payload.result || {};
      setForm({
        ...form,
        conclusion: result.autoConclusion || result.conclusion || local.conclusion,
        successPoints: result.successPoints || local.successPoints,
        failurePoints: result.failurePoints || local.failurePoints,
        recommendAsCase: typeof result.recommendAsCase === "boolean" ? result.recommendAsCase : local.recommendAsCase
      });
      setMessage("已使用 AI 生成复盘结论。");
    } catch (error) {
      setForm({
        ...form,
        conclusion: local.conclusion,
        successPoints: local.successPoints,
        failurePoints: local.failurePoints,
        recommendAsCase: local.recommendAsCase
      });
      setMessage(`${error instanceof Error ? error.message : "AI 请求失败"}，已自动使用本地规则生成复盘结论。`);
    }
  }

  function save() {
    if (!form.scriptId) {
      setMessage("请先关联脚本。");
      return;
    }
    const review = { ...form, updatedAt: nowIso() };
    saveSimpleReviewRecord(review);
    createAsset({
      id: `asset_review_${review.id}`,
      type: "review",
      title: selectedScript?.title ? `${selectedScript.title} - 复盘` : "数据复盘",
      summary: review.conclusion || review.nextOptimization || "复盘记录",
      content: formatReview(review, selectedScript),
      rawData: review,
      sourceModule: "review",
      platform: review.platform ? (review.platform === "视频号" ? "shipinhao" : review.platform === "小红书" ? "xiaohongshu" : review.platform === "快手" ? "kuaishou" : review.platform === "淘宝内容" ? "taobao" : review.platform === "朋友圈" ? "private" : "douyin") : "unknown",
      productName: selectedScript?.productName || "",
      tags: [review.performanceLevel || inferPerformanceLevel(review)].filter(Boolean),
      favorite: Boolean(review.recommendAsCase),
      status: "completed",
      createdAt: review.createdAt,
      updatedAt: review.updatedAt,
      linkedRecordIds: [review.id, review.scriptId].filter(Boolean),
    });
    if (selectedScript) {
      // 手动评价优先；自动判断缺数据（待评估）时不覆盖脚本上已有的历史评价
      const level = review.performanceLevel || inferPerformanceLevel(review);
      const savedScript = { ...selectedScript, reviewId: review.id, status: "已复盘" as ScriptRecordStatus, platform: review.platform || selectedScript.platform, performanceLevel: level === "待评估" ? selectedScript.performanceLevel : level, updatedAt: nowIso() };
      saveScriptRecord(savedScript);
      assetFromScriptRecord(savedScript);
    }
    refresh();
    setForm(blankReview(form.scriptId));
    setMessage("复盘已保存，并已关联到脚本资产。");
  }

  return (
    <div>
      <PageHeader eyebrow="AI 内容中台 / 数据复盘" title="简单复盘，沉淀下一条怎么改" description="复盘只保留真正高频的播放、留存、互动、转化和主观判断，结论可回写脚本资产。" />
      <div className="two-pane-grid">
        <SectionCard className="pane-scroll">
          <CardHeader><CardTitle>填写复盘</CardTitle><CardDescription>先选脚本，再补核心数据和判断。</CardDescription></CardHeader>
          <CardContent className="space-y-4">
            <Field label="关联脚本">
              <Select value={form.scriptId} onChange={(event) => {
                const script = data.scripts.find((item) => item.id === event.target.value);
                setForm({ ...form, scriptId: event.target.value, platform: script?.platform || form.platform || "" });
              }} options={[{ label: "请选择脚本", value: "" }, ...data.scripts.map((item) => ({ label: item.title, value: item.id }))]} />
            </Field>
            <div className="grid gap-3 md:grid-cols-2">
              <Field label="发布平台"><Select value={form.platform || ""} onChange={(event) => setForm({ ...form, platform: event.target.value as ScriptRecordPlatform })} options={[{ label: "请选择平台", value: "" }, ...scriptRecordPlatforms.map(toOption)]} /></Field>
              <Field label="复盘表现"><Select value={form.performanceLevel || ""} onChange={(event) => setForm({ ...form, performanceLevel: event.target.value as SimpleReviewRecord["performanceLevel"] })} options={[{ label: "自动判断/未定", value: "" }, ...["表现好", "一般", "表现差"].map(toOption)]} /></Field>
            </div>
            <p className="text-xs text-muted-foreground">自动判断只按固定阈值（播放≥1万、完播≥45%、点赞≥5%）给参考结论，没有结合账号基线；请以手动评价为准。没有数据时显示“待评估”。</p>
            <div className="grid gap-3 md:grid-cols-2">
              <Field label="播放量"><Input value={form.views} onChange={(event) => setForm({ ...form, views: event.target.value })} /></Field>
              <Field label="完播率"><Input value={form.completionRate} onChange={(event) => setForm({ ...form, completionRate: event.target.value })} /></Field>
            </div>
            <Field label="转化数据"><Textarea value={form.conversionData} onChange={(event) => setForm({ ...form, conversionData: event.target.value })} placeholder="商品点击、私信数、成交金额、直播间进入等。" /></Field>
            <div className="grid gap-3 md:grid-cols-2">
              <Field label="选题是否有效"><Select value={form.topicJudgement} onChange={(event) => setForm({ ...form, topicJudgement: event.target.value })} options={judgementOptions.map(toOption)} /></Field>
              <Field label="开头是否有效"><Select value={form.hookJudgement} onChange={(event) => setForm({ ...form, hookJudgement: event.target.value })} options={judgementOptions.map(toOption)} /></Field>
              <Field label="脚本是否清晰"><Select value={form.scriptJudgement} onChange={(event) => setForm({ ...form, scriptJudgement: event.target.value })} options={["清晰", "一般", "不清晰", "待观察"].map(toOption)} /></Field>
              <Field label="拍摄是否到位"><Select value={form.shootingJudgement} onChange={(event) => setForm({ ...form, shootingJudgement: event.target.value })} options={["到位", "一般", "不到位", "待观察"].map(toOption)} /></Field>
              <Field label="剪辑是否到位"><Select value={form.editingJudgement} onChange={(event) => setForm({ ...form, editingJudgement: event.target.value })} options={["到位", "一般", "不到位", "待观察"].map(toOption)} /></Field>
            </div>
            <Field label="问题归因"><Textarea value={form.problemReason} onChange={(event) => setForm({ ...form, problemReason: event.target.value })} /></Field>
            <Field label="下次优化方向"><Textarea value={form.nextOptimization} onChange={(event) => setForm({ ...form, nextOptimization: event.target.value })} /></Field>
            <Field label="复盘结论"><Textarea value={form.conclusion} onChange={(event) => setForm({ ...form, conclusion: event.target.value })} /></Field>
            <details className="rounded-2xl border border-slate-200/70 bg-white/60 p-4 dark:border-slate-800 dark:bg-slate-950/40">
              <summary className="cursor-pointer text-sm font-semibold text-slate-900 dark:text-slate-100">补充数据</summary>
              <div className="mt-4 grid gap-4">
                <Field label="发布时间"><Input type="datetime-local" value={form.publishTime} onChange={(event) => setForm({ ...form, publishTime: event.target.value })} /></Field>
                <div className="grid gap-3 md:grid-cols-2">
                  <Field label="5 秒留存"><Input value={form.fiveSecondRetention} onChange={(event) => setForm({ ...form, fiveSecondRetention: event.target.value })} placeholder="例如 42%" /></Field>
                  <Field label="平均播放时长"><Input value={form.avgWatchTime} onChange={(event) => setForm({ ...form, avgWatchTime: event.target.value })} /></Field>
                  <Field label="点赞"><Input value={form.likeRate} onChange={(event) => setForm({ ...form, likeRate: event.target.value })} /></Field>
                  <Field label="评论"><Input value={form.commentRate} onChange={(event) => setForm({ ...form, commentRate: event.target.value })} /></Field>
                  <Field label="收藏"><Input value={form.saveRate} onChange={(event) => setForm({ ...form, saveRate: event.target.value })} /></Field>
                </div>
                <div className="grid gap-4 md:grid-cols-2">
                  <Field label="成功点"><Textarea value={form.successPoints} onChange={(event) => setForm({ ...form, successPoints: event.target.value })} /></Field>
                  <Field label="失败点"><Textarea value={form.failurePoints} onChange={(event) => setForm({ ...form, failurePoints: event.target.value })} /></Field>
                </div>
                <CheckLine label="推荐沉淀为优秀案例" checked={form.recommendAsCase} onChange={(checked) => setForm({ ...form, recommendAsCase: checked })} />
              </div>
            </details>
            <div className="flex flex-wrap gap-2">
              <Button onClick={aiConclusion}><Sparkles className="h-4 w-4" />生成复盘结论</Button>
              <Button variant="outline" onClick={save}><Save className="h-4 w-4" />保存复盘</Button>
              <Button variant="ghost" onClick={() => setForm(blankReview(form.scriptId))}>清空</Button>
            </div>
            {message ? <p className="rounded-2xl bg-slate-100 px-4 py-3 text-sm text-slate-600 dark:bg-slate-800 dark:text-slate-300">{message}</p> : null}
          </CardContent>
        </SectionCard>

        <div className="pane-scroll space-y-4">
          {data.reviews.length === 0 ? <EmptyState text="还没有复盘记录。选择一条脚本，填写数据后保存。" /> : null}
          {data.reviews.map((item) => {
            const script = data.scripts.find((entry) => entry.id === item.scriptId);
            return (
    <Card key={item.id}>
                <CardHeader>
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <CardTitle>{script?.title || "未关联脚本"}</CardTitle>
                      <CardDescription>{item.platform || script?.platform || "未填平台"}｜播放 {item.views || "未填"}｜5 秒留存 {item.fiveSecondRetention || "未填"}｜完播 {item.completionRate || "未填"}</CardDescription>
                    </div>
                    <div className="flex flex-wrap justify-end gap-2">
                      {(item.performanceLevel || inferPerformanceLevel(item)) ? (
                        <Badge variant="secondary">
                          {item.performanceLevel ? item.performanceLevel : `${inferPerformanceLevel(item)}（自动参考）`}
                        </Badge>
                      ) : null}
                      {item.recommendAsCase ? <Badge>优秀案例</Badge> : null}
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="space-y-3">
                  <Info label="复盘结论" value={item.conclusion || "未填写"} />
                  <Info label="下次优化" value={item.nextOptimization || "未填写"} />
                  <div className="flex flex-wrap gap-2">
                    <Button size="sm" variant="outline" onClick={() => copyText(formatReview(item, script))}><Copy className="h-4 w-4" />复制</Button>
                    <Button size="sm" variant="outline" onClick={() => setForm(item)}><PenLine className="h-4 w-4" />编辑</Button>
                    <Button size="sm" variant="destructive" onClick={() => { deleteSimpleReviewRecord(item.id); refresh(); }}><Trash2 className="h-4 w-4" />删除</Button>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      </div>
    </div>
  );
}

export function ResourcesCenterPage() {
  const { data, refresh } = useSimpleData();
  const [resource, setResource] = useState<ResourceItem>(() => blankResource());
  const [product, setProduct] = useState<ProductRecord>(() => blankProduct());
  const [productDocument, setProductDocument] = useState<File | null>(null);
  const [productDocumentInputKey, setProductDocumentInputKey] = useState(0);
  const [productImporting, setProductImporting] = useState(false);
  const [productImportMessage, setProductImportMessage] = useState("");
  const [typeFilter, setTypeFilter] = useState("全部");
  const resourceCards = [
    { title: "产品资料", description: "产品事实、卖点、痛点、禁忌词和素材条件。", href: "#product-records", icon: Package, count: data.products.length },
    { title: "内容资产", description: "成功案例、失败案例、爆款开头、高转化脚本等。", href: "/assets", icon: Star, count: data.pipeline.contentAssets.length },
    { title: "编导方法库", description: "开头、痛点、卖点、分镜、画中画、结尾成交方法。", href: "/methods", icon: BookOpen, count: data.pipeline.directorMethods.length },
    { title: "项目资料", description: "项目、行业、人群、目标和负责人信息。", href: "/projects", icon: Layers3, count: data.pipeline.projects.length },
    { title: "分镜拍摄表", description: "已生成的分镜和拍摄执行清单。", href: "/shot-lists", icon: Clapperboard, count: data.pipeline.shotLists.length },
    { title: "视频任务记录", description: "完整任务卡、负责人、审核流和协作记录。", href: "/video-tasks", icon: MoreHorizontal, count: data.pipeline.videoTasks.length },
    { title: "剪辑说明单", description: "低频辅助交付物，按需进入查看。", href: "/edit-briefs", icon: MoreHorizontal, count: data.pipeline.editBriefs.length },
    { title: "发布运营记录", description: "发布标题、文案、话题和平台承接记录。", href: "/publishing", icon: MoreHorizontal, count: data.pipeline.publishPlans.length }
  ];
  const resourceTypes = Array.from(new Set(data.resources.map((item) => item.type).filter(Boolean)));
  const filtered = typeFilter === "全部" ? data.resources : data.resources.filter((item) => item.type === typeFilter);

  function saveResource() {
    if (!resource.title.trim()) return;
    saveResourceItem({ ...resource, updatedAt: nowIso() });
    setResource(blankResource());
    refresh();
  }

  function saveProduct() {
    if (!product.name.trim()) return;
    saveProductAndAsset(product);
    setProduct(blankProduct());
    refresh();
  }

  function saveProductAndAsset(input: ProductRecordSaveInput) {
    const savedProduct = saveProductRecord(input);
    createAsset({
      id: `asset_product_${savedProduct.id}`,
      type: "product",
      title: savedProduct.name,
      summary: savedProduct.coreSellingPoints || savedProduct.category || "产品资料",
      content: formatProduct(savedProduct),
      rawData: savedProduct,
      sourceModule: "manual",
      platform: "unknown",
      productId: savedProduct.id,
      productName: savedProduct.name,
      tags: [savedProduct.category].filter(Boolean),
      favorite: false,
      status: "completed",
      createdAt: savedProduct.createdAt,
      updatedAt: savedProduct.updatedAt,
      linkedRecordIds: [savedProduct.id],
    });
    return savedProduct;
  }

  async function importProductDocument() {
    if (!productDocument) {
      setProductImportMessage("请先选择 .docx 产品资料文档。");
      return;
    }

    setProductImporting(true);
    setProductImportMessage("");
    try {
      const formData = new FormData();
      formData.append("file", productDocument);
      const response = await fetch("/api/products/import-word", {
        method: "POST",
        body: formData
      });
      const payload = await response.json();
      if (!response.ok || !payload.success) {
        throw new Error(payload.message || "Word 产品资料解析失败。");
      }

      const imported = payload.product as ProductRecordSaveInput | undefined;
      if (!imported || typeof imported.name !== "string" || !imported.name.trim()) {
        throw new Error("Word 文档没有解析出有效产品名称，未保存任何资料。");
      }

      const saved = saveProductAndAsset(imported);
      setProduct(saved);
      setProductDocument(null);
      setProductDocumentInputKey((current) => current + 1);
      refresh();
      const extra = payload.truncated ? " 文档较长，已保留前 20 万字。" : "";
      setProductImportMessage(`${payload.message || "Word 产品资料已解析。"} 已保存到产品资料库。${extra} 可在下方继续核对和编辑。`);
    } catch (error) {
      setProductImportMessage(error instanceof Error ? error.message : "Word 产品资料解析失败，请稍后重试。");
    } finally {
      setProductImporting(false);
    }
  }

  return (
    <div>
      <PageHeader eyebrow="AI 内容中台 / 资料库" title="资料库" description="产品资料优先维护，其他底层资料统一收纳在这里，供脚本、拆片和生图复用。" />
      <div className="mb-5">
        <div className="mb-3 text-sm font-semibold text-slate-950 dark:text-slate-100">资料分类</div>
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        {resourceCards.map((item) => {
          const Icon = item.icon;
          return (
            <Link key={item.title} href={item.href} className="group">
              <Card className="h-full transition-colors hover:border-slate-300 dark:hover:border-slate-700">
                <CardHeader className="p-4">
                  <div className="mb-2 flex items-center justify-between gap-3">
                    <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300">
                      <Icon className="h-4 w-4" />
                    </div>
                    <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-500 dark:bg-slate-800 dark:text-slate-400">{item.count}</span>
                  </div>
                  <CardTitle>{item.title}</CardTitle>
                  <CardDescription className="line-clamp-2">{item.description}</CardDescription>
                </CardHeader>
              </Card>
            </Link>
          );
        })}
      </div>
      </div>

      <div id="product-records" className="mb-6 grid gap-5 xl:grid-cols-[420px_minmax(0,1fr)]">
        <SectionCard className="xl:sticky xl:top-6 xl:max-h-[calc(100vh-7rem)] xl:overflow-y-auto xl:pr-2 scrollbar-subtle">
          <CardHeader><CardTitle>产品资料轻量库</CardTitle><CardDescription>脚本生成时可选择产品，自动带入卖点、痛点和禁忌词。</CardDescription></CardHeader>
          <CardContent className="space-y-4">
            <div className="rounded-2xl border border-slate-200/70 bg-slate-50/70 p-4 dark:border-slate-800 dark:bg-slate-950/40">
              <div className="text-sm font-semibold text-slate-900 dark:text-slate-100">从 Word 导入</div>
              <p className="mt-1 text-xs leading-5 text-slate-500 dark:text-slate-400">支持 .docx。解析成功后会保存为产品资料，并可继续手动修改。</p>
              <div className="mt-3 grid gap-3">
                <Input
                  key={productDocumentInputKey}
                  type="file"
                  accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                  onChange={(event) => {
                    setProductDocument(event.target.files?.[0] || null);
                    setProductImportMessage("");
                  }}
                />
                <Button type="button" variant="outline" disabled={!productDocument || productImporting} onClick={importProductDocument}>
                  {productImporting ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                  {productImporting ? "正在解析" : "解析并保存"}
                </Button>
                {productImportMessage ? <p className="text-xs leading-5 text-slate-600 dark:text-slate-300">{productImportMessage}</p> : null}
              </div>
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              <Field label="产品名称"><Input value={product.name} onChange={(event) => setProduct({ ...product, name: event.target.value })} /></Field>
              <Field label="品类"><Input value={product.category} onChange={(event) => setProduct({ ...product, category: event.target.value })} /></Field>
              <Field label="价格/价格区间"><Input value={product.priceRange} onChange={(event) => setProduct({ ...product, priceRange: event.target.value })} /></Field>
              <Field label="目标人群"><Input value={product.targetAudience} onChange={(event) => setProduct({ ...product, targetAudience: event.target.value })} /></Field>
            </div>
            <Field label="核心卖点"><Textarea value={product.coreSellingPoints} onChange={(event) => setProduct({ ...product, coreSellingPoints: event.target.value })} /></Field>
            <Field label="次级卖点"><Textarea value={product.secondarySellingPoints} onChange={(event) => setProduct({ ...product, secondarySellingPoints: event.target.value })} /></Field>
            <Field label="用户痛点"><Textarea value={product.painPoints} onChange={(event) => setProduct({ ...product, painPoints: event.target.value })} /></Field>
            <Field label="用户顾虑"><Textarea value={product.objections} onChange={(event) => setProduct({ ...product, objections: event.target.value })} /></Field>
            <details className="rounded-2xl border border-slate-200/70 bg-white/60 p-4 dark:border-slate-800 dark:bg-slate-950/40">
              <summary className="cursor-pointer text-sm font-semibold text-slate-900 dark:text-slate-100">更多产品事实</summary>
              <div className="mt-4 grid gap-4">
                <div className="grid gap-4 md:grid-cols-2">
                  <Field label="品牌"><Input value={product.brandName || ""} onChange={(event) => setProduct({ ...product, brandName: event.target.value })} /></Field>
                  <Field label="颜色/款式"><Input value={product.colors || ""} onChange={(event) => setProduct({ ...product, colors: event.target.value })} /></Field>
                </div>
                <Field label="产品基础事实"><Textarea value={product.productFacts || ""} onChange={(event) => setProduct({ ...product, productFacts: event.target.value })} /></Field>
                <Field label="规格参数"><Textarea value={product.specifications || ""} onChange={(event) => setProduct({ ...product, specifications: event.target.value })} /></Field>
                <Field label="使用场景"><Textarea value={product.useScenarios} onChange={(event) => setProduct({ ...product, useScenarios: event.target.value })} /></Field>
                <Field label="竞品对比点"><Textarea value={product.competitorComparison} onChange={(event) => setProduct({ ...product, competitorComparison: event.target.value })} /></Field>
                <Field label="评论/买家反馈"><Textarea value={product.buyerFeedback} onChange={(event) => setProduct({ ...product, buyerFeedback: event.target.value })} /></Field>
                <Field label="常见问题"><Textarea value={product.faq || ""} onChange={(event) => setProduct({ ...product, faq: event.target.value })} /></Field>
                <Field label="客服话术"><Textarea value={product.customerServiceScript || ""} onChange={(event) => setProduct({ ...product, customerServiceScript: event.target.value })} /></Field>
                <Field label="禁忌词"><Textarea value={product.forbiddenWords} onChange={(event) => setProduct({ ...product, forbiddenWords: event.target.value })} placeholder="例如：全网最低、100%、治疗等" /></Field>
                <Field label="不能承诺的内容"><Textarea value={product.forbiddenClaims} onChange={(event) => setProduct({ ...product, forbiddenClaims: event.target.value })} /></Field>
                <Field label="证据材料"><Textarea value={product.proofMaterials || ""} onChange={(event) => setProduct({ ...product, proofMaterials: event.target.value })} /></Field>
                <Field label="素材链接/备注"><Textarea value={product.materialLinks} onChange={(event) => setProduct({ ...product, materialLinks: event.target.value })} /></Field>
                <Field label="其他备注"><Textarea value={product.notes || ""} onChange={(event) => setProduct({ ...product, notes: event.target.value })} /></Field>
              </div>
            </details>
            <div className="flex flex-wrap gap-2">
              <Button onClick={saveProduct}><Save className="h-4 w-4" />保存产品资料</Button>
              <Button variant="ghost" onClick={() => setProduct(blankProduct())}>清空</Button>
            </div>
          </CardContent>
        </SectionCard>
        <div className="space-y-4 xl:max-h-[calc(100vh-7rem)] xl:overflow-y-auto xl:pr-2 scrollbar-subtle">
          {data.products.length === 0 ? <EmptyState text="还没有产品资料。先建一张产品卡，脚本生成会更稳。" /> : null}
          {data.products.map((item) => (
            <Card key={item.id}>
              <CardHeader>
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <CardTitle>{item.name}</CardTitle>
                    <CardDescription>{item.category || "未填写品类"}｜{item.priceRange || "未填写价格"}{item.sourceType === "word" ? `｜Word：${item.sourceDocumentName || "已导入"}` : ""}</CardDescription>
                  </div>
                  <Badge variant="secondary">{item.forbiddenWords ? "含风控词" : "可调用"}</Badge>
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                <Info label="核心卖点" value={item.coreSellingPoints} />
                <Info label="用户痛点" value={item.painPoints} />
                <Info label="禁忌词 / 不能承诺" value={[item.forbiddenWords, item.forbiddenClaims].filter(Boolean).join("\n")} />
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" variant="outline" onClick={() => copyText(formatProduct(item))}><Copy className="h-4 w-4" />复制</Button>
                  <Button size="sm" variant="outline" onClick={() => setProduct(item)}><PenLine className="h-4 w-4" />编辑</Button>
                  <Button size="sm" variant="destructive" onClick={() => { deleteProductRecord(item.id); refresh(); }}><Trash2 className="h-4 w-4" />删除</Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>

      <div className="grid gap-5 xl:grid-cols-[420px_minmax(0,1fr)]">
        <SectionCard>
          <CardHeader><CardTitle>其他沉淀资料</CardTitle><CardDescription>手动保存团队临时方法、素材链接或复盘结论。</CardDescription></CardHeader>
          <CardContent className="space-y-4">
            <Field label="资料类型"><Input value={resource.type} onChange={(event) => setResource({ ...resource, type: event.target.value })} placeholder="例如：其他沉淀资料 / 拆片结构 / 素材链接" /></Field>
            <Field label="标题"><Input value={resource.title} onChange={(event) => setResource({ ...resource, title: event.target.value })} /></Field>
            <Field label="内容"><Textarea className="min-h-44" value={resource.content} onChange={(event) => setResource({ ...resource, content: event.target.value })} /></Field>
            <Field label="标签"><Input value={resource.tags} onChange={(event) => setResource({ ...resource, tags: event.target.value })} /></Field>
            <Button onClick={saveResource}><Save className="h-4 w-4" />保存资料</Button>
          </CardContent>
        </SectionCard>
        <div className="space-y-4">
          <div className="max-w-xs">
            <Select value={typeFilter} onChange={(event) => setTypeFilter(event.target.value)} options={[{ label: "全部资料", value: "全部" }, ...resourceTypes.map(toOption)]} />
          </div>
          {filtered.length === 0 ? <EmptyState text="还没有其他沉淀资料。拆片结果也可以一键保存到这里。" /> : null}
          {filtered.map((item) => (
            <Card key={item.id}>
              <CardHeader>
                <CardTitle>{item.title}</CardTitle>
                <CardDescription>{item.type}｜{item.tags || "未打标签"}</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <p className="whitespace-pre-wrap text-sm leading-7 text-slate-600 dark:text-slate-300">{item.content}</p>
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" variant="outline" onClick={() => copyText(item.content)}><Copy className="h-4 w-4" />复制</Button>
                  <Button size="sm" variant="outline" onClick={() => setResource(item)}><PenLine className="h-4 w-4" />编辑</Button>
                  <Button size="sm" variant="destructive" onClick={() => { deleteResourceItem(item.id); refresh(); }}><Trash2 className="h-4 w-4" />删除</Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </div>
  );
}

function ScriptOutput({ script, onSave, onRegenerate, loading }: { script: ScriptRecord | null; onSave: () => void; onRegenerate: () => void; loading?: boolean }) {
  if (!script) {
    return (
    <SectionCard className="editor-strip pane-scroll min-h-[460px]">
        <CardHeader>
          <CardTitle>生成结果</CardTitle>
          <CardDescription>生成后会输出标题、钩子、正文、分镜、画中画、拍摄提醒、结尾引导和风控检查。</CardDescription>
        </CardHeader>
        <CardContent>
          <EmptyState text="左侧填写信息后点击生成脚本。" />
        </CardContent>
      </SectionCard>
    );
  }

  return (
    <SectionCard className="editor-strip pane-scroll">
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <Badge className="mb-3">可拍摄脚本</Badge>
            <CardTitle>{script.title}</CardTitle>
            <CardDescription>{script.productName}｜{script.platform || "抖音"}｜{script.contentFormat || script.contentType}｜{script.videoGoal}</CardDescription>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" onClick={onSave}><Save className="h-4 w-4" />保存到资产库</Button>
            <Button variant="outline" size="sm" onClick={() => copyText(formatScript(script))}><Copy className="h-4 w-4" />复制全文</Button>
            <Button variant="ghost" size="sm" onClick={onRegenerate} disabled={loading}><RefreshCw className="h-4 w-4" />重新生成</Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <ReadableBlock title="标题" value={script.title} />
        <ReadableBlock title="开头 3 秒钩子" value={script.hook} />
        <ReadableBlock title={script.contentFormat === "图文笔记" ? "完整图文内容" : script.contentType === "产品卖点提炼" ? "卖点提炼结果" : "完整脚本"} value={script.scriptText} large />
        <ReadableBlock title="分镜建议" value={script.shotSuggestions} />
        <ReadableBlock title="画中画建议" value={script.overlaySuggestions} />
        <ReadableBlock title="拍摄提醒" value={script.shootingTips} />
        <ReadableBlock title="结尾引导" value={script.endingCTA} />
        <RiskCheckBlock result={script.riskCheckResult} />
      </CardContent>
    </SectionCard>
  );
}

function ScriptCard({
  item,
  onFavorite,
  onStatus,
  onDelete
}: {
  item: ScriptRecord;
  onFavorite: () => void;
  onStatus: (status: ScriptRecordStatus) => void;
  onDelete: () => void;
}) {
  return (
    <Card className="group h-full overflow-hidden transition-colors duration-150 hover:border-input">
      <CardHeader>
        <div className="mb-2 flex items-start justify-between gap-3">
          <div className="flex flex-wrap gap-2">
            <Badge>{item.platform || "抖音"}</Badge>
            <Badge variant="secondary">{item.contentFormat || item.contentType}</Badge>
            <Badge variant="secondary">{item.status}</Badge>
            {item.reviewId ? <Badge variant="secondary">已复盘</Badge> : null}
            {item.performanceLevel ? <Badge variant="secondary">{item.performanceLevel}</Badge> : null}
          </div>
          <button type="button" onClick={onFavorite} className={cn("rounded-full p-1.5 transition-colors hover:bg-slate-100 dark:hover:bg-slate-800", item.favorite ? "text-rose-500" : "text-slate-400")}>
            <Heart className={cn("h-4 w-4", item.favorite && "fill-current")} />
          </button>
        </div>
        <Link href={`/scripts/${item.id}`} className="block">
          <CardTitle className="line-clamp-2 leading-6 transition-colors group-hover:text-slate-700 dark:group-hover:text-slate-300">{item.title}</CardTitle>
          <CardDescription className="mt-2 line-clamp-2">{item.productName || "未填写产品"}｜{item.videoGoal}｜{item.targetAudience || "未填写人群"}</CardDescription>
        </Link>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="line-clamp-3 rounded-2xl border border-slate-200/70 bg-white/60 p-3 text-sm leading-6 text-slate-600 dark:border-slate-800 dark:bg-slate-950/40 dark:text-slate-300">{item.hook || item.scriptText}</p>
        <div className="flex items-center justify-between gap-3 text-xs text-slate-400">
          <span>{formatDate(item.updatedAt)}</span>
          <span>{item.createdBy || "编导"}</span>
        </div>
        <div className="flex flex-wrap gap-2">
          <Select className="h-8 w-28 rounded-lg text-xs" value={item.status} onChange={(event) => onStatus(event.target.value as ScriptRecordStatus)} options={scriptRecordStatuses.map(toOption)} />
          <Button size="sm" variant="outline" onClick={() => copyText(formatScript(item))}><Copy className="h-4 w-4" />复制</Button>
          <Button size="sm" variant="destructive" onClick={onDelete}><Trash2 className="h-4 w-4" />删除</Button>
        </div>
      </CardContent>
    </Card>
  );
}

function DeconstructionResult({
  item,
  onSave,
  onSaveResource,
  onDelete
}: {
  item: SimpleDeconstructionRecord;
  onSave: () => void;
  onSaveResource: () => void;
  onDelete?: () => void;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{item.title || "未命名拆解"}</CardTitle>
        <CardDescription>{item.sourceUrl || "未填写链接"}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <Info label="视频核心主题" value={item.coreTheme} />
        <Info label="开头钩子" value={item.hook} />
        <Info label="爆款元素" value={item.viralElements} />
        <Info label="内容结构" value={item.structure} />
        <Info label="情绪变化" value={item.emotionFlow} />
        <Info label="可迁移结构" value={item.reusableStructure} />
        <Info label="新选题" value={item.newTopicIdeas} />
        <Info label="新脚本方向" value={item.newScriptDirections} />
        <div className="flex flex-wrap gap-2">
          <Button size="sm" onClick={onSave}><Save className="h-4 w-4" />保存</Button>
          <Button size="sm" variant="outline" onClick={onSaveResource}><Boxes className="h-4 w-4" />存入资料库</Button>
          <Button size="sm" variant="outline" onClick={() => copyText(formatDeconstruction(item))}><Copy className="h-4 w-4" />复制</Button>
          {onDelete ? <Button size="sm" variant="destructive" onClick={onDelete}><Trash2 className="h-4 w-4" />删除</Button> : null}
        </div>
      </CardContent>
    </Card>
  );
}

function QuickAction({ title, description, onOpen, icon: Icon }: { title: string; description: string; onOpen: () => void; icon: typeof WandSparkles }) {
  return (
    <button type="button" onClick={onOpen} className="group h-full text-left">
      <Card className="h-full overflow-hidden transition-all duration-150 hover:-translate-y-px hover:border-input hover:shadow-[0_6px_20px_rgba(15,23,42,0.08)] dark:hover:border-white/15 dark:hover:shadow-none">
        <CardHeader className="p-4">
          <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-xl bg-accent/10 text-accent">
            <Icon className="h-5 w-5" />
          </div>
          <CardTitle>{title}</CardTitle>
          <CardDescription>{description}</CardDescription>
          <div className="mt-4 flex items-center gap-2 text-xs font-medium text-foreground">
            进入工作流
            <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-1" />
          </div>
        </CardHeader>
      </Card>
    </button>
  );
}

function ManagementCard({ title, description, action, onOpen, icon: Icon }: { title: string; description: string; action: string; onOpen: () => void; icon: typeof WandSparkles }) {
  return (
    <button type="button" onClick={onOpen} className="group h-full rounded-2xl border border-slate-200/70 bg-white/70 p-4 text-left transition-all hover:-translate-y-0.5 hover:border-slate-300 hover:bg-white dark:border-slate-800 dark:bg-slate-900/55 dark:hover:border-slate-700">
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300">
          <Icon className="h-5 w-5" />
        </div>
        <div className="min-w-0">
          <div className="text-sm font-semibold text-slate-950 dark:text-slate-100">{title}</div>
          <p className="mt-1 line-clamp-2 text-xs leading-5 text-slate-500 dark:text-slate-400">{description}</p>
          <div className="mt-3 inline-flex items-center gap-1.5 text-xs font-medium text-slate-700 dark:text-slate-300">
            {action}
            <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" />
          </div>
        </div>
      </div>
    </button>
  );
}

function DashboardList({ title, empty, onAction, children }: { title: string; empty: string; onAction: () => void; children: React.ReactNode }) {
  const hasChildren = Array.isArray(children) ? children.length > 0 : Boolean(children);
  return (
    <SectionCard className="editor-strip">
      <CardHeader>
        <div className="flex items-center justify-between gap-3">
          <CardTitle>{title}</CardTitle>
          <Button variant="ghost" size="sm" onClick={onAction}>查看</Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {hasChildren ? children : <EmptyState text={empty} />}
      </CardContent>
    </SectionCard>
  );
}

function ReminderInline({ title, description, onOpen }: { title: string; description: string; onOpen: () => void }) {
  return (
    <button type="button" onClick={onOpen} className="block w-full rounded-2xl border border-amber-200/70 bg-amber-50/70 p-4 text-left transition-colors hover:border-amber-300 hover:bg-amber-50 dark:border-amber-900/50 dark:bg-amber-950/25 dark:hover:border-amber-800">
      <div className="text-sm font-semibold text-amber-900 dark:text-amber-100">{title}</div>
      <p className="mt-1 text-xs leading-5 text-amber-700/80 dark:text-amber-200/75">{description}</p>
    </button>
  );
}

function ReminderCard({ title, value, description, onOpen }: { title: string; value: number | string; description: string; onOpen: () => void }) {
  return (
    <button type="button" onClick={onOpen} className="rounded-2xl border border-slate-200/70 bg-white/75 p-4 text-left transition-colors hover:border-slate-300 hover:bg-white dark:border-slate-800 dark:bg-slate-900/60 dark:hover:border-slate-700">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-sm font-semibold text-slate-950 dark:text-slate-100">{title}</div>
          <p className="mt-1 text-xs leading-5 text-slate-500 dark:text-slate-400">{description}</p>
        </div>
        <div className="rounded-xl bg-slate-100 px-3 py-1 text-lg font-semibold text-slate-950 dark:bg-slate-800 dark:text-slate-100">{value}</div>
      </div>
    </button>
  );
}

function ScriptRow({ item, onOpen }: { item: ScriptRecord; onOpen: () => void }) {
  return (
    <button type="button" onClick={onOpen} className="block w-full rounded-2xl border border-border bg-card p-4 text-left transition-colors hover:border-input hover:bg-muted/40">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="line-clamp-1 text-sm font-semibold text-slate-950 dark:text-slate-100">{item.title}</div>
          <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">{item.productName || "未填写产品"}｜{item.status}</div>
        </div>
        {item.favorite ? <Heart className="h-4 w-4 shrink-0 fill-current text-rose-500" /> : null}
      </div>
    </button>
  );
}

function DeconstructionRow({ item, onOpen }: { item: SimpleDeconstructionRecord; onOpen: () => void }) {
  return (
    <button type="button" onClick={onOpen} className="block w-full rounded-2xl border border-border bg-card p-4 text-left transition-colors hover:border-input hover:bg-muted/40">
      <div className="line-clamp-1 text-sm font-semibold text-slate-950 dark:text-slate-100">{item.sourceTitle || item.rewrittenTitle || item.title || "未命名拆片"}</div>
      <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">{item.platform || "未知平台"}｜{item.status === "failed" ? "失败" : "已完成"}</div>
    </button>
  );
}

function AssetRow({ item, onOpen }: { item: ContentAsset; onOpen: () => void }) {
  const typeMap: Record<string, string> = {
    script: "脚本",
    deconstruction: "拆片",
    image_prompt: "生图",
    image_project: "生图项目",
    comment_insight: "评论洞察",
    ai_chat: "AI 对话",
    review: "复盘",
    product: "产品",
  };
  const statusMap: Record<string, string> = {
    draft: "草稿",
    completed: "已完成",
    failed: "失败",
    archived: "已归档",
  };
  return (
    <button type="button" onClick={onOpen} className="block w-full rounded-2xl border border-border bg-card p-4 text-left transition-colors hover:border-input hover:bg-muted/40">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="line-clamp-1 text-sm font-semibold text-slate-950 dark:text-slate-100">{item.title}</div>
          <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">{typeMap[item.type] || item.type}｜{statusMap[item.status] || item.status}</div>
        </div>
        {item.favorite ? <Heart className="h-4 w-4 shrink-0 fill-current text-rose-500" /> : null}
      </div>
    </button>
  );
}

function MiniMetric({ label, value, dark = false }: { label: string; value: number | string; dark?: boolean }) {
  return (
    <div className={cn("rounded-2xl border p-4", dark ? "border-white/10 bg-white/10 dark:bg-slate-950/10" : "border-slate-200/70 bg-slate-50/80 dark:border-slate-800 dark:bg-slate-950/40")}>
      <div className={cn("text-xs", dark ? "text-slate-300 dark:text-slate-600" : "text-slate-500 dark:text-slate-400")}>{label}</div>
      <div className={cn("mt-2 text-2xl font-semibold", dark ? "text-white dark:text-slate-950" : "text-slate-950 dark:text-slate-100")}>{value}</div>
    </div>
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

function CheckLine({ label, checked, onChange }: { label: string; checked: boolean; onChange: (checked: boolean) => void }) {
  return (
    <label className="flex items-center gap-2 rounded-[14px] border border-slate-200/70 bg-white/80 px-3 py-2 text-sm text-slate-700 dark:border-slate-800 dark:bg-slate-950/50 dark:text-slate-300">
      <input className="accent-slate-950 dark:accent-slate-100" type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} />
      {label}
    </label>
  );
}

function ReadableBlock({ title, value, large = false }: { title: string; value: string; large?: boolean }) {
  const content = value || "未生成";
  const shouldFold = content.length > 520 || content.split("\n").length > 9;
  const preview = shouldFold ? `${content.slice(0, 320).trim()}...` : content;
  return (
    <section className="doc-section">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h3 className="text-sm font-semibold text-slate-950 dark:text-slate-100">{title}</h3>
        <Button size="sm" variant="ghost" onClick={() => copyText(content)}>
          <Copy className="h-4 w-4" />复制
        </Button>
      </div>
      {shouldFold ? (
        <div className="space-y-3">
          <p className={cn("whitespace-pre-wrap text-sm leading-7 text-slate-700 dark:text-slate-300", large && "text-[15px] leading-8")}>{preview}</p>
          <details className="rounded-2xl border border-slate-200/70 bg-white/60 p-3 dark:border-slate-800 dark:bg-slate-950/35">
            <summary className="cursor-pointer text-sm font-medium text-slate-700 dark:text-slate-300">展开完整内容</summary>
            <div className={cn("mt-3 whitespace-pre-wrap text-sm leading-7 text-slate-700 dark:text-slate-300", large && "text-[15px] leading-8")}>{content}</div>
          </details>
        </div>
      ) : (
        <p className={cn("whitespace-pre-wrap text-sm leading-7 text-slate-700 dark:text-slate-300", large && "text-[15px] leading-8")}>{content}</p>
      )}
    </section>
  );
}

function RiskCheckBlock({ result }: { result?: ScriptRecord["riskCheckResult"] }) {
  if (!result) return null;
  const levelLabel = result.level === "high" ? "高" : result.level === "medium" ? "中" : result.level === "low" ? "低" : result.level;
  const tone = levelLabel === "高" ? "border-rose-200 bg-rose-50 text-rose-800 dark:border-rose-900/60 dark:bg-rose-950/30 dark:text-rose-200" : levelLabel === "中" ? "border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-200" : "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900/60 dark:bg-emerald-950/30 dark:text-emerald-200";
  return (
    <section className="doc-section">
      <div className="mb-3">
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-sm font-semibold text-slate-950 dark:text-slate-100">内容风控检查</h3>
          <Badge className={tone}>风险等级：{levelLabel}</Badge>
        </div>
        <p className="mt-2 text-sm leading-6 text-slate-500 dark:text-slate-400">仅作为内容风险提醒，不构成法律意见。</p>
      </div>
      <div className="space-y-3">
        <Info label="风险词" value={result.riskyWords.length ? result.riskyWords.join("、") : "暂未发现明显风险词"} />
        <Info label="风险原因" value={result.reasons.join("\n")} />
        <Info label="建议改法" value={result.suggestions.length ? result.suggestions.map((item) => `原句/词：${item.original}\n改成：${item.suggestion || item.replacement}`).join("\n\n") : "当前无需明显替换，发布前仍需核对产品事实。"} />
      </div>
    </section>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[16px] border border-slate-200/70 bg-white/50 p-4 dark:border-slate-800/80 dark:bg-slate-950/30">
      <div className="text-xs font-medium text-slate-400">{label}</div>
      <div className="mt-2 whitespace-pre-wrap text-sm leading-6 text-slate-700 dark:text-slate-300">{value || "未填写"}</div>
    </div>
  );
}

function useSimpleData() {
  const [data, setData] = useState<SimpleData>({
    pipeline: emptyPipelineData(),
    scripts: [],
    reviews: [],
    deconstructions: [],
    resources: [],
    products: [],
    commentInsights: []
  });

  function refresh() {
    setData({
      pipeline: getPipelineData(),
      scripts: getScriptRecords(),
      reviews: getSimpleReviewRecords(),
      deconstructions: getSimpleDeconstructionRecords(),
      resources: getResourceItems(),
      products: getProductRecords(),
      commentInsights: getCommentInsightRecords()
    });
  }

  useEffect(() => {
    refresh();
  }, []);

  return { data, refresh };
}

function blankReview(scriptId: string): SimpleReviewRecord {
  const now = nowIso();
  return {
    id: createId("review_simple"),
    scriptId,
    platform: "",
    publishTime: "",
    views: "",
    fiveSecondRetention: "",
    completionRate: "",
    avgWatchTime: "",
    likeRate: "",
    commentRate: "",
    saveRate: "",
    conversionData: "",
    topicJudgement: "待观察",
    hookJudgement: "待观察",
    scriptJudgement: "待观察",
    shootingJudgement: "待观察",
    editingJudgement: "待观察",
    problemReason: "",
    nextOptimization: "",
    conclusion: "",
    successPoints: "",
    failurePoints: "",
    recommendAsCase: false,
    performanceLevel: "",
    aiConclusion: "",
    createdAt: now,
    updatedAt: now
  };
}

function blankProduct(): ProductRecord {
  const now = nowIso();
  return {
    id: createId("product_record"),
    name: "",
    category: "",
    priceRange: "",
    coreSellingPoints: "",
    secondarySellingPoints: "",
    targetAudience: "",
    painPoints: "",
    objections: "",
    useScenarios: "",
    competitorComparison: "",
    buyerFeedback: "",
    forbiddenWords: "",
    forbiddenClaims: "",
    materialLinks: "",
    sourceType: "manual",
    brandName: "",
    productFacts: "",
    specifications: "",
    colors: "",
    faq: "",
    customerServiceScript: "",
    proofMaterials: "",
    notes: "",
    sourceDocumentName: "",
    sourceDocumentText: "",
    sourceDocumentImportedAt: "",
    createdAt: now,
    updatedAt: now
  };
}

function blankResource(): ResourceItem {
  const now = nowIso();
  return {
    id: createId("resource"),
    type: "其他沉淀资料",
    title: "",
    content: "",
    tags: "",
    createdAt: now,
    updatedAt: now
  };
}

function emptyPipelineData(): PipelineData {
  return {
    projects: [],
    products: [],
    videoTasks: [],
    topics: [],
    scripts: [],
    shotLists: [],
    scriptTranscripts: [],
    editBriefs: [],
    publishPlans: [],
    reviewRecords: [],
    contentAssets: [],
    deconstructionRecords: [],
    approvalRecords: [],
    versionRecords: [],
    taskComments: [],
    teamMembers: [],
    taskRisks: [],
    viralAnalyses: [],
    directorMethods: [],
    scriptRecords: [],
    simpleReviewRecords: [],
    simpleDeconstructionRecords: [],
    resourceItems: [],
    productRecords: [],
    commentInsightRecords: []
  };
}

function toOption(value: string) {
  return { label: value, value };
}

function applyContentType(input: SimpleScriptInput, contentType: ScriptRecordContentType): SimpleScriptInput {
  return {
    ...input,
    contentType,
    contentFormat: contentFormatFromContentType(contentType),
    materialSource: contentType === "评论回复" ? "评论区" : input.materialSource,
    needNote: contentType === "小红书图文"
  };
}

function normalizeScriptInput(input: SimpleScriptInput): SimpleScriptInput {
  return {
    ...input,
    contentFormat: contentFormatFromContentType(input.contentType),
    needNote: input.contentType === "小红书图文",
    includeRiskCheck: input.includeRiskCheck !== false,
    includeCoverTitle: input.includeCoverTitle !== false && input.needTitle
  };
}

function contentFormatFromContentType(contentType: ScriptRecordContentType): ScriptRecordContentFormat {
  if (contentType === "小红书图文") return "图文笔记";
  if (contentType === "老板 IP") return "老板 IP";
  if (contentType === "直播切片") return "直播切片";
  if (contentType === "评论回复") return "评论回复";
  if (contentType === "竞品对比") return "竞品对比";
  if (contentType === "避坑科普") return "避坑科普";
  if (contentType === "电商带货" || contentType === "带货转化") return "电商带货";
  return "短视频口播";
}

function buildScriptGeneratePayload(input: SimpleScriptInput) {
  return {
    product: input.productName,
    targetAudience: input.targetAudience,
    painPoints: input.painPoint,
    sellingPoints: input.sellingPoint,
    platform: input.platform,
    contentType: input.contentType,
    contentGoal: input.videoGoal,
    extraRequirement: [
      `素材来源：${input.materialSource}`,
      `平台规则：${platformHint(input.platform)}`,
      formatProductReferenceForPrompt(input.productSnapshot),
      input.extra
    ].filter(Boolean).join("\n"),
    comments: input.comments || "",
    liveTranscript: input.liveTranscript || "",
    originalScript: input.originalScript || "",
    rewriteGoal: input.rewriteGoal || "",
    forbiddenWords: input.productForbiddenWords || "",
    forbiddenClaims: input.productForbiddenClaims || "",
    advanced: {
      tone: input.speakingStyle,
      duration: input.duration,
      scene: input.scene,
      includeStoryboard: input.needShotList,
      includeOverlay: input.needOverlay,
      includeRiskCheck: input.includeRiskCheck !== false,
      includeCoverTitle: input.includeCoverTitle !== false && input.needTitle
    }
  };
}

function formatScript(script: ScriptRecord) {
  // 空的镜头/动作字段不再输出，避免复制出一堆只有标题的空块。
  return [
    `标题：${script.title}`,
    `平台：${script.platform || "抖音"}`,
    `内容形式：${script.contentFormat || script.contentType}`,
    `视频目的：${script.videoGoal}`,
    script.hook?.trim() ? `开头 3 秒钩子：${script.hook}` : "",
    script.scriptText?.trim() ? `完整口播文案：\n${script.scriptText}` : "",
    script.shotSuggestions?.trim() ? `分镜建议：\n${script.shotSuggestions}` : "",
    script.overlaySuggestions?.trim() ? `画中画建议：\n${script.overlaySuggestions}` : "",
    script.shootingTips?.trim() ? `拍摄提醒：\n${script.shootingTips}` : "",
    script.endingCTA?.trim() ? `结尾引导：${script.endingCTA}` : ""
  ].filter(Boolean).join("\n\n");
}

function formatReview(review: SimpleReviewRecord, script?: ScriptRecord) {
  return [
    `脚本：${script?.title || "未关联脚本"}`,
    `播放量：${review.views || "未填"}`,
    `5 秒留存：${review.fiveSecondRetention || "未填"}`,
    `完播率：${review.completionRate || "未填"}`,
    `复盘结论：${review.conclusion || "未填写"}`,
    `成功点：${review.successPoints || "未填写"}`,
    `失败点：${review.failurePoints || "未填写"}`,
    `下次优化：${review.nextOptimization || "未填写"}`
  ].join("\n\n");
}

function formatDeconstruction(item: SimpleDeconstructionRecord) {
  return [
    `视频核心主题：${item.coreTheme}`,
    `开头钩子：${item.hook}`,
    `爆款元素：${item.viralElements}`,
    `内容结构：\n${item.structure}`,
    `情绪变化：\n${item.emotionFlow}`,
    `可迁移结构：\n${item.reusableStructure}`,
    `新选题：\n${item.newTopicIdeas}`,
    `新脚本方向：\n${item.newScriptDirections}`
  ].join("\n\n");
}

function saveDeconstructionAsset(item: SimpleDeconstructionRecord) {
  createAsset({
    id: `asset_deconstruction_${item.id}`,
    type: "deconstruction",
    title: item.sourceTitle || item.title || item.rewrittenTitle || "拆片结果",
    summary: item.coreTheme || item.hook || item.reusableStructure?.slice(0, 120) || "爆款结构拆解",
    content: formatDeconstruction(item),
    rawData: item,
    sourceModule: "deconstruction",
    platform: "unknown",
    productId: item.productId || "",
    productName: item.targetProduct,
    tags: [],
    favorite: Boolean(item.favorite),
    status: item.status === "failed" ? "failed" : "completed",
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
    linkedRecordIds: [item.id],
  });
}

function formatProduct(item: ProductRecord) {
  return [
    `产品名称：${item.name}`,
    `品牌：${item.brandName || ""}`,
    `品类：${item.category}`,
    `价格：${item.priceRange}`,
    `产品基础事实：${item.productFacts || ""}`,
    `规格参数：${item.specifications || ""}`,
    `颜色/款式：${item.colors || ""}`,
    `核心卖点：${item.coreSellingPoints}`,
    `次级卖点：${item.secondarySellingPoints}`,
    `目标人群：${item.targetAudience}`,
    `用户痛点：${item.painPoints}`,
    `用户顾虑：${item.objections}`,
    `使用场景：${item.useScenarios}`,
    `竞品对比：${item.competitorComparison}`,
    `买家反馈：${item.buyerFeedback}`,
    `常见问题：${item.faq || ""}`,
    `客服话术：${item.customerServiceScript || ""}`,
    `禁忌词：${item.forbiddenWords}`,
    `不能承诺：${item.forbiddenClaims}`,
    `证据材料：${item.proofMaterials || ""}`,
    `素材备注：${item.materialLinks}`,
    `其他备注：${item.notes || ""}`,
    `来源文档：${item.sourceDocumentName || "手动录入"}`
  ].join("\n\n");
}

function inferPerformanceLevel(review: SimpleReviewRecord) {
  if (review.performanceLevel) return review.performanceLevel;
  // 区分「缺失」与「真实的零」：字段里连数字都没有，视为缺数据，不参与自动判断
  const viewsRaw = String(review.views || "").trim();
  const hasViews = /\d/.test(viewsRaw);
  const views = hasViews ? Number(viewsRaw.replace(/[^\d.]/g, "")) || 0 : 0;
  const completion = parseMetricNumber(review.completionRate);
  const likes = parseMetricNumber(review.likeRate);
  const hasCompletion = /\d/.test(String(review.completionRate || ""));
  const hasLikes = /\d/.test(String(review.likeRate || ""));
  // 无任何有效数据时不自动判为「一般」，明确标注待评估
  if (!hasViews && !hasCompletion && !hasLikes && !review.recommendAsCase) return "待评估";
  if (views >= 10000 || completion >= 45 || likes >= 5 || review.recommendAsCase) return "表现好";
  if ((views > 0 && views < 1000) || (completion > 0 && completion < 20)) return "表现差";
  return "一般";
}

function parseMetricNumber(value: string) {
  const matched = value.match(/\d+(\.\d+)?/);
  return matched ? Number(matched[0]) : 0;
}

function formatDate(value: string) {
  if (!value) return "未记录";
  return new Date(value).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}

function copyText(value: string) {
  if (typeof navigator === "undefined") return;
  void navigator.clipboard.writeText(value);
}

function platformHint(platform: ScriptRecordPlatform) {
  const hints: Record<ScriptRecordPlatform, string> = {
    抖音: "开头强钩子、节奏快、痛点直接、适合强转化。",
    小红书: "真实种草、标题像体验分享、细节充分、不要太硬广。",
    快手: "强调真实信任、人设和售后，适合老板口播和直播承接。",
    视频号: "强调品质、信任、老板 IP 和中年用户，语气稳一点。",
    淘宝内容: "强调商品信息、使用场景、卖点和成交理由。",
    朋友圈: "像熟人推荐，适合复购、信任和成交。",
    私域朋友圈: "像熟人推荐，适合复购、信任和成交。"
  };
  return hints[platform];
}
