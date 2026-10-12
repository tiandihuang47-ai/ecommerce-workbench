"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Copy,
  Download,
  HelpCircle,
  Loader2,
  PauseCircle,
  RotateCcw,
  StopCircle,
  Trash2,
  X,
  XCircle,
  Clock3
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { storageGet, storageSet } from "@/lib/web-storage";
import { getScriptTranscriptRecords, saveScriptTranscriptRecord } from "@/lib/pipeline-storage";

/**
 * 批量扒稿弹窗（服务端编排版）。
 *
 * 任务队列在服务器上运行并持久化：粘贴约 20 条（上限 30 条）、复制、TXT 导出能力不变；
 * 刷新页面 / 关闭弹窗 / 切页都不会让任务丢失，重开弹窗自动接上服务器上的最新进度。
 */

const STORAGE_KEY = "director-platform.batch-transcript.last";
const MAX_ITEMS = 30;
const POLL_INTERVAL_MS = 2000;

type ServerItemStatus = "pending" | "processing" | "completed" | "failed" | "unknown" | "stopped";

interface ServerBatchItem {
  id: string;
  input: string;
  link: string;
  status: ServerItemStatus;
  title: string;
  authorName: string;
  transcript: string;
  awemeId: string;
  error: string;
  errorStage: string;
  retryable: boolean;
  dedupOf?: string;
  attempts: number;
}

interface ServerBatch {
  batchId: string;
  requestId: string;
  status: "running" | "completed" | "stopped" | "paused";
  pausedReason: string;
  inputText: string;
  items: ServerBatchItem[];
}

interface PersistedPointer {
  inputText: string;
  batchId: string;
  savedAt: string;
}

/** 从整段粘贴文本里提取全部抖音链接（短链 + 完整链），去重。 */
function parseDouyinUrls(text: string): string[] {
  const pattern = /https?:\/\/[^\s，。；;）)\]}]+|(?:www\.)?(?:v\.)?(?:douyin\.com|iesdouyin\.com)\/[^\s，。；;）)\]}]+/gi;
  const matches = String(text || "").match(pattern) || [];
  const seen = new Set<string>();
  const urls: string[] = [];

  for (const match of matches) {
    const cleaned = match.replace(/[，。；;、,.!?！？）)\]}]+$/g, "").trim();
    if (!cleaned) continue;
    const normalized = /^https?:\/\//i.test(cleaned) ? cleaned : `https://${cleaned}`;
    try {
      const parsed = new URL(normalized);
      if (!/^(?:[\w-]+\.)*douyin\.com$|^(?:[\w-]+\.)*iesdouyin\.com$/i.test(parsed.hostname)) continue;
    } catch {
      continue;
    }
    if (!seen.has(normalized)) {
      seen.add(normalized);
      urls.push(normalized);
    }
  }
  return urls;
}

async function requestIdForLinks(links: string[]): Promise<string> {
  const content = links.join("\n");
  try {
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(content));
    return `req_${Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 32)}`;
  } catch {
    return `req_${content.length}_${content.slice(0, 40).replace(/\W/g, "_")}`;
  }
}

function statusLabel(item: ServerBatchItem) {
  switch (item.status) {
    case "pending": return "等待";
    case "processing": return "处理中";
    case "completed": return "完成";
    case "failed": return "失败";
    case "unknown": return "结果未知";
    case "stopped": return "已停止";
    default: return item.status;
  }
}

function formatItemText(item: ServerBatchItem) {
  const heading = `=== ${item.title || "未命名视频"} | ${item.authorName || "未知作者"} | ${item.link || item.input} ===`;
  return `${heading}\n${item.transcript}`;
}

function isTerminalBatch(batch: ServerBatch | null) {
  if (!batch) return true;
  if (batch.status !== "running") return true;
  return batch.items.every((item) => item.status !== "pending" && item.status !== "processing");
}

function loadPointer(): PersistedPointer | null {
  try {
    const raw = storageGet(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PersistedPointer;
    if (!parsed || typeof parsed.batchId !== "string") return null;
    return parsed;
  } catch {
    return null;
  }
}

/**
 * 把已扒好的结果补进「逐字稿库」，AI 对话可直接引用。
 * 已在库里的（按 awemeId / 链接判断）跳过，重复触发不会产生重复条目。
 */
function backfillTranscriptLibrary(items: ServerBatchItem[], savedKeys: Set<string>) {
  const doneItems = items.filter((item) => item.status === "completed" && item.transcript.trim());
  if (doneItems.length === 0) return;
  const records = getScriptTranscriptRecords();
  const knownIds = new Set(records.map((record) => record.id));
  const knownLinks = new Set(records.map((record) => record.link));
  for (const item of doneItems) {
    const dedupKey = item.awemeId ? `aweme:${item.awemeId}` : `link:${item.link || item.input}`;
    if (savedKeys.has(dedupKey)) continue;
    const known = (item.awemeId ? knownIds.has(`transcript_${item.awemeId}`) : false) || knownLinks.has(item.link || item.input);
    savedKeys.add(dedupKey);
    if (known) continue;
    saveScriptTranscriptRecord({
      awemeId: item.awemeId,
      link: item.link || item.input,
      title: item.title,
      authorName: item.authorName,
      transcript: item.transcript
    });
  }
}

export function BatchTranscriptDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const [inputText, setInputText] = useState("");
  const [batch, setBatch] = useState<ServerBatch | null>(null);
  const [isBusy, setIsBusy] = useState(false);
  const [hint, setHint] = useState("");
  const [expandedId, setExpandedId] = useState("");
  const [copiedId, setCopiedId] = useState("");

  const hydratedRef = useRef(false);
  const batchIdRef = useRef("");
  const savedLibraryKeysRef = useRef<Set<string>>(new Set());
  const pollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const applyBatch = useCallback((next: ServerBatch | null) => {
    if (!next) return;
    setBatch(next);
    batchIdRef.current = next.batchId;
    backfillTranscriptLibrary(next.items, savedLibraryKeysRef.current);
  }, []);

  const fetchBatch = useCallback(async (id: string): Promise<ServerBatch | null> => {
    try {
      const res = await fetch(`/api/transcript-batch/${encodeURIComponent(id)}`, { cache: "no-store" });
      if (!res.ok) return null;
      const data = await res.json().catch(() => null);
      return data?.batch ?? null;
    } catch {
      return null;
    }
  }, []);

  // 打开弹窗：恢复输入 + 接上服务器上最近的批次（刷新/重开不丢任务）。
  useEffect(() => {
    if (!open || hydratedRef.current) return;
    hydratedRef.current = true;
    const pointer = loadPointer();
    if (pointer) {
      setInputText(pointer.inputText || "");
      if (pointer.batchId) {
        void fetchBatch(pointer.batchId).then((restored) => {
          if (restored) applyBatch(restored);
          else if (pointer.inputText) setInputText(pointer.inputText);
        });
      }
    }
  }, [open, applyBatch, fetchBatch]);

  // 轮询服务器上的批次进度：跑批期间（含弹窗关闭后服务端仍在跑）持续同步。
  useEffect(() => {
    if (!open) return;
    let cancelled = false;

    const tick = async () => {
      const id = batchIdRef.current;
      if (id) {
        const next = await fetchBatch(id);
        if (!cancelled && next) applyBatch(next);
      }
      if (!cancelled) {
        pollTimerRef.current = setTimeout(tick, POLL_INTERVAL_MS);
      }
    };
    pollTimerRef.current = setTimeout(tick, POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      if (pollTimerRef.current) clearTimeout(pollTimerRef.current);
    };
  }, [open, applyBatch, fetchBatch]);

  // 输入与最近批次指针持久化（桌面走 localStorage；网页按账号同步到服务器）。
  useEffect(() => {
    if (!hydratedRef.current) return;
    try {
      const payload: PersistedPointer = {
        inputText,
        batchId: batchIdRef.current,
        savedAt: new Date().toISOString()
      };
      storageSet(STORAGE_KEY, JSON.stringify(payload));
    } catch {
      // 存储失败不影响功能主流程。
    }
  }, [inputText, batch?.batchId, batch?.items.length]);

  const requestClose = useCallback(() => {
    // 服务端任务继续运行：关闭只是不看了，进度不会丢。
    onOpenChange(false);
  }, [onOpenChange]);

  useEffect(() => {
    if (!open) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") requestClose();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, requestClose]);

  async function startBatch() {
    const urls = parseDouyinUrls(inputText);
    if (urls.length === 0) {
      setHint("没有识别到抖音链接，请粘贴分享文案或链接（每行一个）。");
      return;
    }
    if (urls.length > MAX_ITEMS) {
      setHint(`一次最多 ${MAX_ITEMS} 条，本次识别到 ${urls.length} 条。请删掉一部分再开始，或分两批处理。`);
      return;
    }
    setHint("");
    setIsBusy(true);
    try {
      const requestId = await requestIdForLinks(urls);
      const res = await fetch("/api/transcript-batch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requestId, links: urls, rawInput: inputText })
      });
      const data = await res.json().catch(() => null);
      if (res.ok && data?.success && data.batch) {
        applyBatch(data.batch as ServerBatch);
        savedLibraryKeysRef.current = new Set();
        if (data.existing) setHint("这批链接已经在处理/处理过了，直接展示该批次。");
        else if (data.duplicatesRemoved > 0) setHint(`已自动去掉 ${data.duplicatesRemoved} 条完全重复的链接。`);
        else setHint("");
      } else {
        setHint(String(data?.message || `创建任务失败（${res.status}），请重试`));
      }
    } catch {
      setHint("网络错误，请重试");
    } finally {
      setIsBusy(false);
    }
  }

  async function batchAction(action: "stop" | "resume" | "retry-item", itemId?: string) {
    const id = batchIdRef.current;
    if (!id) return;
    setIsBusy(true);
    try {
      const res = await fetch(`/api/transcript-batch/${encodeURIComponent(id)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(itemId ? { action: "retry-item", itemId } : { action })
      });
      const data = await res.json().catch(() => null);
      if (res.ok && data?.batch) applyBatch(data.batch as ServerBatch);
      else setHint(String(data?.message || "操作失败，请重试"));
    } catch {
      setHint("网络错误，请重试");
    } finally {
      setIsBusy(false);
    }
  }

  function clearResults() {
    if (!batch) return;
    if (!window.confirm("清空当前页面的结果展示？服务器上的批次记录仍会保留，任务不会因此中断。")) return;
    setBatch(null);
    batchIdRef.current = "";
    setExpandedId("");
    setHint("");
  }

  function toggleExpanded(id: string) {
    setExpandedId((current) => (current === id ? "" : id));
  }

  async function copyText(text: string, itemId: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedId(itemId);
      window.setTimeout(() => setCopiedId((current) => (current === itemId ? "" : current)), 1500);
    } catch {
      setHint("复制失败，请手动选择文本复制。");
    }
  }

  function exportTxt() {
    const doneItems = (batch?.items || []).filter((item) => item.status === "completed");
    if (doneItems.length === 0) return;
    const content = doneItems.map(formatItemText).join("\n\n");
    const now = new Date();
    const pad = (value: number) => String(value).padStart(2, "0");
    const filename = `抖音逐字稿_${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}.txt`;
    const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = filename;
    link.click();
    URL.revokeObjectURL(link.href);
  }

  if (!open) return null;

  const items = batch?.items || [];
  const total = items.length;
  const doneCount = items.filter((item) => item.status === "completed").length;
  const failedCount = items.filter((item) => item.status === "failed").length;
  const pendingCount = items.filter((item) => item.status === "pending").length;
  const processingCount = items.filter((item) => item.status === "processing").length;
  const stoppedCount = items.filter((item) => item.status === "stopped").length;
  const unknownCount = items.filter((item) => item.status === "unknown").length;
  const progress = total === 0 ? 0 : Math.round(((total - pendingCount - processingCount) / total) * 100);
  const hasDone = doneCount > 0;
  const running = Boolean(batch && (batch.status === "running" || processingCount > 0));
  const resumable = Boolean(batch && (batch.status === "stopped" || batch.status === "paused") && (pendingCount + stoppedCount > 0));

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div
        className="absolute inset-0 bg-black/50"
        onClick={requestClose}
        aria-hidden="true"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="批量扒稿"
        className="relative flex max-h-[85vh] w-full max-w-3xl flex-col overflow-hidden rounded-xl border border-border bg-card shadow-xl"
      >
        <div className="flex shrink-0 items-start justify-between border-b border-border px-5 py-4">
          <div>
            <h2 className="text-base font-semibold text-foreground">批量扒稿</h2>
            <p className="mt-0.5 text-xs text-muted-foreground">
              粘贴一批抖音链接（每行一个，或整段分享文案），服务端逐条转写。任务在后台进行，关闭弹窗、刷新页面都不会丢。
            </p>
          </div>
          <button
            type="button"
            onClick={requestClose}
            title="关闭"
            className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          <Textarea
            value={inputText}
            onChange={(event) => setInputText(event.target.value)}
            disabled={running}
            rows={5}
            placeholder={"粘贴抖音分享文案或链接，例如：\n8.94 复制打开抖音… https://v.douyin.com/xxxxxxx/\nhttps://v.douyin.com/yyyyyyy/"}
            className="min-h-[110px] resize-y text-sm"
          />
          <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
            <span className="text-xs text-muted-foreground">
              {inputText.trim()
                ? `识别到 ${parseDouyinUrls(inputText).length} 条抖音链接（去重后，上限 ${MAX_ITEMS} 条）`
                : "支持混贴分享文案，自动提取链接并去重"}
            </span>
            <div className="flex items-center gap-2">
              {batch && !running ? (
                <Button variant="ghost" size="sm" onClick={clearResults}>
                  <Trash2 className="h-3.5 w-3.5" />
                  清空展示
                </Button>
              ) : null}
              {running ? (
                <Button variant="secondary" size="sm" disabled={isBusy} onClick={() => void batchAction("stop")}>
                  <StopCircle className="h-3.5 w-3.5" />
                  停止派发
                </Button>
              ) : resumable ? (
                <Button size="sm" disabled={isBusy} onClick={() => void batchAction("resume")}>
                  继续处理（待处理 {pendingCount + stoppedCount} 条）
                </Button>
              ) : (
                <Button size="sm" disabled={!inputText.trim() || isBusy} onClick={() => void startBatch()}>
                  {isBusy ? "提交中…" : "开始扒稿"}
                </Button>
              )}
            </div>
          </div>

          {hint ? (
            <p className="mt-2 rounded-lg border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
              {hint}
            </p>
          ) : null}

          {batch?.pausedReason ? (
            <p className="mt-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-100">
              {batch.pausedReason}
            </p>
          ) : null}

          {total > 0 ? (
            <div className="mt-4">
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span>
                  共 {total} 条 · 完成 {doneCount} · 失败 {failedCount}
                  {processingCount > 0 ? ` · 处理中 ${processingCount}` : ""}
                  {pendingCount > 0 ? ` · 等待 ${pendingCount}` : ""}
                  {stoppedCount > 0 ? ` · 已停止 ${stoppedCount}` : ""}
                  {unknownCount > 0 ? ` · 结果未知 ${unknownCount}` : ""}
                </span>
                {hasDone ? (
                  <div className="flex items-center gap-2">
                    <Button variant="outline" size="sm" onClick={() => void copyText(items.filter((item) => item.status === "completed").map(formatItemText).join("\n\n"), "__all__")}>
                      <Copy className="h-3.5 w-3.5" />
                      {copiedId === "__all__" ? "已复制" : "全部复制"}
                    </Button>
                    <Button variant="outline" size="sm" onClick={exportTxt}>
                      <Download className="h-3.5 w-3.5" />
                      导出 txt
                    </Button>
                  </div>
                ) : null}
              </div>
              <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full rounded-full bg-brand transition-all duration-300"
                  style={{ width: `${progress}%` }}
                />
              </div>

              <ul className="mt-3 space-y-2">
                {items.map((item, index) => {
                  const expanded = expandedId === item.id;
                  const showText = item.status === "completed";
                  return (
                    <li key={item.id} className="rounded-lg border border-border bg-background/40 px-3 py-2.5">
                      <div className="flex items-start gap-2.5">
                        <span className="mt-0.5 shrink-0">
                          {item.status === "completed" ? (
                            <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                          ) : item.status === "failed" ? (
                            <XCircle className="h-4 w-4 text-destructive" />
                          ) : item.status === "processing" ? (
                            <Loader2 className="h-4 w-4 animate-spin text-accent" />
                          ) : item.status === "unknown" ? (
                            <HelpCircle className="h-4 w-4 text-amber-500" />
                          ) : item.status === "stopped" ? (
                            <PauseCircle className="h-4 w-4 text-muted-foreground/70" />
                          ) : (
                            <Clock3 className="h-4 w-4 text-muted-foreground/60" />
                          )}
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                            <span className="text-xs text-muted-foreground/70">{index + 1}.</span>
                            <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground" title={item.title || item.link || item.input}>
                              {item.title || item.link || item.input}
                            </span>
                            {item.authorName ? (
                              <span className="shrink-0 text-xs text-muted-foreground">{item.authorName}</span>
                            ) : null}
                            <span className="shrink-0 text-xs text-muted-foreground/70">{statusLabel(item)}</span>
                            {showText ? (
                              <span className="shrink-0 text-xs text-muted-foreground/70">
                                {item.transcript.replace(/\s/g, "").length} 字
                              </span>
                            ) : null}
                            {item.dedupOf ? (
                              <span className="shrink-0 text-xs text-muted-foreground/50">同批同视频，未重复转写</span>
                            ) : null}
                          </div>
                          {(item.status === "failed" || item.status === "unknown" || item.status === "stopped") && item.error ? (
                            <div className="mt-1 flex flex-wrap items-center gap-2">
                              <span className={item.status === "failed" ? "text-xs text-destructive" : "text-xs text-muted-foreground"}>
                                {item.error}
                              </span>
                              {item.status !== "stopped" ? (
                                <Button variant="ghost" size="sm" className="h-6 px-2" disabled={isBusy} onClick={() => void batchAction("retry-item", item.id)}>
                                  <RotateCcw className="h-3 w-3" />
                                  {item.status === "unknown" ? "确认重新执行" : "重试本条"}
                                </Button>
                              ) : null}
                            </div>
                          ) : null}
                          {showText ? (
                            <>
                              {expanded ? (
                                <div className="mt-2 max-h-56 overflow-y-auto whitespace-pre-wrap rounded-md bg-muted/50 px-3 py-2 text-xs leading-5 text-foreground/90">
                                  {item.transcript || "（空）"}
                                </div>
                              ) : null}
                              <div className="mt-1.5 flex items-center gap-1">
                                <button
                                  type="button"
                                  onClick={() => toggleExpanded(item.id)}
                                  className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                                >
                                  {expanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                                  {expanded ? "收起" : "查看"}
                                </button>
                                <button
                                  type="button"
                                  onClick={() => void copyText(formatItemText(item), item.id)}
                                  className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                                >
                                  <Copy className="h-3 w-3" />
                                  {copiedId === item.id ? "已复制" : "复制本条"}
                                </button>
                              </div>
                            </>
                          ) : null}
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
