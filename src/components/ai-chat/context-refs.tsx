"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Check, Database, Plus, Search, X } from "lucide-react";
import type { AIChatContextRef, AIChatContextSource } from "@/lib/ai-chat-types";
import {
  contextSourceOptions,
  listContextOptions,
  maxContextRefs,
  resolveContextRef
} from "@/lib/ai-chat-context";
import { cn } from "@/lib/utils";

export function ContextRefs({
  refs,
  onChange,
  disabled
}: {
  refs: AIChatContextRef[];
  onChange: (refs: AIChatContextRef[]) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [source, setSource] = useState<AIChatContextSource>("product");
  const [keyword, setKeyword] = useState("");
  const panelRef = useRef<HTMLDivElement | null>(null);

  const options = useMemo(() => (open ? listContextOptions(source, keyword).slice(0, 60) : []), [open, source, keyword]);
  const atLimit = refs.length >= maxContextRefs;
  const usedIds = new Set(refs.map((item) => `${item.source}:${item.refId}`));

  useEffect(() => {
    if (!open) setKeyword("");
  }, [open]);

  function addRef(optionSource: AIChatContextSource, refId: string, label: string) {
    if (atLimit || usedIds.has(`${optionSource}:${refId}`)) return;
    onChange([
      ...refs,
      {
        id: `ref_${Date.now()}_${Math.random().toString(16).slice(2, 6)}`,
        source: optionSource,
        refId,
        label,
        createdAt: new Date().toISOString()
      }
    ]);
    setOpen(false);
  }

  function removeRef(id: string) {
    onChange(refs.filter((item) => item.id !== id));
  }

  return (
    <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
      {refs.map((ref) => {
        const resolved = resolveContextRef(ref);
        const label = resolved.label || ref.label || "资料";
        return (
          <span
            key={ref.id}
            title={resolved.content ? resolved.content.slice(0, 160) : `${label}（原始资料已不存在）`}
            className={cn(
              "inline-flex max-w-[240px] items-center gap-1.5 rounded-full border py-1 pl-2.5 pr-1.5 text-[12.5px] transition-colors duration-150",
              resolved.content
                ? "border-brand-ring bg-brand-soft text-ink-1"
                : "border-line bg-surface-2 text-ink-3"
            )}
          >
            <Database className={cn("h-3 w-3 shrink-0", resolved.content ? "text-brand" : "text-ink-3")} strokeWidth={1.8} />
            <span className="truncate">{label}</span>
            <button
              type="button"
              aria-label={`取消引用 ${label}`}
              disabled={disabled}
              onClick={() => removeRef(ref.id)}
              className="inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-ink-3 transition-colors duration-150 hover:bg-white/60 hover:text-danger disabled:opacity-50 dark:hover:bg-white/10"
            >
              <X className="h-3 w-3" strokeWidth={2} />
            </button>
          </span>
        );
      })}

      <div className="relative">
        <button
          type="button"
          disabled={disabled || atLimit}
          onClick={() => setOpen((current) => !current)}
          title={atLimit ? `最多同时引用 ${maxContextRefs} 条资料` : "引用产品资料、脚本、拆片、复盘或资产"}
          className={cn(
            "inline-flex items-center gap-1 rounded-full border border-line bg-surface-2 px-2.5 py-1 text-[12.5px] text-ink-2",
            "transition-colors duration-150 hover:border-line-strong hover:text-ink-1",
            "disabled:cursor-not-allowed disabled:opacity-50"
          )}
        >
          <Plus className="h-3 w-3" strokeWidth={2} />
          {atLimit ? `已引用 ${maxContextRefs} 条` : "引用资料"}
        </button>

        {open ? (
          <>
            <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
            <div
              ref={panelRef}
              className="absolute bottom-[calc(100%+8px)] left-0 z-50 w-[320px] origin-bottom-left rounded-xl border border-line bg-surface p-2.5 shadow-[0_16px_40px_rgba(15,23,42,0.16)] anim-pop-in dark:shadow-[0_16px_40px_rgba(0,0,0,0.5)]"
            >
              <div className="flex flex-wrap gap-1">
                {contextSourceOptions.map((item) => (
                  <button
                    key={item.value}
                    type="button"
                    onClick={() => setSource(item.value)}
                    className={cn(
                      "rounded-lg px-2 py-1 text-[12px] transition-colors duration-150",
                      source === item.value ? "bg-brand-soft text-brand" : "text-ink-3 hover:bg-surface-2 hover:text-ink-1"
                    )}
                  >
                    {item.label}
                  </button>
                ))}
              </div>

              <div className="relative mt-2">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink-3" strokeWidth={1.8} />
                <input
                  value={keyword}
                  onChange={(event) => setKeyword(event.target.value)}
                  placeholder="搜索"
                  className="h-9 w-full rounded-lg border border-line bg-surface-2 pl-8 pr-2.5 text-[12.5px] text-ink-1 placeholder:text-ink-3 focus:border-brand-ring focus:outline-none"
                />
              </div>

              <div className="mt-2 max-h-[240px] overflow-y-auto scrollbar-subtle">
                {options.length === 0 ? (
                  <p className="px-2 py-6 text-center text-[12.5px] text-ink-3">
                    {keyword.trim() ? "没有匹配的资料。" : "这里还没有可引用的内容。"}
                  </p>
                ) : (
                  options.map((option) => {
                    const used = usedIds.has(`${source}:${option.value}`);
                    return (
                      <button
                        key={option.value}
                        type="button"
                        disabled={used}
                        onClick={() => addRef(source, option.value, option.label)}
                        className={cn(
                          "flex w-full items-start gap-2 rounded-lg px-2 py-1.5 text-left transition-colors duration-150",
                          used ? "opacity-45" : "hover:bg-surface-2"
                        )}
                      >
                        <span className="mt-0.5 shrink-0 text-ink-3">
                          {used ? <Check className="h-3.5 w-3.5" strokeWidth={2} /> : <Plus className="h-3.5 w-3.5" strokeWidth={2} />}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[13px] text-ink-1">{option.label}</span>
                          {option.hint ? <span className="mt-0.5 block truncate text-[11.5px] text-ink-3">{option.hint}</span> : null}
                        </span>
                      </button>
                    );
                  })
                )}
              </div>
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
}
