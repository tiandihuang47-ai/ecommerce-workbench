"use client";

import { useState } from "react";
import ReactMarkdown from "react-markdown";
import { Check, Copy, RefreshCw, Save } from "lucide-react";
import type { AIChatMessage as AIChatMessageType } from "@/lib/ai-chat-types";
import { cn } from "@/lib/utils";

export type SaveAssetKind = "script" | "deconstruction" | "review" | "ai_chat";

const saveOptions: Array<{ kind: SaveAssetKind; label: string }> = [
  { kind: "script", label: "存为脚本" },
  { kind: "deconstruction", label: "存为拆片" },
  { kind: "review", label: "存为复盘" },
  { kind: "ai_chat", label: "存为对话记录" }
];

export function ChatMessage({
  message,
  canRegenerate,
  onRegenerate,
  onSaveAsset
}: {
  message: AIChatMessageType;
  canRegenerate: boolean;
  onRegenerate: (messageId: string) => void;
  onSaveAsset: (messageId: string, kind: SaveAssetKind) => void;
}) {
  const [copied, setCopied] = useState(false);
  const [saveOpen, setSaveOpen] = useState(false);
  const isUser = message.role === "user";

  async function copy() {
    try {
      await navigator.clipboard.writeText(message.content);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1400);
    } catch {
      setCopied(false);
    }
  }

  if (isUser) {
    return (
      <article className="flex justify-end anim-fade-up">
        {/* 暗色主题下 --ui-brand 是亮紫，白字只有 3.33:1；改用深色文字后为 5.67:1。 */}
        <div className="max-w-[76%] whitespace-pre-wrap break-words rounded-2xl rounded-br-md bg-brand-solid px-4 py-2.5 text-[14px] leading-6 text-white dark:text-canvas">
          {message.content}
        </div>
      </article>
    );
  }

  const streaming = message.status === "sending";
  const failed = message.status === "failed";

  return (
    <article className="group anim-fade-up">
      <div className="max-w-[68ch]">
        {streaming && !message.content ? (
          <div className="flex items-center gap-2 py-1 text-[13px] text-ink-3">
            <span className="flex gap-1">
              <i className="h-1.5 w-1.5 animate-pulse rounded-full bg-ink-3" />
              <i className="h-1.5 w-1.5 animate-pulse rounded-full bg-ink-3 [animation-delay:150ms]" />
              <i className="h-1.5 w-1.5 animate-pulse rounded-full bg-ink-3 [animation-delay:300ms]" />
            </span>
            AI 正在思考…
          </div>
        ) : message.content ? (
          <div className="md-body text-[14px] text-ink-1">
            <ReactMarkdown components={markdownComponents}>{message.content}</ReactMarkdown>
            {streaming ? <span className="ml-0.5 inline-block h-4 w-[2px] translate-y-[2px] animate-pulse bg-brand" /> : null}
          </div>
        ) : null}

        {failed ? (
          <div className="mt-2 flex flex-wrap items-center gap-3 rounded-xl border border-danger/25 bg-danger-soft px-3.5 py-2.5 text-[13px] text-danger">
            <span className="min-w-0 flex-1">{message.errorMessage || "AI 回复失败，请重试。"}</span>
            {message.content ? null : (
              <button
                type="button"
                disabled={!canRegenerate}
                onClick={() => onRegenerate(message.id)}
                className="inline-flex h-7 shrink-0 items-center gap-1.5 rounded-lg border border-danger/30 px-2.5 text-[12.5px] transition-colors duration-150 hover:bg-danger/10 disabled:opacity-50"
              >
                <RefreshCw className="h-3.5 w-3.5" strokeWidth={1.8} />
                重试本条
              </button>
            )}
          </div>
        ) : null}
      </div>

      {!streaming && message.content ? (
        <div className="mt-2 flex flex-wrap items-center gap-1 opacity-0 transition-opacity duration-150 group-hover:opacity-100 focus-within:opacity-100 max-md:opacity-100">
          <ActionButton onClick={copy} label={copied ? "已复制" : "复制"}>
            {copied ? <Check className="h-3.5 w-3.5" strokeWidth={2} /> : <Copy className="h-3.5 w-3.5" strokeWidth={1.8} />}
          </ActionButton>

          <div className="relative">
            <ActionButton onClick={() => setSaveOpen((current) => !current)} label="存到资产库">
              <Save className="h-3.5 w-3.5" strokeWidth={1.8} />
            </ActionButton>
            {saveOpen ? (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setSaveOpen(false)} />
                <div className="absolute left-0 top-[calc(100%+6px)] z-50 w-[152px] rounded-xl border border-line bg-surface p-1 shadow-[0_16px_40px_rgba(15,23,42,0.16)] anim-pop-in dark:shadow-[0_16px_40px_rgba(0,0,0,0.5)]">
                  {saveOptions.map((option) => (
                    <button
                      key={option.kind}
                      type="button"
                      onClick={() => {
                        setSaveOpen(false);
                        onSaveAsset(message.id, option.kind);
                      }}
                      className="block w-full rounded-lg px-2.5 py-1.5 text-left text-[12.5px] text-ink-2 transition-colors duration-150 hover:bg-surface-2 hover:text-ink-1"
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
              </>
            ) : null}
          </div>

          <ActionButton onClick={() => onRegenerate(message.id)} label="重新生成" disabled={!canRegenerate}>
            <RefreshCw className="h-3.5 w-3.5" strokeWidth={1.8} />
          </ActionButton>
        </div>
      ) : null}
    </article>
  );
}

function ActionButton({
  onClick,
  label,
  disabled,
  children
}: {
  onClick: () => void;
  label: string;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "inline-flex h-7 items-center gap-1.5 rounded-lg px-2 text-[12.5px] text-ink-3",
        "transition-colors duration-150 hover:bg-surface-2 hover:text-ink-1 disabled:pointer-events-none disabled:opacity-50"
      )}
    >
      {children}
      {label}
    </button>
  );
}

const markdownComponents = {
  h1: ({ children }: { children?: React.ReactNode }) => <h1 className="mb-2 mt-5 text-[17px] font-semibold leading-7 text-ink-1 first:mt-0">{children}</h1>,
  h2: ({ children }: { children?: React.ReactNode }) => <h2 className="mb-2 mt-5 text-[15.5px] font-semibold leading-7 text-ink-1 first:mt-0">{children}</h2>,
  h3: ({ children }: { children?: React.ReactNode }) => <h3 className="mb-1.5 mt-4 text-[14.5px] font-semibold leading-6 text-ink-1 first:mt-0">{children}</h3>,
  h4: ({ children }: { children?: React.ReactNode }) => <h4 className="mb-1.5 mt-3 text-[14px] font-semibold leading-6 text-ink-2 first:mt-0">{children}</h4>,
  p: ({ children }: { children?: React.ReactNode }) => <p className="my-2 leading-7 first:mt-0 last:mb-0">{children}</p>,
  ul: ({ children }: { children?: React.ReactNode }) => <ul className="my-2 list-disc space-y-1 pl-5 first:mt-0 last:mb-0">{children}</ul>,
  ol: ({ children }: { children?: React.ReactNode }) => <ol className="my-2 list-decimal space-y-1 pl-5 first:mt-0 last:mb-0">{children}</ol>,
  li: ({ children }: { children?: React.ReactNode }) => <li className="leading-7">{children}</li>,
  strong: ({ children }: { children?: React.ReactNode }) => <strong className="font-semibold text-ink-1">{children}</strong>,
  em: ({ children }: { children?: React.ReactNode }) => <em className="text-ink-2">{children}</em>,
  a: ({ children, href }: { children?: React.ReactNode; href?: string }) => (
    <a href={href} target="_blank" rel="noreferrer" className="text-brand underline underline-offset-2">{children}</a>
  ),
  code: ({ children }: { children?: React.ReactNode }) => (
    <code className="rounded bg-surface-2 px-1.5 py-0.5 text-[12.5px] text-ink-1">{children}</code>
  ),
  pre: ({ children }: { children?: React.ReactNode }) => (
    <pre className="my-2.5 overflow-x-auto rounded-xl border border-line bg-surface-2 p-3 text-[12.5px] leading-6 scrollbar-subtle">{children}</pre>
  ),
  blockquote: ({ children }: { children?: React.ReactNode }) => (
    <blockquote className="my-2.5 border-l-2 border-brand pl-3 text-ink-2">{children}</blockquote>
  ),
  hr: () => <hr className="my-4 border-line" />,
  table: ({ children }: { children?: React.ReactNode }) => (
    <div className="my-2.5 overflow-x-auto scrollbar-subtle">
      <table className="w-full border-collapse text-[12.5px]">{children}</table>
    </div>
  ),
  th: ({ children }: { children?: React.ReactNode }) => (
    <th className="border border-line bg-surface-2 px-2.5 py-1.5 text-left font-semibold text-ink-1">{children}</th>
  ),
  td: ({ children }: { children?: React.ReactNode }) => <td className="border border-line px-2.5 py-1.5 text-ink-2">{children}</td>
};
