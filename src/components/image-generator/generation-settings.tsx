"use client";

import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { commerceImageModelRegistry, commerceImageRatioOrder, commerceImageRequestSizeForModel, resolveCanonicalCommerceImageSize } from "@/lib/commerce-image-models";
import type {
  CommerceImageModel,
  CommerceImageOutputRatio,
  CommerceImageQuality,
  CommerceImageRatio,
  ResolvedCommerceImageModel
} from "@/lib/commerce-image-types";

/**
 * 生图设置：一个紧凑的组合选择器。
 *
 * 收起状态：[比例图标] 9:16 | 2K | 1张
 * 点开之后：比例（4 列网格）/ 分辨率（三段等宽）/ 数量（5×2 网格）一次改完，
 * 选择过程中不自动关闭，点控件或点外面才关。
 *
 * 只负责「选什么」，不负责发送：真正的 size 由 commerceImageRequestSize 统一映射，
 * 面板里显示的像素就是即将发往 Provider 的像素。
 */
export type GenerationSettingsValue = {
  ratio: CommerceImageOutputRatio;
  quality: CommerceImageQuality;
  count: number;
};

const RATIO_ROWS: CommerceImageRatio[][] = [
  ["1:1", "3:4", "9:16", "2:3"],
  ["3:2", "4:3", "16:9"]
];
const COUNT_OPTIONS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
const RESOLUTIONS: Array<{ value: CommerceImageQuality; label: string }> = [
  { value: "standard", label: "1K" },
  { value: "high", label: "2K" },
  { value: "ultra", label: "4K" }
];

export function GenerationSettings(props: {
  value: GenerationSettingsValue;
  onChange: (next: GenerationSettingsValue) => void;
  /** 用来算「这次真实请求多少像素」。 */
  model: CommerceImageModel;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const { ratio, quality, count } = props.value;

  /* 点组件外区域关闭（选择参数时不关闭）。 */
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const resolvedRatio = ratio === "original" ? "9:16" : ratio;
  const qualityLabel = RESOLUTIONS.find((item) => item.value === quality)?.label || "2K";
  const requestSize = requestSizeFor(props.model, resolvedRatio, quality);

  function patch(next: Partial<GenerationSettingsValue>) {
    props.onChange({ ratio, quality, count, ...next });
  }

  return (
    <div ref={rootRef} className="relative">
      {open ? (
        <div
          className={cn(
            "anim-pop-in absolute bottom-full left-0 z-40 mb-1 w-[440px] max-w-[calc(100vw-24px)] overflow-hidden",
            "rounded-xl border border-line bg-[var(--ui-surface)] p-3 shadow-[0_18px_44px_-22px_rgba(0,0,0,0.72)]"
          )}
        >
          <SettingsSection title="选择比例">
            <div className="grid grid-cols-4 gap-1.5">
              {RATIO_ROWS.flat().map((item) => (
                <button
                  key={item}
                  type="button"
                  data-ratio-option={item}
                  aria-pressed={resolvedRatio === item}
                  onClick={() => patch({ ratio: item })}
                  className={cn(
                    "flex h-[34px] items-center justify-center gap-1 rounded-md border text-[12.5px] transition-colors duration-150",
                    resolvedRatio === item
                      ? "border-transparent bg-brand-solid font-medium text-white"
                      : "border-line bg-surface-2 text-ink-3 hover:border-line-strong hover:text-ink-2"
                  )}
                >
                  <RatioGlyph ratio={item} active={resolvedRatio === item} />
                  {item}
                </button>
              ))}
            </div>
          </SettingsSection>

          <SettingsSection title="选择分辨率">
            <div className="flex gap-1.5">
              {RESOLUTIONS.map((item) => (
                <button
                  key={item.value}
                  type="button"
                  data-resolution-option={item.label}
                  aria-pressed={quality === item.value}
                  onClick={() => patch({ quality: item.value })}
                  className={cn(
                    "h-[34px] flex-1 rounded-md border text-[12.5px] transition-colors duration-150",
                    quality === item.value
                      ? "border-transparent bg-brand-solid font-medium text-white"
                      : "border-line bg-surface-2 text-ink-3 hover:border-line-strong hover:text-ink-2"
                  )}
                >
                  {item.label}
                </button>
              ))}
            </div>
            {/* UI 与实际请求必须一致：这里直接给出这次会发送的像素。 */}
            <p className="mt-1 text-[10px] leading-3 text-ink-3">
              {qualityLabel} 实际请求 {requestSize.width} × {requestSize.height}
              {quality === "ultra" ? "（该通道可交付的最高档）" : ""}
            </p>
          </SettingsSection>

          <SettingsSection title="选择生成数量" last>
            <div className="grid grid-cols-5 gap-1.5">
              {COUNT_OPTIONS.map((item) => (
                <button
                  key={item}
                  type="button"
                  data-count-option={item}
                  aria-pressed={count === item}
                  onClick={() => patch({ count: item })}
                  className={cn(
                    "h-[30px] rounded-md border text-[12px] transition-colors duration-150",
                    count === item
                      ? "border-transparent bg-brand-solid font-medium text-white"
                      : "border-line bg-surface-2 text-ink-3 hover:border-line-strong hover:text-ink-2"
                  )}
                >
                  {item}张
                </button>
              ))}
            </div>
          </SettingsSection>
        </div>
      ) : null}

      <button
        type="button"
        disabled={props.disabled}
        aria-expanded={open}
        aria-label="生图设置"
        data-settings-summary
        onClick={() => setOpen((value) => !value)}
        className={cn(
          "inline-flex h-8 items-center gap-2 rounded-lg border border-line bg-surface-2 px-2 text-[12px] text-ink-1",
          "transition-colors duration-150 hover:border-line-strong disabled:opacity-50"
        )}
      >
        <RatioGlyph ratio={resolvedRatio} active={false} />
        <SummaryValue label="比例" value={resolvedRatio} />
        <Divider />
        <SummaryValue label="分辨率" value={qualityLabel} />
        <Divider />
        <SummaryValue label="数量" value={`${count}张`} />
      </button>
    </div>
  );
}

function SettingsSection(props: { title: string; children: React.ReactNode; last?: boolean }) {
  return (
    <section className={cn(!props.last && "mb-1.5 border-b border-line pb-1.5")}>
      <h3 className="mb-1 text-[11px] leading-3.5 text-ink-3">{props.title}</h3>
      {props.children}
    </section>
  );
}

function SummaryValue(props: { label: string; value: string }) {
  return (
    <span className="text-[12px] text-ink-1" data-summary-value={props.label}>
      {props.value}
    </span>
  );
}

function Divider() {
  return <span aria-hidden className="h-3.5 w-px bg-[var(--ui-line-strong)]" />;
}

/** 比例轮廓图标：按比例画一个矩形边框，不用图片。 */
function RatioGlyph(props: { ratio: CommerceImageRatio; active: boolean }) {
  const [width, height] = glyphBox(props.ratio);
  return (
    <span
      aria-hidden
      className={cn("shrink-0 rounded-[3px] border", props.active ? "border-white" : "border-current")}
      style={{ width, height, opacity: props.active ? 1 : 0.75 }}
    />
  );
}

function glyphBox(ratio: CommerceImageRatio): [number, number] {
  const [w, h] = ratio.split(":").map((part) => Number(part));
  const long = 13;
  if (w >= h) {
    const width = long;
    const height = Math.max(6, Math.round((long * h) / w));
    return [width, height];
  }
  const height = long;
  const width = Math.max(6, Math.round((long * w) / h));
  return [width, height];
}

/** 与真实请求完全同一套映射（严格比例表 + 模型档位换算）：面板里显示的就是要发出去的像素。 */
function requestSizeFor(model: CommerceImageModel, ratio: CommerceImageRatio, quality: CommerceImageQuality) {
  const canonical = resolveCanonicalCommerceImageSize(ratio, quality);
  /* auto 实际解析为默认模型 gpt-image-2.5；只有走 v25 通道（openai_v25）才做档位换算，
   * seedream / gpt-image-2 直接用严格比例表。 */
  const resolved = (model === "auto" ? "gpt-image-2.5" : model) as ResolvedCommerceImageModel;
  const provider = commerceImageModelRegistry[resolved]?.provider;
  if (provider !== "openai_v25") return canonical;
  return commerceImageRequestSizeForModel(resolved, canonical, quality);
}

export { RATIO_ROWS as commerceImageSettingsRatioRows, COUNT_OPTIONS as commerceImageSettingsCountOptions, RESOLUTIONS as commerceImageSettingsResolutions, requestSizeFor as commerceImageSettingsRequestSize };
export { commerceImageRatioOrder };
