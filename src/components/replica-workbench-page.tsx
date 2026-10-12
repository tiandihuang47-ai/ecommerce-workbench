"use client";

import { useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  Check,
  ChevronLeft,
  Clock3,
  Copy,
  FileText,
  Film,
  History,
  ImagePlus,
  Link2,
  Loader2,
  MessageCircle,
  Paperclip,
  RefreshCw,
  RotateCcw,
  Send,
  Sparkles,
  Square,
  Trash2,
  Upload,
  X
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { LinkDeconstructionPage } from "@/components/link-deconstruction-page";
import { createAsset, updateAsset } from "@/lib/stores/asset-store";
import { createId } from "@/lib/shared/id";
import { nowIso } from "@/lib/shared/time";
import {
  appendReplicaVersion,
  getLatestReplicaTask,
  getReplicaDraft,
  getReplicaTaskById,
  getReplicaTasks,
  saveReplicaDraft,
  saveReplicaTask
} from "@/lib/replica-store";
import type { ReplicaTask, ReplicaTaskMessage, ReplicaVersion } from "@/lib/replica-types";
import { cn } from "@/lib/utils";

type AssetStatus = "idle" | "working" | "ready" | "error";
type UploadStatus = "idle" | "uploading" | "uploaded" | "error";
type ViewMode = "input" | "result";

interface ReplicaDraft {
  video?: ReplicaTask["video"];
  products?: ReplicaTask["products"];
  productCacheKey?: string;
  videoCacheKey?: string;
  messages?: ReplicaTaskMessage[];
  referenceCopy?: string;
  documentName?: string;
  prompt?: string;
  taskId?: string;
}

const activeStatuses: ReplicaTask["status"][] = ["analyzing_video", "analyzing_product", "compiling_prompt"];

const quickSuggestions = ["保留人物动作", "保留镜头节奏", "只替换产品", "文案改写", "更像原片"];

export function ReplicaWorkbenchPage() {
  const searchParams = useSearchParams();
  const legacyRecord = searchParams.get("record") || searchParams.get("reuseAsset");
  if (legacyRecord) return <LinkDeconstructionPage />;
  return <ReplicaWorkbench />;
}

function ReplicaWorkbench() {
  const searchParams = useSearchParams();
  const videoInputRef = useRef<HTMLInputElement | null>(null);
  const productInputRef = useRef<HTMLInputElement | null>(null);
  const documentInputRef = useRef<HTMLInputElement | null>(null);
  const chatScrollRef = useRef<HTMLDivElement | null>(null);
  const materialPanelRef = useRef<HTMLElement | null>(null);
  const chatPanelRef = useRef<HTMLElement | null>(null);
  const chatAbortRef = useRef<AbortController | null>(null);
  const chatFollowRef = useRef(true);
  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [videoPreview, setVideoPreview] = useState("");
  const [videoThumbnail, setVideoThumbnail] = useState("");
  const [videoMeta, setVideoMeta] = useState<ReplicaTask["video"]>({ name: "", size: 0, duration: 0, cacheKey: "" });
  const [videoStatus, setVideoStatus] = useState<AssetStatus>("idle");
  const [videoUploadStatus, setVideoUploadStatus] = useState<UploadStatus>("idle");
  const [videoError, setVideoError] = useState("");
  const [videoSourceMode, setVideoSourceMode] = useState<"local" | "douyin">("local");
  const [douyinInput, setDouyinInput] = useState("");
  const [douyinImportBusy, setDouyinImportBusy] = useState(false);
  const [douyinImportError, setDouyinImportError] = useState("");
  const [productFiles, setProductFiles] = useState<File[]>([]);
  const [productPreviews, setProductPreviews] = useState<string[]>([]);
  const [productStatus, setProductStatus] = useState<AssetStatus>("idle");
  const [productError, setProductError] = useState("");
  const [productCacheKey, setProductCacheKey] = useState("");
  const [documentFile, setDocumentFile] = useState<File | null>(null);
  const [documentName, setDocumentName] = useState("");
  const [referenceCopy, setReferenceCopy] = useState("");
  const [messages, setMessages] = useState<ReplicaTaskMessage[]>(() => [
    { id: "replica_greeting", role: "assistant", content: "先上传爆款视频和你的产品图。我会按最高还原锁定原片，只替换产品和必要文案。", createdAt: nowIso() }
  ]);
  const [chatInput, setChatInput] = useState("");
  const [chatBusy, setChatBusy] = useState(false);
  const [videoPreviewOpen, setVideoPreviewOpen] = useState(false);
  const [generateBusy, setGenerateBusy] = useState(false);
  const [refineBusy, setRefineBusy] = useState(false);
  const [refineInput, setRefineInput] = useState("");
  const [message, setMessage] = useState("");
  const [viewMode, setViewMode] = useState<ViewMode>("input");
  const [prompt, setPrompt] = useState("");
  const [currentTask, setCurrentTask] = useState<ReplicaTask | null>(null);
  const [history, setHistory] = useState<ReplicaTask[]>([]);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const [copied, setCopied] = useState(false);
  const [dialogueConfirmOpen, setDialogueConfirmOpen] = useState(false);
  const [dialogueMode, setDialogueMode] = useState<"source" | "custom">("source");
  const [dialogueInstruction, setDialogueInstruction] = useState("");

  function assetUrl(taskId: string, assetId?: string) {
    return assetId ? `/api/replica/tasks/asset?taskId=${encodeURIComponent(taskId)}&assetId=${encodeURIComponent(assetId)}` : "";
  }

  function applyTask(task: ReplicaTask) {
    setCurrentTask(task);
    setPrompt(task.prompt);
    if (task.messages.length) setMessages(task.messages);
    setReferenceCopy(task.referenceCopy);
    setVideoFile(null);
    setVideoMeta(task.video);
    setVideoPreview(assetUrl(task.id, task.video.assetId));
    setVideoThumbnail(assetUrl(task.id, task.video.thumbnailAssetId));
    setVideoStatus(activeStatuses.includes(task.status) ? "working" : task.video.cacheKey ? "ready" : "error");
    setVideoUploadStatus(task.video.cacheKey || activeStatuses.includes(task.status) ? "uploaded" : "error");
    setVideoError(task.status === "failed" ? "分析失败，请重试。" : "");
    setProductFiles([]);
    setProductCacheKey(task.productCacheKey);
    setProductPreviews(task.products.map((item) => assetUrl(task.id, item.assetId)));
    setProductStatus(task.status === "analyzing_product" ? "working" : task.productCacheKey ? "ready" : task.status === "failed" ? "error" : "idle");
    setProductError(task.status === "failed" ? task.error || "分析失败，请重试。" : "");
    setDocumentFile(null);
    setDocumentName(task.documentName || "");
    setViewMode(task.prompt ? "result" : "input");
  }

  useEffect(() => {
    const taskId = searchParams.get("task");
    const task = taskId ? getReplicaTaskById(taskId) : null;
    const draft = getReplicaDraft<ReplicaDraft>();
    const restored = task || (draft?.taskId ? getReplicaTaskById(draft.taskId) : null);
    if (restored) {
      applyTask(restored);
    } else if (draft) {
      if (draft.video) setVideoMeta(draft.video);
      if (draft.products) setProductFiles([]);
      if (draft.productCacheKey) setProductCacheKey(draft.productCacheKey);
      if (draft.videoCacheKey) setVideoMeta((current) => ({ ...current, cacheKey: draft.videoCacheKey || "" }));
      if (draft.videoCacheKey) setVideoStatus("ready");
      if (draft.productCacheKey) setProductStatus("ready");
      if (draft.messages?.length) setMessages(draft.messages);
      if (draft.referenceCopy) setReferenceCopy(draft.referenceCopy);
      if (draft.prompt) {
        setPrompt(draft.prompt);
        setViewMode("result");
      }
    }
    setHistory(getReplicaTasks());
    setHydrated(true);
    const serverTaskId = taskId || draft?.taskId;
    if (serverTaskId) {
      void (async () => {
        try {
          const response = await fetch(`/api/replica/tasks?taskId=${encodeURIComponent(serverTaskId)}`, { cache: "no-store" });
          const payload = await response.json();
          if (payload.success && payload.task) {
            const saved = saveReplicaTask(payload.task);
            applyTask(saved);
            setHistory(getReplicaTasks());
          }
        } catch { /* 本地草稿仍可显示 */ }
      })();
    } else {
      void (async () => {
        try {
          const response = await fetch("/api/replica/tasks", { cache: "no-store" });
          const payload = await response.json();
          const tasks = Array.isArray(payload.tasks) ? payload.tasks as ReplicaTask[] : [];
          const active = tasks.find((item) => activeStatuses.includes(item.status) || item.status === "failed");
          if (active) {
            const saved = saveReplicaTask(active);
            applyTask(saved);
            setHistory(getReplicaTasks());
          }
        } catch { /* 没有未完成任务时保持空白 */ }
      })();
    }
    // The initial greeting is intentionally stable; this effect only restores a draft once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  useEffect(() => {
    if (!hydrated) return;
    saveReplicaDraft({
      video: videoMeta,
      products: productFiles.map((file) => ({ name: file.name, size: file.size, type: file.type })),
      videoCacheKey: videoMeta.cacheKey,
      productCacheKey,
      messages,
      referenceCopy,
      documentName: documentFile?.name || documentName,
      prompt,
      taskId: currentTask?.id
    } satisfies ReplicaDraft);
  }, [currentTask?.id, documentFile?.name, hydrated, messages, productCacheKey, productFiles, prompt, referenceCopy, videoMeta]);

  useEffect(() => {
    const container = chatScrollRef.current;
    if (!container || !chatFollowRef.current) return;
    container.scrollTop = container.scrollHeight;
  }, [messages, chatBusy]);

  useEffect(() => {
    function checkLayout() {
      const left = materialPanelRef.current?.getBoundingClientRect();
      const right = chatPanelRef.current?.getBoundingClientRect();
      if (!left || !right) return;
      const topDiff = Math.abs(left.top - right.top);
      const bottomDiff = Math.abs(left.bottom - right.bottom);
      const heightDiff = Math.abs(left.height - right.height);
      console.info(`[WORKBENCH_LAYOUT_CHECK] leftTop=${left.top.toFixed(1)} rightTop=${right.top.toFixed(1)} topDiff=${topDiff.toFixed(1)} leftBottom=${left.bottom.toFixed(1)} rightBottom=${right.bottom.toFixed(1)} bottomDiff=${bottomDiff.toFixed(1)} leftHeight=${left.height.toFixed(1)} rightHeight=${right.height.toFixed(1)} heightDiff=${heightDiff.toFixed(1)}`);
    }
    checkLayout();
    const observer = new ResizeObserver(checkLayout);
    if (materialPanelRef.current) observer.observe(materialPanelRef.current);
    if (chatPanelRef.current) observer.observe(chatPanelRef.current);
    window.addEventListener("resize", checkLayout);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", checkLayout);
    };
  }, [messages.length]);

  useEffect(() => {
    if (!videoFile) return;
    const url = URL.createObjectURL(videoFile);
    setVideoPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [videoFile]);

  useEffect(() => {
    if (!productFiles.length) return;
    const urls = productFiles.map((file) => URL.createObjectURL(file));
    setProductPreviews(urls);
    return () => urls.forEach((url) => URL.revokeObjectURL(url));
  }, [productFiles]);

  useEffect(() => {
    const taskId = currentTask?.id;
    const active = currentTask && activeStatuses.includes(currentTask.status);
    if (!taskId || !active) return;
    let cancelled = false;
    const timer = window.setTimeout(() => {
      void (async () => {
        try {
          const response = await fetch(`/api/replica/tasks?taskId=${encodeURIComponent(taskId)}`, { cache: "no-store" });
          const payload = await response.json();
          const task = payload.task as ReplicaTask | undefined;
          if (!cancelled && payload.success && task) {
            const saved = saveReplicaTask(task);
            const isFinished = saved.status === "completed" || saved.status === "failed";
            if (isFinished) {
              applyTask(saved);
              if (saved.status === "completed") setMessage("任务已完成");
              if (saved.status === "failed") setMessage(saved.error || "分析失败，请重试。");
            } else {
              setCurrentTask(saved);
              setVideoStatus(saved.status === "analyzing_video" ? "working" : saved.video.cacheKey ? "ready" : "working");
              setProductStatus(saved.status === "analyzing_product" ? "working" : saved.productCacheKey ? "ready" : "idle");
              setVideoMeta(saved.video);
              setProductCacheKey(saved.productCacheKey);
            }
          }
        } catch { /* 下一次轮询继续 */ }
      })();
    }, 1800);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [currentTask]);

  const userRequirements = useMemo(
    () => messages.filter((item) => item.role === "user").map((item) => item.content.trim()).filter(Boolean).join("\n"),
    [messages]
  );
  const videoReady = videoStatus === "ready" && Boolean(videoMeta.cacheKey);
  const productReady = productStatus === "ready" && Boolean(productCacheKey);
  const canGenerate = videoReady && productReady && !generateBusy;

  async function analyzeVideo(file: File) {
    setVideoFile(file);
    setVideoStatus("working");
    setVideoUploadStatus("uploading");
    setVideoError("");
    setMessage("");
    try {
      // 流式上传：原始字节流直传，服务端边落盘边算哈希，不再把整份视频整体读进内存
      const taskId = createId("replica_task");
      const response = await fetch("/api/replica/tasks", {
        method: "POST",
        headers: {
          "Content-Type": "application/octet-stream",
          "x-file-name": encodeURIComponent(file.name || "video.mp4"),
          "x-task-id": taskId,
          "x-replica-meta": encodeURIComponent(JSON.stringify({ referenceCopy, messages }))
        },
        body: file
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload.success) throw new Error(payload.message || "视频理解失败，请重试。");
      const task = payload.task as ReplicaTask;
      const saved = saveReplicaTask({ ...task, messages });
      setVideoFile(null);
      setCurrentTask(saved);
      setVideoMeta(saved.video);
      setVideoPreview(assetUrl(saved.id, saved.video.assetId));
      setVideoThumbnail(assetUrl(saved.id, saved.video.thumbnailAssetId));
      setVideoStatus("working");
      setVideoUploadStatus("uploaded");
      setHistory(getReplicaTasks());
      setMessage("视频已进入后台理解，可离开页面");
    } catch (error) {
      setVideoStatus("error");
      setVideoUploadStatus("error");
      setVideoError(error instanceof Error ? error.message : "视频理解失败，请重试。");
    }
  }

  async function importDouyinVideo() {
    if (!douyinInput.trim() || douyinImportBusy) return;
    setDouyinImportBusy(true);
    setDouyinImportError("");
    setVideoError("");
    setVideoStatus("working");
    setVideoUploadStatus("uploading");
    setMessage("");
    try {
      const response = await fetch("/api/replica/tasks/import-douyin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ input: douyinInput, taskId: currentTask?.id || "" })
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload.success) throw new Error(payload.message || "视频导入失败，请重试。");
      const task = payload.task as ReplicaTask;
      const saved = saveReplicaTask({ ...task, messages: currentTask?.messages || messages });
      setVideoFile(null);
      setCurrentTask(saved);
      setVideoMeta(saved.video);
      setVideoPreview(assetUrl(saved.id, saved.video.assetId));
      setVideoThumbnail(assetUrl(saved.id, saved.video.thumbnailAssetId));
      setVideoStatus("working");
      setVideoUploadStatus("uploaded");
      setDouyinInput("");
      setHistory(getReplicaTasks());
      setMessage("抖音视频已导入，正在后台理解");
    } catch (error) {
      setVideoStatus("idle");
      setVideoUploadStatus("error");
      setDouyinImportError(error instanceof Error ? error.message : "视频导入失败，请重试。");
    } finally {
      setDouyinImportBusy(false);
    }
  }

  async function analyzeProduct(files: File[], document = documentFile, keepAssetIds: string[] = currentTask?.products.map((item) => item.assetId || "").filter(Boolean) || []) {
    if (!currentTask?.id) {
      setMessage("请先上传爆款视频。");
      return;
    }
    const hasStoredProducts = Boolean(currentTask.products.length);
    if (!files.length && !(document && hasStoredProducts)) {
      setProductStatus("idle");
      setProductCacheKey("");
      return;
    }
    setProductStatus("working");
    setProductError("");
    try {
      const formData = new FormData();
      formData.append("taskId", currentTask.id);
      files.forEach((file) => formData.append("images", file));
      keepAssetIds.forEach((assetId) => formData.append("keepAssetIds", assetId));
      if (document) formData.append("document", document);
      const response = await fetch("/api/replica/tasks/products", { method: "POST", body: formData });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload.success) throw new Error(payload.message || "产品图片理解失败，请重试。");
      const task = payload.task as ReplicaTask;
      const saved = saveReplicaTask(task);
      setCurrentTask(saved);
      setProductFiles([]);
      setProductPreviews(saved.products.map((item) => assetUrl(saved.id, item.assetId)));
      setProductCacheKey(saved.productCacheKey);
      setProductStatus("working");
      setDocumentFile(null);
      setDocumentName(saved.documentName || "");
      setHistory(getReplicaTasks());
      setMessage("产品已进入后台理解，可离开页面");
    } catch (error) {
      setProductStatus("error");
      setProductError(error instanceof Error ? error.message : "产品图片理解失败，请重试。");
    }
  }

  function addProductFiles(fileList: FileList | null) {
    if (!fileList) return;
    const existingCount = currentTask?.products.length || 0;
    const next = [...productFiles, ...Array.from(fileList)].slice(0, Math.max(0, 8 - existingCount));
    setProductFiles(next);
    void analyzeProduct(next);
  }

  function removeProduct(index: number) {
    const next = productFiles.filter((_, itemIndex) => itemIndex !== index);
    setProductFiles(next);
    void analyzeProduct(next);
  }

  async function removeStoredProduct(assetId?: string) {
    if (!currentTask?.id || !assetId) return;
    setProductStatus("working");
    try {
      const formData = new FormData();
      formData.append("taskId", currentTask.id);
      formData.append("removeAssetId", assetId);
      const response = await fetch("/api/replica/tasks/products", { method: "POST", body: formData });
      const payload = await response.json();
      if (!payload.success) throw new Error(payload.message || "删除产品图失败。");
      const saved = saveReplicaTask(payload.task);
      applyTask(saved);
      setHistory(getReplicaTasks());
      setMessage("已删除产品图");
    } catch (error) {
      setProductStatus("error");
      setMessage(error instanceof Error ? error.message : "删除产品图失败。");
    }
  }

  function replaceProduct(index: number, file: File) {
    const next = productFiles.map((item, itemIndex) => itemIndex === index ? file : item);
    setProductFiles(next);
    void analyzeProduct(next);
  }

  function removeDocument() {
    setDocumentFile(null);
    setDocumentName("");
    if (!currentTask?.id) return;
    void (async () => {
      try {
        const formData = new FormData();
        formData.append("taskId", currentTask.id);
        formData.append("removeDocument", "true");
        currentTask.products.forEach((item) => formData.append("keepAssetIds", item.assetId || ""));
        const response = await fetch("/api/replica/tasks/products", { method: "POST", body: formData });
        const payload = await response.json();
        if (payload.success) {
          const saved = saveReplicaTask(payload.task);
          applyTask(saved);
          setHistory(getReplicaTasks());
        }
      } catch { /* 保留当前任务状态 */ }
    })();
  }

  function startNewReplica() {
    setCurrentTask(null);
    setVideoFile(null);
    setVideoPreview("");
    setVideoThumbnail("");
    setVideoMeta({ name: "", size: 0, duration: 0, cacheKey: "" });
    setVideoStatus("idle");
    setVideoUploadStatus("idle");
    setVideoError("");
    setProductFiles([]);
    setProductPreviews([]);
    setProductStatus("idle");
    setProductError("");
    setProductCacheKey("");
    setDocumentFile(null);
    setDocumentName("");
    setReferenceCopy("");
    setMessages([{ id: "replica_greeting", role: "assistant", content: "先上传爆款视频和你的产品图。我会按最高还原锁定原片，只替换产品和必要文案。", createdAt: nowIso() }]);
    setPrompt("");
    setViewMode("input");
    setMessage("已准备新建复刻，请上传新的视频");
  }

  async function retryReplica() {
    if (!currentTask?.id) return;
    setVideoError("");
    setProductError("");
    setMessage("");
    if (productStatus === "error") {
      setProductStatus("working");
    } else {
      setVideoStatus("working");
    }
    try {
      const response = await fetch("/api/replica/tasks/retry", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ taskId: currentTask.id })
      });
      const payload = await response.json();
      if (!payload.success) throw new Error(payload.message || "重试失败，请稍后再试。");
      const saved = saveReplicaTask(payload.task);
      applyTask(saved);
      setHistory(getReplicaTasks());
      setMessage("已复用原视频和产品资料继续处理");
    } catch (error) {
      setVideoStatus("error");
      setMessage(error instanceof Error ? error.message : "重试失败，请稍后再试。");
    }
  }

  async function sendChat(content = chatInput) {
    const text = content.trim();
    if (!text || chatBusy || !currentTask?.id) return;
    const userMessage: ReplicaTaskMessage = { id: createId("replica_message"), role: "user", content: text, createdAt: nowIso() };
    const nextMessages = [...messages, userMessage];
    setMessages(nextMessages);
    setChatInput("");
    setChatBusy(true);
    chatFollowRef.current = true;
    void syncTask({ taskId: currentTask.id, messages: nextMessages });
    const controller = new AbortController();
    chatAbortRef.current = controller;
    const timeout = window.setTimeout(() => controller.abort(), 300000);
    try {
      const response = await fetch("/api/replica/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ taskId: currentTask.id, messages: nextMessages, videoReady, productReady }),
        signal: controller.signal
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload.success) throw new Error(payload.message || "AI 暂时没有回应，请重试。");
      if (payload.task) {
        const updated = saveReplicaTask(payload.task as ReplicaTask);
        setCurrentTask(updated);
        setVideoMeta(updated.video);
        setVideoStatus(updated.status === "analyzing_video" ? "working" : updated.video.cacheKey ? "ready" : "working");
        setProductStatus(updated.status === "analyzing_product" ? "working" : updated.productCacheKey ? "ready" : "idle");
        setProductCacheKey(updated.productCacheKey);
        setHistory(getReplicaTasks());
      }
      const assistantMessage: ReplicaTaskMessage = {
        id: createId("replica_message"),
        role: "assistant",
        content: String(payload.content || "已收到。"),
        createdAt: nowIso()
      };
      const finished = [...nextMessages, assistantMessage];
      setMessages(finished);
      void syncTask({ taskId: currentTask.id, messages: finished });
    } catch (error) {
      const aborted = error instanceof DOMException && error.name === "AbortError";
      const fallback = aborted ? "已停止生成。" : error instanceof Error && error.name === "TimeoutError" ? "生成超时，请重试。" : error instanceof Error ? error.message : "AI 暂时没有回应，请重试。";
      const next = [...nextMessages, { id: createId("replica_message"), role: "assistant" as const, content: fallback, createdAt: nowIso() }];
      setMessages(next);
      void syncTask({ taskId: currentTask.id, messages: next });
    } finally {
      window.clearTimeout(timeout);
      chatAbortRef.current = null;
      setChatBusy(false);
    }
  }

  function stopChatGeneration() {
    chatAbortRef.current?.abort();
  }

  function requestGeneratePrompt() {
    if (!videoReady || !productReady) {
      setMessage("请先准备爆款视频和产品图片。");
      return;
    }
    if (currentTask?.copyMode === "source" || (currentTask?.copyMode === "custom" && currentTask.customCopy?.trim())) {
      void generatePrompt({ mode: currentTask.copyMode, instruction: currentTask.customCopy || "" });
      return;
    }
    setDialogueMode("source");
    setDialogueInstruction("");
    setDialogueConfirmOpen(true);
  }

  async function generatePrompt(handling: { mode: "source" | "custom"; instruction: string }) {
    if (!videoReady || !productReady || !currentTask?.id) {
      setMessage("请先准备爆款视频和产品图片。");
      return;
    }
    setDialogueConfirmOpen(false);
    setGenerateBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/replica/tasks/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          taskId: currentTask?.id,
          requirements: userRequirements || "默认最高还原，只替换产品和必要文案。",
          referenceCopy,
          messages,
          copyMode: handling.mode,
          customCopy: handling.instruction
        })
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload.success) throw new Error(payload.message || "复刻提示词生成失败，请重试。");
      const task = payload.task as ReplicaTask;
      const taskId = task.id;
      const saved = saveReplicaTask(task);
      setCurrentTask(saved);
      setPrompt(saved.prompt || "");
      setHistory(getReplicaTasks());
      setViewMode("input");
      const promptMessage: ReplicaTaskMessage = {
        id: createId("replica_message"),
        role: "assistant",
        content: payload.prompt || saved.prompt || "Prompt 已生成。",
        createdAt: nowIso()
      };
      const nextMessages = [...(saved.messages.length ? saved.messages : messages), promptMessage];
      setMessages(nextMessages);
      saveReplicaTask({ ...saved, messages: nextMessages });
      void syncTask({ taskId, messages: nextMessages });
      if (currentTask) {
        updateAsset(`asset_replica_${taskId}`, { title: saved.title, content: saved.prompt, rawData: { replicaTaskId: taskId, selfCheck: saved.selfCheck, version: saved.versions.length }, updatedAt: nowIso() });
      } else {
        createAsset({ id: `asset_replica_${taskId}`, type: "deconstruction", title: saved.title, summary: "爆款复刻提示词", content: saved.prompt, rawData: { replicaTaskId: taskId, selfCheck: saved.selfCheck }, sourceModule: "deconstruction", platform: "unknown", productId: "", productName: saved.products[0]?.name || "", tags: ["爆款复刻", "高还原"], status: "completed", linkedRecordIds: [taskId] });
      }
      setMessage("复刻提示词已生成，已同步到右侧 AI 对话。");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "复刻提示词生成失败，请重试。");
    } finally {
      setGenerateBusy(false);
    }
  }

  async function refinePrompt(content = refineInput) {
    const instruction = content.trim();
    if (!instruction || !prompt || refineBusy) return;
    setRefineBusy(true);
    setRefineInput("");
    try {
      const response = await fetch("/api/replica/refine", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ prompt, instruction }) });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload.success) throw new Error(payload.message || "AI 修改失败，请重试。");
      const nextPrompt = String(payload.prompt || "").trim();
      if (!nextPrompt) throw new Error("AI 没有返回修改后的 Prompt。");
      setPrompt(nextPrompt);
      if (currentTask) {
        const nextMessages = [...currentTask.messages, { id: createId("replica_message"), role: "user" as const, content: instruction, createdAt: nowIso() }, { id: createId("replica_message"), role: "assistant" as const, content: nextPrompt, createdAt: nowIso() }];
        const saved = saveReplicaTask({ ...currentTask, prompt: nextPrompt, messages: nextMessages });
        setCurrentTask(saved);
        setMessages(nextMessages);
        updateAsset(`asset_replica_${saved.id}`, { content: nextPrompt, rawData: { replicaTaskId: saved.id, selfCheck: saved.selfCheck } });
        void syncTask({ taskId: saved.id, messages: nextMessages, prompt: nextPrompt });
      }
      setMessage("AI 已按要求修改提示词");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "AI 修改失败，请重试。");
    } finally {
      setRefineBusy(false);
    }
  }

  function updatePrompt(value: string) {
    setPrompt(value);
    if (currentTask) setCurrentTask((current) => current ? { ...current, prompt: value } : current);
  }

  function savePrompt() {
    if (!currentTask) return;
    const saved = saveReplicaTask({ ...currentTask, prompt });
    setCurrentTask(saved);
    updateAsset(`asset_replica_${saved.id}`, { content: prompt });
    setHistory(getReplicaTasks());
    void syncTask({ taskId: saved.id, prompt });
  }

  function saveVersion() {
    if (!currentTask || !prompt.trim()) return;
    const saved = appendReplicaVersion(currentTask.id, prompt, "手动保存");
    if (saved) {
      setCurrentTask(saved);
      setHistory(getReplicaTasks());
      updateAsset(`asset_replica_${saved.id}`, { content: prompt, rawData: { replicaTaskId: saved.id, version: saved.versions.length } });
      setMessage(`已保存 V${saved.versions.length}`);
      void syncTask({ taskId: saved.id, prompt, appendVersion: { prompt, note: "手动保存" } });
    }
  }

  function restoreVersion(version: ReplicaVersion) {
    setPrompt(version.prompt);
    if (currentTask) {
      const saved = saveReplicaTask({ ...currentTask, prompt: version.prompt });
      setCurrentTask(saved);
      updateAsset(`asset_replica_${saved.id}`, { content: version.prompt, rawData: { replicaTaskId: saved.id, restoredVersion: version.version } });
      void syncTask({ taskId: saved.id, prompt: version.prompt });
    }
    setMessage(`已恢复 V${version.version}，旧版本未被覆盖`);
  }

  async function syncTask(body: Record<string, unknown>) {
    try {
      await fetch("/api/replica/tasks/update", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    } catch { /* 本地保存仍可使用 */ }
  }

  function loadHistoryTask(task: ReplicaTask) {
    setHistoryOpen(false);
    applyTask(task);
    if (activeStatuses.includes(task.status)) setMessage("已打开处理中的历史任务");
    else setMessage("已打开历史任务");
  }

  async function copyPrompt() {
    if (!prompt.trim()) return;
    try {
      await navigator.clipboard.writeText(prompt);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      setMessage("复制失败，请手动选中 Prompt 复制。");
    }
  }

  const statusText = (status: AssetStatus, ready: string, working: string, idle: string, error: string) => status === "ready" ? ready : status === "working" ? working : status === "error" ? error : idle;

  if (viewMode === "result") {
    return (
      <div className="desktop-page flex h-[calc(100vh-7rem)] min-h-0 flex-col">
        <ResultHeader title={currentTask?.title || "复刻提示词"} copied={copied} onCopy={() => void copyPrompt()} onSave={saveVersion} onRegenerate={requestGeneratePrompt} onHistory={() => setHistoryOpen(true)} onBack={() => setViewMode("input")} />
        {message ? <div className="mb-3 text-xs text-slate-500 dark:text-slate-400">{message}</div> : null}
        <div className="grid min-h-0 flex-1 gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(300px,360px)]">
          <section className="h-full min-h-0 flex flex-col overflow-hidden rounded-xl border border-slate-200/70 bg-white dark:border-white/[0.07] dark:bg-card">
            <div className="flex items-center justify-between border-b border-slate-200/70 px-4 py-3 dark:border-white/[0.06]">
              <div><div className="text-sm font-semibold text-slate-950 dark:text-slate-100">复刻提示词</div><div className="mt-0.5 text-xs text-slate-400">可直接编辑，保存不会覆盖旧版本</div></div>
              <div className="flex items-center gap-2 text-xs text-slate-400"><Check className="h-3.5 w-3.5 text-emerald-500" />已完成自动自检</div>
            </div>
            <Textarea value={prompt} onChange={(event) => updatePrompt(event.target.value)} onBlur={savePrompt} className="min-h-0 flex-1 resize-none rounded-none border-0 bg-transparent p-6 font-mono text-[13px] leading-6 focus-visible:ring-0 dark:bg-transparent" aria-label="可编辑复刻提示词" />
            {currentTask?.versions.length ? <details className="border-t border-slate-200/70 px-4 py-2.5 dark:border-white/[0.06]"><summary className="cursor-pointer text-xs text-slate-400">历史版本（{currentTask.versions.length}）</summary><div className="mt-2 flex flex-wrap gap-2">{currentTask.versions.map((version) => <button key={version.id} type="button" onClick={() => restoreVersion(version)} className="rounded-md border border-slate-200 px-2 py-1 text-xs text-slate-500 hover:border-brand/50 hover:text-brand dark:border-white/10 dark:text-slate-400">V{version.version}</button>)}</div></details> : null}
          </section>
          <section className="flex min-h-0 flex-col overflow-hidden rounded-xl border border-slate-200/70 bg-white dark:border-white/[0.07] dark:bg-card">
            <div className="border-b border-slate-200/70 px-4 py-3 dark:border-white/[0.06]"><div className="flex items-center gap-2 text-sm font-semibold text-slate-950 dark:text-slate-100"><MessageCircle className="h-4 w-4 text-brand" />AI 助手</div><div className="mt-1 text-xs text-slate-400">继续说要改哪里，我会保留完整时间轴和锁定约束。</div></div>
            <div className="min-h-0 flex-1 overflow-y-auto p-4 scrollbar-subtle"><div className="space-y-3"><div className="rounded-xl bg-slate-50 px-3 py-2.5 text-xs leading-5 text-slate-500 dark:bg-white/[0.04] dark:text-slate-300">可以说“第 1 秒动作再写细一点”或“产品不能变形，把一致性约束写得更强”。</div></div></div>
            <div className="border-t border-slate-200/70 p-3 dark:border-white/[0.06]"><Textarea value={refineInput} onChange={(event) => setRefineInput(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void refinePrompt(); } }} placeholder="告诉 AI 你想怎么改…" className="min-h-20 resize-none text-xs" disabled={refineBusy} /><div className="mt-2 flex items-center justify-between gap-2"><div className="flex flex-wrap gap-1">{["第 1 秒动作再细一点", "眼神再接近原片", "产品不能变形"].map((item) => <button key={item} type="button" onClick={() => void refinePrompt(item)} className="rounded-md bg-slate-100 px-2 py-1 text-[11px] text-slate-500 hover:bg-slate-200 dark:bg-white/[0.05] dark:text-slate-400">{item}</button>)}</div><Button size="sm" onClick={() => void refinePrompt()} disabled={refineBusy || !refineInput.trim()}>{refineBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}发送</Button></div></div>
          </section>
        </div>
        {dialogueConfirmOpen ? <DialogueConfirmModal mode={dialogueMode} instruction={dialogueInstruction} onModeChange={setDialogueMode} onInstructionChange={setDialogueInstruction} onCancel={() => setDialogueConfirmOpen(false)} onConfirm={(handling) => void generatePrompt(handling)} /> : null}
        {historyOpen ? <HistoryDrawer items={history} onClose={() => setHistoryOpen(false)} onOpen={loadHistoryTask} /> : null}
      </div>
    );
  }

  return (
    <div className="desktop-page flex h-[calc(100dvh-8.5rem)] min-h-0 flex-col overflow-hidden">
      <header className="mb-4 flex shrink-0 items-start justify-between gap-4"><div><div className="text-xs font-medium tracking-[0.16em] text-brand">AI 内容中台 / 爆款复刻</div><h1 className="mt-2 text-[27px] font-semibold tracking-tight text-slate-950 dark:text-slate-100">爆款复刻</h1><p className="mt-1 text-sm text-slate-500 dark:text-slate-400">上传原片和产品图，告诉 AI 少量要求，尽可能复刻原视频。</p></div><div className="flex items-center gap-2"><Button size="sm" variant="outline" onClick={startNewReplica}><RotateCcw className="h-4 w-4" />新建复刻</Button><Button size="sm" variant="outline" onClick={() => setHistoryOpen(true)}><History className="h-4 w-4" />历史任务{history.length ? `（${history.length}）` : ""}</Button></div></header>
      {message ? <div className="mb-3 flex shrink-0 items-center gap-2 text-xs text-slate-500 dark:text-slate-400"><Check className="h-3.5 w-3.5 text-emerald-500" />{message}</div> : null}
      <div className="grid min-h-0 flex-1 gap-4 xl:grid-cols-[minmax(360px,0.78fr)_minmax(520px,1.22fr)]">
        <section ref={materialPanelRef} className="h-full min-h-0 overflow-y-auto overscroll-contain rounded-xl border border-slate-200/70 bg-white p-3 scrollbar-subtle dark:border-white/[0.07] dark:bg-card">
          <div className="space-y-3">
            <UploadVideoCard
              file={videoFile}
              preview={videoPreview}
              thumbnail={videoThumbnail}
              meta={videoMeta}
              status={videoStatus}
              uploadStatus={videoUploadStatus}
              error={videoError || douyinImportError}
              progress={currentTask?.analysisProgress}
              onOpenPreview={() => setVideoPreviewOpen(true)}
              inputRef={videoInputRef}
              sourceMode={videoSourceMode}
              douyinInput={douyinInput}
              importBusy={douyinImportBusy}
              onSourceModeChange={setVideoSourceMode}
              onDouyinInputChange={setDouyinInput}
              onImportDouyin={() => void importDouyinVideo()}
              onPick={(file) => void analyzeVideo(file)}
              onRetry={() => void retryReplica()}
              onRemove={() => { setVideoFile(null); setCurrentTask(null); setVideoPreview(""); setVideoThumbnail(""); setVideoMeta({ name: "", size: 0, duration: 0, cacheKey: "" }); setVideoStatus("idle"); setVideoUploadStatus("idle"); setVideoError(""); setDouyinImportError(""); }}
              statusText={statusText(videoStatus, "视频已准备", "正在理解视频…", "等待上传", videoError || "视频无法读取")}
            />
            <ProductUploadCard cachedProducts={productFiles.length ? undefined : currentTask?.products} cachedTaskId={currentTask?.id} files={productFiles} previews={productPreviews} status={productStatus} error={productError} inputRef={productInputRef} onPick={addProductFiles} onRemove={removeProduct} onRemoveAsset={(assetId) => void removeStoredProduct(assetId)} onReplace={replaceProduct} onRetry={() => void retryReplica()} statusText={statusText(productStatus, "产品已准备", "正在匹配你的产品…", "等待上传", productError || "产品图片无法读取")} />
<div className="flex items-center gap-3 px-1 text-[11px] text-slate-400 dark:text-slate-500"><label className="inline-flex cursor-pointer items-center gap-1.5 hover:text-slate-600 dark:hover:text-slate-300"><FileText className="h-3.5 w-3.5" />添加产品文档<input ref={documentInputRef} type="file" accept=".pdf,.docx,.txt,.md" className="hidden" onChange={(event) => { const file = event.target.files?.[0] || null; setDocumentFile(file); if (!file) return; if (productFiles.length) void analyzeProduct(productFiles, file); else void analyzeProduct([], file); event.target.value = ""; }} /></label>{documentFile || documentName ? <span className="max-w-48 truncate text-slate-500">{documentFile?.name || documentName}<button type="button" className="ml-1 hover:text-red-500" onClick={removeDocument} aria-label="删除产品文档"><X className="inline h-3 w-3" /></button></span> : null}<span className="text-slate-300 dark:text-slate-600">·</span><span className="inline-flex items-center gap-1.5"><Paperclip className="h-3.5 w-3.5" />参考文案在右侧补充</span></div>
          </div>
        </section>
        <section ref={chatPanelRef} className="h-full min-h-0 flex flex-col overflow-hidden rounded-xl border border-slate-200/70 bg-white dark:border-white/[0.07] dark:bg-card">
          <div className="flex shrink-0 items-center justify-between border-b border-slate-200/70 px-4 py-3 dark:border-white/[0.06]"><div><div className="flex items-center gap-2 text-sm font-semibold text-slate-950 dark:text-slate-100"><Sparkles className="h-4 w-4 text-brand" />3. 告诉 AI 这次怎么复刻</div><div className="mt-1 text-xs text-slate-400">自然语言沟通即可，默认最高还原。</div></div><div className="text-[11px] text-slate-400">{videoReady && productReady ? "素材已就绪" : "等待素材"}</div></div>
          <div
              ref={chatScrollRef}
              onScroll={(event) => {
                const element = event.currentTarget;
                chatFollowRef.current = element.scrollHeight - element.scrollTop - element.clientHeight < 80;
              }}
              className="min-h-0 flex-1 overflow-y-auto overscroll-contain overflow-x-hidden p-4 scrollbar-subtle"
            >
              <div className="space-y-3">
                {messages.map((item) => <ChatBubble key={item.id} message={item} />)}
                {chatBusy ? <div className="flex items-center gap-2 text-xs text-slate-400"><Loader2 className="h-3.5 w-3.5 animate-spin" />AI 正在生成…</div> : null}
              </div>
            </div>
          <div className="shrink-0 border-t border-slate-200/70 p-3 dark:border-white/[0.06]"><Textarea value={chatInput} onChange={(event) => setChatInput(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void sendChat(); } }} placeholder="例如：保留转身、路人搭话、女生惊讶的感觉，只替换成我上传的红色羽绒服…" className="min-h-20 resize-none text-sm" disabled={chatBusy} /><div className="mt-2 flex items-center justify-between gap-3"><div className="flex flex-wrap gap-1.5">{quickSuggestions.map((item) => <button key={item} type="button" onClick={() => void sendChat(item)} disabled={chatBusy} className="rounded-md bg-slate-100 px-2 py-1 text-[11px] text-slate-500 transition-colors hover:bg-slate-200 disabled:opacity-50 dark:bg-white/[0.05] dark:text-slate-400 dark:hover:bg-white/[0.1]">{item}</button>)}</div>{chatBusy ? (
                  <Button type="button" onClick={stopChatGeneration} size="sm" variant="outline" aria-label="停止生成" title="停止生成">
                    <Square className="h-3.5 w-3.5 fill-current" />
                  </Button>
                ) : (
                  <Button onClick={() => void sendChat()} disabled={!chatInput.trim()} size="sm" aria-label="发送">
                    <Send className="h-3.5 w-3.5" />发送
                  </Button>
                )}</div></div>
          <details className="border-t border-slate-200/70 px-4 py-2.5 dark:border-white/[0.06]"><summary className="cursor-pointer text-[11px] text-slate-400 hover:text-slate-600 dark:hover:text-slate-300">添加参考文案（可选）</summary><Textarea value={referenceCopy} onChange={(event) => setReferenceCopy(event.target.value)} className="mt-2 min-h-16 resize-y text-xs" placeholder="只有品牌必须使用的说法才放这里，优先级低于原视频结构。" /></details>
<div className="border-t border-slate-200/70 p-3 dark:border-white/[0.06]"><Button className="w-full" onClick={requestGeneratePrompt} disabled={!canGenerate}>{generateBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}{generateBusy ? "正在生成高还原复刻提示词…" : "开始生成复刻提示词"}</Button>{!videoReady || !productReady ? <div className="mt-2 text-center text-[11px] text-slate-400">准备好两个素材后即可生成</div> : null}</div>
        </section>
      </div>
      {dialogueConfirmOpen ? <DialogueConfirmModal mode={dialogueMode} instruction={dialogueInstruction} onModeChange={setDialogueMode} onInstructionChange={setDialogueInstruction} onCancel={() => setDialogueConfirmOpen(false)} onConfirm={(handling) => void generatePrompt(handling)} /> : null}
      {historyOpen ? <HistoryDrawer items={history} onClose={() => setHistoryOpen(false)} onOpen={loadHistoryTask} /> : null}
      {videoPreviewOpen && currentTask ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 p-4 backdrop-blur-sm" onClick={() => setVideoPreviewOpen(false)}>
          <div className="relative w-full max-w-4xl overflow-hidden rounded-2xl bg-black shadow-2xl" onClick={(event) => event.stopPropagation()}>
            <Button size="icon" variant="ghost" className="absolute right-2 top-2 z-10 text-white hover:bg-white/10" onClick={() => setVideoPreviewOpen(false)} aria-label="关闭视频预览"><X className="h-4 w-4" /></Button>
            <video
              src={assetUrl(currentTask.id, currentTask.video.assetId)}
              poster={assetUrl(currentTask.id, currentTask.video.thumbnailAssetId)}
              controls
              autoPlay
              playsInline
              className="max-h-[82vh] w-full bg-black"
            />
          </div>
        </div>
      ) : null}
    </div>
  );
}

const analysisStageOrder = ["VIDEO_READING", "SHOT_DETECTION", "FRAME_EXTRACTION", "AUDIO_EXTRACTION", "ASR", "AUDIO_ANALYSIS", "SHOT_ANALYSIS", "DNA_ASSEMBLY", "VALIDATION"];
const analysisStageLabels: Record<string, string> = {
  VIDEO_READING: "视频读取",
  SHOT_DETECTION: "镜头切分",
  FRAME_EXTRACTION: "关键帧提取",
  AUDIO_EXTRACTION: "音频提取",
  ASR: "语音转写",
  AUDIO_ANALYSIS: "音频节奏",
  SHOT_ANALYSIS: "镜头逐段理解",
  DNA_ASSEMBLY: "Video DNA 整理",
  VALIDATION: "DNA 校验"
};

function analysisProgressText(progress: NonNullable<ReplicaTask["analysisProgress"]>) {
  const unit = progress.totalUnits && progress.completedUnits !== undefined ? ` ${progress.completedUnits}/${progress.totalUnits}` : "";
  const percent = progress.totalUnits && progress.completedUnits !== undefined ? ` · ${Math.round((progress.completedUnits / progress.totalUnits) * 100)}%` : "";
  return `${progress.stageLabel}${unit}${percent}${progress.detail ? ` · ${progress.detail}` : ""}`;
}

function formatElapsedSince(value?: string) {
  if (!value) return "";
  const started = new Date(value).getTime();
  if (!Number.isFinite(started)) return "";
  const seconds = Math.max(0, Math.floor((Date.now() - started) / 1000));
  if (seconds < 60) return `${seconds}s`;
  return `${Math.floor(seconds / 60)}分${String(seconds % 60).padStart(2, "0")}秒`;
}

function DialogueConfirmModal({ mode, instruction, onModeChange, onInstructionChange, onCancel, onConfirm }: {
  mode: "source" | "custom";
  instruction: string;
  onModeChange: (mode: "source" | "custom") => void;
  onInstructionChange: (instruction: string) => void;
  onCancel: () => void;
  onConfirm: (handling: { mode: "source" | "custom"; instruction: string }) => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/30 p-4 backdrop-blur-[1px]">
      <div className="w-full max-w-lg rounded-2xl bg-white p-5 shadow-2xl dark:bg-[#101521]">
        <div className="text-sm font-semibold text-slate-950 dark:text-slate-100">这次视频文案使用哪一种？</div>
        <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">除产品和必要文案外，其他内容默认按原片最高还原。</div>
        <div className="mt-4 space-y-2">
          {[
            { key: "source" as const, title: "A. 使用原视频文案", desc: "完整保留识别出的原视频台词，仅做最小产品适配。" },
            { key: "custom" as const, title: "B. 使用你提供的新文案", desc: "粘贴完整文案后，系统会映射回原视频时间结构。" },
          ].map((item) => (
            <button key={item.key} type="button" onClick={() => onModeChange(item.key)} className={cn("w-full rounded-xl border p-3 text-left transition-colors", mode === item.key ? "border-brand bg-brand/[0.06]" : "border-slate-200 hover:border-brand/50 dark:border-white/[0.08]")}>
              <div className="text-sm font-medium text-slate-800 dark:text-slate-100">{item.title}</div>
              <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">{item.desc}</div>
            </button>
          ))}
        </div>
        {mode === "custom" ? (
          <Textarea value={instruction} onChange={(event) => onInstructionChange(event.target.value)} placeholder="把这次要使用的完整文案发给我，我收到后直接生成最终复刻提示词。" className="mt-3 min-h-32 resize-y text-xs" />
        ) : null}
        <div className="mt-4 flex items-center justify-end gap-2">
          <Button size="sm" variant="ghost" onClick={onCancel}>取消</Button>
          <Button size="sm" disabled={mode === "custom" && !instruction.trim()} onClick={() => onConfirm({ mode, instruction: instruction.trim() })}>确认并生成</Button>
        </div>
      </div>
    </div>
  );
}

function UploadVideoCard({ file, preview, thumbnail, meta, status, uploadStatus, error, progress, onOpenPreview, inputRef, sourceMode, douyinInput, importBusy, onSourceModeChange, onDouyinInputChange, onImportDouyin, onPick, onRetry, onRemove, statusText }: {
  file: File | null;
  preview: string;
  thumbnail: string;
  meta: ReplicaTask["video"];
  status: AssetStatus;
  uploadStatus: UploadStatus;
  error: string;
  progress?: ReplicaTask["analysisProgress"];
  onOpenPreview: () => void;
  inputRef: React.RefObject<HTMLInputElement | null>;
  sourceMode: "local" | "douyin";
  douyinInput: string;
  importBusy: boolean;
  onSourceModeChange: (mode: "local" | "douyin") => void;
  onDouyinInputChange: (value: string) => void;
  onImportDouyin: () => void;
  onPick: (file: File) => void;
  onRetry: () => void;
  onRemove: () => void;
  statusText: string;
}) {
  const hasLocalFile = Boolean(file && preview);
  const hasVideoAsset = Boolean(meta.assetId || meta.cacheKey);
  const sourceType = meta.sourceType;
  const analysisBadge = status === "working"
    ? { icon: <Loader2 className="h-3 w-3 animate-spin" />, text: "正在分析", className: "bg-slate-100 text-slate-600 dark:bg-white/[0.06] dark:text-slate-300" }
    : status === "ready"
      ? { icon: <Check className="h-3 w-3" />, text: "分析成功", className: "bg-emerald-50 text-emerald-600 dark:bg-emerald-500/10 dark:text-emerald-300" }
      : status === "error"
        ? { icon: <X className="h-3 w-3" />, text: "分析失败", className: "bg-red-50 text-red-600 dark:bg-red-500/10 dark:text-red-300" }
        : null;

  if (!hasLocalFile && !hasVideoAsset) {
    return (
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">1. 添加爆款视频</CardTitle>
          <CardDescription className="text-xs">本地上传 MP4 / MOV，或粘贴公开抖音链接。</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="mb-3 inline-flex rounded-lg bg-slate-100 p-1 dark:bg-white/[0.06]">
            {([
              { key: "local" as const, label: "本地上传", icon: <Film className="h-3.5 w-3.5" /> },
              { key: "douyin" as const, label: "抖音链接", icon: <Link2 className="h-3.5 w-3.5" /> }
            ]).map((item) => (
              <button
                key={item.key}
                type="button"
                onClick={() => onSourceModeChange(item.key)}
                className={cn("inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors", sourceMode === item.key ? "bg-white text-slate-900 shadow-sm dark:bg-white/[0.12] dark:text-white" : "text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200")}
              >
                {item.icon}
                {item.label}
              </button>
            ))}
          </div>
          {sourceMode === "local" ? (
            <label
              onDragOver={(event) => event.preventDefault()}
              onDrop={(event) => { event.preventDefault(); const selected = event.dataTransfer.files?.[0]; if (selected) onPick(selected); }}
              className="flex min-h-32 cursor-pointer flex-col items-center justify-center rounded-xl border border-dashed border-slate-300/80 bg-slate-50/70 text-center transition-colors hover:border-brand/50 hover:bg-brand/[0.04] dark:border-white/15 dark:bg-white/[0.02] dark:hover:border-brand/50"
            >
              <Film className="h-7 w-7 text-slate-300 dark:text-slate-600" />
              <span className="mt-2 text-sm font-medium text-slate-600 dark:text-slate-300">拖拽或点击上传爆款视频</span>
              <span className="mt-1 text-xs text-slate-400">{status === "working" ? "正在理解视频…" : "MP4 / MOV"}</span>
              <input ref={inputRef} type="file" accept="video/mp4,video/quicktime,.mp4,.mov,.m4v,.webm" className="hidden" onChange={(event) => { const selected = event.target.files?.[0]; if (selected) onPick(selected); event.target.value = ""; }} />
            </label>
          ) : (
            <div>
              <Textarea
                value={douyinInput}
                onChange={(event) => onDouyinInputChange(event.target.value)}
                placeholder="粘贴抖音视频链接或整段分享文本"
                className="min-h-20 resize-none text-xs"
                disabled={importBusy}
              />
              <div className="mt-2 flex items-center justify-between gap-2">
                <span className="text-[11px] text-slate-400">只支持公开单条普通视频</span>
                <Button size="sm" onClick={onImportDouyin} disabled={!douyinInput.trim() || importBusy}>
                  {importBusy ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : null}
                  {importBusy ? "解析并导入中" : "解析并导入"}
                </Button>
              </div>
            </div>
          )}
          {error ? <div className="mt-2 text-xs text-red-500">{error}</div> : null}
          {sourceMode === "local" && status === "error" ? <button type="button" onClick={onRetry} className="mt-2 text-xs text-brand hover:underline">重试</button> : null}
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm">1. 添加爆款视频</CardTitle>
        <CardDescription className="text-xs">{sourceType === "douyin" ? "抖音导入视频，已保存到本地资产。" : "支持 MP4、MOV，系统会真正读取画面、动作和音频节奏。"}</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex items-center gap-3 rounded-xl bg-slate-50 p-2.5 dark:bg-white/[0.04]">
          {thumbnail ? (
            <button type="button" onClick={onOpenPreview} title="播放原视频" className="group relative h-16 w-28 shrink-0 overflow-hidden rounded-lg bg-black">
              <img src={thumbnail} alt="视频封面" className="h-full w-full object-cover" />
              <span className="absolute inset-0 flex items-center justify-center bg-black/25 opacity-0 transition-opacity group-hover:opacity-100"><Film className="h-5 w-5 text-white" /></span>
            </button>
          ) : file && preview ? (
            <video src={preview} muted playsInline className="h-16 w-28 shrink-0 rounded-lg bg-black object-cover" />
          ) : (
            <div className="flex h-16 w-28 shrink-0 items-center justify-center rounded-lg bg-black/80"><Film className="h-6 w-6 text-slate-300" /></div>
          )}
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-medium text-slate-800 dark:text-slate-200">{file?.name || meta.name || "已缓存的爆款视频"}</div>
            {analysisBadge ? (
              <div className={`mt-1 inline-flex w-fit items-center gap-1 rounded-full px-2 py-0.5 text-[11px] ${analysisBadge.className}`}>
                {analysisBadge.icon}
                {analysisBadge.text}
              </div>
            ) : null}
            <div className="mt-1 text-xs text-slate-400">
              {formatDuration(meta.duration)} · {formatFileSize(file ? file.size : meta.size)} · {sourceType === "douyin" ? "来源：抖音" : "本地视频"}
            </div>
            {sourceType === "douyin" && meta.authorName ? <div className="mt-0.5 truncate text-[11px] text-slate-400">{meta.authorName}</div> : null}
            {error ? <div className="mt-1 truncate text-xs text-red-500">{error}</div> : null}
          </div>
          {!file ? (
            <div className="flex shrink-0 items-center gap-1">
              <label className="cursor-pointer rounded-md p-1.5 text-slate-400 hover:text-brand" title="选择新视频并替换缓存">
                <RotateCcw className="h-4 w-4" />
                <input ref={inputRef} type="file" accept="video/mp4,video/quicktime,.mp4,.mov,.m4v,.webm" className="hidden" onChange={(event) => { const selected = event.target.files?.[0]; if (selected) onPick(selected); event.target.value = ""; }} />
              </label>
              <button type="button" onClick={onRemove} className="rounded-md p-1.5 text-slate-400 hover:bg-white hover:text-red-500 dark:hover:bg-white/[0.08]" title="删除视频">
                <X className="h-4 w-4" />
              </button>
            </div>
          ) : (
            <>
              <button type="button" onClick={onRetry} className="rounded-md p-1.5 text-slate-400 hover:bg-white hover:text-brand dark:hover:bg-white/[0.08]" title="重新理解"><RefreshCw className="h-4 w-4" /></button>
              <button type="button" onClick={onRemove} className="rounded-md p-1.5 text-slate-400 hover:bg-white hover:text-red-500 dark:hover:bg-white/[0.08]" title="删除视频"><X className="h-4 w-4" /></button>
            </>
          )}
        </div>
        {status === "error" ? (
          <div className="mt-2 flex items-center justify-end gap-3 text-xs">
            <span className="text-red-500">分析失败</span>
            <button type="button" onClick={onRetry} className="text-brand hover:underline">重试</button>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

function ProductUploadCard({ cachedProducts, cachedTaskId, files, previews, status, error, inputRef, onPick, onRemove, onRemoveAsset, onReplace, onRetry, statusText }: {
  cachedProducts?: ReplicaTask["products"];
  cachedTaskId?: string;
  files: File[];
  previews: string[];
  status: AssetStatus;
  error: string;
  inputRef: React.RefObject<HTMLInputElement | null>;
  onPick: (files: FileList | null) => void;
  onRemove: (index: number) => void;
  onRemoveAsset: (assetId: string) => void;
  onReplace: (index: number, file: File) => void;
  onRetry: () => void;
  statusText: string;
}) {
  const hasCachedProducts = !files.length && Boolean(cachedProducts?.length);

  if (hasCachedProducts) {
    return (
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">2. 上传我的产品图</CardTitle>
          <CardDescription className="text-xs">可上传正面、侧面、背面和细节图，最多 8 张。</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-4 gap-2">
            {cachedProducts?.map((item, index) => (
              <div key={`${item.assetId || item.name}-${index}`} className="group relative aspect-square overflow-hidden rounded-lg bg-slate-100 dark:bg-white/[0.06]">
                {cachedTaskId && item.assetId ? (
                  <a href={`/api/replica/tasks/asset?taskId=${encodeURIComponent(cachedTaskId)}&assetId=${encodeURIComponent(item.assetId)}`} target="_blank" rel="noreferrer" title="查看大图">
                    <img src={`/api/replica/tasks/asset?taskId=${encodeURIComponent(cachedTaskId)}&assetId=${encodeURIComponent(item.assetId)}`} alt={`产品参考图 ${index + 1}`} className="h-full w-full object-cover" />
                  </a>
                ) : (
                  <div className="flex h-full items-center justify-center"><ImagePlus className="h-4 w-4 text-slate-400" /></div>
                )}
                <button type="button" onClick={() => item.assetId && onRemoveAsset(item.assetId)} className="absolute right-1 top-1 rounded-full bg-black/55 p-1 text-white opacity-0 transition-opacity group-hover:opacity-100" aria-label={`删除产品图 ${index + 1}`}><X className="h-3 w-3" /></button>
              </div>
            ))}
            <label className="flex aspect-square cursor-pointer flex-col items-center justify-center rounded-lg border border-dashed border-slate-300/80 text-slate-400 hover:border-brand/50 hover:text-brand dark:border-white/15">
              <ImagePlus className="h-5 w-5" /><span className="mt-1 text-[11px]">继续添加</span>
              <input ref={inputRef} type="file" accept="image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp" multiple className="hidden" onChange={(event) => { onPick(event.target.files); event.target.value = ""; }} />
            </label>
          </div>
            <div className="mt-2 flex items-center justify-between text-xs">
              <span className={status === "working" ? "text-slate-400" : status === "error" ? "text-red-500" : "text-emerald-600 dark:text-emerald-400"}>
                {status === "working" ? "正在匹配你的产品…" : status === "error" ? "产品理解失败" : cachedProducts?.length ? "产品已保存" : statusText}
              </span>
              <label className="cursor-pointer text-xs text-brand hover:underline">
                重新上传全部
                <input ref={inputRef} type="file" accept="image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp" multiple className="hidden" onChange={(event) => { onPick(event.target.files); event.target.value = ""; }} />
              </label>
            </div>
          {error ? <div className="mt-1 text-xs text-red-500">{error}</div> : null}
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="pb-3"><CardTitle className="text-sm">2. 上传我的产品图</CardTitle><CardDescription className="text-xs">可上传正面、侧面、背面和细节图，最多 8 张。</CardDescription></CardHeader>
      <CardContent>
        {files.length ? (
          <>
            <div className="grid grid-cols-4 gap-2">
              {files.map((file, index) => (
                <div key={`${file.name}-${index}`} className="group relative aspect-square overflow-hidden rounded-lg bg-slate-100 dark:bg-white/[0.06]">
                  <a href={previews[index]} target="_blank" rel="noreferrer" title="查看大图"><img src={previews[index]} alt={`产品参考图 ${index + 1}`} className="h-full w-full object-cover" /></a>
                  <label className="absolute bottom-1 left-1 cursor-pointer rounded-full bg-black/55 p-1 text-white opacity-0 transition-opacity group-hover:opacity-100" title="更换图片">
                    <RefreshCw className="h-3 w-3" />
                    <input type="file" accept="image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp" className="hidden" onChange={(event) => { const selected = event.target.files?.[0]; if (selected) onReplace(index, selected); event.target.value = ""; }} />
                  </label>
                  <button type="button" onClick={() => onRemove(index)} className="absolute right-1 top-1 rounded-full bg-black/55 p-1 text-white opacity-0 transition-opacity group-hover:opacity-100" aria-label="删除产品图"><X className="h-3 w-3" /></button>
                </div>
              ))}
              <label className="flex aspect-square cursor-pointer flex-col items-center justify-center rounded-lg border border-dashed border-slate-300/80 text-slate-400 hover:border-brand/50 hover:text-brand dark:border-white/15">
                <ImagePlus className="h-5 w-5" /><span className="mt-1 text-[11px]">添加</span>
                <input ref={inputRef} type="file" accept="image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp" multiple className="hidden" onChange={(event) => { onPick(event.target.files); event.target.value = ""; }} />
              </label>
            </div>
            <div className="mt-2 flex items-center justify-between gap-2 text-xs">
              <span className={cn(status === "error" ? "text-red-500" : "text-slate-400")}>{statusText}</span>
              {status === "error" ? <button type="button" onClick={onRetry} className="text-brand hover:underline">重试</button> : null}
            </div>
            {error ? <div className="mt-1 text-xs text-red-500">{error}</div> : null}
          </>
        ) : (
          <label
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => { event.preventDefault(); onPick(event.dataTransfer.files); }}
            className="flex min-h-28 cursor-pointer flex-col items-center justify-center rounded-xl border border-dashed border-slate-300/80 bg-slate-50/70 text-center transition-colors hover:border-brand/50 hover:bg-brand/[0.04] dark:border-white/15 dark:bg-white/[0.02] dark:hover:border-brand/50"
          >
            <ImagePlus className="h-7 w-7 text-slate-300 dark:text-slate-600" />
            <span className="mt-2 text-sm font-medium text-slate-600 dark:text-slate-300">拖拽或点击上传产品图片</span>
            <span className="mt-1 text-xs text-slate-400">{status === "working" ? "正在匹配你的产品…" : "正面 / 侧面 / 背面 / 细节"}</span>
            <input ref={inputRef} type="file" accept="image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp" multiple className="hidden" onChange={(event) => { onPick(event.target.files); event.target.value = ""; }} />
          </label>
        )}
      </CardContent>
    </Card>
  );
}

function ChatBubble({ message }: { message: ReplicaTaskMessage }) {
  const [copied, setCopied] = useState(false);
  const isFinalPrompt = message.role === "assistant" && /SHOT\s+0+1|TIME RANGE|COPY MODE|TARGET MODEL|PRODUCT REFERENCE/i.test(message.content) && message.content.length > 1200;

  async function copyMessage() {
    try {
      await navigator.clipboard.writeText(message.content);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      // 浏览器拒绝剪贴板时保持按钮可见，用户仍可手动选择复制。
    }
  }

  return (
    <div className={cn("group flex", message.role === "user" ? "justify-end" : "justify-start")}>
      <div className={cn("max-w-[88%] min-w-0 rounded-xl px-3 py-2.5 text-sm leading-6 select-text", message.role === "user" ? "bg-brand text-brand-foreground" : "bg-slate-50 text-slate-600 dark:bg-white/[0.05] dark:text-slate-300")}>
        <div className="whitespace-pre-wrap break-words [overflow-wrap:anywhere]">{message.content}</div>
        <div className="mt-1 flex justify-end opacity-60 transition-opacity group-hover:opacity-100">
          <button
            type="button"
            onClick={() => void copyMessage()}
            className="rounded px-1.5 py-0.5 text-[11px] hover:bg-black/5 dark:hover:bg-white/10"
            title={isFinalPrompt ? "复制完整Prompt" : "复制消息"}
          >
            {copied ? "✓ 已复制" : isFinalPrompt ? "复制完整Prompt" : "复制"}
          </button>
        </div>
      </div>
    </div>
  );
}

function ResultHeader({ title, copied, onCopy, onSave, onRegenerate, onHistory, onBack }: { title: string; copied: boolean; onCopy: () => void; onSave: () => void; onRegenerate: () => void; onHistory: () => void; onBack: () => void }) {
  return <header className="mb-4 flex shrink-0 flex-wrap items-center justify-between gap-3"><div className="flex items-center gap-3"><Button size="icon" variant="ghost" onClick={onBack} title="返回素材与对话"><ChevronLeft className="h-5 w-5" /></Button><div><div className="text-xs font-medium tracking-[0.16em] text-brand">AI 内容中台 / 复刻提示词</div><h1 className="mt-1 text-xl font-semibold text-slate-950 dark:text-slate-100">{title}</h1></div></div><div className="flex flex-wrap items-center gap-1"><Button size="sm" variant="ghost" onClick={onCopy}><Copy className="h-4 w-4" />{copied ? "已复制" : "一键全复制"}</Button><Button size="sm" variant="ghost" onClick={onSave}>保存版本</Button><Button size="sm" variant="ghost" onClick={onRegenerate}><RefreshCw className="h-4 w-4" />重新生成</Button><Button size="sm" variant="outline" onClick={onHistory}><History className="h-4 w-4" />历史版本 / 任务</Button></div></header>;
}

function HistoryDrawer({ items, onClose, onOpen }: { items: ReplicaTask[]; onClose: () => void; onOpen: (task: ReplicaTask) => void }) {
  return <div className="fixed inset-0 z-50 bg-slate-950/20 backdrop-blur-[1px]" onClick={onClose}><aside className="absolute right-0 top-0 flex h-full w-full max-w-md flex-col border-l border-slate-200 bg-white p-5 shadow-2xl dark:border-white/[0.08] dark:bg-[#101521]" onClick={(event) => event.stopPropagation()}><div className="flex items-center justify-between"><div><div className="text-xs text-slate-400">爆款复刻</div><div className="mt-1 text-lg font-semibold text-slate-950 dark:text-slate-100">历史任务</div></div><Button size="icon" variant="ghost" onClick={onClose}><X className="h-4 w-4" /></Button></div><div className="mt-5 min-h-0 flex-1 space-y-2 overflow-y-auto scrollbar-subtle">{items.length ? items.map((item) => <button key={item.id} type="button" onClick={() => onOpen(item)} className="w-full rounded-xl border border-slate-200/80 p-3 text-left transition-colors hover:border-brand/50 hover:bg-brand/[0.03] dark:border-white/[0.08] dark:hover:bg-brand/[0.05]"><div className="flex items-center justify-between gap-3"><span className="truncate text-sm font-medium text-slate-800 dark:text-slate-200">{item.title}</span><span className="shrink-0 text-[11px] text-slate-400">{item.analysisProgress?.status === "completed" ? "Video DNA 已完成" : item.analysisProgress?.status === "stalled" ? "分析似乎已暂停" : activeStatuses.includes(item.status) ? `处理中${item.analysisProgress ? ` · ${analysisProgressText(item.analysisProgress)}` : ""}` : item.status === "failed" ? "分析失败" : `V${item.versions.length}`}</span></div><div className="mt-1 flex items-center gap-2 text-xs text-slate-400"><Clock3 className="h-3.5 w-3.5" />{formatDateTime(item.updatedAt)}<span>·</span><span className="truncate">{item.video.name || "未命名视频"}</span></div></button>) : <div className="rounded-xl border border-dashed border-slate-200 p-6 text-center text-sm text-slate-400 dark:border-white/[0.1]">完成一次复刻后，这里会保留历史版本。</div>}</div></aside></div>;
}

function formatFileSize(size: number) {
  if (!size) return "0 KB";
  if (size >= 1024 * 1024 * 1024) return `${(size / 1024 / 1024 / 1024).toFixed(1)} GB`;
  if (size >= 1024 * 1024) return `${(size / 1024 / 1024).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(size / 1024))} KB`;
}

function formatDuration(seconds: number) {
  if (!seconds || !Number.isFinite(seconds)) return "时长读取中";
  const minutes = Math.floor(seconds / 60);
  return `${String(minutes).padStart(2, "0")}:${String(Math.max(0, Math.floor(seconds % 60))).padStart(2, "0")}`;
}

function formatDateTime(value: string) {
  try { return new Date(value).toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }); } catch { return "刚刚"; }
}
