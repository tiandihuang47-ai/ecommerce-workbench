"use client";

import { ArrowRight, ImageIcon, Sparkles } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export function ModeCard(props: {
  badge: string;
  title: string;
  description: string;
  cta: string;
  visual: ReactNode;
  footer?: ReactNode;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={props.onClick}
      disabled={props.disabled}
      className={cn(
        "group relative flex h-full w-full items-stretch gap-6 overflow-hidden rounded-2xl border border-line bg-surface p-7 text-left",
        "transition-[transform,border-color,background-color] duration-150 ease-out",
        "hover:-translate-y-px hover:border-line-strong hover:bg-surface-2",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ui-brand-ring)]",
        "disabled:pointer-events-none disabled:opacity-60"
      )}
    >
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="inline-flex w-fit items-center rounded-md border border-line px-2 py-[3px] text-[11px] font-medium tracking-[0.02em] text-ink-3">
          {props.badge}
        </span>
        <h2 className="mt-4 text-[23px] font-semibold leading-[1.2] tracking-[-0.01em] text-ink-1">{props.title}</h2>
        <p className="mt-3 max-w-[36ch] whitespace-pre-line text-[13.5px] leading-6 text-ink-2">{props.description}</p>
        {props.footer ? <div className="mt-4">{props.footer}</div> : null}
        <div className="mt-auto flex items-center gap-3 pt-6">
          <span className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-brand-solid text-white transition-transform duration-150 ease-out group-hover:translate-x-0.5">
            <ArrowRight className="h-[15px] w-[15px]" strokeWidth={2.2} />
          </span>
          <span className="text-[13.5px] font-medium text-ink-1">{props.cta}</span>
        </div>
      </div>
      <div className="relative hidden w-[40%] shrink-0 items-center justify-center lg:flex">
        {props.visual}
      </div>
    </button>
  );
}

/** 纯 CSS 抽象预览：左「对标详情图」→ 右「我的商品图」，不引用任何外部图片。 */
export function DetailModeVisual() {
  return (
    <div className="relative h-[210px] w-full max-w-[260px]">
      <div className="ig-float-a absolute left-0 top-2 h-[188px] w-[104px] -rotate-[5deg] rounded-xl border border-line bg-surface-2 p-2 shadow-[0_12px_30px_-18px_rgba(0,0,0,0.55)]">
        <div className="h-[74px] w-full rounded-md bg-[linear-gradient(135deg,rgba(255,255,255,0.10),rgba(255,255,255,0.02))]" />
        <div className="mt-2 space-y-[5px]">
          <div className="h-[5px] w-[72%] rounded-full bg-white/14" />
          <div className="h-[5px] w-[52%] rounded-full bg-white/10" />
          <div className="h-[5px] w-[62%] rounded-full bg-white/08" />
        </div>
        <div className="mt-2 grid grid-cols-2 gap-[5px]">
          <div className="h-[22px] rounded-[5px] bg-white/[0.06]" />
          <div className="h-[22px] rounded-[5px] bg-white/[0.06]" />
        </div>
        <div className="absolute -bottom-2 left-2 rounded-md border border-line bg-surface px-1.5 py-[2px] text-[9px] text-ink-3">对标</div>
      </div>

      <div className="absolute left-1/2 top-1/2 z-10 -translate-x-1/2 -translate-y-1/2 rounded-full border border-line bg-surface px-2 py-1.5 shadow-sm">
        <ArrowRight className="h-3.5 w-3.5 text-ink-3" strokeWidth={1.8} />
      </div>

      <div className="ig-float-b absolute right-0 top-6 h-[188px] w-[104px] rotate-[4deg] rounded-xl border border-line bg-surface p-2 shadow-[0_18px_38px_-20px_rgba(0,0,0,0.7)]">
        <div className="relative h-[74px] w-full overflow-hidden rounded-md bg-[linear-gradient(150deg,rgba(139,124,246,0.16),rgba(255,255,255,0.03))]">
          <ImageIcon className="absolute left-1/2 top-1/2 h-4 w-4 -translate-x-1/2 -translate-y-1/2 text-ink-3" strokeWidth={1.6} />
        </div>
        <div className="mt-2 space-y-[5px]">
          <div className="h-[5px] w-[64%] rounded-full bg-[var(--ui-brand-soft)]" />
          <div className="h-[5px] w-[46%] rounded-full bg-white/10" />
          <div className="h-[5px] w-[56%] rounded-full bg-white/08" />
        </div>
        <div className="mt-2 grid grid-cols-2 gap-[5px]">
          <div className="h-[22px] rounded-[5px] bg-white/[0.06]" />
          <div className="h-[22px] rounded-[5px] bg-white/[0.06]" />
        </div>
        <div className="absolute -bottom-2 right-2 rounded-md border border-line bg-surface px-1.5 py-[2px] text-[9px] text-ink-2">我的</div>
      </div>
    </div>
  );
}

/** 纯 CSS 抽象预览：两张轻微层叠的小红书 / 抖音图文卡片。 */
export function SocialModeVisual() {
  return (
    <div className="relative h-[210px] w-full max-w-[260px]">
      <div className="ig-float-a absolute left-1 top-6 h-[164px] w-[116px] -rotate-[4deg] rounded-xl border border-line bg-surface-2 p-2 shadow-[0_14px_32px_-20px_rgba(0,0,0,0.6)]">
        <div className="h-[92px] w-full rounded-lg bg-[linear-gradient(140deg,rgba(255,255,255,0.10),rgba(255,255,255,0.02))]" />
        <div className="mt-2 flex items-center gap-1.5">
          <span className="h-[10px] w-[10px] rounded-full bg-white/16" />
          <span className="h-[4px] w-[42px] rounded-full bg-white/12" />
        </div>
        <div className="mt-1.5 space-y-[4px]">
          <div className="h-[4px] w-[86%] rounded-full bg-white/10" />
          <div className="h-[4px] w-[60%] rounded-full bg-white/08" />
        </div>
      </div>

      <div className="ig-float-b absolute right-0 top-0 h-[164px] w-[116px] rotate-[5deg] rounded-xl border border-line bg-surface p-2 shadow-[0_20px_40px_-22px_rgba(0,0,0,0.75)]">
        <div className="h-[92px] w-full rounded-lg bg-[linear-gradient(160deg,rgba(139,124,246,0.14),rgba(255,255,255,0.03))]" />
        <div className="mt-2 flex items-center gap-1.5">
          <Sparkles className="h-[10px] w-[10px] text-ink-3" strokeWidth={1.8} />
          <span className="h-[4px] w-[52px] rounded-full bg-white/12" />
        </div>
        <div className="mt-1.5 space-y-[4px]">
          <div className="h-[4px] w-[78%] rounded-full bg-[var(--ui-brand-soft)]" />
          <div className="h-[4px] w-[52%] rounded-full bg-white/08" />
        </div>
      </div>
    </div>
  );
}
