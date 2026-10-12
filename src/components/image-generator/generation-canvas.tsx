"use client";

import { AlertTriangle, Copy, Database, Download, ImageIcon, Loader2, Maximize2, MoreHorizontal, RefreshCw } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { GenerationProgressBar, useGenerationProgress } from "@/components/image-generator/generation-progress";
import { ImageLightbox } from "@/components/image-generator/image-lightbox";
import type { CommerceImagePanel, CommerceImageTask, CommerceImageVersion } from "@/lib/commerce-image-types";

export function selectedVersion(panel: CommerceImagePanel, setId: string): CommerceImageVersion | null {
  const inSet = [...panel.versions].reverse().find((version) => version.setId === setId);
  if (inSet) return inSet;
  if (panel.selectedVersionId) {
    const selected = panel.versions.find((version) => version.id === panel.selectedVersionId);
    if (selected) return selected;
  }
  return panel.versions.at(-1) || null;
}

export function GenerationCanvas(props: {
  task: CommerceImageTask;
  busy: string;
  onDownload: (panel: CommerceImagePanel, version: CommerceImageVersion) => void;
  onRegenerate: (panelId: string) => void;
  onSelectVersion: (panel: CommerceImagePanel, versionId: string) => void;
  onOpenLearning?: (panel: CommerceImagePanel, version: CommerceImageVersion) => void;
  onRetryFailed?: () => void;
  banner?: ReactNode;
  placeholder?: string;
  /** 这一次生成请求还在提交中（点完按钮到服务端受理之间）。 */
  submitting?: boolean;
}) {
  const panels = props.task.panels;
  const items = panels
    .map((panel) => ({ panel, version: selectedVersion(panel, props.task.selectedSetId) }))
    .filter((item) => Boolean(item.version));
  /* 全屏查看：按钮或点图触发；图片 URL 即原始分辨率，全屏看细节不失真。 */
  const [lightbox, setLightbox] = useState<{ panel: CommerceImagePanel; version: CommerceImageVersion } | null>(null);

  const running = ["planning", "queued", "generating"].includes(props.task.status);
  /* 进度直接用当前任务算：不需要切页面，也不需要历史记录。 */
  const targetTotal = Math.max(1, props.task.progress?.total || props.task.brief.cardCount || 1);
  const allReturned = items.length > 0 && items.length >= targetTotal;
  const progress = useGenerationProgress(props.task, { submitting: props.submitting, hasResult: allReturned });
  /* 刚生成完保留 5 秒 100% 进度，让用户看到「到 100% 了」而不是进度条突然消失；
   * 失败/取消时保留红色进度条（停住的百分比），配合错误横幅说明。 */
  const wasRunning = useRef(false);
  const [justFinished, setJustFinished] = useState(false);
  useEffect(() => {
    if (running) {
      wasRunning.current = true;
      return;
    }
    if (wasRunning.current && (props.task.status === "completed" || props.task.status === "partial")) {
      wasRunning.current = false;
      setJustFinished(true);
      const timer = window.setTimeout(() => setJustFinished(false), 5000);
      return () => window.clearTimeout(timer);
    }
  }, [running, props.task.status]);
  const showProgress = running || Boolean(props.submitting) || justFinished || (progress.frozen && progress.percent > 0);
  const skeletonCount = Math.max(1, Math.min(12, props.task.progress?.total || props.task.brief.cardCount || 1));
  const referenceCount = props.task.sourceAssets.filter((asset) => !["benchmark_reference", "reference_segment", "style_reference", "skill_reference"].includes(asset.role)).length;
  const failedCount = props.task.panels.filter((panel) => panel.status === "failed").length;
  /* 界面只显示任务级的人话说明；provider 原始报文留在任务数据里，不直接抛给用户。 */
  const error = props.task.error || (failedCount ? "有画面没有生成成功，可以点「重试」重新生成。" : "");
  /* 简洁前端打点：结果图真正渲染出来的时间（仅开发阶段）。 */
  useEffect(() => {
    if (process.env.NODE_ENV !== "production" && items.length) {
      console.debug("[TIMELINE] results_rendered", { taskId: props.task.id, count: items.length, at: Date.now() });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items.length, props.task.id]);

  return (
    <section className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border border-line bg-surface">
      <div className="flex shrink-0 items-center justify-between gap-3 border-b border-line px-4 py-3">
        <div className="flex min-w-0 items-center gap-2">
          <h2 className="text-[20px] font-medium tracking-[-0.01em] text-ink-1">生成结果</h2>
          {items.length ? <span className="text-[12px] text-ink-3">{items.length} 张</span> : null}
        </div>
        {showProgress ? (
          <span className="flex items-center gap-1.5 text-[12px] text-ink-3" data-progress-header>
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            {progress.label}
            <span className="font-medium tabular-nums text-ink-2">{progress.percent}%</span>
          </span>
        ) : null}
      </div>

      {error ? (
        <div className="anim-fade-in flex shrink-0 items-center gap-2 border-b border-line bg-[var(--ui-danger-soft)] px-4 py-2.5 text-[12.5px] text-ink-1">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-[var(--ui-danger)]" />
          <span className="min-w-0 flex-1">{error}</span>
          {failedCount && props.onRetryFailed ? (
            <button
              type="button"
              disabled={Boolean(props.busy)}
              onClick={props.onRetryFailed}
              className="shrink-0 rounded-md border border-line bg-surface px-2 py-0.5 text-[11.5px] text-ink-2 transition-colors hover:text-ink-1 disabled:opacity-50"
            >
              重试
            </button>
          ) : null}
        </div>
      ) : null}

      {props.banner ? <div className="shrink-0 border-b border-line px-4 py-3">{props.banner}</div> : null}

      <div className="min-h-0 flex-1 overflow-y-auto scrollbar-subtle p-4">
        {items.length && showProgress ? (
          <div className="mb-3">
            <GenerationProgressBar progress={progress} task={props.task} compact />
          </div>
        ) : null}
        {items.length ? (
          <div className={cn("grid gap-3", items.length === 1 ? "grid-cols-1" : items.length <= 4 ? "grid-cols-2" : "grid-cols-2 xl:grid-cols-3")}>
            {items.map((item, index) => (
              <ResultCard
                key={item.panel.id}
                index={index}
                panel={item.panel}
                version={item.version as CommerceImageVersion}
                single={items.length === 1}
                busy={props.busy}
                onDownload={props.onDownload}
                onRegenerate={props.onRegenerate}
                onSelectVersion={props.onSelectVersion}
                onOpenLearning={props.onOpenLearning}
                onOpenLightbox={(panel, version) => setLightbox({ panel, version })}
              />
            ))}
          </div>
        ) : showProgress ? (
          <div>
            <div className="mb-4 space-y-3">
              <div className="flex items-baseline gap-2">
                <span className="text-[30px] font-semibold leading-none tabular-nums text-ink-1" data-progress-big>
                  {progress.percent}%
                </span>
                <span className="text-[13px] text-ink-2">{progress.label}</span>
              </div>
              <GenerationProgressBar progress={progress} task={props.task} />
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-ink-3">
                <span>{props.task.productName || "当前商品"}</span>
                <span>参考图 {referenceCount} 张</span>
                <span>共 {progress.total} 张</span>
              </div>
            </div>
            <div className={cn("grid gap-3", skeletonCount === 1 ? "grid-cols-1" : skeletonCount <= 4 ? "grid-cols-2" : "grid-cols-2 xl:grid-cols-3")}>
              {Array.from({ length: skeletonCount }, (_, index) => (
                <div
                  key={index}
                  className={cn("animate-pulse rounded-xl border border-line bg-surface-2", skeletonCount === 1 && "mx-auto w-full max-w-[560px]")}
                  style={skeletonCount === 1 ? { minHeight: 280 } : { aspectRatio: "3 / 4" }}
                />
              ))}
            </div>
          </div>
        ) : (
          <div className="grid h-full min-h-[280px] place-items-center">
            <div className="flex flex-col items-center gap-3 text-center">
              <ImageIcon className="h-6 w-6 text-ink-3" strokeWidth={1.5} />
              <p className="text-[13px] text-ink-2">生成结果会出现在这里</p>
              <p className="max-w-[36ch] text-[12px] leading-5 text-ink-3">{props.placeholder || "左侧上传素材，底部写下想怎么做，然后点击生成图片。"}</p>
            </div>
          </div>
        )}
      </div>

      {lightbox && lightbox.version.imageUrl ? (
        <ImageLightbox
          url={lightbox.version.imageUrl}
          name={lightbox.panel.title || `第 ${lightbox.panel.id.slice(-4)} 张`}
          width={lightbox.version.width}
          height={lightbox.version.height}
          onClose={() => setLightbox(null)}
        />
      ) : null}
    </section>
  );
}

function ResultCard(props: {
  index: number;
  panel: CommerceImagePanel;
  version: CommerceImageVersion;
  single: boolean;
  busy: string;
  onDownload: (panel: CommerceImagePanel, version: CommerceImageVersion) => void;
  onRegenerate: (panelId: string) => void;
  onSelectVersion: (panel: CommerceImagePanel, versionId: string) => void;
  onOpenLearning?: (panel: CommerceImagePanel, version: CommerceImageVersion) => void;
  onOpenLightbox: (panel: CommerceImagePanel, version: CommerceImageVersion) => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const ratio = props.version.width && props.version.height ? props.version.width / props.version.height : 3 / 4;
  /* 容器比例优先用「这次生成选定的比例」（版本上留档的 ratio，旧数据回退到图片自身宽高）：
   * 图片加载中、或者历史数据没有 ratio 时，容器也不会用错比例去挤图片。 */
  const containerAspect = props.version.ratio && props.version.ratio !== "original"
    ? props.version.ratio.replace(":", " / ")
    : props.version.width && props.version.height
      ? `${props.version.width} / ${props.version.height}`
      : "3 / 4";

  return (
    <div className={cn(props.single && "mx-auto w-full max-w-[560px]")}>
    <figure
      className={cn(
        "group relative overflow-hidden rounded-xl border border-line bg-surface-2 transition-[border-color,transform] duration-150 ease-out hover:-translate-y-px hover:border-line-strong",
        props.single && "w-full"
      )}
      style={{ aspectRatio: containerAspect }}
    >
      {props.version.imageUrl ? (
        <img
          src={props.version.imageUrl}
          alt={props.panel.title || `第 ${props.index + 1} 张`}
          /* 点图即全屏查看（悬停按钮里也有同款入口）；图片是原始分辨率，全屏看细节不失真。 */
          onClick={() => props.onOpenLightbox(props.panel, props.version)}
          /* 单张时让容器跟着图片本身的比例走（不再是一个固定方框里放竖图），
           * 多张时容器比例取自图片宽高 + object-cover：两种方式都不会拉伸。 */
          className={cn(
            "cursor-zoom-in",
            props.single
              ? "mx-auto block h-auto max-h-[62vh] w-auto max-w-full object-contain"
              : "h-full w-full object-cover"
          )}
        />
      ) : (
        <div className="grid h-full min-h-[180px] place-items-center text-[12px] text-ink-3">图片暂不可用</div>
      )}

      <ResolutionBadge version={props.version} />

      <figcaption className="pointer-events-none absolute inset-x-0 bottom-0 flex items-end justify-between gap-2 bg-gradient-to-t from-black/72 via-black/25 to-transparent px-3 pb-3 pt-10 opacity-0 transition-opacity duration-150 group-hover:opacity-100">
        <span className="truncate text-[11.5px] text-white/80">{String(props.index + 1).padStart(2, "0")}{props.panel.title ? ` · ${props.panel.title}` : ""}</span>
      </figcaption>

      <div className="absolute right-2.5 top-2.5 flex items-center gap-1 opacity-0 transition-opacity duration-150 group-hover:opacity-100">
        <IconAction label="全屏查看" onClick={() => props.onOpenLightbox(props.panel, props.version)}><Maximize2 className="h-3.5 w-3.5" /></IconAction>
        <IconAction label="下载" onClick={() => props.onDownload(props.panel, props.version)}><Download className="h-3.5 w-3.5" /></IconAction>
        <IconAction label="重新生成" disabled={Boolean(props.busy)} onClick={() => props.onRegenerate(props.panel.id)}><RefreshCw className="h-3.5 w-3.5" /></IconAction>
        <IconAction label="更多" onClick={() => setMenuOpen((value) => !value)}><MoreHorizontal className="h-3.5 w-3.5" /></IconAction>
      </div>

      {menuOpen ? (
        <div className="anim-pop-in absolute right-2.5 top-11 z-20 w-[188px] overflow-hidden rounded-xl border border-line bg-surface p-1 shadow-xl">
          <MenuItem onClick={() => { setMenuOpen(false); void navigator.clipboard?.writeText(props.panel.prompt || ""); }}>
            <Copy className="h-3.5 w-3.5" />复制提示词
          </MenuItem>
          <MenuItem onClick={() => { setMenuOpen(false); props.onOpenLearning?.(props.panel, props.version); }}>
            <Database className="h-3.5 w-3.5" />营销记录 / 记录数据
          </MenuItem>
          {props.panel.versions.length > 1 ? (
            <div className="mt-1 border-t border-line pt-1">
              <p className="px-2.5 py-1 text-[11px] text-ink-3">历史版本 {props.panel.versions.length} 个</p>
              {[...props.panel.versions].reverse().slice(0, 4).map((version, index) => (
                <MenuItem key={version.id} onClick={() => { setMenuOpen(false); props.onSelectVersion(props.panel, version.id); }}>
                  <span className={cn("h-1.5 w-1.5 rounded-full", version.id === props.version.id ? "bg-brand-solid" : "bg-[var(--ui-line-strong)]")} />
                  V{props.panel.versions.length - index}
                </MenuItem>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
    </figure>
    <VersionMeta version={props.version} />
    </div>
  );
}

/**
 * 结果信息一行小字：比例 · 请求尺寸 · 实际尺寸。
 * 如果上游返回的比例被本地等比校正过，这里直接写出来（不静默）。
 */
function VersionMeta(props: { version: CommerceImageVersion }) {
  const { version } = props;
  if (!version.width || !version.height) return null;
  const requested = version.requestedSize;
  const provider = version.providerSize;
  const targetRatio = version.ratio && version.ratio !== "original" ? version.ratio : "";
  const corrected = Boolean(
    provider &&
      targetRatio &&
      (provider.width !== version.width || provider.height !== version.height) &&
      provider.width * version.height !== provider.height * version.width
  );
  return (
    <p className="mt-1.5 px-0.5 text-[10.5px] leading-4 text-ink-3" data-version-meta>
      {targetRatio ? `${targetRatio} · ` : ""}
      请求 {requested ? `${requested.width} × ${requested.height}` : "—"} ·
      实际 {version.width} × {version.height}
      {corrected && provider ? (
        <span className="text-[var(--ui-warn)]">
          {" "}· 上游 {provider.width} × {provider.height}（已等比裁剪，未拉伸）
        </span>
      ) : null}
    </p>
  );
}

/**
 * 实际分辨率徽标：Direct Mode 下必须让人一眼看到「这张真的是多少像素」。
 * 若上游输出明显低于本次请求（长边不足 75%），如实标注「上游降档」，不冒充 4K。
 */
function ResolutionBadge(props: { version: CommerceImageVersion }) {
  const { width, height, requestedSize } = props.version;
  if (!width || !height) return null;
  const requestedLong = requestedSize ? Math.max(requestedSize.width, requestedSize.height) : 0;
  const downgraded = Boolean(requestedLong) && Math.max(width, height) < requestedLong * 0.75;
  return (
    <div
      className={cn(
        "pointer-events-none absolute bottom-2 left-2 rounded-md px-1.5 py-[2px] text-[10.5px] font-medium tracking-[0.01em] backdrop-blur-[2px]",
        downgraded ? "bg-[var(--ui-warn)]/82 text-black" : "bg-black/55 text-white/85"
      )}
    >
      {width} × {height}
      {downgraded && requestedSize ? ` · 上游降档（请求 ${requestedSize.width} × ${requestedSize.height}）` : ""}
    </div>
  );
}

function IconAction(props: { label: string; onClick: () => void; disabled?: boolean; children: ReactNode }) {
  return (
    <button
      type="button"
      title={props.label}
      aria-label={props.label}
      disabled={props.disabled}
      onClick={props.onClick}
      className="rounded-lg border border-white/12 bg-black/45 p-1.5 text-white/90 backdrop-blur-sm transition-colors duration-150 hover:bg-black/65 disabled:opacity-40"
    >
      {props.children}
    </button>
  );
}

function MenuItem(props: { onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={props.onClick}
      className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-[12.5px] text-ink-2 transition-colors duration-150 hover:bg-surface-2 hover:text-ink-1"
    >
      {props.children}
    </button>
  );
}
