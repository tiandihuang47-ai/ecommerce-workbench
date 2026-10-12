"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { Archive, ArrowRight, Copy, Download, Heart, ImagePlus, Search, Sparkles, Trash2 } from "lucide-react";
import { EmptyState, PageHeader, SectionCard } from "@/components/design-system";
import { ProductReferenceCard } from "@/components/product-reference-card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { createAsset, deleteAsset, archiveAsset, getAssets, searchAssets, toggleFavoriteAsset, type ContentAsset, type ContentAssetPlatform, type ContentAssetStatus, type ContentAssetType } from "@/lib/stores/asset-store";
import { createId } from "@/lib/shared/id";
import { formatDateTime, nowIso } from "@/lib/shared/time";
import { getProductRecords } from "@/lib/pipeline-storage";
import type { ProductRecord, ProductReferenceSnapshot } from "@/lib/pipeline-types";
import { createProductReferenceSnapshot, formatProductReferenceForPrompt } from "@/lib/product-reference";
import {
  extractProductSnapshot,
  getAssetReuseLabel,
  imagePromptDraftStorageKey,
  prepareAssetReuse
} from "@/lib/asset-reuse-client";

const assetTypeOptions = [
  { label: "全部类型", value: "all" },
  { label: "脚本", value: "script" },
  { label: "拆片", value: "deconstruction" },
  { label: "生图提示词", value: "image_prompt" },
  { label: "生图项目", value: "image_project" },
  { label: "评论洞察", value: "comment_insight" },
  { label: "AI 对话", value: "ai_chat" },
  { label: "复盘", value: "review" },
  { label: "产品资料", value: "product" },
];

const platformOptions = [
  { label: "全部平台", value: "all" },
  { label: "抖音", value: "douyin" },
  { label: "小红书", value: "xiaohongshu" },
  { label: "快手", value: "kuaishou" },
  { label: "视频号", value: "shipinhao" },
  { label: "淘宝", value: "taobao" },
  { label: "朋友圈", value: "private" },
  { label: "未知", value: "unknown" },
];

const statusOptions = [
  { label: "全部状态", value: "all" },
  { label: "草稿", value: "draft" },
  { label: "已完成", value: "completed" },
  { label: "失败", value: "failed" },
  { label: "已归档", value: "archived" },
];

const typeLabel: Record<string, string> = {
  script: "脚本",
  deconstruction: "拆片",
  image_prompt: "生图提示词",
  image_project: "生图项目",
  ai_chat: "AI 对话",
  comment_insight: "评论洞察",
  review: "复盘",
  product: "产品资料",
};

const platformLabel: Record<string, string> = {
  douyin: "抖音",
  xiaohongshu: "小红书",
  kuaishou: "快手",
  shipinhao: "视频号",
  taobao: "淘宝",
  private: "朋友圈",
  unknown: "未知",
};

const statusLabel: Record<string, string> = {
  draft: "草稿",
  completed: "已完成",
  failed: "失败",
  archived: "已归档",
};

const defaultImagePromptForm = {
  purpose: "短视频封面",
  productId: "",
  productSnapshot: undefined as ProductReferenceSnapshot | undefined,
  product: "",
  audience: "",
  sellingPoint: "",
  scene: "",
  style: "干净高级",
  ratio: "3:4",
  extra: "",
};

export function ImageGeneratorPlaceholderPage() {
  const [form, setForm] = useState(defaultImagePromptForm);
  const [products, setProducts] = useState<ProductRecord[]>([]);
  const [result, setResult] = useState<Record<string, string> | null>(null);
  const [assetId, setAssetId] = useState("");
  const [message, setMessage] = useState("");
  const [draftReady, setDraftReady] = useState(false);

  useEffect(() => {
    setProducts(getProductRecords());
    try {
      const saved = window.localStorage.getItem(imagePromptDraftStorageKey);
      if (saved) {
        setForm({ ...defaultImagePromptForm, ...JSON.parse(saved) as Partial<typeof defaultImagePromptForm> });
      }
      if (new URLSearchParams(window.location.search).get("reuseAsset")) {
        setMessage("已从资产库恢复产品资料和生图创作简报，可直接调整后重新生成。");
      }
    } catch {
      setMessage("生图草稿恢复失败，可继续新建内容。");
    } finally {
      setDraftReady(true);
    }
  }, []);

  useEffect(() => {
    if (!draftReady) return;
    try {
      window.localStorage.setItem(imagePromptDraftStorageKey, JSON.stringify(form));
    } catch {
      setMessage("生图草稿自动保存失败，请检查本地存储空间。");
    }
  }, [draftReady, form]);

  function selectProduct(productId: string) {
    const selected = products.find((item) => item.id === productId);
    if (!selected) {
      setForm((current) => ({ ...current, productId: "", productSnapshot: undefined }));
      return;
    }
    setForm((current) => ({
      ...current,
      productId: selected.id,
      productSnapshot: createProductReferenceSnapshot(selected),
      product: selected.name,
      audience: selected.targetAudience,
      sellingPoint: [selected.coreSellingPoints, selected.secondarySellingPoints].filter(Boolean).join("\n"),
      scene: selected.useScenarios || current.scene,
    }));
    setMessage(`已引用产品资料：${selected.name}`);
  }

  function resetImagePrompt() {
    setForm(defaultImagePromptForm);
    setResult(null);
    setAssetId("");
    setMessage("");
    window.localStorage.removeItem(imagePromptDraftStorageKey);
  }

  function buildPrompt(status: "draft" | "completed") {
    const product = form.product.trim() || "未命名产品";
    const scene = form.scene.trim() || "真实使用场景";
    const style = form.style.trim() || "干净高级";
    const sellingPoint = form.sellingPoint.trim() || "资料中未提供明确卖点";
    const audience = form.audience.trim() || "目标用户";
    const title = `${product} - ${form.purpose}提示词`;
    const productReference = formatProductReferenceForPrompt(form.productSnapshot);
    const output = {
      chinese: `${form.purpose}，产品是${product}，面向${audience}。画面场景：${scene}。核心卖点：${sellingPoint}。整体风格：${style}，画幅 ${form.ratio}。画面要清晰展示产品主体、使用场景和可信细节，避免夸张宣传。${form.extra ? `补充要求：${form.extra}` : ""}${productReference ? `\n\n${productReference}` : ""}`,
      english: `${form.purpose} for ${product}, target audience: ${audience}. Scene: ${scene}. Key selling point: ${sellingPoint}. Style: ${style}, aspect ratio ${form.ratio}. Clean product-focused composition, realistic lighting, clear details, no exaggerated claims.`,
      jimeng: `即梦：${product} ${form.purpose}，${scene}，${style}，突出${sellingPoint}，${form.ratio}，真实电商内容质感，主体清晰，背景干净`,
      midjourney: `${product}, ${form.purpose}, ${scene}, ${style}, product photography, clean composition, realistic lighting, aspect ratio ${form.ratio}`,
      veo: `图生视频提示词：围绕${product}设计 3-5 秒镜头，先展示${scene}，再强调${sellingPoint}，镜头运动自然，适合短视频封面和转场。`,
      kling: `可灵：${product}，${scene}，${style}，轻微推镜，突出产品细节和使用氛围，画面稳定，商业质感。`,
      composition: `构图建议：主体占画面 55%-70%，卖点细节放在视觉中心附近，背景只服务产品，不堆装饰。`,
      cover: `${product}，这样拍更显卖点`,
    };
    const now = nowIso();
    const saved = createAsset({
      id: assetId || createId("asset_image_prompt"),
      type: "image_prompt",
      title,
      summary: output.chinese.slice(0, 120),
      content: formatImagePrompt(output),
      rawData: { form, result: output },
      sourceModule: "image",
      platform: "unknown",
      productId: form.productId,
      productName: product,
      tags: [form.purpose, form.style].filter(Boolean),
      favorite: false,
      status,
      createdAt: assetId ? undefined : now,
      updatedAt: now,
      linkedRecordIds: [],
    });
    setAssetId(saved.id);
    setResult(output);
    setMessage(status === "draft" ? "草稿已保存到资产库。" : "提示词已生成，并自动保存到资产库。");
  }

  return (
    <div className="desktop-page">
      <PageHeader
        eyebrow="AI 内容中台 / 生图"
        title="生图"
        description="先生成电商主图、短视频封面、场景图和图生视频提示词，解决画面怎么做。"
        action={<Button asChild><Link href="/assets"><ImagePlus className="h-4 w-4" />查看资产库</Link></Button>}
      />

      <div className="two-pane-grid">
        <SectionCard className="pane-scroll">
          <CardHeader>
            <CardTitle>生图简报</CardTitle>
            <CardDescription>先把产品、场景、风格说清楚，再复制到即梦、Midjourney、Gemini/Veo 或可灵。</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <Field label="引用产品资料">
              <Select
                value={form.productId}
                onChange={(event) => selectProduct(event.target.value)}
                options={[
                  { label: products.length ? "不选择，手动输入" : "资料库暂无产品，可手动输入", value: "" },
                  ...products.map((item) => ({ label: item.name, value: item.id }))
                ]}
              />
            </Field>
            <ProductReferenceCard product={form.productSnapshot} />
            <Field label="图片用途">
              <Select value={form.purpose} onChange={(event) => setForm({ ...form, purpose: event.target.value })} options={["电商主图", "短视频封面", "小红书配图", "产品场景图", "分镜图", "图生视频"].map((item) => ({ label: item, value: item }))} />
            </Field>
            <Field label="产品 / 业务"><Input value={form.product} onChange={(event) => setForm({ ...form, product: event.target.value })} placeholder="例如：安哥拉红中长款羽绒服" /></Field>
            <Field label="目标人群"><Textarea value={form.audience} onChange={(event) => setForm({ ...form, audience: event.target.value })} placeholder="例如：40 岁以上通勤女性" /></Field>
            <Field label="核心卖点"><Textarea value={form.sellingPoint} onChange={(event) => setForm({ ...form, sellingPoint: event.target.value })} placeholder="例如：显气色、不臃肿、冬季通勤" /></Field>
            <div className="grid gap-4 md:grid-cols-2">
              <Field label="场景"><Input value={form.scene} onChange={(event) => setForm({ ...form, scene: event.target.value })} placeholder="店铺、通勤街景、室内" /></Field>
              <Field label="风格"><Input value={form.style} onChange={(event) => setForm({ ...form, style: event.target.value })} placeholder="干净高级、真实种草" /></Field>
            </div>
            <Field label="画幅">
              <Select value={form.ratio} onChange={(event) => setForm({ ...form, ratio: event.target.value })} options={["1:1", "3:4", "4:5", "9:16", "16:9"].map((item) => ({ label: item, value: item }))} />
            </Field>
            <Field label="补充要求"><Textarea value={form.extra} onChange={(event) => setForm({ ...form, extra: event.target.value })} placeholder="例如：不要太网红，要适合中年用户。" /></Field>
            <div className="mt-2 flex flex-wrap gap-2 rounded-2xl border border-slate-200/70 bg-white/70 p-3 backdrop-blur dark:border-slate-800/80 dark:bg-slate-950/40">
              <Button onClick={() => buildPrompt("completed")}><Sparkles className="h-4 w-4" />生成提示词</Button>
              <Button variant="outline" onClick={() => buildPrompt("draft")}>保存草稿</Button>
              <Button variant="ghost" onClick={resetImagePrompt}>新建</Button>
            </div>
            {message ? <p className="rounded-2xl bg-slate-100 px-4 py-3 text-sm text-slate-600 dark:bg-slate-800 dark:text-slate-300">{message}</p> : null}
          </CardContent>
        </SectionCard>

        <SectionCard className="pane-scroll">
          <CardHeader>
            <CardTitle>生成结果</CardTitle>
            <CardDescription>{assetId ? `已保存资产：${assetId}` : "生成后会自动保存，刷新页面后可在资产库找到。"}</CardDescription>
          </CardHeader>
          <CardContent>
            {result ? (
              <div className="space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200/70 bg-white/60 p-3 dark:border-slate-800 dark:bg-slate-950/35">
                  <div>
                    <div className="text-sm font-semibold text-slate-950 dark:text-slate-100">提示词文档</div>
                    <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">结果已按平台拆好，长提示词默认折叠，复制时会复制完整内容。</p>
                  </div>
                  <Button variant="outline" onClick={() => copyText(formatImagePrompt(result))}><Copy className="h-4 w-4" />复制全部</Button>
                </div>
                {Object.entries(result).map(([key, value]) => (
                  <PromptBlock key={key} title={promptLabel(key)} value={value} />
                ))}
              </div>
            ) : (
              <EmptyState text="还没有生图提示词。先填写左侧简报，生成后会自动进入资产库。" />
            )}
          </CardContent>
        </SectionCard>
      </div>
    </div>
  );
}

export function AssetLibraryLandingPage() {
  const [assets, setAssets] = useState<ContentAsset[]>(() => getAssets());
  const [products] = useState<ProductRecord[]>(() => getProductRecords());
  const [keyword, setKeyword] = useState("");
  const [type, setType] = useState<ContentAssetType | "all">("all");
  const [platform, setPlatform] = useState<ContentAssetPlatform | "all">("all");
  const [status, setStatus] = useState<ContentAssetStatus | "all">("all");
  const [favorite, setFavorite] = useState("all");
  const [selected, setSelected] = useState<ContentAsset | null>(null);
  const [notice, setNotice] = useState("");

  const filtered = useMemo(() => searchAssets(keyword, {
    type,
    platform,
    status,
    favorite: favorite === "all" ? undefined : favorite === "favorite",
  }), [assets, favorite, keyword, platform, status, type]);

  function refresh(nextSelectedId = selected?.id || "") {
    const next = getAssets();
    setAssets(next);
    setSelected(next.find((item) => item.id === nextSelectedId) || null);
  }

  function copyAsset(asset: ContentAsset) {
    copyText(asset.content || asset.summary || asset.title);
    setNotice("已复制资产内容。");
  }

  function exportJson() {
    const data = JSON.stringify({ assets: getAssets(), exportedAt: nowIso() }, null, 2);
    copyText(data);
    setNotice("资产 JSON 已复制，可粘贴到文档或备份文件。");
  }

  function archive(id: string) {
    if (!window.confirm("确定要归档这条资产吗？归档后仍可通过状态筛选找回。")) return;
    archiveAsset(id);
    refresh(id);
  }

  function remove(id: string) {
    if (!window.confirm("确定要删除这条资产吗？建议重要内容先导出备份。")) return;
    deleteAsset(id);
    refresh();
  }

  function reuseAsset(asset: ContentAsset) {
    const result = prepareAssetReuse(asset);
    if (!result.success) {
      setNotice(result.message);
      return;
    }
    window.location.assign(result.href);
  }

  return (
    <div>
      <PageHeader
        eyebrow="AI 内容中台 / 资产库"
        title="资产库"
        description="保存脚本、拆片、生图提示词、评论洞察和 AI 对话内容。生成内容会自动沉淀到这里。"
        action={<Button onClick={exportJson}><Download className="h-4 w-4" />导出资产</Button>}
      />

      <SectionCard className="mb-5">
        <CardContent className="space-y-3 p-4">
          <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_150px_150px_130px_120px]">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <Input className="pl-9" value={keyword} onChange={(event) => setKeyword(event.target.value)} placeholder="搜索标题、摘要、内容、产品、标签" />
            </div>
            <Select value={type} onChange={(event) => setType(event.target.value as ContentAssetType | "all")} options={assetTypeOptions} />
            <Select value={platform} onChange={(event) => setPlatform(event.target.value as ContentAssetPlatform | "all")} options={platformOptions} />
            <Select value={status} onChange={(event) => setStatus(event.target.value as ContentAssetStatus | "all")} options={statusOptions} />
            <Select value={favorite} onChange={(event) => setFavorite(event.target.value)} options={[{ label: "全部", value: "all" }, { label: "只看收藏", value: "favorite" }]} />
          </div>
          {notice ? <p className="rounded-2xl bg-slate-100 px-4 py-3 text-sm text-slate-600 dark:bg-slate-800 dark:text-slate-300">{notice}</p> : null}
        </CardContent>
      </SectionCard>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_420px] xl:items-start">
        <div>
          {filtered.length === 0 ? <EmptyState text="还没有匹配的资产。先从脚本、拆片或生图开始生成内容。" actionText="写脚本" onAction={() => window.location.assign("/script-generator")} /> : null}
          <div className="grid gap-4 lg:grid-cols-2">
            {filtered.map((asset) => (
              <button key={asset.id} type="button" onClick={() => { setSelected(asset); }} className="group rounded-2xl border border-border bg-card p-4 text-left transition-colors hover:border-input hover:bg-muted/40">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap gap-2">
                      <Badge variant="secondary">{typeLabel[asset.type] || asset.type}</Badge>
                      <Badge variant="secondary">{platformLabel[asset.platform] || "未知"}</Badge>
                      <Badge variant="secondary">{statusLabel[asset.status]}</Badge>
                      {extractProductSnapshot(asset.rawData) ? <Badge variant="secondary">资料快照</Badge> : null}
                    </div>
                    <h3 className="mt-3 line-clamp-2 text-base font-semibold text-slate-950 dark:text-slate-100">{asset.title}</h3>
                  </div>
                  <Heart className={`h-4 w-4 shrink-0 ${asset.favorite ? "fill-rose-500 text-rose-500" : "text-slate-400"}`} />
                </div>
                <p className="mt-3 line-clamp-3 text-sm leading-6 text-slate-500 dark:text-slate-400">{asset.summary || asset.content || "暂无摘要"}</p>
                <div className="mt-4 flex items-center justify-between gap-3 text-xs text-slate-400">
                  <span>{asset.productName || "未关联产品"}</span>
                  <span>{formatDateTime(asset.updatedAt)}</span>
                </div>
              </button>
            ))}
          </div>
        </div>

        <SectionCard className="xl:sticky xl:top-6 xl:max-h-[calc(100vh-7rem)] xl:overflow-y-auto scrollbar-subtle">
          <CardHeader>
            <CardTitle>{selected ? selected.title : "资产详情"}</CardTitle>
            <CardDescription>{selected ? `${typeLabel[selected.type]} · ${formatDateTime(selected.updatedAt)}` : "点击左侧资产查看完整内容。"}</CardDescription>
          </CardHeader>
          <CardContent>
            {selected ? (
              <div className="space-y-4">
                <div className="flex flex-wrap gap-2">
                  {getAssetReuseLabel(selected) ? <Button size="sm" onClick={() => reuseAsset(selected)}><ArrowRight className="h-4 w-4" />{getAssetReuseLabel(selected)}</Button> : null}
                  <Button size="sm" variant="outline" onClick={() => copyAsset(selected)}><Copy className="h-4 w-4" />复制</Button>
                  <Button size="sm" variant="outline" onClick={() => { toggleFavoriteAsset(selected.id); refresh(selected.id); }}><Heart className="h-4 w-4" />{selected.favorite ? "取消收藏" : "收藏"}</Button>
                  <Button size="sm" variant="outline" onClick={() => archive(selected.id)}><Archive className="h-4 w-4" />归档</Button>
                  <Button size="sm" variant="destructive" onClick={() => remove(selected.id)}><Trash2 className="h-4 w-4" />删除</Button>
                </div>
                <AssetProductTrace asset={selected} products={products} />
                <div className="rounded-2xl border border-slate-200/70 bg-slate-50/70 p-4 text-sm leading-7 text-slate-600 dark:border-slate-800 dark:bg-slate-950/45 dark:text-slate-300 whitespace-pre-wrap">
                  {selected.content || selected.summary || "暂无完整内容"}
                </div>
                <details className="rounded-2xl border border-slate-200/70 bg-white/70 p-4 dark:border-slate-800 dark:bg-slate-950/40">
                  <summary className="cursor-pointer text-sm font-semibold text-slate-900 dark:text-slate-100">原始数据</summary>
                  <pre className="mt-3 max-h-72 overflow-auto rounded-xl bg-slate-950 p-3 text-xs text-slate-100">{JSON.stringify(selected.rawData, null, 2)}</pre>
                </details>
              </div>
            ) : (
              <EmptyState text="选择一条资产后，可以查看完整内容、复制、收藏、归档或删除。" />
            )}
          </CardContent>
        </SectionCard>
      </div>
    </div>
  );
}

function AssetProductTrace({ asset, products }: { asset: ContentAsset; products: ProductRecord[] }) {
  const savedSnapshot = extractProductSnapshot(asset.rawData);
  const currentProduct = products.find((item) => item.id === (asset.productId || savedSnapshot?.id))
    || products.find((item) => item.name === (asset.productName || savedSnapshot?.name));
  const displaySnapshot = savedSnapshot || (currentProduct ? createProductReferenceSnapshot(currentProduct) : undefined);
  const productName = savedSnapshot?.name || asset.productName || currentProduct?.name || "";

  if (!productName && !displaySnapshot) return null;

  const versionState = savedSnapshot
    ? currentProduct
      ? savedSnapshot.updatedAt && savedSnapshot.updatedAt === currentProduct.updatedAt
        ? "资料版本一致"
        : "使用生成时快照"
      : "历史快照"
    : currentProduct
      ? "旧资产 · 当前资料"
      : "仅记录产品名称";
  const versionNote = savedSnapshot
    ? currentProduct
      ? savedSnapshot.updatedAt === currentProduct.updatedAt
        ? "这条内容使用的产品资料与资料库当前版本一致。"
        : "资料库后来有过更新，这条内容仍保留生成时使用的版本，不会被新资料覆盖。"
      : "资料库中已找不到原产品，但这条内容仍保留生成时的产品资料。"
    : currentProduct
      ? "这是一条旧资产，生成时尚未保存资料快照；下面展示的是资料库当前内容。"
      : "这是一条旧资产，只保存了产品名称，没有可追溯的资料快照。";

  return (
    <section className="border-y border-slate-200/70 py-4 dark:border-slate-800">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-medium text-slate-500 dark:text-slate-400">产品引用</p>
          <p className="mt-1 text-sm font-semibold text-slate-950 dark:text-slate-100">{productName}</p>
        </div>
        <Badge variant={savedSnapshot ? "default" : "secondary"}>{versionState}</Badge>
      </div>
      <p className="mt-3 text-xs leading-5 text-slate-500 dark:text-slate-400">{versionNote}</p>
      <div className="mt-3 grid gap-2 text-xs text-slate-500 sm:grid-cols-2 dark:text-slate-400">
        <span>资产生成：{formatDateTime(asset.createdAt)}</span>
        {savedSnapshot?.updatedAt ? <span>资料快照：{formatDateTime(savedSnapshot.updatedAt)}</span> : null}
        {savedSnapshot?.sourceDocumentName ? <span className="sm:col-span-2">来源文档：{savedSnapshot.sourceDocumentName}</span> : null}
      </div>
      {displaySnapshot ? (
        <details className="mt-3">
          <summary className="cursor-pointer text-sm font-medium text-slate-700 dark:text-slate-300">查看引用的产品资料</summary>
          <div className="mt-3 space-y-2 text-sm leading-6 text-slate-600 dark:text-slate-300">
            {displaySnapshot.coreSellingPoints ? <p><strong>核心卖点：</strong>{displaySnapshot.coreSellingPoints}</p> : null}
            {displaySnapshot.targetAudience ? <p><strong>目标人群：</strong>{displaySnapshot.targetAudience}</p> : null}
            {displaySnapshot.painPoints ? <p><strong>用户痛点：</strong>{displaySnapshot.painPoints}</p> : null}
            {displaySnapshot.useScenarios ? <p><strong>使用场景：</strong>{displaySnapshot.useScenarios}</p> : null}
            {displaySnapshot.forbiddenWords ? <p><strong>禁忌词：</strong>{displaySnapshot.forbiddenWords}</p> : null}
            {displaySnapshot.forbiddenClaims ? <p><strong>不能承诺：</strong>{displaySnapshot.forbiddenClaims}</p> : null}
          </div>
        </details>
      ) : null}
    </section>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-2">
      <Label>{label}</Label>
      {children}
    </div>
  );
}

function PromptBlock({ title, value }: { title: string; value: string }) {
  const shouldFold = value.length > 420 || value.split("\n").length > 7;
  const preview = shouldFold ? `${value.slice(0, 260).trim()}...` : value;
  return (
    <section className="doc-section">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h3 className="text-sm font-semibold text-slate-950 dark:text-slate-100">{title}</h3>
        <Button size="sm" variant="ghost" onClick={() => copyText(value)}><Copy className="h-4 w-4" />复制</Button>
      </div>
      {shouldFold ? (
        <div className="space-y-3">
          <p className="whitespace-pre-wrap text-sm leading-7 text-slate-600 dark:text-slate-300">{preview}</p>
          <details className="rounded-2xl border border-slate-200/70 bg-white/60 p-3 dark:border-slate-800 dark:bg-slate-950/35">
            <summary className="cursor-pointer text-sm font-medium text-slate-700 dark:text-slate-300">展开完整提示词</summary>
            <div className="mt-3 whitespace-pre-wrap text-sm leading-7 text-slate-600 dark:text-slate-300">{value}</div>
          </details>
        </div>
      ) : (
        <p className="whitespace-pre-wrap text-sm leading-7 text-slate-600 dark:text-slate-300">{value}</p>
      )}
    </section>
  );
}

function promptLabel(key: string) {
  const labels: Record<string, string> = {
    chinese: "中文提示词",
    english: "英文提示词",
    jimeng: "即梦提示词",
    midjourney: "Midjourney 提示词",
    veo: "Gemini / Veo 图生视频提示词",
    kling: "可灵提示词",
    composition: "构图建议",
    cover: "封面文案",
  };
  return labels[key] || key;
}

function formatImagePrompt(result: Record<string, string>) {
  return Object.entries(result).map(([key, value]) => `【${promptLabel(key)}】\n${value}`).join("\n\n");
}

function copyText(value: string) {
  navigator.clipboard?.writeText(value).catch(() => undefined);
}
