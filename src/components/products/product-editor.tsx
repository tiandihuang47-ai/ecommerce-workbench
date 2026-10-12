"use client";

import { ChevronLeft, ChevronRight, FileText, ImagePlus, Loader2, Star, Trash2, Upload, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import {
  PRODUCT_IMAGE_LIMIT,
  formatFileSize,
  productImageRoleLabel,
  type ProductImageAsset
} from "@/lib/product-assets-types";
import {
  appendProductImages,
  getProductWithAssets,
  retryProductDocumentAnalysis,
  startProductDocumentAnalysis,
  productCoverImage,
  productHasDocument,
  removeProductImage,
  setProductCover,
  subscribeProductUpdates,
  uploadProductDocument,
  uploadProductImages,
  withProductImageUrls
} from "@/lib/product-assets-client";
import { saveProductRecord } from "@/lib/pipeline-storage";
import type { ProductRecord } from "@/lib/pipeline-types";
import { Modal } from "@/components/products/product-modal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const DOCUMENT_ACCEPT = ".docx,.doc,.md,.markdown,.txt";

/**
 * 产品编辑器：AI 生图的产品选择器与「产品资料」页共用同一套实现，
 * 都读写同一个 ProductRecord（不另建一份产品数据）。
 *
 * 图片与资料的增删改是真实的文件操作，点一下就立即生效；
 * 文本字段点「保存修改」才落库。底部会明确写出这一点，不做假保存。
 */
export function ProductEditor(props: {
  productId: string;
  onClose: () => void;
  onSaved?: (record: ProductRecord, options: { deletedImageIds: string[] }) => void;
  title?: string;
}) {
  const initial = getProductWithAssets(props.productId, { includeArchived: true });
  const [record, setRecord] = useState<ProductRecord | null>(initial);
  const [form, setForm] = useState({
    name: initial?.name || "",
    brandName: initial?.brandName || "",
    category: initial?.category || "",
    coreSellingPoints: initial?.coreSellingPoints || "",
    targetAudience: initial?.targetAudience || ""
  });
  const [busy, setBusy] = useState("");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [confirmReplace, setConfirmReplace] = useState<File | null>(null);
  const [preview, setPreview] = useState<{ images: ProductImageAsset[]; index: number } | null>(null);
  const deletedImageIds = useRef<string[]>([]);
  const imageInput = useRef<HTMLInputElement>(null);
  const documentInput = useRef<HTMLInputElement>(null);

  const refresh = useCallback(() => {
    const next = getProductWithAssets(props.productId, { includeArchived: true });
    if (next) setRecord(next);
    return next;
  }, [props.productId]);

  // 后台解析完成后同步编辑器里的状态
  useEffect(() => subscribeProductUpdates((productId) => {
    if (!productId || productId === props.productId) refresh();
  }), [props.productId, refresh]);

  const images = record ? withProductImageUrls(record.id, record.images) : [];
  const cover = record ? productCoverImage({ ...record, images }) : null;
  const remaining = Math.max(0, PRODUCT_IMAGE_LIMIT - images.length);

  function flash(text: string) {
    setNotice(text);
    setError("");
    window.setTimeout(() => setNotice((current) => (current === text ? "" : current)), 4000);
  }

  async function work(label: string, run: () => Promise<void>) {
    setBusy(label);
    setError("");
    try {
      await run();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "操作失败，请重试。");
    } finally {
      setBusy("");
    }
  }

  async function addImages(files: File[]) {
    if (!record || !files.length) return;
    if (remaining <= 0) {
      setError(`这个产品已经有 ${PRODUCT_IMAGE_LIMIT} 张图片，达到上限；请先删除不用的图片。`);
      return;
    }
    if (files.length > remaining) {
      setError(`该产品最多支持 ${PRODUCT_IMAGE_LIMIT} 张图片，当前已有 ${images.length} 张，本次最多还能添加 ${remaining} 张。`);
      return;
    }
    await work("images", async () => {
      const uploaded = await uploadProductImages(record.id, files);
      appendProductImages(getProductWithAssets(record.id, { includeArchived: true }) || record, uploaded);
      refresh();
      flash(`已添加 ${uploaded.length} 张商品图。`);
    });
  }

  async function removeImage(assetId: string) {
    if (!record) return;
    await work("images", async () => {
      const latest = getProductWithAssets(record.id, { includeArchived: true }) || record;
      const next = await removeProductImage(latest, assetId);
      deletedImageIds.current = [...deletedImageIds.current, assetId];
      setRecord(next);
      flash(next.coverImageId ? "图片已删除。" : "图片已删除，产品暂时没有封面。");
    });
  }

  async function setCover(assetId: string) {
    if (!record) return;
    await work("cover", async () => {
      const latest = getProductWithAssets(record.id, { includeArchived: true }) || record;
      setRecord(setProductCover(latest, assetId));
      flash("已设为产品封面。");
    });
  }

  async function pickDocument(file: File | null) {
    if (!file || !record) return;
    if (productHasDocument(record)) {
      setConfirmReplace(file);
      return;
    }
    await applyDocument(file);
  }

  async function applyDocument(file: File) {
    if (!record) return;
    await work("document", async () => {
      const latest = getProductWithAssets(record.id, { includeArchived: true }) || record;
      // 只等本地解析 + 落盘；AI 理解在后台继续，不占用用户的保存时间
      const result = await uploadProductDocument(latest, file);
      const saved = saveProductRecord({
        ...latest,
        ...result.product,
        name: latest.name,
        document: result.document,
        sourceDocumentName: result.document.name,
        sourceDocumentText: result.document.text,
        sourceDocumentImportedAt: result.document.updatedAt,
        documentAnalysisStatus: "processing",
        documentAnalysisError: "",
        documentAnalysisDocumentId: result.document.id
      });
      setRecord(saved);
      startProductDocumentAnalysis(saved.id, result.document, { onDone: (next) => setRecord(next) });
      flash("资料已保存，正在后台解析。");
    });
  }

  function save() {
    if (!record) return;
    if (!form.name.trim()) {
      setError("产品名称不能为空。");
      return;
    }
    const latest = getProductWithAssets(record.id, { includeArchived: true }) || record;
    const saved = saveProductRecord({ ...latest, ...form, name: form.name.trim() });
    props.onSaved?.(saved, { deletedImageIds: deletedImageIds.current });
    props.onClose();
  }

  if (!record) {
    return (
      <Modal title="编辑产品" onClose={props.onClose}>
        <p className="text-[13px] text-ink-3">这个产品已不存在。</p>
      </Modal>
    );
  }

  return (
    <>
      <Modal title={props.title || "编辑产品"} onClose={props.onClose} wide>
        <div className="max-h-[68vh] space-y-5 overflow-y-auto scrollbar-subtle pr-1">
          <div className="space-y-1.5">
            <Label>产品名称</Label>
            <Input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="例如：雅鹿安哥拉红短款羽绒服" autoFocus />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5"><Label>品牌</Label><Input value={form.brandName} onChange={(event) => setForm({ ...form, brandName: event.target.value })} placeholder="选填" /></div>
            <div className="space-y-1.5"><Label>品类</Label><Input value={form.category} onChange={(event) => setForm({ ...form, category: event.target.value })} placeholder="选填" /></div>
          </div>

          <div className="space-y-1.5">
            <Label>核心卖点</Label>
            <textarea
              value={form.coreSellingPoints}
              onChange={(event) => setForm({ ...form, coreSellingPoints: event.target.value })}
              rows={2}
              className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm"
              placeholder="一行一个；上传产品资料时 AI 会自动填好"
            />
          </div>

          <div className="space-y-1.5">
            <Label>目标人群</Label>
            <Input value={form.targetAudience} onChange={(event) => setForm({ ...form, targetAudience: event.target.value })} placeholder="选填" />
          </div>

          {/* ---------------- 商品图片 ---------------- */}
          <section className="space-y-2.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <h4 className="text-[13.5px] font-medium text-ink-1">商品图片</h4>
                <span className={cn("text-[12px]", images.length >= PRODUCT_IMAGE_LIMIT ? "text-[var(--ui-warn)]" : "text-ink-3")}>
                  {images.length} / {PRODUCT_IMAGE_LIMIT}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <input
                  ref={imageInput}
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  multiple
                  className="hidden"
                  onChange={(event) => {
                    const files = event.target.files ? Array.from(event.target.files) : [];
                    event.target.value = "";
                    void addImages(files);
                  }}
                />
                <Button size="sm" variant="outline" disabled={images.length >= PRODUCT_IMAGE_LIMIT || busy === "images"} onClick={() => imageInput.current?.click()}>
                  {busy === "images" ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Upload className="mr-1 h-3.5 w-3.5" />}
                  添加图片
                </Button>
              </div>
            </div>

            {images.length ? (
              <div className="grid grid-cols-3 gap-2.5 sm:grid-cols-4">
                {images.map((image, index) => {
                  const isCover = cover?.id === image.id;
                  return (
                    <figure key={image.id} className={cn("group relative overflow-hidden rounded-xl border bg-surface-2", isCover ? "border-[var(--ui-brand)]" : "border-line")}>
                      <button type="button" className="block aspect-square w-full" onClick={() => setPreview({ images, index })}>
                        <img src={image.thumbUrl || image.url} alt={image.name} className="h-full w-full object-cover" loading="lazy" />
                      </button>
                      {isCover ? (
                        <span className="absolute left-1.5 top-1.5 rounded-md bg-[var(--ui-brand)] px-1.5 py-0.5 text-[10.5px] text-white">封面</span>
                      ) : null}
                      <span className="absolute right-1.5 top-1.5 flex items-center gap-0.5 opacity-0 transition-opacity duration-150 group-hover:opacity-100">
                        {isCover ? null : (
                          <button type="button" aria-label="设为封面" title="设为封面" onClick={() => void setCover(image.id)}
                            className="rounded-md bg-black/60 p-1 text-white hover:bg-black/75">
                            <Star className="h-3.5 w-3.5" />
                          </button>
                        )}
                        <button type="button" aria-label="删除图片" title="删除图片" onClick={() => void removeImage(image.id)}
                          className="rounded-md bg-black/60 p-1 text-white hover:bg-black/75">
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </span>
                      <figcaption className="truncate px-2 py-1.5 text-[10.5px] text-ink-3">{productImageRoleLabel(image.role)}</figcaption>
                    </figure>
                  );
                })}
                {images.length < PRODUCT_IMAGE_LIMIT ? (
                  <button type="button" onClick={() => imageInput.current?.click()}
                    className="flex aspect-square flex-col items-center justify-center gap-1 rounded-xl border border-dashed border-line text-ink-3 transition-colors hover:border-line-strong hover:text-ink-2">
                    <ImagePlus className="h-4 w-4" /><span className="text-[11px]">添加</span>
                  </button>
                ) : null}
              </div>
            ) : (
              <button type="button" onClick={() => imageInput.current?.click()}
                className="flex w-full flex-col items-center gap-1.5 rounded-xl border border-dashed border-line py-8 text-ink-3 transition-colors hover:border-line-strong hover:text-ink-2">
                <ImagePlus className="h-5 w-5" />
                <span className="text-[12.5px]">还没有商品图片，点这里添加</span>
                <span className="text-[11.5px] text-ink-3/80">最多 {PRODUCT_IMAGE_LIMIT} 张，第一张会自动成为封面</span>
              </button>
            )}
          </section>

          {/* ---------------- 产品资料 ---------------- */}
          <section className="space-y-2.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h4 className="text-[13.5px] font-medium text-ink-1">产品资料</h4>
              <div className="flex items-center gap-2">
                <input
                  ref={documentInput}
                  type="file"
                  accept={DOCUMENT_ACCEPT}
                  className="hidden"
                  onChange={(event) => {
                    const file = event.target.files?.[0] || null;
                    event.target.value = "";
                    void pickDocument(file);
                  }}
                />
                <Button size="sm" variant="outline" disabled={busy === "document"} onClick={() => documentInput.current?.click()}>
                  {busy === "document" ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Upload className="mr-1 h-3.5 w-3.5" />}
                  {productHasDocument(record) ? "替换产品资料" : "上传产品资料"}
                </Button>
              </div>
            </div>

            {record.document ? (
              <div className="flex items-start gap-3 rounded-xl border border-line bg-surface-2 px-3.5 py-3">
                <FileText className="mt-0.5 h-4 w-4 shrink-0 text-ink-3" strokeWidth={1.7} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13px] text-ink-1">{record.document.name}</p>
                  <p className="mt-1 text-[11.5px] text-ink-3">
                    {formatFileSize(record.document.size)} · 更新于 {new Date(record.document.updatedAt).toLocaleString("zh-CN")}
                  </p>
                </div>
                {record.document.downloadUrl ? (
                  <a href={record.document.downloadUrl} className="shrink-0 rounded-md border border-line px-2 py-0.5 text-[11.5px] text-ink-2 hover:bg-surface hover:text-ink-1">下载</a>
                ) : null}
              </div>
            ) : (
              <p className="rounded-xl border border-dashed border-line px-3.5 py-4 text-[12.5px] text-ink-3">
                还没有产品资料。上传 Word 或 Markdown，AI 会自动读取卖点、规格与人群。
              </p>
            )}
            <div className="flex flex-wrap items-center gap-2 text-[11.5px]">
              {record.documentAnalysisStatus === "processing" ? (
                <span className="inline-flex items-center gap-1 text-[var(--ui-warn)]"><Loader2 className="h-3 w-3 animate-spin" />资料解析中…</span>
              ) : record.documentAnalysisStatus === "failed" ? (
                <>
                  <span className="text-[var(--ui-danger)]">资料解析失败</span>
                  <button type="button" onClick={() => retryProductDocumentAnalysis(record.id, { onDone: (next) => setRecord(next) })}
                    className="rounded-md border border-line px-2 py-0.5 text-ink-2 hover:bg-surface hover:text-ink-1">重试解析</button>
                </>
              ) : record.documentAnalysisStatus === "ready" ? (
                <span className="text-[var(--ui-ok)]">资料已就绪</span>
              ) : null}
            </div>
            <p className="text-[11.5px] leading-5 text-ink-3">一个产品只保留一份资料。更新后的资料用于以后的新任务，历史任务仍保留生成时的资料。</p>
          </section>

          {notice ? <p className="text-[12px] text-[var(--ui-ok)]">{notice}</p> : null}
          {error ? <p className="text-[12px] text-[var(--ui-danger)]">{error}</p> : null}
        </div>

        <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-line pt-3.5">
          <p className="text-[11.5px] text-ink-3">图片与资料的改动会立即生效；名称等信息点保存后生效。</p>
          <div className="flex items-center gap-2">
            <Button variant="ghost" onClick={props.onClose} disabled={Boolean(busy)}>取消</Button>
            <Button onClick={save} disabled={Boolean(busy)}>保存修改</Button>
          </div>
        </div>
      </Modal>

      {confirmReplace ? (
        <Modal title="替换当前产品资料？" onClose={() => setConfirmReplace(null)}>
          <p className="text-[13px] leading-6 text-ink-2">更新后，新生成任务将使用最新产品资料，历史任务不会变化。一个产品只保留一份资料。</p>
          <div className="mt-5 flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setConfirmReplace(null)}>取消</Button>
            <Button onClick={() => { const file = confirmReplace; setConfirmReplace(null); void applyDocument(file); }}>替换资料</Button>
          </div>
        </Modal>
      ) : null}

      {preview ? (
        <ProductImagePreview
          images={preview.images}
          index={preview.index}
          onIndex={(index) => setPreview((current) => current ? { ...current, index } : current)}
          onClose={() => setPreview(null)}
        />
      ) : null}
    </>
  );
}

function ProductImagePreview(props: { images: ProductImageAsset[]; index: number; onIndex: (index: number) => void; onClose: () => void }) {
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
    <div className="fixed inset-0 z-[130] flex flex-col items-center justify-center bg-black/85 p-6" onClick={props.onClose}>
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
