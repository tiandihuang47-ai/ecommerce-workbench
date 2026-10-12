"use client";

import { CheckSquare, ImagePlus, Loader2, Package, Plus, Search, Square, X } from "lucide-react";
import { useMemo, useState } from "react";
import { cn } from "@/lib/utils";
import { PRODUCT_IMAGE_LIMIT, productImageRoleLabel, type ProductImageAsset } from "@/lib/product-assets-types";
import { Modal } from "@/components/products/product-modal";
import { Button } from "@/components/ui/button";
import type { ProductRecord } from "@/lib/pipeline-types";
import { productCoverImage, productHasDocument } from "@/lib/product-assets-client";

export type SelectedProductInfo = {
  id: string;
  name: string;
  imageCount: number;
  documentName: string;
  hasDocument: boolean;
  images: ProductImageAsset[];
  mode: "all" | "selected";
  selectedImageIds: string[];
};

/** 「我的产品」素材卡：没选产品时是选择入口，选好后是产品摘要。 */
export function ProductSummaryCard(props: {
  product: SelectedProductInfo | null;
  busy: boolean;
  onPick: () => void;
  onCreate: () => void;
  onEdit: () => void;
  onDetach: () => void;
}) {
  if (!props.product) {
    return (
      <div className="rounded-xl border border-dashed border-line px-3 py-4">
        <div className="flex items-center gap-2 text-ink-3">
          <Package className="h-4 w-4" strokeWidth={1.7} />
          <span className="text-[12.5px]">从产品资料里选一个已有产品，图片和资料自动带过来。</span>
        </div>
        <div className="mt-3 flex items-center gap-2">
          <Button size="sm" disabled={props.busy} onClick={props.onPick}>选择产品</Button>
          <Button size="sm" variant="outline" onClick={props.onCreate}><Plus className="mr-1 h-3.5 w-3.5" />新建产品</Button>
        </div>
      </div>
    );
  }

  const cover = props.product.images[0];
  return (
    <div className="rounded-xl border border-line bg-surface-2 px-3 py-3">
      <div className="flex items-center gap-3">
        <span className="h-11 w-11 shrink-0 overflow-hidden rounded-lg border border-line bg-surface">
          {cover ? <img src={cover.thumbUrl || cover.url} alt={props.product.name} className="h-full w-full object-cover" /> : (
            <span className="flex h-full w-full items-center justify-center text-ink-3"><ImagePlus className="h-4 w-4" /></span>
          )}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13px] text-ink-1">{props.product.name}</span>
          <span className="mt-0.5 block truncate text-[11.5px] text-ink-3">
            {props.product.imageCount} 张商品图 · {props.product.hasDocument ? "已绑定产品资料" : "未绑定产品资料"}
          </span>
        </span>
        <span className="flex shrink-0 items-center gap-1">
          <button type="button" onClick={props.onEdit} disabled={props.busy}
            className="rounded-md border border-line px-2 py-0.5 text-[11.5px] text-ink-2 transition-colors hover:bg-surface hover:text-ink-1 disabled:opacity-50">
            编辑
          </button>
          <button type="button" onClick={props.onPick} disabled={props.busy}
            className="rounded-md border border-line px-2 py-0.5 text-[11.5px] text-ink-2 transition-colors hover:bg-surface hover:text-ink-1 disabled:opacity-50">
            更换
          </button>
          <button type="button" aria-label="取消产品引用" onClick={props.onDetach} disabled={props.busy}
            className="rounded-md p-1 text-ink-3 transition-colors hover:bg-surface hover:text-ink-1 disabled:opacity-50">
            <X className="h-3.5 w-3.5" />
          </button>
        </span>
      </div>
      {props.product.hasDocument ? (
        <p className="mt-2 truncate text-[11.5px] text-ink-3">产品资料：{props.product.documentName}（生成时自动引用）</p>
      ) : null}
    </div>
  );
}

/** 「本次参考图片」：使用整个产品，或只勾选其中几张。 */
export function ProductReferencePicker(props: {
  product: SelectedProductInfo;
  modelLimit: number;
  onMode: (mode: "all" | "selected") => void;
  onToggle: (imageId: string) => void;
  onSelectAll: () => void;
  onClear: () => void;
  busy: boolean;
}) {
  const { product } = props;
  const [expanded, setExpanded] = useState(false);
  const selectedCount = product.mode === "all" ? product.images.length : product.selectedImageIds.length;
  const willTruncate = selectedCount > props.modelLimit;

  return (
    <div className="space-y-2.5">
      <div className="flex gap-1.5">
        {([["all", "使用全部图片"], ["selected", "自定义勾选"]] as const).map(([mode, label]) => (
          <button
            key={mode}
            type="button"
            disabled={props.busy}
            onClick={() => { props.onMode(mode); if (mode === "selected") setExpanded(true); }}
            className={cn(
              "flex-1 rounded-lg border px-2.5 py-1.5 text-[12px] transition-colors duration-150 disabled:opacity-50",
              product.mode === mode
                ? "border-[var(--ui-brand)] bg-[var(--ui-brand-soft)] text-ink-1"
                : "border-line text-ink-3 hover:bg-surface-2 hover:text-ink-2"
            )}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-[12px] text-ink-2">
          {product.mode === "all"
            ? `本次使用这个产品的全部 ${product.images.length} 张图片`
            : `已选择 ${selectedCount} / ${product.images.length} 张`}
        </p>
        {product.mode === "selected" ? (
          <span className="flex items-center gap-2 text-[11.5px] text-ink-3">
            <button type="button" className="hover:text-ink-1" onClick={props.onSelectAll}>全选</button>
            <button type="button" className="hover:text-ink-1" onClick={props.onClear}>取消全选</button>
          </span>
        ) : null}
      </div>

      {willTruncate ? (
        <p className="rounded-lg border border-line bg-surface-2 px-2.5 py-2 text-[11.5px] leading-5 text-ink-3">
          当前模型单次最多参考 {props.modelLimit} 张，系统会按图片类型自动挑出最相关的 {props.modelLimit} 张；想精确控制请用「自定义勾选」。
        </p>
      ) : null}

      <button type="button" onClick={() => setExpanded((value) => !value)}
        className="w-full rounded-lg border border-line px-2.5 py-1.5 text-[11.5px] text-ink-3 transition-colors hover:bg-surface-2 hover:text-ink-2">
        {expanded ? "收起图片列表" : `展开查看这 ${product.images.length} 张图片`}
      </button>

      {expanded ? (
        <div className="grid max-h-[260px] grid-cols-4 gap-2 overflow-y-auto scrollbar-subtle pr-1">
          {product.images.map((image) => {
            const picked = product.mode === "all" || product.selectedImageIds.includes(image.id);
            return (
              <button
                key={image.id}
                type="button"
                disabled={props.busy}
                title={`${productImageRoleLabel(image.role)} · ${image.name}`}
                onClick={() => { if (product.mode === "all") props.onMode("selected"); props.onToggle(image.id); }}
                className={cn(
                  "group relative aspect-square overflow-hidden rounded-lg border transition-colors duration-150 disabled:opacity-60",
                  picked ? "border-[var(--ui-brand)]" : "border-line opacity-70 hover:opacity-100"
                )}
              >
                <img src={image.thumbUrl || image.url} alt={image.name} className="h-full w-full object-cover" loading="lazy" />
                <span className={cn(
                  "absolute right-1 top-1 rounded-md p-0.5",
                  picked ? "bg-[var(--ui-brand)] text-white" : "bg-black/50 text-white/80"
                )}>
                  {picked ? <CheckSquare className="h-3 w-3" /> : <Square className="h-3 w-3" />}
                </span>
                <span className="absolute inset-x-0 bottom-0 truncate bg-black/55 px-1 py-0.5 text-[10px] text-white/85">
                  {productImageRoleLabel(image.role)}
                </span>
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

/** 选择产品弹窗：不离开创作页，选完立即返回。 */
export function ProductPickerDialog(props: {
  products: ProductRecord[];
  activeId: string;
  busy: boolean;
  onPick: (product: ProductRecord) => void;
  onCreate: () => void;
  onEdit: (productId: string) => void;
  onClose: () => void;
}) {
  const [keyword, setKeyword] = useState("");
  const filtered = useMemo(() => {
    const value = keyword.trim().toLowerCase();
    if (!value) return props.products;
    return props.products.filter((item) => item.name.toLowerCase().includes(value));
  }, [props.products, keyword]);

  return (
    <Modal title="选择产品" wide onClose={props.onClose}>
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <div className="flex min-w-0 flex-1 items-center gap-2 rounded-lg border border-line bg-surface-2 px-2.5 py-1.5">
            <Search className="h-3.5 w-3.5 shrink-0 text-ink-3" strokeWidth={1.8} />
            <input value={keyword} onChange={(event) => setKeyword(event.target.value)} placeholder="搜索产品"
              className="min-w-0 flex-1 bg-transparent text-[13px] text-ink-1 placeholder:text-ink-3 focus:outline-none" autoFocus />
          </div>
          <Button size="sm" variant="outline" onClick={props.onCreate}><Plus className="mr-1 h-3.5 w-3.5" />新建产品</Button>
        </div>

        <div className="max-h-[52vh] space-y-1.5 overflow-y-auto scrollbar-subtle">
          {filtered.length ? filtered.map((product) => {
            const cover = productCoverImage(product);
            const count = (product.images || []).length;
            return (
              <div
                key={product.id}
                className={cn(
                  "flex w-full items-center gap-3 rounded-xl border px-3 py-2.5 transition-colors duration-150",
                  product.id === props.activeId ? "border-[var(--ui-brand)] bg-[var(--ui-brand-soft)]" : "border-line hover:bg-surface-2"
                )}
              >
                <button type="button" disabled={props.busy} onClick={() => props.onPick(product)} className="flex min-w-0 flex-1 items-center gap-3 text-left disabled:opacity-50">
                  <span className="h-11 w-11 shrink-0 overflow-hidden rounded-lg border border-line bg-surface-2">
                    {cover ? <img src={cover.thumbUrl || cover.url} alt={product.name} className="h-full w-full object-cover" /> : (
                      <span className="flex h-full w-full items-center justify-center text-ink-3"><ImagePlus className="h-4 w-4" /></span>
                    )}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] text-ink-1">{product.name || "未命名产品"}</span>
                    <span className="mt-0.5 block text-[11.5px] text-ink-3">
                      {count} 张图片 · {product.documentAnalysisStatus === "processing" ? "资料解析中" : productHasDocument(product) ? "资料已绑定" : "无资料"}
                    </span>
                  </span>
                </button>
                <span className="flex shrink-0 items-center gap-1.5">
                  <button
                    type="button"
                    disabled={props.busy}
                    onClick={() => props.onEdit(product.id)}
                    className="rounded-md border border-line px-2 py-0.5 text-[11.5px] text-ink-3 transition-colors hover:bg-surface hover:text-ink-1 disabled:opacity-50"
                  >
                    编辑
                  </button>
                  {product.id === props.activeId ? <span className="text-[11.5px] text-ink-2">当前使用</span> : null}
                </span>
              </div>
            );
          }) : (
            <p className="px-3 py-10 text-center text-[12.5px] text-ink-3">
              {props.products.length ? "没有匹配的产品。" : "还没有产品。点「新建产品」上传商品图片和产品资料。"}
            </p>
          )}
        </div>

        <p className="text-[11.5px] text-ink-3">最多支持 {PRODUCT_IMAGE_LIMIT} 张商品图片；一个产品绑定一份产品资料。</p>
      </div>
    </Modal>
  );
}

export function ProductBusyHint({ text }: { text: string }) {
  return (
    <p className="flex items-center gap-2 text-[12px] text-ink-3">
      <Loader2 className="h-3.5 w-3.5 animate-spin" />{text}
    </p>
  );
}
