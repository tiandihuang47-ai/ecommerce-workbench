"use client";

import { FileText, ImagePlus, Loader2, Trash2, Upload } from "lucide-react";
import { useRef, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import type { CommerceImageAsset, CommerceImageDocument } from "@/lib/commerce-image-types";

export function MaterialPanel(props: { children: ReactNode; footer?: ReactNode }) {
  return (
    <aside className="flex min-h-0 w-full shrink-0 flex-col overflow-hidden rounded-2xl border border-line bg-surface lg:w-[34%] lg:min-w-[320px] lg:max-w-[440px]">
      <div className="min-h-0 flex-1 overflow-y-auto scrollbar-subtle p-4">
        <div className="space-y-6">{props.children}</div>
      </div>
      {props.footer ? <div className="shrink-0 border-t border-line px-4 py-3">{props.footer}</div> : null}
    </aside>
  );
}

export function PanelSection(props: { title: string; requirement?: "必填" | "可选"; hint?: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section>
      <div className="mb-2.5 flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <h3 className="text-[15px] font-medium tracking-[-0.01em] text-ink-1">{props.title}</h3>
          {props.requirement ? (
            <span className={cn(
              "rounded-[5px] px-1.5 py-[1px] text-[10.5px]",
              props.requirement === "必填" ? "bg-[var(--ui-brand-soft)] text-ink-2" : "border border-line text-ink-3"
            )}>
              {props.requirement}
            </span>
          ) : null}
        </div>
        {props.action}
      </div>
      {props.hint ? <p className="mb-2.5 text-[12px] leading-5 text-ink-3">{props.hint}</p> : null}
      {props.children}
    </section>
  );
}

export function UploadTile(props: {
  label: string;
  hint?: string;
  accept?: string;
  multiple?: boolean;
  busy?: boolean;
  compact?: boolean;
  onFiles: (files: File[]) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  return (
    <>
      <button
        type="button"
        disabled={props.busy}
        onClick={() => inputRef.current?.click()}
        className={cn(
          "group flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-line text-ink-3",
          "transition-[border-color,background-color,color] duration-150 ease-out",
          "hover:border-line-strong hover:bg-surface-2 hover:text-ink-2 disabled:pointer-events-none disabled:opacity-60",
          props.compact ? "h-11" : "h-[104px] flex-col"
        )}
      >
        {props.busy ? <Loader2 className="h-4 w-4 animate-spin" /> : props.compact ? <Upload className="h-4 w-4" strokeWidth={1.8} /> : <ImagePlus className="h-5 w-5" strokeWidth={1.6} />}
        <span className={cn("text-[12.5px]", props.compact ? "" : "mt-1")}>{props.label}</span>
        {props.hint && !props.compact ? <span className="text-[11.5px] text-ink-3/80">{props.hint}</span> : null}
      </button>
      <input
        ref={inputRef}
        type="file"
        accept={props.accept}
        multiple={props.multiple}
        className="hidden"
        onChange={(event) => {
          // 先快照：清空 input.value 会把 FileList 原地清空，异步上传时就会变成 0 张图。
          const files = event.target.files ? Array.from(event.target.files) : [];
          event.target.value = "";
          props.onFiles(files);
        }}
      />
    </>
  );
}

export function AssetThumb(props: { asset: CommerceImageAsset; onRemove: (assetId: string) => void; size?: "sm" | "md" }) {
  const box = props.size === "sm" ? "h-16 w-16" : "h-[76px] w-[76px]";
  return (
    <div className={cn("group relative shrink-0 overflow-hidden rounded-xl border border-line bg-surface-2", box)}>
      {props.asset.url ? <img src={props.asset.url} alt={props.asset.name} className="h-full w-full object-cover" /> : null}
      <button
        type="button"
        aria-label="删除素材"
        onClick={() => props.onRemove(props.asset.id)}
        className="absolute right-1 top-1 rounded-full bg-black/60 p-1 text-white opacity-0 transition-opacity duration-150 group-hover:opacity-100"
      >
        <Trash2 className="h-3 w-3" />
      </button>
    </div>
  );
}

export function ThumbStrip(props: { assets: CommerceImageAsset[]; onRemove: (assetId: string) => void }) {
  return (
    <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-subtle">
      {props.assets.map((asset) => (
        <AssetThumb key={asset.id} asset={asset} onRemove={props.onRemove} />
      ))}
    </div>
  );
}

export function BenchmarkPreview(props: { asset: CommerceImageAsset; onRemove: (assetId: string) => void }) {
  return (
    <div className="group relative overflow-hidden rounded-xl border border-line bg-surface-2">
      {props.asset.url ? <img src={props.asset.url} alt={props.asset.name} className="max-h-[280px] w-full object-contain" /> : null}
      <div className="absolute inset-x-0 bottom-0 flex items-center justify-between gap-2 bg-gradient-to-t from-black/70 to-transparent px-2.5 py-2">
        <span className="truncate text-[11.5px] text-white/85">{props.asset.name}</span>
        <button
          type="button"
          onClick={() => props.onRemove(props.asset.id)}
          className="shrink-0 rounded-md bg-white/12 px-1.5 py-0.5 text-[11px] text-white/90 opacity-0 transition-opacity duration-150 hover:bg-white/20 group-hover:opacity-100"
        >
          移除
        </button>
      </div>
    </div>
  );
}

export function DocumentList(props: { documents: CommerceImageDocument[]; onRemove: (documentId: string) => void }) {
  if (!props.documents.length) return null;
  return (
    <ul className="mt-2 space-y-1.5">
      {props.documents.map((document) => (
        <li key={document.id} className="flex items-center gap-2 rounded-lg border border-line px-2.5 py-2">
          <FileText className="h-3.5 w-3.5 shrink-0 text-ink-3" strokeWidth={1.7} />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[12.5px] text-ink-1">{document.name}</span>
            <span className="block text-[11px] text-ink-3">
              {document.status === "ready" ? "已读取商品卖点" : document.error || "读取失败"}
            </span>
          </span>
          <button
            type="button"
            aria-label="删除资料"
            onClick={() => props.onRemove(document.id)}
            className="shrink-0 rounded-md p-1 text-ink-3 transition-colors duration-150 hover:bg-surface-2 hover:text-ink-1"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </li>
      ))}
    </ul>
  );
}

export function SegmentedControl<T extends string>(props: { value: T; options: Array<{ value: T; label: string }>; onChange: (value: T) => void; disabled?: boolean }) {
  return (
    <div className={cn("inline-flex rounded-lg border border-line bg-surface-2 p-0.5", props.disabled && "opacity-60")}>
      {props.options.map((option) => {
        const active = option.value === props.value;
        return (
          <button
            key={option.value}
            type="button"
            disabled={props.disabled}
            onClick={() => props.onChange(option.value)}
            className={cn(
              "rounded-[7px] px-3 py-1 text-[12.5px] transition-colors duration-150",
              active ? "bg-surface text-ink-1 shadow-sm" : "text-ink-3 hover:text-ink-2"
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
