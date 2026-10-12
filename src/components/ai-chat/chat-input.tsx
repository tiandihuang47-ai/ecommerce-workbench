"use client";

import { useEffect, useRef } from "react";
import { Send, Square } from "lucide-react";
import { ContextRefs } from "@/components/ai-chat/context-refs";
import type { AIChatContextRef } from "@/lib/ai-chat-types";
import { cn } from "@/lib/utils";

export function ChatComposer({
  value,
  loading,
  refs,
  hint,
  onChange,
  onSend,
  onStop,
  onRefsChange
}: {
  value: string;
  loading: boolean;
  refs: AIChatContextRef[];
  hint: string;
  onChange: (value: string) => void;
  onSend: () => void;
  onStop: () => void;
  onRefsChange: (refs: AIChatContextRef[]) => void;
}) {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    const node = textareaRef.current;
    if (!node) return;
    node.style.height = "auto";
    node.style.height = `${Math.min(Math.max(node.scrollHeight, 52), 180)}px`;
  }, [value]);

  return (
    <div className="rounded-2xl border border-line bg-surface p-3 transition-colors duration-150 focus-within:border-brand-ring">
      {refs.length > 0 ? (
        <div className="mb-2 flex flex-wrap items-center gap-1.5 border-b border-line pb-2.5">
          <span className="text-[11.5px] text-ink-3">已引用</span>
          <ContextRefs refs={refs} onChange={onRefsChange} disabled={loading} />
        </div>
      ) : null}

      <textarea
        ref={textareaRef}
        value={value}
        rows={1}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
            event.preventDefault();
            onSend();
          }
        }}
        placeholder="描述你要做的事，或直接问一个问题…"
        className="max-h-[180px] min-h-[52px] w-full resize-none bg-transparent px-1 py-1 text-[14px] leading-6 text-ink-1 placeholder:text-ink-3 focus:outline-none"
      />

      <div className="mt-1.5 flex items-center gap-2">
        {refs.length === 0 ? <ContextRefs refs={refs} onChange={onRefsChange} disabled={loading} /> : null}
        <span className="min-w-0 flex-1 truncate px-1 text-[11.5px] text-ink-3">{hint}</span>

        {loading ? (
          <button
            type="button"
            onClick={onStop}
            className="inline-flex h-9 shrink-0 items-center gap-2 rounded-lg border border-line-strong bg-surface-2 px-4 text-[13px] font-medium text-ink-1 transition-colors duration-150 hover:bg-surface"
          >
            <Square className="h-3.5 w-3.5" strokeWidth={2} />
            停止生成
          </button>
        ) : (
          <button
            type="button"
            disabled={!value.trim()}
            onClick={onSend}
            className={cn(
              "inline-flex h-9 shrink-0 items-center gap-2 rounded-lg bg-brand-solid px-4 text-[13px] font-medium text-white",
              "transition-[background-color,transform] duration-150 ease-out hover:bg-[var(--ui-brand-hover)] active:translate-y-px",
              "disabled:pointer-events-none disabled:opacity-45"
            )}
          >
            <Send className="h-3.5 w-3.5" strokeWidth={2} />
            发送
          </button>
        )}
      </div>
    </div>
  );
}
