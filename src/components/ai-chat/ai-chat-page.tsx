"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowDown, Bot, ChevronRight, Eraser, History, Puzzle, Save, Sparkles, X } from "lucide-react";
import { ChatComposer } from "@/components/ai-chat/chat-input";
import { ChatEmpty } from "@/components/ai-chat/chat-empty";
import { ChatMessage, type SaveAssetKind } from "@/components/ai-chat/chat-message";
import { ChatSidebar } from "@/components/ai-chat/chat-sidebar";
import { consumeAIChatHandoff } from "@/lib/ai-chat-bridge";
import { maxContextRefs, resolveContextRef } from "@/lib/ai-chat-context";
import { aiChatAssistantOptions } from "@/lib/ai-chat-types";
import { syncScriptTranscriptLibrary } from "@/lib/script-transcript-sync";
import type {
  AIChatAssistantKind,
  AIChatContextRef,
  AIChatMessage,
  AIChatSession
} from "@/lib/ai-chat-types";
import {
  clearAIChatSession,
  createAIChatId,
  createAIChatSession,
  deleteAIChatMessage,
  deleteAIChatSession,
  getAIChatNow,
  getAIChatSessions,
  renameAIChatSession,
  saveAIChatMessage,
  setAIChatActiveSkills,
  setAIChatAssistantKind,
  setAIChatSessionRefs,
  updateAIChatMessage,
  updateAIChatSession
} from "@/lib/ai-chat-store";
import { createAsset } from "@/lib/stores/asset-store";
import { cn } from "@/lib/utils";

const saveKindLabels: Record<SaveAssetKind, string> = {
  script: "脚本",
  deconstruction: "拆片",
  review: "复盘",
  ai_chat: "AI 对话"
};

export function AIChatPage() {
  const [sessions, setSessions] = useState<AIChatSession[]>([]);
  const [activeId, setActiveId] = useState("");
  const [input, setInput] = useState("");
  const [keyword, setKeyword] = useState("");
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState("");
  const [historyOpen, setHistoryOpen] = useState(false);
  const [atBottom, setAtBottom] = useState(true);
  /** 已安装且可用的 Skill（Installed）。当前会话只挂载其中 1-3 个（Active）。 */
  const [usableSkills, setUsableSkills] = useState<Array<{ skillId: string; name: string; description: string }>>([]);
  const [skillPickerOpen, setSkillPickerOpen] = useState(false);

  /** 流式输出中的文本只存在内存里，完成后一次性落盘；避免每个分片都写 localStorage。 */
  const [, setStreamTick] = useState(0);
  const listRef = useRef<HTMLDivElement | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const atBottomRef = useRef(true);
  const streamRef = useRef<{ messageId: string; text: string } | null>(null);

  const activeSession = sessions.find((session) => session.id === activeId) || sessions[0] || null;

  useEffect(() => {
    // 进 AI 对话先自愈一次逐字稿库：工作台草稿/旧脚本记录/批量扒稿里解析过的逐字稿都能直接引用。
    syncScriptTranscriptLibrary();

    const stored = getAIChatSessions();
    const initial = stored[0] || createAIChatSession();
    setSessions(getAIChatSessions());
    setActiveId(initial.id);

    void refreshUsableSkills();

    const handoff = consumeAIChatHandoff();
    if (!handoff) return;

    const current = getAIChatSessions().find((session) => session.id === initial.id);
    const merged = mergeRefs(current?.contextRefs || [], handoff.references);
    if (merged.length !== (current?.contextRefs || []).length) {
      setAIChatSessionRefs(initial.id, merged);
      setSessions(getAIChatSessions());
    }
    // Skill 中心点「使用」跳过来时，自动把该 Skill 挂到当前会话。
    if (handoff.skillIds.length > 0) {
      const existing = getAIChatSessions().find((session) => session.id === initial.id);
      const nextSkills = Array.from(new Set([...(existing?.activeSkillIds || []), ...handoff.skillIds])).slice(0, 3);
      setAIChatActiveSkills(initial.id, nextSkills);
      setSessions(getAIChatSessions());
    }
    if (handoff.prompt) setInput(handoff.prompt);
    if (handoff.autoSend && handoff.prompt.trim()) {
      void runSend({ sessionId: initial.id, text: handoff.prompt.trim(), refs: merged });
    }
    // 只在首次进入时消费一次握手数据。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function refreshUsableSkills() {
    try {
      const response = await fetch("/api/skills");
      const data = (await response.json()) as { success?: boolean; skills?: Array<{ skillId: string; name: string; description: string; usable?: boolean }> };
      setUsableSkills(
        (data.skills || [])
          .filter((item) => item.usable)
          .map((item) => ({ skillId: item.skillId, name: item.name, description: item.description }))
      );
    } catch {
      // 拉不到不影响对话本身
    }
  }

  function updateActiveSkills(skillIds: string[]) {
    if (!activeSession) return;
    setAIChatActiveSkills(activeSession.id, skillIds);
    refresh(activeSession.id);
  }

  useEffect(() => {
    if (atBottomRef.current) scrollToBottom("smooth");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeSession?.id, activeSession?.messages.length, loading]);

  function refresh(nextActiveId = activeId) {
    const next = getAIChatSessions();
    setSessions(next);
    if (nextActiveId) setActiveId(nextActiveId);
  }

  function scrollToBottom(behavior: ScrollBehavior = "smooth") {
    const node = listRef.current;
    if (!node) return;
    node.scrollTo({ top: node.scrollHeight, behavior });
    atBottomRef.current = true;
    setAtBottom(true);
  }

  function handleScroll() {
    const node = listRef.current;
    if (!node) return;
    const near = node.scrollHeight - node.scrollTop - node.clientHeight < 48;
    atBottomRef.current = near;
    setAtBottom(near);
  }

  function createSession() {
    const session = createAIChatSession();
    setSessions(getAIChatSessions());
    setActiveId(session.id);
    setInput("");
    setNotice("");
    setHistoryOpen(false);
  }

  function deleteSession(id: string) {
    if (!window.confirm("确定要删除这个对话吗？删除后无法恢复。")) return;
    deleteAIChatSession(id);
    const next = getAIChatSessions();
    if (next.length === 0) {
      const session = createAIChatSession();
      setSessions(getAIChatSessions());
      setActiveId(session.id);
      return;
    }
    setSessions(next);
    if (id === activeId) setActiveId(next[0].id);
  }

  function renameSession(id: string, title: string) {
    if (!renameAIChatSession(id, title)) return;
    refresh(id);
  }

  function clearSession() {
    if (!activeSession) return;
    if (!window.confirm("确定要清空当前对话吗？对话内容会被删除，无法恢复。")) return;
    clearAIChatSession(activeSession.id);
    refresh(activeSession.id);
  }

  function updateRefs(refs: AIChatContextRef[]) {
    if (!activeSession) return;
    setAIChatSessionRefs(activeSession.id, refs);
    refresh(activeSession.id);
  }

  function saveSessionToAssets() {
    if (!activeSession) return;
    const messages = activeSession.messages.filter((message) => message.status === "success" && message.content.trim());
    if (messages.length === 0) {
      setNotice("当前对话还没有可保存的内容。");
      return;
    }
    const content = messages.map((message) => `${message.role === "assistant" ? "AI 助手" : "用户"}：${message.content}`).join("\n\n");
    createAsset({
      id: `asset_ai_chat_${activeSession.id}`,
      type: "ai_chat",
      title: activeSession.title || "AI 对话",
      summary: messages[messages.length - 1]?.content.replace(/\s+/g, " ").slice(0, 120) || "AI 对话摘要",
      content,
      rawData: activeSession,
      sourceModule: "ai_chat",
      platform: "unknown",
      productName: productNameFromRefs(activeSession.contextRefs),
      tags: ["AI 对话"],
      favorite: false,
      status: "completed",
      createdAt: activeSession.createdAt,
      updatedAt: getAIChatNow(),
      linkedRecordIds: [activeSession.id]
    });
    setNotice("整段对话已保存到资产库。");
  }

  function saveMessageToAssets(messageId: string, kind: SaveAssetKind) {
    if (!activeSession) return;
    const message = activeSession.messages.find((item) => item.id === messageId);
    const content = message?.content.trim();
    if (!content) return;

    const title = `${activeSession.title || "AI 对话"} · ${saveKindLabels[kind]}`;
    createAsset({
      id: `asset_ai_chat_${activeSession.id}_${messageId}_${kind}`,
      type: kind,
      title,
      summary: content.replace(/\s+/g, " ").slice(0, 120),
      content,
      rawData: buildMessageRawData(kind, content, title, activeSession),
      sourceModule: "ai_chat",
      platform: "unknown",
      productName: productNameFromRefs(activeSession.contextRefs),
      tags: ["AI 对话", saveKindLabels[kind]],
      favorite: false,
      status: "completed",
      createdAt: getAIChatNow(),
      updatedAt: getAIChatNow(),
      linkedRecordIds: [activeSession.id, messageId]
    });
    setNotice(`已存到资产库：${saveKindLabels[kind]}。`);
  }

  async function sendMessage(customInput?: string) {
    if (!activeSession) return;
    const text = (customInput ?? input).trim();
    if (!text || loading) return;
    setInput("");
    await runSend({ sessionId: activeSession.id, text, refs: activeSession.contextRefs || [] });
  }

  async function runSend({ sessionId, text, refs }: { sessionId: string; text: string; refs: AIChatContextRef[] }) {
    const session = getAIChatSessions().find((item) => item.id === sessionId);
    if (!session) return;

    setLoading(true);
    setNotice("");
    atBottomRef.current = true;
    setAtBottom(true);

    const userMessage = makeMessage("user", text, "success");
    saveAIChatMessage(session.id, userMessage);

    const withUser = getAIChatSessions().find((item) => item.id === session.id);
    if (withUser && (!withUser.title || withUser.title === "新对话")) {
      updateAIChatSession(session.id, { title: makeTitle(text) });
    }

    const assistantMessage = makeMessage("assistant", "", "sending");
    saveAIChatMessage(session.id, assistantMessage);
    refresh(session.id);

    const controller = new AbortController();
    abortRef.current = controller;
    streamRef.current = { messageId: assistantMessage.id, text: "" };

    try {
      // 修 BUG-1：历史直接取落盘后的会话，不再额外拼接一遍用户消息。
      const history = (getAIChatSessions().find((item) => item.id === session.id)?.messages || [])
        .filter((message) => message.id !== assistantMessage.id)
        .filter((message) => message.role !== "system" && message.status === "success");
      const data = await requestAI(history, refs, session.assistantKind, session.activeSkillIds || [], controller.signal, (text) => {
        if (streamRef.current?.messageId !== assistantMessage.id) return;
        streamRef.current.text = text;
        // 流式期间不 refresh()，否则会用 localStorage 里的空占位覆盖在途文本。
        setStreamTick((tick) => tick + 1);
        if (atBottomRef.current) scrollToBottom("auto");
      }, (label) => setNotice(label), (notices) => setNotice(formatRefNotices(notices)));
      if (!data.success) throw new Error(data.message || "AI 回复失败，请稍后重试。");
      const content = data.content || "";
      streamRef.current = null;
      updateAIChatMessage(session.id, assistantMessage.id, { content, status: "success", errorMessage: "" });
    } catch (error) {
      const partial = streamRef.current?.messageId === assistantMessage.id ? streamRef.current.text : "";
      streamRef.current = null;

      if (isAbortError(error)) {
        if (partial.trim()) {
          updateAIChatMessage(session.id, assistantMessage.id, { content: partial, status: "success", errorMessage: "" });
          setNotice("已停止生成，保留已生成的部分。");
        } else {
          deleteAIChatMessage(session.id, assistantMessage.id);
          setNotice("已停止生成。");
        }
      } else {
        const message = errorMessageOf(error);
        updateAIChatMessage(session.id, assistantMessage.id, { content: partial, status: "failed", errorMessage: message });
        setNotice(message);
      }
    } finally {
      abortRef.current = null;
      streamRef.current = null;
      setLoading(false);
      refresh(session.id);
    }
  }

  async function regenerate(messageId: string) {
    if (!activeSession || loading) return;
    const sessionId = activeSession.id;
    const index = activeSession.messages.findIndex((message) => message.id === messageId);
    if (index < 0) return;
    const target = activeSession.messages[index];
    if (target.role !== "assistant") return;

    setLoading(true);
    setNotice("");
    updateAIChatMessage(sessionId, messageId, { status: "sending", errorMessage: "" });
    refresh(sessionId);

    const controller = new AbortController();
    abortRef.current = controller;
    streamRef.current = { messageId, text: "" };

    try {
      const session = getAIChatSessions().find((item) => item.id === sessionId);
      const history = (session?.messages || [])
        .slice(0, index)
        .filter((message) => message.role !== "system" && message.status === "success");
      const data = await requestAI(history, session?.contextRefs || [], session?.assistantKind || "general", session?.activeSkillIds || [], controller.signal, (text) => {
        if (streamRef.current?.messageId !== messageId) return;
        streamRef.current.text = text;
        setStreamTick((tick) => tick + 1);
        if (atBottomRef.current) scrollToBottom("auto");
      }, (label) => setNotice(label), (notices) => setNotice(formatRefNotices(notices)));
      if (!data.success) throw new Error(data.message || "重新生成失败，请稍后重试。");
      streamRef.current = null;
      updateAIChatMessage(sessionId, messageId, { content: data.content || "", status: "success", errorMessage: "" });
    } catch (error) {
      // 修 BUG-2：失败时完整回滚（保留原回答 + 原状态），不再伪造 success。
      streamRef.current = null;
      if (target.content.trim()) {
        updateAIChatMessage(sessionId, messageId, { ...target });
        setNotice(isAbortError(error) ? "已停止生成，已保留原回答。" : `${errorMessageOf(error)}（已保留原回答）`);
      } else {
        updateAIChatMessage(sessionId, messageId, {
          content: "",
          status: "failed",
          errorMessage: isAbortError(error) ? "已停止生成。" : errorMessageOf(error)
        });
        setNotice(isAbortError(error) ? "已停止生成。" : errorMessageOf(error));
      }
    } finally {
      abortRef.current = null;
      streamRef.current = null;
      setLoading(false);
      refresh(sessionId);
    }
  }

  function stopGenerating() {
    abortRef.current?.abort();
  }

  const refs = activeSession?.contextRefs || [];
  const composerHint = refs.length
    ? `已引用 ${refs.length} 条资料，AI 会优先基于资料回答`
    : `Enter 发送，Shift + Enter 换行 · 最多可引用 ${maxContextRefs} 条资料`;

  return (
    <div className="flex h-[calc(100dvh-11rem)] min-h-[560px] flex-col md:h-[calc(100dvh-3.5rem)]">
      <header className="mb-3 flex shrink-0 items-center gap-3">
        <div className="min-w-0 flex-1">
          <nav className="flex items-center gap-1.5 text-[12.5px] text-ink-3">
            <span>AI 内容中台</span>
            <ChevronRight className="h-3 w-3" strokeWidth={1.8} />
            <span className="text-ink-2">AI 对话</span>
          </nav>
          <h1 className="mt-1 flex items-center gap-2 truncate text-[20px] font-medium tracking-[-0.015em] text-ink-1">
            <Bot className="h-4.5 w-4.5 shrink-0 text-brand" strokeWidth={1.8} />
            <span className="truncate">{activeSession?.title || "新对话"}</span>
          </h1>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <select
            value={activeSession?.assistantKind || "general"}
            disabled={loading || !activeSession}
            aria-label="会话角色"
            title={aiChatAssistantOptions.find((item) => item.value === (activeSession?.assistantKind || "general"))?.hint}
            onChange={(event) => {
              if (!activeSession) return;
              setAIChatAssistantKind(activeSession.id, event.target.value as AIChatAssistantKind);
              refresh(activeSession.id);
            }}
            className="h-8 max-w-[124px] rounded-lg border border-line bg-surface-2 px-2 text-[12.5px] text-ink-2 transition-colors duration-150 hover:border-line-strong hover:text-ink-1 disabled:opacity-50"
          >
            {aiChatAssistantOptions.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
          <HeaderAction label="历史对话" className="lg:hidden" onClick={() => setHistoryOpen(true)}>
            <History className="h-3.5 w-3.5" strokeWidth={1.8} />
          </HeaderAction>
          <HeaderAction label="整段对话存到资产库" disabled={!activeSession?.messages.length || loading} onClick={saveSessionToAssets}>
            <Save className="h-3.5 w-3.5" strokeWidth={1.8} />
          </HeaderAction>
          <HeaderAction label="清空当前对话" disabled={!activeSession?.messages.length || loading} onClick={clearSession}>
            <Eraser className="h-3.5 w-3.5" strokeWidth={1.8} />
          </HeaderAction>
        </div>
      </header>

      <ActiveSkillBar
        activeIds={activeSession?.activeSkillIds || []}
        usable={usableSkills}
        open={skillPickerOpen}
        onOpenChange={setSkillPickerOpen}
        disabled={loading}
        onRemove={(skillId) => updateActiveSkills((activeSession?.activeSkillIds || []).filter((item) => item !== skillId))}
        onAdd={(skillId) => {
          updateActiveSkills([...(activeSession?.activeSkillIds || []), skillId]);
          setSkillPickerOpen(false);
        }}
      />

      <div className="grid min-h-0 flex-1 gap-3 lg:grid-cols-[268px_minmax(0,1fr)]">
        {historyOpen ? (
          <div className="fixed inset-0 z-30 bg-black/40 lg:hidden" onClick={() => setHistoryOpen(false)} />
        ) : null}

        <ChatSidebar
          sessions={sessions}
          activeId={activeSession?.id || ""}
          keyword={keyword}
          onKeywordChange={setKeyword}
          onCreate={createSession}
          onSelect={(id) => {
            setActiveId(id);
            setHistoryOpen(false);
            atBottomRef.current = true;
            setAtBottom(true);
          }}
          onDelete={deleteSession}
          onRename={renameSession}
          className={cn(
            "max-lg:fixed max-lg:inset-y-0 max-lg:left-0 max-lg:z-40 max-lg:w-[286px] max-lg:rounded-none max-lg:border-y-0 max-lg:border-l-0",
            historyOpen ? "max-lg:flex" : "max-lg:hidden"
          )}
        />

        <section className="relative flex min-h-0 flex-col overflow-hidden rounded-2xl border border-line bg-canvas">
          <div ref={listRef} onScroll={handleScroll} className="min-h-0 flex-1 space-y-5 overflow-y-auto px-4 py-5 scrollbar-subtle md:px-6">
            {notice ? (
              <div className="flex items-start gap-3 rounded-xl border border-warn/25 bg-warn-soft px-3.5 py-2.5 text-[13px] text-warn">
                <span className="min-w-0 flex-1">{notice}</span>
                <button
                  type="button"
                  aria-label="关闭提示"
                  onClick={() => setNotice("")}
                  className="shrink-0 rounded-md p-0.5 transition-colors duration-150 hover:bg-warn/10"
                >
                  <X className="h-3.5 w-3.5" strokeWidth={2} />
                </button>
              </div>
            ) : null}

            {activeSession && activeSession.messages.length > 0 ? (
              activeSession.messages.map((message) => (
                <ChatMessage
                  key={message.id}
                  message={
                    streamRef.current && streamRef.current.messageId === message.id && streamRef.current.text
                      ? { ...message, content: streamRef.current.text }
                      : message
                  }
                  canRegenerate={!loading}
                  onRegenerate={regenerate}
                  onSaveAsset={saveMessageToAssets}
                />
              ))
            ) : (
              <ChatEmpty disabled={loading} onPick={(prompt) => void sendMessage(prompt)} />
            )}
          </div>

          {atBottom ? null : (
            <button
              type="button"
              onClick={() => scrollToBottom("smooth")}
              className="absolute bottom-[124px] left-1/2 z-10 inline-flex h-8 -translate-x-1/2 items-center gap-1.5 rounded-full border border-line bg-surface px-3 text-[12px] text-ink-2 shadow-[0_6px_20px_rgba(15,23,42,0.12)] transition-colors duration-150 hover:text-ink-1 anim-pop-in dark:shadow-[0_6px_20px_rgba(0,0,0,0.5)]"
            >
              <ArrowDown className="h-3.5 w-3.5" strokeWidth={1.8} />
              回到底部
            </button>
          )}

          <div className="shrink-0 border-t border-line bg-surface p-3">
            <ChatComposer
              value={input}
              loading={loading}
              refs={refs}
              hint={composerHint}
              onChange={setInput}
              onSend={() => void sendMessage()}
              onStop={stopGenerating}
              onRefsChange={updateRefs}
            />
          </div>
        </section>
      </div>
    </div>
  );
}

/**
 * Active Skill 条（§33 / §34 / §35）。
 * 已安装 ≠ 当前启用：这里只显示当前会话挂载的 1-3 个 Skill，可单个移除。
 */
function ActiveSkillBar({
  activeIds,
  usable,
  open,
  onOpenChange,
  disabled,
  onRemove,
  onAdd
}: {
  activeIds: string[];
  usable: Array<{ skillId: string; name: string; description: string }>;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  disabled?: boolean;
  onRemove: (skillId: string) => void;
  onAdd: (skillId: string) => void;
}) {
  const active = activeIds
    .map((id) => usable.find((item) => item.skillId === id) || { skillId: id, name: "已启用的 Skill", description: "" })
    .filter(Boolean);

  return (
    <div className="mb-2 flex shrink-0 flex-wrap items-center gap-1.5">
      {active.length > 0 ? <span className="text-[11.5px] text-ink-3">已启用</span> : null}

      {active.map((skill) => (
        <span
          key={skill.skillId}
          title={skill.description}
          className="inline-flex max-w-[220px] items-center gap-1.5 rounded-full border border-brand-ring bg-brand-soft py-1 pl-2.5 pr-1.5 text-[12.5px] text-ink-1"
        >
          <Sparkles className="h-3 w-3 shrink-0 text-brand" strokeWidth={1.8} />
          <span className="truncate">{skill.name}</span>
          <button
            type="button"
            aria-label={"关闭 Skill " + skill.name}
            disabled={disabled}
            onClick={() => onRemove(skill.skillId)}
            className="inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-ink-3 transition-colors duration-150 hover:bg-white/60 hover:text-danger disabled:opacity-50 dark:hover:bg-white/10"
          >
            <X className="h-3 w-3" strokeWidth={2} />
          </button>
        </span>
      ))}

      <div className="relative">
        <button
          type="button"
          disabled={disabled || active.length >= 3}
          onClick={() => onOpenChange(!open)}
          title={active.length >= 3 ? "一个会话最多同时启用 3 个 Skill" : "给当前会话启用 Skill"}
          className="inline-flex items-center gap-1 rounded-full border border-line bg-surface-2 px-2.5 py-1 text-[12.5px] text-ink-2 transition-colors duration-150 hover:border-line-strong hover:text-ink-1 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Puzzle className="h-3 w-3" strokeWidth={2} />
          启用 Skill
        </button>

        {open ? (
          <>
            <div className="fixed inset-0 z-40" onClick={() => onOpenChange(false)} />
            <div className="absolute left-0 top-[calc(100%+6px)] z-50 w-[300px] rounded-xl border border-line bg-surface p-2.5 shadow-[0_16px_40px_rgba(15,23,42,0.16)] anim-pop-in dark:shadow-[0_16px_40px_rgba(0,0,0,0.5)]">
              <div className="px-1 pb-1.5 text-[11.5px] text-ink-3">已安装且可用的 Skill</div>
              {usable.length === 0 ? (
                <p className="px-1 py-4 text-center text-[12.5px] leading-6 text-ink-3">
                  还没有可用的 Skill。
                  <br />
                  去 Skill 中心导入一个即可在这里启用。
                </p>
              ) : (
                <div className="max-h-[260px] overflow-y-auto scrollbar-subtle">
                  {usable.map((skill) => {
                    const already = activeIds.includes(skill.skillId);
                    return (
                      <button
                        key={skill.skillId}
                        type="button"
                        disabled={already}
                        onClick={() => onAdd(skill.skillId)}
                        className={cn(
                          "flex w-full items-start gap-2 rounded-lg px-2 py-1.5 text-left transition-colors duration-150",
                          already ? "opacity-45" : "hover:bg-surface-2"
                        )}
                      >
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[13px] text-ink-1">{skill.name}</span>
                          <span className="mt-0.5 block line-clamp-2 text-[11.5px] leading-5 text-ink-3">{skill.description}</span>
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
}

function HeaderAction({
  label,
  onClick,
  disabled,
  className,
  children
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "inline-flex h-8 items-center gap-1.5 rounded-lg px-2 text-[12.5px] text-ink-3",
        "transition-colors duration-150 hover:bg-surface-2 hover:text-ink-1 disabled:pointer-events-none disabled:opacity-45",
        className
      )}
    >
      {children}
      <span className="hidden xl:inline">{label}</span>
    </button>
  );
}

function mergeRefs(existing: AIChatContextRef[], incoming: AIChatContextRef[]) {
  if (!incoming.length) return existing;
  const seen = new Set(existing.map((item) => `${item.source}:${item.refId}`));
  const merged = [...existing];
  incoming.forEach((item) => {
    const key = `${item.source}:${item.refId}`;
    if (seen.has(key) || merged.length >= maxContextRefs) return;
    seen.add(key);
    merged.push(item);
  });
  return merged;
}

function productNameFromRefs(refs: AIChatContextRef[]) {
  const product = refs.find((ref) => ref.source === "product");
  if (!product) return "";
  return resolveContextRef(product).label || "";
}

function buildMessageRawData(kind: SaveAssetKind, content: string, title: string, session: AIChatSession) {
  const productName = productNameFromRefs(session.contextRefs);
  if (kind === "script") {
    return { scriptText: content, title, productName, source: "ai_chat", sessionId: session.id };
  }
  if (kind === "deconstruction") {
    return { rewrittenScript: content, rewrittenTitle: title, title, productName, source: "ai_chat", sessionId: session.id };
  }
  if (kind === "review") {
    return { aiConclusion: content, conclusion: title, title, source: "ai_chat", sessionId: session.id };
  }
  return { sessionId: session.id, sessionTitle: session.title, source: "ai_chat" };
}

function makeMessage(role: "user" | "assistant", content: string, status: "sending" | "success" | "failed"): AIChatMessage {
  return {
    id: createAIChatId("msg"),
    role,
    content,
    createdAt: getAIChatNow(),
    status
  };
}

function makeTitle(content: string) {
  const cleaned = content
    .replace(/[#*`>\-]/g, " ")
    .replace(/[，。！？、,.!?\n\r]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned.slice(0, 18) || "新对话";
}

function isAbortError(error: unknown) {
  return error instanceof DOMException && error.name === "AbortError";
}

function errorMessageOf(error: unknown) {
  return error instanceof Error ? error.message : "AI 回复失败，请稍后重试。";
}

/** 引用资料超出处理范围时的提示载荷（sentChars=-1 表示发送前预估，数字以服务端返回为准）。 */
type RefNotice = { label: string; kind: string; totalChars: number; sentChars: number };

/** 与服务端 /api/ai-chat 的预算保持一致（改动时两处同步）。 */
const REF_LIMIT_PER_ITEM = 4000;
const REF_LIMIT_TRANSCRIPT = 12000;
const REF_LIMIT_TOTAL = 36000;

function formatRefNotices(notices: RefNotice[]) {
  const detail = notices
    .map((notice) => notice.sentChars >= 0
      ? `《${notice.label}》发送了前 ${notice.sentChars} 字（全文 ${notice.totalChars} 字）`
      : `《${notice.label}》（全文约 ${notice.totalChars} 字）`)
    .join("；");
  return `引用资料超出本次处理范围，只发送了部分内容：${detail}。可减少引用条数后重试，原始资料不受影响。`;
}

async function requestAI(
  messages: AIChatMessage[],
  refs: AIChatContextRef[],
  assistantKind: AIChatAssistantKind,
  skillIds: string[],
  signal: AbortSignal,
  onDelta: (text: string) => void,
  onTool?: (label: string) => void,
  onRefNotices?: (notices: RefNotice[]) => void
): Promise<{ success: boolean; content?: string; message?: string }> {
  const payload = refs
    .map((ref) => {
      const resolved = resolveContextRef(ref);
      return { source: ref.source, label: resolved.label || ref.label, content: resolved.content };
    })
    .filter((item) => item.content.trim());

  // 发送前估算：资料明显超出本次处理范围时，先提示用户（可以缩小引用范围，也可以继续）
  const overLimit = payload.filter((item) => item.content.length > REF_LIMIT_PER_ITEM || item.source === "transcript" && item.content.length > REF_LIMIT_TRANSCRIPT);
  const totalChars = payload.reduce((sum, item) => sum + item.content.length, 0);
  if (overLimit.length > 0 || totalChars > REF_LIMIT_TOTAL) {
    onRefNotices?.(payload.map((item) => ({
      label: item.label,
      kind: item.source,
      totalChars: item.content.length,
      sentChars: -1 // -1 表示“发送前预估”，具体数字以服务端返回为准
    })));
  }

  const response = await fetch("/api/ai-chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    signal,
    body: JSON.stringify({
      messages: messages.map((message) => ({ role: message.role, content: message.content })),
      context: { refs: payload },
      assistantKind,
      skillIds,
      stream: true
    })
  });

  const contentType = response.headers.get("content-type") || "";

  // 兜底：服务端或中间层没有给流，就退回一次性 JSON，功能不受影响。
  if (!response.ok || !response.body || !contentType.includes("text/event-stream")) {
    const data = await response.json().catch(() => null);
    if (data?.success && typeof data.content === "string") {
      onDelta(data.content);
      if (Array.isArray(data.refNotices) && data.refNotices.length > 0) {
        onRefNotices?.(data.refNotices as RefNotice[]);
      }
      return { success: true, content: data.content };
    }
    return { success: false, message: withHint(data?.message, data?.hint) };
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let text = "";
  let failure = "";
  let failureHint = "";
  let notices: RefNotice[] = [];

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    const frames = buffer.split("\n\n");
    buffer = frames.pop() || "";
    for (const frame of frames) {
      const line = frame.trim();
      if (!line.startsWith("data:")) continue;
      const raw = line.slice(5).trim();
      if (!raw) continue;
      try {
        const payloadFrame = JSON.parse(raw) as {
          delta?: string;
          error?: string;
          code?: string;
          hint?: string;
          done?: boolean;
          refNotices?: RefNotice[];
          tool?: { name?: string; skillId?: string; label?: string };
        };
        if (payloadFrame.error) {
          failure = payloadFrame.error;
          failureHint = payloadFrame.hint || "";
        }
        if (payloadFrame.refNotices?.length) {
          notices = payloadFrame.refNotices;
        }
        if (payloadFrame.tool) onTool?.(payloadFrame.tool.label || "正在执行 Skill…");
        if (payloadFrame.delta) {
          text += payloadFrame.delta;
          onDelta(text);
        }
      } catch {
        // 忽略无法解析的帧，不打断整段回复。
      }
    }
  }

  if (!text.trim()) {
    return { success: false, message: withHint(failure, failureHint) || "模型没有返回有效内容。" };
  }
  if (notices.length > 0) onRefNotices?.(notices);
  return { success: true, content: text };
}

/** 把「发生了什么」和「该怎么办」拼成一条用户看得懂的提示。 */
function withHint(message?: string, hint?: string) {
  const main = (message || "").trim();
  const extra = (hint || "").trim();
  if (!main) return extra;
  if (!extra || main.includes(extra)) return main;
  return `${main}（${extra}）`;
}
