"use client";

import { ChevronLeft, ChevronRight, FileText, ImagePlus, Loader2, Pencil, Plus, Search, Star, Trash2, Upload, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import {
  PRODUCT_IMAGE_LIMIT,
  PRODUCT_IMAGE_ROLES,
  PRODUCT_IMAGE_ROLE_LABELS,
  formatFileSize,
  productImageRoleLabel,
  type ProductImageAsset,
  type ProductImageRole
} from "@/lib/product-assets-types";
import {
  appendProductImages,
  archiveProduct,
  resumePendingDocumentAnalyses,
  retryProductDocumentAnalysis,
  subscribeProductUpdates,
  createProductFromDocument,
  hydrateProductRecord,
  productCoverImage,
  productHasDocument,
  removeProductDocument,
  removeProductImage,
  setProductCover,
  setProductImageRole,
  uploadProductDocument,
  uploadProductImages,
  withProductImageUrls
} from "@/lib/product-assets-client";
import { getProductRecordById, getProductRecords, saveProductRecord } from "@/lib/pipeline-storage";
import type { ProductRecord } from "@/lib/pipeline-types";
import { Modal } from "@/components/products/product-modal";
import { ProductEditor } from "@/components/products/product-editor";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const DOCUMENT_ACCEPT = ".docx,.doc,.md,.markdown,.txt";

export function ProductAssetCenter() {
  const [products, setProducts] = useState<ProductRecord[]>([]);
  const [activeId, setActiveId] = useState("");
  const [keyword, setKeyword] = useState("");
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [preview, setPreview] = useState<{ images: ProductImageAsset[]; index: number } | null>(null);

  const refresh = useCallback((preferId?: string) => {
    const list = getProductRecords().map(hydrateProductRecord);
    setProducts(list);
    setActiveId((current) => {
      const wanted = preferId || current;
      if (wanted && list.some((item) => item.id === wanted)) return wanted;
      return list[0]?.id || "";
    });
  }, []);

  useEffect(() => {
    resumePendingDocumentAnalyses();
    refresh();
  }, [refresh]);

  // 后台解析完成后，列表与详情的状态要跟着更新，不需要用户刷新页面
  useEffect(() => subscribeProductUpdates(() => refresh()), [refresh]);

  const active = useMemo(() => products.find((item) => item.id === activeId) || null, [products, activeId]);
  const filtered = useMemo(() => {
    const value = keyword.trim().toLowerCase();
    if (!value) return products;
    return products.filter((item) => item.name.toLowerCase().includes(value));
  }, [products, keyword]);

  const notify = useCallback((text: string) => {
    setMessage(text);
    setError("");
    window.setTimeout(() => setMessage((current) => (current === text ? "" : current)), 5200);
  }, []);
  const fail = useCallback((text: string) => {
    setError(text);
    setMessage("");
  }, []);

  async function run(label: string, work: () => Promise<void>) {
    setBusy(label);
    setError("");
    try {
      await work();
    } catch (cause) {
      fail(cause instanceof Error ? cause.message : "操作失败，请重试。");
    } finally {
      setBusy("");
    }
  }

  return (
    <div className="flex min-h-[calc(100dvh-56px)] flex-col">
      <header className="mb-4 shrink-0">
        <p className="text-[11.5px] text-ink-3">AI 内容中台 / 产品资料</p>
        <h1 className="mt-1 text-[26px] font-medium tracking-[-0.02em] text-ink-1">产品资料</h1>
        <p className="mt-1.5 text-[12.5px] text-ink-3">每个产品一份完整资产：商品图片 + 一份产品资料。AI 生图直接选产品，不用每次重新上传。</p>
      </header>

      <div className="flex min-h-0 flex-1 flex-col gap-4 lg:flex-row">
        {/* 左：产品列表 */}
        <aside className="flex w-full shrink-0 flex-col overflow-hidden rounded-2xl border border-line bg-surface lg:w-[320px]">
          <div className="flex shrink-0 items-center gap-2 border-b border-line px-3 py-2.5">
            <div className="flex min-w-0 flex-1 items-center gap-2 rounded-lg border border-line bg-surface-2 px-2.5 py-1.5">
              <Search className="h-3.5 w-3.5 shrink-0 text-ink-3" strokeWidth={1.8} />
              <input
                value={keyword}
                onChange={(event) => setKeyword(event.target.value)}
                placeholder="搜索产品"
                className="min-w-0 flex-1 bg-transparent text-[13px] text-ink-1 placeholder:text-ink-3 focus:outline-none"
              />
            </div>
            <Button size="sm" onClick={() => setCreateOpen(true)} className="shrink-0">
              <Plus className="mr-1 h-3.5 w-3.5" />新建
            </Button>
          </div>

          <div className="min-h-0 flex-1 space-y-1.5 overflow-y-auto scrollbar-subtle p-2">
            {filtered.length ? filtered.map((item) => (
              <ProductListCard
                key={item.id}
                product={item}
                active={item.id === activeId}
                onSelect={() => setActiveId(item.id)}
              />
            )) : (
              <p className="px-3 py-8 text-center text-[12.5px] text-ink-3">
                {products.length ? "没有匹配的产品。" : "还没有产品。点「新建」添加商品图片和产品资料。"}
              </p>
            )}
          </div>
        </aside>

        {/* 右：产品详情 */}
        <section className="flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto scrollbar-subtle rounded-2xl border border-line bg-surface">
          {active ? (
            <ProductDetail
              key={active.id}
              product={active}
              busy={busy}
              run={run}
              onRefresh={refresh}
              onNotify={notify}
              onFail={fail}
              onEdit={() => setEditOpen(true)}
              onPreview={(images, index) => setPreview({ images, index })}
            />
          ) : (
            <EmptyDetail onCreate={() => setCreateOpen(true)} />
          )}
        </section>
      </div>

      {(message || error) ? (
        <div className={cn(
          "fixed bottom-6 left-1/2 z-[100] flex max-w-xl -translate-x-1/2 items-center gap-3 rounded-xl border px-4 py-2.5 text-[12.5px] shadow-2xl",
          error ? "border-[var(--ui-danger)] bg-[var(--ui-danger-soft)] text-ink-1" : "border-line-strong bg-surface text-ink-1"
        )}>
          <span>{error || message}</span>
          <button type="button" aria-label="关闭提示" onClick={() => { setMessage(""); setError(""); }}>
            <X className="h-3.5 w-3.5 text-ink-3" />
          </button>
        </div>
      ) : null}

      {createOpen ? (
        <CreateProductDialog
          onClose={() => setCreateOpen(false)}
          onCreated={(id, text) => { setCreateOpen(false); refresh(id); notify(text); }}
          onFail={(text) => { setCreateOpen(false); fail(text); }}
        />
      ) : null}

      {editOpen && active ? (
        <ProductEditor
          productId={active.id}
          onClose={() => setEditOpen(false)}
          onSaved={() => { setEditOpen(false); refresh(active.id); notify("产品已更新。"); }}
        />
      ) : null}

      {preview ? (
        <ImageLightbox
          images={preview.images}
          index={preview.index}
          onIndex={(index) => setPreview((current) => current ? { ...current, index } : current)}
          onClose={() => setPreview(null)}
        />
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------ 列表卡片 */

function ProductListCard({ product, active, onSelect }: { product: ProductRecord; active: boolean; onSelect: () => void }) {
  const cover = productCoverImage(product);
  const count = (product.images || []).length;
  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        "flex w-full items-center gap-3 rounded-xl border px-2.5 py-2 text-left transition-colors duration-150",
        active ? "border-[var(--ui-brand)] bg-[var(--ui-brand-soft)]" : "border-transparent hover:bg-surface-2"
      )}
    >
      <span className="h-11 w-11 shrink-0 overflow-hidden rounded-lg border border-line bg-surface-2">
        {cover ? <img src={cover.thumbUrl || cover.url} alt={product.name} className="h-full w-full object-cover" /> : (
          <span className="flex h-full w-full items-center justify-center text-ink-3"><ImagePlus className="h-4 w-4" /></span>
        )}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px] text-ink-1">{product.name || "未命名产品"}</span>
        <span className="mt-0.5 block truncate text-[11.5px] text-ink-3">
          {count} 张图片 · {documentStatusText(product)}
        </span>
      </span>
    </button>
  );
}

/* ------------------------------------------------------------------ 详情 */

function ProductDetail(props: {
  product: ProductRecord;
  busy: string;
  run: (label: string, work: () => Promise<void>) => Promise<void>;
  onRefresh: (preferId?: string) => void;
  onNotify: (text: string) => void;
  onFail: (text: string) => void;
  onEdit: () => void;
  onPreview: (images: ProductImageAsset[], index: number) => void;
}) {
  const { product } = props;
  const [tab, setTab] = useState<"images" | "document">("images");
  const [confirmArchive, setConfirmArchive] = useState(false);
  const [confirmReplace, setConfirmReplace] = useState<File | null>(null);
  const imageInput = useRef<HTMLInputElement>(null);
  const documentInput = useRef<HTMLInputElement>(null);
  const images = withProductImageUrls(product.id, product.images);
  const cover = productCoverImage({ ...product, images });

  async function addImages(files: File[]) {
    if (!files.length) return;
    const list = files;
    const remaining = PRODUCT_IMAGE_LIMIT - images.length;
    if (remaining <= 0) { props.onFail(`这个产品已经有 ${PRODUCT_IMAGE_LIMIT} 张图片，达到上限；请先删除不用的图片。`); return; }
    if (list.length > remaining) { props.onFail(`最多还能再添加 ${remaining} 张，本次选择了 ${list.length} 张，请分批上传。`); return; }
    await props.run("images", async () => {
      const uploaded = await uploadProductImages(product.id, list);
      appendProductImages(getProductRecordById(product.id) || product, uploaded);
      props.onRefresh(product.id);
      props.onNotify(`已添加 ${uploaded.length} 张商品图。`);
    });
  }

  async function pickDocument(file: File | null) {
    if (!file) return;
    if (productHasDocument(product)) { setConfirmReplace(file); return; }
    await applyDocument(file);
  }

  async function applyDocument(file: File) {
    await props.run("document", async () => {
      const result = await uploadProductDocument(getProductRecordById(product.id) || product, file);
      saveProductRecord({
        ...(getProductRecordById(product.id) || product),
        ...result.product,
        name: product.name,
        document: result.document,
        sourceDocumentName: result.document.name,
        sourceDocumentText: result.document.text,
        sourceDocumentImportedAt: result.document.updatedAt
      });
      props.onRefresh(product.id);
      props.onNotify(result.message);
    });
  }

  return (
    <>
      <header className="flex shrink-0 flex-wrap items-center gap-4 border-b border-line px-5 py-4">
        <div className="h-16 w-16 shrink-0 overflow-hidden rounded-xl border border-line bg-surface-2">
          {cover ? <img src={cover.thumbUrl || cover.url} alt={product.name} className="h-full w-full object-cover" /> : (
            <span className="flex h-full w-full items-center justify-center text-ink-3"><ImagePlus className="h-5 w-5" /></span>
          )}
        </div>
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-[18px] font-medium text-ink-1">{product.name || "未命名产品"}</h2>
          <p className="mt-1 text-[12.5px] text-ink-3">
            {images.length} / {PRODUCT_IMAGE_LIMIT} 张商品图 · {productHasDocument(product) ? "已绑定产品资料" : "未绑定产品资料"}
          </p>
          {(product.brandName || product.category) ? (
            <p className="mt-0.5 truncate text-[11.5px] text-ink-3">{[product.brandName, product.category].filter(Boolean).join(" · ")}</p>
          ) : null}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {/* 资料解析状态常驻头部：不管当前在哪个 Tab 都能一眼看到，失败时可直接重试 */}
          {productHasDocument(product) ? (
            product.documentAnalysisStatus === "processing" ? (
              <span className="inline-flex items-center gap-1.5 rounded-md border border-line px-2 py-0.5 text-[11.5px] text-ink-3">
                <Loader2 className="h-3 w-3 animate-spin" />资料解析中
              </span>
            ) : product.documentAnalysisStatus === "failed" ? (
              <span className="inline-flex items-center gap-1.5">
                <span className="rounded-md border border-[var(--ui-danger)] px-2 py-0.5 text-[11.5px] text-[var(--ui-danger)]">资料解析失败</span>
                <button type="button" onClick={() => { retryProductDocumentAnalysis(product.id); props.onRefresh(product.id); }}
                  className="rounded-md border border-line px-2 py-0.5 text-[11.5px] text-ink-2 transition-colors hover:bg-surface-2 hover:text-ink-1">
                  重试
                </button>
              </span>
            ) : product.documentAnalysisStatus === "ready" ? (
              <span className="rounded-md border border-line px-2 py-0.5 text-[11.5px] text-[var(--ui-ok)]">资料已就绪</span>
            ) : null
          ) : null}
          <Button variant="outline" size="sm" onClick={props.onEdit}><Pencil className="mr-1 h-3.5 w-3.5" />编辑产品</Button>
          <Button variant="outline" size="sm" onClick={() => setConfirmArchive(true)}><Trash2 className="mr-1 h-3.5 w-3.5" />删除产品</Button>
        </div>
      </header>

      <div className="flex shrink-0 items-center gap-1 border-b border-line px-5">
        {([["images", `产品图片 ${images.length}`], ["document", "产品资料"]] as const).map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => setTab(key)}
            className={cn(
              "-mb-px border-b-2 px-3 py-2.5 text-[13px] transition-colors duration-150",
              tab === key ? "border-[var(--ui-brand)] text-ink-1" : "border-transparent text-ink-3 hover:text-ink-2"
            )}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="min-h-0 flex-1 p-5">
        {tab === "images" ? (
          <section className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-[13px] text-ink-2">
                当前数量 <span className="font-medium text-ink-1">{images.length} / {PRODUCT_IMAGE_LIMIT}</span>
              </p>
              <div className="flex items-center gap-2">
                <input ref={imageInput} type="file" accept="image/png,image/jpeg,image/webp" multiple className="hidden"
                  onChange={(event) => { const files = event.target.files ? Array.from(event.target.files) : []; event.target.value = ""; void addImages(files); }} />
                <Button size="sm" disabled={images.length >= PRODUCT_IMAGE_LIMIT || props.busy === "images"} onClick={() => imageInput.current?.click()}>
                  {props.busy === "images" ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Upload className="mr-1 h-3.5 w-3.5" />}
                  {images.length ? "继续添加商品图" : "上传商品图"}
                </Button>
              </div>
            </div>

            {images.length ? (
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">
                {images.map((image, index) => (
                  <figure key={image.id} className="group relative overflow-hidden rounded-xl border border-line bg-surface-2">
                    <button type="button" className="block aspect-square w-full" onClick={() => props.onPreview(images, index)}>
                      <img src={image.thumbUrl || image.url} alt={image.name} className="h-full w-full object-cover" loading="lazy" />
                    </button>
                    {product.coverImageId === image.id || (!product.coverImageId && index === 0) ? (
                      <span className="absolute left-1.5 top-1.5 rounded-md bg-black/65 px-1.5 py-0.5 text-[10.5px] text-white">封面</span>
                    ) : null}
                    <figcaption className="flex items-center justify-between gap-1 border-t border-line px-2 py-1.5">
                      <span className="truncate text-[11px] text-ink-3">{productImageRoleLabel(image.role)}</span>
                      <span className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity duration-150 group-hover:opacity-100">
                        <IconAction label="设为封面" onClick={() => { setProductCover(product, image.id); props.onRefresh(product.id); props.onNotify("已设为产品封面。"); }}>
                          <Star className={cn("h-3.5 w-3.5", product.coverImageId === image.id ? "fill-current" : "")} />
                        </IconAction>
                        <IconAction label="删除图片" onClick={() => void props.run("image-remove", async () => {
                          await removeProductImage(getProductRecordById(product.id) || product, image.id);
                          props.onRefresh(product.id);
                          props.onNotify("图片已删除。");
                        })}>
                          <Trash2 className="h-3.5 w-3.5" />
                        </IconAction>
                      </span>
                    </figcaption>
                    <div className="absolute right-1.5 top-1.5 opacity-0 transition-opacity duration-150 group-hover:opacity-100">
                      <select
                        value={image.role}
                        onChange={(event) => { setProductImageRole(product, image.id, event.target.value as ProductImageRole | ""); props.onRefresh(product.id); }}
                        className="rounded-md border border-line bg-black/65 px-1 py-0.5 text-[10.5px] text-white"
                        aria-label="图片类型"
                      >
                        <option value="">未分类</option>
                        {PRODUCT_IMAGE_ROLES.map((role) => <option key={role} value={role}>{PRODUCT_IMAGE_ROLE_LABELS[role]}</option>)}
                      </select>
                    </div>
                  </figure>
                ))}
              </div>
            ) : (
              <div className="rounded-xl border border-dashed border-line px-6 py-12 text-center">
                <ImagePlus className="mx-auto h-6 w-6 text-ink-3" strokeWidth={1.6} />
                <p className="mt-2 text-[13px] text-ink-2">还没有商品图片</p>
                <p className="mt-1 text-[12px] text-ink-3">正面、侧面、细节、模特图都可以放进来，最多 {PRODUCT_IMAGE_LIMIT} 张；第一张会自动成为封面。</p>
              </div>
            )}
          </section>
        ) : (
          <section className="max-w-2xl space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-[13px] text-ink-2">一个产品只绑定一份产品资料，新资料会替换旧资料。</p>
              <div className="flex items-center gap-2">
                <input ref={documentInput} type="file" accept={DOCUMENT_ACCEPT} className="hidden"
                  onChange={(event) => { const file = event.target.files?.[0] || null; event.target.value = ""; void pickDocument(file); }} />
                <Button size="sm" disabled={props.busy === "document"} onClick={() => documentInput.current?.click()}>
                  {props.busy === "document" ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Upload className="mr-1 h-3.5 w-3.5" />}
                  {productHasDocument(product) ? "更新资料" : "上传产品资料"}
                </Button>
              </div>
            </div>

            {product.document ? (
              <div className="rounded-xl border border-line bg-surface-2 px-4 py-3.5">
                <div className="flex items-start gap-3">
                  <FileText className="mt-0.5 h-4 w-4 shrink-0 text-ink-3" strokeWidth={1.7} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13px] text-ink-1">{product.document.name}</p>
                    <p className="mt-1 text-[11.5px] text-ink-3">
                      {formatFileSize(product.document.size)} · 更新于 {new Date(product.document.updatedAt).toLocaleString("zh-CN")}
                    </p>
                    <p className="mt-2 flex flex-wrap items-center gap-2 text-[11.5px] text-ink-3">
                      {product.documentAnalysisStatus === "processing" ? (
                        <span className="inline-flex items-center gap-1"><Loader2 className="h-3 w-3 animate-spin" />资料解析中…</span>
                      ) : product.documentAnalysisStatus === "failed" ? (
                        <span className="text-[var(--ui-danger)]">资料解析失败</span>
                      ) : (
                        <span className="text-[var(--ui-ok)]">资料已就绪</span>
                      )}
                      {product.documentAnalysisStatus === "failed" ? (
                        <button type="button" onClick={() => { retryProductDocumentAnalysis(product.id); props.onRefresh(product.id); props.onNotify("正在重新解析产品资料。"); }}
                          className="rounded-md border border-line px-2 py-0.5 text-[11.5px] text-ink-2 hover:bg-surface hover:text-ink-1">
                          重试解析
                        </button>
                      ) : null}
                    </p>
                    <p className="mt-1 text-[11.5px] text-ink-3">新任务使用最新产品资料，历史任务保持原生成时资料。</p>
                    <div className="mt-2.5 flex flex-wrap items-center gap-2">
                      {product.document.downloadUrl ? (
                        <a href={product.document.downloadUrl} className="rounded-md border border-line px-2 py-0.5 text-[11.5px] text-ink-2 transition-colors hover:bg-surface hover:text-ink-1">下载原文件</a>
                      ) : null}
                      <button type="button" onClick={() => void props.run("document-remove", async () => {
                        await removeProductDocument(getProductRecordById(product.id) || product);
                        props.onRefresh(product.id);
                        props.onNotify("产品资料已移除。");
                      })} className="rounded-md border border-line px-2 py-0.5 text-[11.5px] text-ink-2 transition-colors hover:bg-surface hover:text-ink-1">
                        移除资料
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              <div className="rounded-xl border border-dashed border-line px-6 py-12 text-center">
                <FileText className="mx-auto h-6 w-6 text-ink-3" strokeWidth={1.6} />
                <p className="mt-2 text-[13px] text-ink-2">还没有产品资料</p>
                <p className="mt-1 text-[12px] text-ink-3">上传 Word 或 Markdown，AI 会自动读取卖点、规格与人群；AI 生图会直接引用这份资料。</p>
              </div>
            )}
          </section>
        )}
      </div>

      {confirmArchive ? (
        <ConfirmDialog
          title="删除这个产品？"
          body="删除后该产品不再出现在产品列表和 AI 生图的产品选择器里；已经生成的图片任务与历史项目不受影响，仍可回看当时使用的图片和资料。"
          confirmText="删除产品"
          onCancel={() => setConfirmArchive(false)}
          onConfirm={() => { archiveProduct(product.id); setConfirmArchive(false); props.onRefresh(); props.onNotify("产品已删除，历史任务保持不变。"); }}
        />
      ) : null}

      {confirmReplace ? (
        <ConfirmDialog
          title="替换当前产品资料？"
          body="更新后，新生成任务将使用最新产品资料，历史任务不会变化。一个产品只保留一份资料。"
          confirmText="替换资料"
          onCancel={() => setConfirmReplace(null)}
          onConfirm={() => { const file = confirmReplace; setConfirmReplace(null); void applyDocument(file); }}
        />
      ) : null}
    </>
  );
}

function documentStatusText(product: ProductRecord) {
  if (!productHasDocument(product)) return "无资料";
  if (product.documentAnalysisStatus === "processing") return "资料解析中";
  if (product.documentAnalysisStatus === "failed") return "资料解析失败";
  return "资料已绑定";
}

function IconAction({ label, onClick, children }: { label: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" aria-label={label} title={label} onClick={onClick}
      className="rounded-md p-1 text-ink-3 transition-colors duration-150 hover:bg-surface hover:text-ink-1">
      {children}
    </button>
  );
}

function EmptyDetail({ onCreate }: { onCreate: () => void }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 p-10 text-center">
      <ImagePlus className="h-7 w-7 text-ink-3" strokeWidth={1.6} />
      <p className="text-[14px] text-ink-1">这里是你的产品资产</p>
      <p className="max-w-sm text-[12.5px] text-ink-3">一个产品 = 最多 {PRODUCT_IMAGE_LIMIT} 张商品图片 + 一份产品资料。建好以后，AI 生图直接选产品就能创作。</p>
      <Button size="sm" onClick={onCreate}><Plus className="mr-1 h-3.5 w-3.5" />新建产品</Button>
    </div>
  );
}

/* ------------------------------------------------------------------ 新建 / 编辑 */

export function CreateProductDialog(props: { onClose: () => void; onCreated: (id: string, message: string) => void; onFail: (message: string) => void }) {
  const [name, setName] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [document, setDocument] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const imageInput = useRef<HTMLInputElement>(null);
  const documentInput = useRef<HTMLInputElement>(null);

  async function submit() {
    if (!name.trim()) { props.onFail("请先填写产品名称。"); return; }
    if (files.length > PRODUCT_IMAGE_LIMIT) { props.onFail(`一个产品最多 ${PRODUCT_IMAGE_LIMIT} 张图片，请先减少一些。`); return; }
    setBusy(true);
    try {
      const created = await createProductFromDocument({ name, file: document });
      if (files.length) {
        const uploaded = await uploadProductImages(created.record.id, files);
        appendProductImages(created.record, uploaded);
      }
      props.onCreated(created.record.id, `产品「${name.trim()}」已创建。`);
    } catch (cause) {
      props.onFail(cause instanceof Error ? cause.message : "产品创建失败，请重试。");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title="新建产品" onClose={props.onClose}>
      <div className="space-y-4">
        <div className="space-y-1.5">
          <Label>产品名称</Label>
          <Input value={name} onChange={(event) => setName(event.target.value)} placeholder="例如：雅鹿安哥拉红短款羽绒服" autoFocus />
        </div>

        <div className="space-y-1.5">
          <Label>商品图片（最多 {PRODUCT_IMAGE_LIMIT} 张，可稍后继续添加）</Label>
          <input ref={imageInput} type="file" accept="image/png,image/jpeg,image/webp" multiple className="hidden"
            onChange={(event) => { const list = event.target.files ? Array.from(event.target.files) : []; event.target.value = ""; setFiles((current) => [...current, ...list].slice(0, PRODUCT_IMAGE_LIMIT)); }} />
          <button type="button" onClick={() => imageInput.current?.click()}
            className="flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-line py-5 text-[12.5px] text-ink-3 transition-colors hover:border-line-strong hover:bg-surface-2 hover:text-ink-2">
            <ImagePlus className="h-4 w-4" />{files.length ? `已选择 ${files.length} 张，点击继续添加` : "选择商品图片"}
          </button>
          {files.length ? (
            <div className="flex flex-wrap gap-1.5">
              {files.map((file, index) => (
                <span key={`${file.name}-${index}`} className="inline-flex items-center gap-1 rounded-md border border-line px-1.5 py-0.5 text-[11px] text-ink-3">
                  {file.name.slice(0, 16)}
                  <button type="button" aria-label="移除" onClick={() => setFiles((current) => current.filter((_, i) => i !== index))}><X className="h-3 w-3" /></button>
                </span>
              ))}
            </div>
          ) : null}
        </div>

        <div className="space-y-1.5">
          <Label>产品资料（可选，一个产品只保留一份）</Label>
          <input ref={documentInput} type="file" accept={DOCUMENT_ACCEPT} className="hidden"
            onChange={(event) => { const file = event.target.files?.[0] || null; event.target.value = ""; setDocument(file); }} />
          <button type="button" onClick={() => documentInput.current?.click()}
            className="flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-line py-4 text-[12.5px] text-ink-3 transition-colors hover:border-line-strong hover:bg-surface-2 hover:text-ink-2">
            <FileText className="h-4 w-4" />{document ? document.name : "选择 Word / Markdown 产品资料"}
          </button>
        </div>

        <div className="flex justify-end gap-2 pt-1">
          <Button variant="ghost" onClick={props.onClose} disabled={busy}>取消</Button>
          <Button onClick={() => void submit()} disabled={busy}>
            {busy ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : null}保存产品
          </Button>
        </div>
      </div>
    </Modal>
  );
}

/* ------------------------------------------------------------------ 通用件 */

function ConfirmDialog(props: { title: string; body: string; confirmText: string; onCancel: () => void; onConfirm: () => void }) {
  return (
    <Modal title={props.title} onClose={props.onCancel}>
      <p className="text-[13px] leading-6 text-ink-2">{props.body}</p>
      <div className="mt-5 flex justify-end gap-2">
        <Button variant="ghost" onClick={props.onCancel}>取消</Button>
        <Button onClick={props.onConfirm}>{props.confirmText}</Button>
      </div>
    </Modal>
  );
}

function ImageLightbox(props: { images: ProductImageAsset[]; index: number; onIndex: (index: number) => void; onClose: () => void }) {
  const current = props.images[props.index];
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") props.onClose();
      if (event.key === "ArrowLeft") props.onIndex((props.index - 1 + props.images.length) % props.images.length);
      if (event.key === "ArrowRight") props.onIndex((props.index + 1) % props.images.length);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [props]);

  if (!current) return null;
  return (
    <div className="fixed inset-0 z-[120] flex flex-col items-center justify-center bg-black/80 p-6" onClick={props.onClose}>
      <img src={current.url} alt={current.name} className="max-h-[80vh] max-w-full rounded-xl object-contain" onClick={(event) => event.stopPropagation()} />
      <div className="mt-3 flex items-center gap-3 text-[12.5px] text-white/85" onClick={(event) => event.stopPropagation()}>
        <button type="button" aria-label="上一张" className="rounded-lg bg-white/10 p-1.5 hover:bg-white/20"
          onClick={() => props.onIndex((props.index - 1 + props.images.length) % props.images.length)}><ChevronLeft className="h-4 w-4" /></button>
        <span>{props.index + 1} / {props.images.length}</span>
        <button type="button" aria-label="下一张" className="rounded-lg bg-white/10 p-1.5 hover:bg-white/20"
          onClick={() => props.onIndex((props.index + 1) % props.images.length)}><ChevronRight className="h-4 w-4" /></button>
      </div>
      <button type="button" aria-label="关闭预览" className="absolute right-6 top-6 rounded-lg bg-white/10 p-2 text-white hover:bg-white/20" onClick={props.onClose}><X className="h-4 w-4" /></button>
    </div>
  );
}
