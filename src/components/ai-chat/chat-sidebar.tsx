"use client";

import { useEffect, useRef, useState } from "react";
import { Check, MessageSquarePlus, Pencil, Search, Trash2, X } from "lucide-react";
import type { AIChatSession } from "@/lib/ai-chat-types";
import { cn } from "@/lib/utils";

export function ChatSidebar({
  sessions,
  activeId,
  keyword,
  onKeywordChange,
  onCreate,
  onSelect,
  onDelete,
  onRename,
  className
}: {
  sessions: AIChatSession[];
  activeId: string;
  keyword: string;
  onKeywordChange: (value: string) => void;
  onCreate: () => void;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
  onRename: (id: string, title: string) => void;
  className?: string;
}) {
  const [editingId, setEditingId] = useState("");
  const [draftTitle, setDraftTitle] = useState("");
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (editingId) inputRef.current?.focus();
  }, [editingId]);

  const search = keyword.trim().toLowerCase();
  const filtered = sessions.filter((session) => {
    if (!search) return true;
    const last = session.messages[session.messages.length - 1]?.content || "";
    return `${session.title} ${last}`.toLowerCase().includes(search);
  });
  const groups = groupSessions(filtered);

  function startRename(session: AIChatSession) {
    setEditingId(session.id);
    setDraftTitle(session.title || "新对话");
  }

  function commitRename() {
    if (editingId) onRename(editingId, draftTitle);
    setEditingId("");
  }

  return (
    <aside className={cn("flex min-h-0 flex-col rounded-2xl border border-line bg-surface", className)}>
      <div className="shrink-0 border-b border-line p-2.5">
        <button
          type="button"
          onClick={onCreate}
          className="inline-flex h-9 w-full items-center justify-center gap-2 rounded-lg bg-brand-solid text-[13px] font-medium text-white transition-[background-color,transform] duration-150 ease-out hover:bg-[var(--ui-brand-hover)] active:translate-y-px"
        >
          <MessageSquarePlus className="h-3.5 w-3.5" strokeWidth={2} />
          新建对话
        </button>
        <div className="relative mt-2">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink-3" strokeWidth={1.8} />
          <input
            value={keyword}
            onChange={(event) => onKeywordChange(event.target.value)}
            placeholder="搜索对话"
            className="h-9 w-full rounded-lg border border-line bg-surface-2 pl-8 pr-2.5 text-[12.5px] text-ink-1 placeholder:text-ink-3 focus:border-brand-ring focus:outline-none"
          />
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-2 scrollbar-subtle">
        {groups.length === 0 ? (
          <p className="px-2 py-8 text-center text-[12.5px] leading-6 text-ink-3">
            {search ? "没有匹配的对话。" : "还没有对话，点上面的按钮开一个。"}
          </p>
        ) : null}

        {groups.map((group) => (
          <section key={group.label} className="mb-2 last:mb-0">
            <h3 className="px-2 pb-1 pt-1.5 text-[11px] font-medium tracking-[0.04em] text-ink-3">{group.label}</h3>
            <div className="space-y-0.5">
              {group.sessions.map((session) => {
                const active = activeId === session.id;
                const editing = editingId === session.id;

                return (
                  <div
                    key={session.id}
                    className={cn(
                      "group relative flex items-center gap-1 rounded-lg pr-1 transition-colors duration-150",
                      active ? "bg-brand-soft" : "hover:bg-surface-2"
                    )}
                  >
                    {editing ? (
                      <div className="flex flex-1 items-center gap-1 px-1.5 py-1">
                        <input
                          ref={inputRef}
                          value={draftTitle}
                          onChange={(event) => setDraftTitle(event.target.value)}
                          onKeyDown={(event) => {
                            if (event.key === "Enter") commitRename();
                            if (event.key === "Escape") setEditingId("");
                          }}
                          className="h-7 min-w-0 flex-1 rounded-md border border-brand-ring bg-surface px-2 text-[12.5px] text-ink-1 focus:outline-none"
                        />
                        <IconAction label="保存名称" onClick={commitRename}>
                          <Check className="h-3.5 w-3.5" strokeWidth={2} />
                        </IconAction>
                        <IconAction label="取消重命名" onClick={() => setEditingId("")}>
                          <X className="h-3.5 w-3.5" strokeWidth={2} />
                        </IconAction>
                      </div>
                    ) : (
                      <>
                        <button
                          type="button"
                          onClick={() => onSelect(session.id)}
                          onDoubleClick={() => startRename(session)}
                          className="min-w-0 flex-1 px-2 py-2 text-left"
                        >
                          <span className={cn("block truncate text-[13px]", active ? "font-medium text-brand" : "text-ink-1")}>
                            {session.title || "新对话"}
                          </span>
                          <span className="mt-0.5 flex items-center gap-1.5 text-[11.5px] text-ink-3">
                            <span className="truncate">{getSessionSummary(session)}</span>
                            <span className="shrink-0">·</span>
                            <span className="shrink-0">{formatTime(session.updatedAt)}</span>
                          </span>
                        </button>
                        <span className="flex shrink-0 items-center opacity-0 transition-opacity duration-150 group-hover:opacity-100 focus-within:opacity-100 max-md:opacity-100">
                          <IconAction label="重命名对话" onClick={() => startRename(session)}>
                            <Pencil className="h-3.5 w-3.5" strokeWidth={1.8} />
                          </IconAction>
                          <IconAction label="删除对话" danger onClick={() => onDelete(session.id)}>
                            <Trash2 className="h-3.5 w-3.5" strokeWidth={1.8} />
                          </IconAction>
                        </span>
                      </>
                    )}
                  </div>
                );
              })}
            </div>
          </section>
        ))}
      </div>
    </aside>
  );
}

function IconAction({
  label,
  onClick,
  danger,
  children
}: {
  label: string;
  onClick: () => void;
  danger?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onClick={onClick}
      className={cn(
        "inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-ink-3 transition-colors duration-150",
        danger ? "hover:bg-danger-soft hover:text-danger" : "hover:bg-surface hover:text-ink-1"
      )}
    >
      {children}
    </button>
  );
}

function groupSessions(sessions: AIChatSession[]) {
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const startOfYesterday = startOfToday - 24 * 60 * 60 * 1000;

  const buckets: Array<{ label: string; sessions: AIChatSession[] }> = [
    { label: "今天", sessions: [] },
    { label: "昨天", sessions: [] },
    { label: "更早", sessions: [] }
  ];

  sessions.forEach((session) => {
    const time = new Date(session.updatedAt).getTime();
    if (Number.isNaN(time) || time >= startOfToday) buckets[0].sessions.push(session);
    else if (time >= startOfYesterday) buckets[1].sessions.push(session);
    else buckets[2].sessions.push(session);
  });

  return buckets.filter((bucket) => bucket.sessions.length > 0);
}

function getSessionSummary(session: AIChatSession) {
  const last = [...session.messages].reverse().find((message) => message.content.trim());
  if (!last) return session.contextRefs.length ? `已引用 ${session.contextRefs.length} 条资料` : "还没有消息";
  return last.content.replace(/\s+/g, " ").slice(0, 40);
}

function formatTime(value: string) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const now = new Date();
  const sameDay = date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth() && date.getDate() === now.getDate();
  if (sameDay) return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
  return `${date.getMonth() + 1}/${date.getDate()}`;
}
