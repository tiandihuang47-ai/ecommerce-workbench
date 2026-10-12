"use client";

import { MoreHorizontal, Sparkles } from "lucide-react";
import type { SkillListItem } from "@/lib/skills-client";
import { cn } from "@/lib/utils";

const statusStyles: Record<SkillListItem["publicStatus"], string> = {
  ready: "bg-ok-soft text-ok",
  preparing: "bg-info-soft text-info",
  requires_authorization: "bg-warn-soft text-warn",
  unavailable: "bg-danger-soft text-danger",
  disabled: "bg-surface-2 text-ink-3"
};

const statusLabels: Record<SkillListItem["publicStatus"], string> = {
  ready: "可使用",
  preparing: "正在准备",
  requires_authorization: "需要授权",
  unavailable: "暂时无法使用",
  disabled: "已停用"
};

const sourceLabels: Record<string, string> = {
  file: "文件",
  folder: "文件夹",
  zip: "压缩包"
};

export function SkillCard({
  skill,
  menuOpen,
  onToggleMenu,
  onUse,
  onDetail,
  onToggleEnabled,
  onDelete
}: {
  skill: SkillListItem;
  menuOpen: boolean;
  onToggleMenu: () => void;
  onUse: () => void;
  onDetail: () => void;
  onToggleEnabled: () => void;
  onDelete: () => void;
}) {
  return (
    <article className="relative flex flex-col rounded-2xl border border-line bg-surface p-4 transition-colors duration-150 hover:border-line-strong">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="truncate text-[15px] font-medium text-ink-1" title={skill.name}>
            {skill.name}
          </h3>
          <p className="mt-1 line-clamp-2 min-h-[36px] text-[12.5px] leading-5 text-ink-3">{skill.description}</p>
        </div>
        <span className={cn("shrink-0 rounded-full px-2 py-0.5 text-[11.5px]", statusStyles[skill.publicStatus])}>
          {statusLabels[skill.publicStatus]}
        </span>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[11.5px] text-ink-3">
        <span>{sourceLabels[skill.sourceType] || "本地导入"}</span>
        <span className="text-line-strong">·</span>
        <span>{skill.version}</span>
        {skill.statusDetail ? (
          <>
            <span className="text-line-strong">·</span>
            <span className="min-w-0 truncate" title={skill.statusDetail}>{skill.statusDetail}</span>
          </>
        ) : null}
      </div>

      <div className="mt-4 flex items-center gap-2">
        <button
          type="button"
          disabled={!skill.usable}
          onClick={onUse}
          className={cn(
            "inline-flex h-8 items-center gap-1.5 rounded-lg px-3 text-[12.5px] font-medium transition-colors duration-150",
            skill.usable
              ? "bg-brand-solid text-white hover:bg-[var(--ui-brand-hover)]"
              : "cursor-not-allowed bg-surface-2 text-ink-3"
          )}
        >
          <Sparkles className="h-3.5 w-3.5" strokeWidth={1.8} />
          使用
        </button>
        <button
          type="button"
          onClick={onDetail}
          className="inline-flex h-8 items-center rounded-lg px-2.5 text-[12.5px] text-ink-2 transition-colors duration-150 hover:bg-surface-2 hover:text-ink-1"
        >
          查看详情
        </button>

        <div className="relative ml-auto">
          <button
            type="button"
            aria-label="更多操作"
            onClick={onToggleMenu}
            className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-ink-3 transition-colors duration-150 hover:bg-surface-2 hover:text-ink-1"
          >
            <MoreHorizontal className="h-4 w-4" strokeWidth={1.8} />
          </button>
          {menuOpen ? (
            <>
              <div className="fixed inset-0 z-40" onClick={onToggleMenu} />
              <div className="absolute right-0 top-[calc(100%+6px)] z-50 w-[132px] rounded-xl border border-line bg-surface p-1 shadow-[0_16px_40px_rgba(15,23,42,0.16)] anim-pop-in dark:shadow-[0_16px_40px_rgba(0,0,0,0.5)]">
                <button
                  type="button"
                  onClick={() => { onToggleMenu(); onDetail(); }}
                  className="block w-full rounded-lg px-2.5 py-1.5 text-left text-[12.5px] text-ink-2 transition-colors duration-150 hover:bg-surface-2 hover:text-ink-1"
                >
                  查看
                </button>
                <button
                  type="button"
                  onClick={() => { onToggleMenu(); onToggleEnabled(); }}
                  className="block w-full rounded-lg px-2.5 py-1.5 text-left text-[12.5px] text-ink-2 transition-colors duration-150 hover:bg-surface-2 hover:text-ink-1"
                >
                  {skill.enabled ? "停用" : "启用"}
                </button>
                <button
                  type="button"
                  onClick={() => { onToggleMenu(); onDelete(); }}
                  className="block w-full rounded-lg px-2.5 py-1.5 text-left text-[12.5px] text-danger transition-colors duration-150 hover:bg-danger-soft"
                >
                  删除
                </button>
              </div>
            </>
          ) : null}
        </div>
      </div>
    </article>
  );
}
