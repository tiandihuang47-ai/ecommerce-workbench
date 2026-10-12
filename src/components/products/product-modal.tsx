"use client";

import { X } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/** 产品相关弹窗的共用外壳（产品资产中心与产品编辑器共用，避免循环依赖）。 */
export function Modal(props: { title: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  return (
    <div className="fixed inset-0 z-[110] flex items-start justify-center overflow-y-auto bg-black/45 p-6 backdrop-blur-[1px]" onClick={props.onClose}>
      <div
        className={cn("anim-fade-up mt-10 w-full rounded-2xl border border-line bg-surface p-5 shadow-2xl", props.wide ? "max-w-3xl" : "max-w-lg")}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between gap-3">
          <h3 className="text-[15px] font-medium text-ink-1">{props.title}</h3>
          <button type="button" aria-label="关闭" onClick={props.onClose} className="rounded-lg p-1 text-ink-3 hover:bg-surface-2 hover:text-ink-1">
            <X className="h-4 w-4" />
          </button>
        </div>
        {props.children}
      </div>
    </div>
  );
}
