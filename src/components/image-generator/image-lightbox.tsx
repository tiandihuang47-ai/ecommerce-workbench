"use client";

import { useEffect, useRef, useState } from "react";
import { Minus, Plus, RotateCcw, X } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * 生成图全屏查看器：黑底全屏 + 滚轮缩放 + 放大后拖拽平移 + Esc/点空白关闭。
 * 从旧版工作台的 FreeChatLightbox 精简平移；图片 URL 即原始分辨率文件，无需另存。
 */
export function ImageLightbox(props: {
  url: string;
  name?: string;
  width?: number;
  height?: number;
  onClose: () => void;
}) {
  const [scale, setScale] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const dragState = useRef<{ x: number; y: number; ox: number; oy: number } | null>(null);

  /* Esc 关闭、0 复位；打开期间锁定背景滚动。 */
  useEffect(() => {
    function handleKey(event: KeyboardEvent) {
      if (event.key === "Escape") props.onClose();
      if (event.key === "0") {
        setScale(1);
        setOffset({ x: 0, y: 0 });
      }
    }
    document.addEventListener("keydown", handleKey);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", handleKey);
      document.body.style.overflow = previousOverflow;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const toolbarButton = "rounded-lg border border-white/20 px-2 py-1 text-[12px] text-white/80 transition-colors duration-150 hover:border-white/40 hover:text-white";

  return (
    <div
      className="anim-fade-in fixed inset-0 z-50 flex flex-col bg-[rgba(4,5,8,0.92)]"
      data-image-lightbox
      onClick={(event) => {
        /* 只有点到遮罩/图片留白处才关闭；点工具栏或图片本身不关。 */
        if (event.target === event.currentTarget) props.onClose();
      }}
    >
      <div className="flex shrink-0 items-center gap-3 px-4 py-3">
        <span className="truncate text-[12px] text-white/70">
          {props.name || "生成图"}
          {props.width && props.height ? ` · ${props.width} × ${props.height}` : ""}
        </span>
        <div className="ml-auto flex shrink-0 items-center gap-2">
          <button type="button" aria-label="缩小" onClick={() => setScale((value) => Math.max(1, Number((value - 0.25).toFixed(2))))} className={toolbarButton}><Minus className="h-3.5 w-3.5" /></button>
          <button type="button" aria-label="放大" onClick={() => setScale((value) => Math.min(4, Number((value + 0.25).toFixed(2))))} className={toolbarButton}><Plus className="h-3.5 w-3.5" /></button>
          <button type="button" aria-label="原始大小" onClick={() => { setScale(1); setOffset({ x: 0, y: 0 }); }} className={toolbarButton}><RotateCcw className="h-3.5 w-3.5" /></button>
          <a href={props.url} download={props.name || "生成图"} className={cn(toolbarButton, "px-2.5")}>下载</a>
          <button type="button" aria-label="关闭全屏" onClick={props.onClose} className={toolbarButton}><X className="h-3.5 w-3.5" /></button>
        </div>
      </div>
      <div
        className="relative min-h-0 flex-1 overflow-hidden"
        onWheel={(event) => {
          event.preventDefault();
          setScale((value) => Math.min(4, Math.max(1, Number((value + (event.deltaY < 0 ? 0.2 : -0.2)).toFixed(2)))));
        }}
        onPointerDown={(event) => {
          if (scale === 1) return;
          dragState.current = { x: event.clientX, y: event.clientY, ox: offset.x, oy: offset.y };
          event.currentTarget.setPointerCapture(event.pointerId);
        }}
        onPointerMove={(event) => {
          const drag = dragState.current;
          if (!drag) return;
          setOffset({ x: drag.ox + (event.clientX - drag.x), y: drag.oy + (event.clientY - drag.y) });
        }}
        onPointerUp={() => { dragState.current = null; }}
        onClick={(event) => {
          if (event.target === event.currentTarget) props.onClose();
        }}
      >
        <div className="flex h-full items-center justify-center p-4">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={props.url}
            alt={props.name || "生成图全屏预览"}
            draggable={false}
            style={{ transform: `translate(${offset.x}px, ${offset.y}px) scale(${scale})` }}
            className={cn("max-h-full max-w-full select-none object-contain", scale > 1 ? "cursor-grab" : "cursor-zoom-in")}
          />
        </div>
      </div>
      <p className="shrink-0 px-4 pb-3 text-center text-[11px] text-white/40">滚轮缩放 · 放大后可拖动 · 按 0 复位 · Esc 或点空白处关闭</p>
    </div>
  );
}
