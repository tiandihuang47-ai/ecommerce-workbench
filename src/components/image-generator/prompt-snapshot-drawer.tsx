"use client";

import { Check, Copy, X } from "lucide-react";
import { useState } from "react";
import type { CommerceImagePromptSnapshot } from "@/lib/commerce-image-types";

/**
 * 「查看生成提示词」抽屉：显示这次生成的两个层次——
 *   1. 用户原始输入（我当时跟 AI 说了什么）
 *   2. 最终发往 Provider 的完整提示词（模型实际收到什么）
 * 都支持选中和一键复制。旧任务没有快照时明确说明，不伪造。
 */
export function PromptSnapshotDrawer(props: {
  snapshot?: CommerceImagePromptSnapshot;
  /** 旧任务的兜底：任务里还留着的用户原始输入。 */
  fallbackInstruction?: string;
  onClose: () => void;
  onNotify: (message: string) => void;
}) {
  const [copied, setCopied] = useState("");
  const snapshot = props.snapshot;
  const instruction = snapshot?.userInstruction || props.fallbackInstruction || "";
  const panels = snapshot?.panels || [];

  async function copy(label: string, text: string) {
    const value = text.trim();
    if (!value) {
      props.onNotify("这里还没有可复制的内容。");
      return;
    }
    try {
      try {
        if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(value);
        else throw new Error("clipboard-unavailable");
      } catch {
        /* 有些内嵌浏览器 / 未聚焦的窗口会拒绝异步剪贴板，退回选中 + execCommand。 */
        const area = document.createElement("textarea");
        area.value = value;
        area.style.position = "fixed";
        area.style.opacity = "0";
        document.body.appendChild(area);
        area.select();
        const ok = document.execCommand("copy");
        area.remove();
        if (!ok) throw new Error("copy-failed");
      }
      setCopied(label);
      props.onNotify(label === "instruction" ? "已复制我的需求。" : "已复制最终生图 Prompt。");
      window.setTimeout(() => setCopied(""), 1800);
    } catch {
      props.onNotify("复制失败，请手动选中文字复制。");
    }
  }

  return (
    <div className="fixed inset-0 z-[60] bg-black/40 backdrop-blur-[1px]" onClick={props.onClose}>
      <aside
        className="anim-fade-up absolute right-0 top-0 flex h-full w-[560px] max-w-[94vw] flex-col border-l border-line bg-surface"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex shrink-0 items-center justify-between border-b border-line px-4 py-3">
          <div>
            <span className="text-[14px] font-medium text-ink-1">生成提示词</span>
            <p className="mt-0.5 text-[11.5px] text-ink-3">
              {snapshot
                ? `记录于 ${formatTime(snapshot.capturedAt)} · ${
                    snapshot.panels.length > 1 ? `${snapshot.panels.length} 张画面` : "1 张画面"
                  }`
                : "这个任务没有提示词快照"}
            </p>
          </div>
          <button
            type="button"
            aria-label="关闭"
            onClick={props.onClose}
            className="rounded-lg p-1 text-ink-3 transition-colors duration-150 hover:bg-surface-2 hover:text-ink-1"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto scrollbar-subtle p-4">
          {!snapshot ? (
            <p className="rounded-xl border border-line bg-surface-2 px-3 py-2.5 text-[12.5px] leading-6 text-ink-2">
              该历史任务创建于提示词保存功能上线前，暂无完整提示词记录。
            </p>
          ) : null}

          <section>
            <header className="mb-1.5 flex items-center justify-between gap-2">
              <h3 className="text-[12.5px] font-medium text-ink-2">我的需求</h3>
              <CopyButton
                label="复制我的需求"
                done={copied === "instruction"}
                onClick={() => void copy("instruction", instruction)}
              />
            </header>
            {instruction ? (
              <pre className="select-text whitespace-pre-wrap break-words rounded-xl border border-line bg-surface-2 px-3 py-2.5 text-[12.5px] leading-6 text-ink-1">
                {instruction}
              </pre>
            ) : (
              <p className="rounded-xl border border-line bg-surface-2 px-3 py-2.5 text-[12px] text-ink-3">没有记录到原始需求。</p>
            )}
          </section>

          {panels.length > 1 ? (
            panels.map((panel, index) => (
              <section key={panel.panelId || index}>
                <header className="mb-1.5 flex items-center justify-between gap-2">
                  <h3 className="min-w-0 truncate text-[12.5px] font-medium text-ink-2">
                    最终生图 Prompt · 第 {index + 1} 张{panel.title ? ` · ${panel.title}` : ""}
                  </h3>
                  <CopyButton
                    label="复制这张 Prompt"
                    done={copied === `panel-${index}`}
                    onClick={() => void copy(`panel-${index}`, panel.compiledPrompt)}
                  />
                </header>
                <pre className="select-text whitespace-pre-wrap break-words rounded-xl border border-line bg-surface-2 px-3 py-2.5 text-[12px] leading-6 text-ink-2">
                  {panel.compiledPrompt || "（空）"}
                </pre>
              </section>
            ))
          ) : (
            <section>
              <header className="mb-1.5 flex items-center justify-between gap-2">
                <h3 className="text-[12.5px] font-medium text-ink-2">最终生图 Prompt</h3>
                <CopyButton
                  label="复制最终 Prompt"
                  done={copied === "compiled"}
                  onClick={() => void copy("compiled", snapshot?.compiledPrompt || "")}
                />
              </header>
              {snapshot?.compiledPrompt ? (
                <pre className="select-text whitespace-pre-wrap break-words rounded-xl border border-line bg-surface-2 px-3 py-2.5 text-[12px] leading-6 text-ink-2">
                  {snapshot.compiledPrompt}
                </pre>
              ) : (
                <p className="rounded-xl border border-line bg-surface-2 px-3 py-2.5 text-[12px] leading-6 text-ink-3">
                  该历史任务创建于提示词保存功能上线前，暂无完整提示词记录。
                </p>
              )}
            </section>
          )}

          {snapshot ? (
            <section>
              <h3 className="mb-1.5 text-[12.5px] font-medium text-ink-2">这次用的参数</h3>
              <dl className="grid grid-cols-2 gap-x-3 gap-y-1.5 rounded-xl border border-line bg-surface-2 px-3 py-2.5 text-[12px] text-ink-2">
                <Param label="模型" value={snapshot.resolvedModelId || snapshot.model} />
                <Param label="比例" value={snapshot.ratio} />
                <Param label="清晰度" value={snapshot.quality} />
                <Param label="数量" value={`${snapshot.count} 张`} />
                <Param label="内容目标" value={snapshot.contentGoal || "—"} />
                <Param label="记录时间" value={formatTime(snapshot.updatedAt || snapshot.capturedAt)} />
              </dl>
            </section>
          ) : null}
        </div>
      </aside>
    </div>
  );
}

function Param(props: { label: string; value: string }) {
  return (
    <div className="flex min-w-0 items-center justify-between gap-2">
      <dt className="shrink-0 text-ink-3">{props.label}</dt>
      <dd className="min-w-0 truncate text-ink-1">{props.value}</dd>
    </div>
  );
}

function CopyButton(props: { label: string; done: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      title={props.label}
      onClick={props.onClick}
      className="inline-flex shrink-0 items-center gap-1 rounded-md border border-line px-2 py-[3px] text-[11.5px] text-ink-3 transition-colors duration-150 hover:bg-surface-2 hover:text-ink-1"
    >
      {props.done ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
      {props.done ? "已复制" : props.label}
    </button>
  );
}

function formatTime(value: string) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString("zh-CN");
}
