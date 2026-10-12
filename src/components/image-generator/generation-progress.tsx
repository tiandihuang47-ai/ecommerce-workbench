"use client";

import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import type { CommerceImageTask } from "@/lib/commerce-image-types";

/**
 * 生成进度：Provider（GPT Image 2.5 / 中转站）不返回真实百分比，所以这里做**阶段型进度**——
 * 用任务生命周期里真实发生的节点（提交 / 排队 / 理解 / 生成第 X 张 / 图片返回 / 落库完成）
 * 决定「阶段基准百分比」，阶段内再用指数平滑缓慢增长。保证：
 *   · 不会前几秒冲到 90% 然后长时间不动；
 *   · 每个跳变都对应真实里程碑，不假装是 Provider 的精确进度；
 *   · 任务成功立即 100%，失败/取消立即停住并显示失败，不会一直转。
 *
 * 阶段表（base = 进入该阶段立刻显示；ceiling = 该阶段最多爬到）：
 *   提交任务        5  → 10
 *   进入队列       10  → 20
 *   理解素材       20  → 30
 *   正在生成       30 + 已完成/总数 × 50  → 30 + (已完成+1)/总数 × 50（上限 85）
 *   图片已返回     90  → 96（保存 / 质检中）
 *   完成          100
 */
export type GenerationProgress = {
  percent: number;
  /** 当前阶段一句话（直接显示给用户）。 */
  label: string;
  /** 第几张 / 共几张（多张任务用；单张为 1/1）。 */
  index: number;
  total: number;
  /** 是否处于「进行中」。 */
  active: boolean;
  /** 失败/取消：进度停住，不再增长。 */
  frozen: boolean;
};

type Stage = { key: string; base: number; ceiling: number; label: string };

const ROUND_MS = 500;
/** 阶段内平滑增长的时间常数（秒）：越小越快贴近该阶段上限。 */
const TAU_SECONDS = 9;
const TERMINAL_FAILED = ["failed", "cancelled"];

export function useGenerationProgress(
  task: CommerceImageTask,
  options: { submitting?: boolean; hasResult?: boolean }
): GenerationProgress {
  const stage = resolveStage(task, options);
  const [percent, setPercent] = useState(stage.base);
  const stageRef = useRef<{ key: string; startedAt: number }>({ key: stage.key, startedAt: Date.now() });

  useEffect(() => {
    if (stageRef.current.key !== stage.key) {
      stageRef.current = { key: stage.key, startedAt: Date.now() };
      /* 阶段切换：直接落到该阶段基准。同一轮生成里基准只会往上跳；
       * 新一次生成（比如完成后又点生成）会从头开始，不会卡在 100%。 */
      if (!TERMINAL_FAILED.includes(stage.key)) setPercent(stage.base);
    }
    const tick = () => {
      const elapsed = (Date.now() - stageRef.current.startedAt) / 1000;
      const eased = stage.base + (stage.ceiling - stage.base) * (1 - Math.exp(-elapsed / TAU_SECONDS));
      setPercent((previous) => {
        if (stage.ceiling >= 100) return 100;
        return Math.max(previous, Math.min(stage.ceiling, eased));
      });
    };
    tick();
    if (stage.ceiling >= 100 || TERMINAL_FAILED.includes(stage.key)) return;
    const timer = window.setInterval(tick, ROUND_MS);
    return () => window.clearInterval(timer);
  }, [stage.key, stage.base, stage.ceiling]);

  const total = Math.max(1, task.progress?.total || task.brief.cardCount || 1);
  const done = Math.max(0, Math.min(total, task.progress?.completed || 0));
  const running = isActive(task.status) || Boolean(options.submitting);
  return {
    percent: Math.round(percent),
    label: stage.label,
    index: Math.min(total, done + (running ? 1 : 0)) || 1,
    total,
    active: running,
    frozen: TERMINAL_FAILED.includes(task.status)
  };
}

function resolveStage(task: CommerceImageTask, options: { submitting?: boolean; hasResult?: boolean }): Stage {
  const total = Math.max(1, task.progress?.total || task.brief.cardCount || 1);
  const done = Math.max(0, Math.min(total, task.progress?.completed || 0));
  if (task.status === "completed" || task.status === "partial") {
    return { key: "done", base: 100, ceiling: 100, label: "已完成" };
  }
  if (task.status === "failed") {
    return { key: "failed", base: 0, ceiling: 0, label: "生成失败" };
  }
  if (task.status === "cancelled") {
    return { key: "cancelled", base: 0, ceiling: 0, label: "已取消" };
  }
  if (task.status === "generating") {
    /* 只有「这一轮要出的图都已经返回」时才算进入保存/质检阶段；
     * 多张任务里出到第 1 张时不能跳到 90%。 */
    if (options.hasResult) {
      return { key: "saving", base: 90, ceiling: 96, label: "图片已返回，正在保存与质检" };
    }
    const per = 50 / total;
    return {
      key: `generating:${done}/${total}`,
      base: 30 + done * per,
      ceiling: Math.min(85, 30 + (done + 1) * per),
      label: `正在生成第 ${Math.min(total, done + 1)} / ${total} 张`
    };
  }
  if (task.status === "planning") {
    return { key: "planning", base: 20, ceiling: 30, label: "正在理解素材与需求" };
  }
  if (task.status === "queued") {
    return { key: "queued", base: 10, ceiling: 20, label: "已进入生成队列" };
  }
  if (options.submitting) {
    return { key: "submitting", base: 5, ceiling: 10, label: "已提交，正在发送给模型" };
  }
  return { key: "idle", base: 0, ceiling: 0, label: "等待开始" };
}

function isActive(status: CommerceImageTask["status"]) {
  return status === "planning" || status === "queued" || status === "generating";
}

/** 进度条 + 百分比：结果区直接用，保证不切页面也能看到进度。 */
export function GenerationProgressBar(props: {
  progress: GenerationProgress;
  task: CommerceImageTask;
  compact?: boolean;
}) {
  const { progress, task } = props;
  const percent = Math.max(0, Math.min(100, progress.percent));
  const failed = progress.frozen;
  return (
    <div
      className={cn("rounded-xl border border-line bg-surface-2", props.compact ? "px-3 py-2" : "px-4 py-3.5")}
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={percent}
      aria-label="生成进度"
    >
      <div className="flex items-center justify-between gap-3">
        <span
          className={cn("min-w-0 truncate text-ink-2", props.compact ? "text-[11.5px]" : "text-[12.5px]")}
          data-progress-stage
        >
          {progress.label}
          {progress.active ? ` · 第 ${progress.index} / ${progress.total} 张` : ""}
        </span>
        <span
          className={cn("shrink-0 font-medium tabular-nums text-ink-1", props.compact ? "text-[12px]" : "text-[15px]")}
          data-progress-percent
        >
          {percent}%
        </span>
      </div>
      <div className={cn("mt-2 h-1.5 w-full overflow-hidden rounded-full bg-[var(--ui-line)]", props.compact && "mt-1.5 h-1")}>
        <div
          className={cn(
            "h-full rounded-full transition-[width] duration-500 ease-out",
            failed ? "bg-[var(--ui-danger)]" : "bg-brand-solid"
          )}
          style={{ width: `${Math.max(2, percent)}%` }}
        />
      </div>
      {props.compact ? null : (
        <p className="mt-2 text-[11.5px] leading-5 text-ink-3">
          {progress.active
            ? `共 ${progress.total} 张；生成会在后台继续，可以离开这个页面，完成后结果会自动出现在这里。`
            : "正在收尾"}
        </p>
      )}
    </div>
  );
}
