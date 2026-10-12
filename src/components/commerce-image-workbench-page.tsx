"use client";

import Link from "next/link";
import {
  ArrowDown, ArrowLeftRight, ArrowUp, ChevronDown, ChevronLeft, ChevronRight, Copy, Download,
  FileImage, FileText, History, Images, Loader2, MessageSquare, Minus, Package, Paperclip, Pause,
  Plus, Redo2, RefreshCw, Scissors, Settings, Sparkles, Trash2, Undo2, Upload, WandSparkles,
  X, ZoomIn, ZoomOut
} from "lucide-react";
import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { imagePromptDraftStorageKey } from "@/lib/asset-reuse-client";
import {
  commerceImageModelOptions,
  commerceImageModelRegistry,
  commerceImageRatioOrder,
  commerceImageRatioSizes,
  commerceImageTaskLabels
} from "@/lib/commerce-image-models";
import { createProductReferenceSnapshot } from "@/lib/product-reference";
import { getProductRecords } from "@/lib/pipeline-storage";
import { createAsset } from "@/lib/stores/asset-store";
import type { ProductRecord, ProductReferenceSnapshot } from "@/lib/pipeline-types";
import type {
  CommerceImageAsset,
  CommerceImageChatMessage,
  CommerceImageQuality,
  CommerceImageAssetRole,
  CommerceImageMarketingStrategy,
  CommerceImageModel,
  CommerceImageOutputRatio,
  CommerceImagePanel,
  CommerceImageRatio,
  CommerceImageRetouchOperation,
  CommerceImageStyleSkill,
  CommerceImageStoryboard,
  CommerceImageTask,
  CommerceImageTaskKind,
  CommerceImageTextLayer,
  ResolvedCommerceImageModel
} from "@/lib/commerce-image-types";

const lastPlatformKey = "director-platform:commerce-image:last-platform";
const commerceCanvasZoomKey = "director-platform:commerce-image:canvas-zoom-v3";
/* 商品素材不再让用户选择角色：上传的图统一按「真实商品参考图」处理。
 * 角色字段在底层数据结构中保留（旧任务、对标长图、风格 Skill 仍需它）。 */
const PRODUCT_UPLOAD_ROLE: CommerceImageAssetRole = "front";

function assetRoleLabel(role: CommerceImageAssetRole) {
  if (role === "benchmark_reference") return "对标长图";
  if (role === "style_reference") return "风格参考";
  if (role === "reference_segment") return "对标切片";
  if (role === "skill_reference") return "Skill 参考";
  return "商品图";
}
const strategyOptions: Array<{ label: string; value: CommerceImageMarketingStrategy }> = [
  { label: "AI 自动推荐", value: "auto" },
  { label: "买家痛点", value: "pain_point" },
  { label: "强对比", value: "contrast" },
  { label: "场景种草", value: "scenario" },
  { label: "情绪共鸣", value: "emotion" },
  { label: "清单／知识型", value: "listicle" },
  { label: "测评／证据型", value: "evidence" },
  { label: "导入的风格 Skill", value: "custom_skill" }
];
const retouchOptions: Array<{ label: string; value: CommerceImageRetouchOperation }> = [
  { label: "白底精修", value: "white_background" },
  { label: "透明底抠图", value: "transparent_background" },
  { label: "更换场景", value: "change_scene" },
  { label: "去除杂物", value: "remove_clutter" },
  { label: "光线与色彩校正", value: "light_color" },
  { label: "清晰度增强", value: "upscale" },
  { label: "构图裁切", value: "crop" },
  { label: "批量视觉统一", value: "batch_consistency" }
];
const statusLabels: Record<CommerceImageTask["status"], string> = {
  draft: "草稿", awaiting_input: "等待补充", planning: "AI 理解中", awaiting_approval: "准备完成", queued: "排队中",
  generating: "生成中", partial: "部分完成", completed: "已完成", failed: "失败", cancelled: "已停止"
};

type Draft = {
  kind: CommerceImageTaskKind;
  productId: string;
  productName: string;
  productSnapshot?: ProductReferenceSnapshot;
  model: CommerceImageModel;
  ratio: CommerceImageOutputRatio;
  audience: string;
  sellingPoints: string;
  scene: string;
  style: string;
  extra: string;
  strategy: CommerceImageMarketingStrategy;
  cardCount: number;
  quality: CommerceImageQuality;
  retouchOperation: CommerceImageRetouchOperation;
};

const defaultDraft: Draft = {
  kind: "xiaohongshu_post",
  productId: "",
  productName: "",
  model: "auto",
  ratio: "3:4",
  audience: "",
  sellingPoints: "",
  scene: "",
  style: "真实商品质感、信息清晰、适合电商转化",
  extra: "",
  strategy: "auto",
  cardCount: 4,
  quality: "high",
  retouchOperation: "white_background"
};

type LayerHistoryEntry = {
  panelId: string;
  before: CommerceImageTextLayer[];
  after: CommerceImageTextLayer[];
};

export function CommerceImageWorkbenchPage() {
  const [tasks, setTasks] = useState<CommerceImageTask[]>([]);
  const [task, setTask] = useState<CommerceImageTask | null>(null);
  const [products, setProducts] = useState<ProductRecord[]>([]);
  const [styleSkills, setStyleSkills] = useState<CommerceImageStyleSkill[]>([]);
  const [draft, setDraft] = useState<Draft>(defaultDraft);
  const [selectedPanelId, setSelectedPanelId] = useState("");
  const [selectedLayerId, setSelectedLayerId] = useState("");
  const [selectedSkillId, setSelectedSkillId] = useState("");
  const [chatInput, setChatInput] = useState("");
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");
  const [historyVisible, setHistoryVisible] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [zoom, setZoom] = useState(100);
  const taskRef = useRef<CommerceImageTask | null>(null);
  const autoSaveTimer = useRef<number | null>(null);
  const pendingPanelSaves = useRef(new Map<string, CommerceImagePanel>());
  const editRevision = useRef(0);
  const undoStack = useRef<LayerHistoryEntry[]>([]);
  const redoStack = useRef<LayerHistoryEntry[]>([]);
  const benchmarkInput = useRef<HTMLInputElement>(null);
  const productInput = useRef<HTMLInputElement>(null);
  const documentInput = useRef<HTMLInputElement>(null);
  const skillInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const records = getProductRecords();
    setProducts(records);
    hydrateLegacyDraft(records, setDraft);
    const lastPlatform = window.localStorage.getItem(lastPlatformKey);
    if (lastPlatform === "douyin_post" || lastPlatform === "xiaohongshu_post") {
      setDraft((current) => ({ ...current, kind: lastPlatform, cardCount: lastPlatform === "xiaohongshu_post" ? 4 : 5 }));
    }
    const savedZoom = Number(window.localStorage.getItem(commerceCanvasZoomKey));
    if (Number.isFinite(savedZoom)) setZoom(clamp(savedZoom, 25, 300));
    void loadInitial();
  }, []);

  useEffect(() => {
    window.localStorage.setItem(commerceCanvasZoomKey, String(zoom));
  }, [zoom]);

  useEffect(() => {
    function handleZoomShortcut(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      if (target?.closest("input, textarea, select, [contenteditable='true']")) return;
      if (!(event.metaKey || event.ctrlKey)) return;
      if (event.key === "+" || event.key === "=") {
        event.preventDefault();
        setZoom((value) => clamp(value + 10, 25, 300));
      } else if (event.key === "-") {
        event.preventDefault();
        setZoom((value) => clamp(value - 10, 25, 300));
      } else if (event.key === "0") {
        event.preventDefault();
        setZoom(100);
      }
    }
    window.addEventListener("keydown", handleZoomShortcut);
    return () => window.removeEventListener("keydown", handleZoomShortcut);
  }, []);

  useEffect(() => {
    taskRef.current = task;
    if (task && !selectedPanelId && task.panels.length) setSelectedPanelId(task.panels[0].id);
  }, [task, selectedPanelId]);

  useEffect(() => {
    if (!task || !["planning", "queued", "generating"].includes(task.status)) return;
    const timer = window.setInterval(() => void refreshTask(task.id, false), 1400);
    return () => window.clearInterval(timer);
  }, [task?.id, task?.status]);

  useEffect(() => () => {
    if (autoSaveTimer.current) window.clearTimeout(autoSaveTimer.current);
  }, []);

  const selectedPanel = useMemo(
    () => task?.panels.find((panel) => panel.id === selectedPanelId) || task?.panels[0] || null,
    [task, selectedPanelId]
  );
  const selectedLayer = selectedPanel?.textLayers.find((layer) => layer.id === selectedLayerId) || null;
  const running = Boolean(task && ["planning", "queued", "generating"].includes(task.status));

  async function loadInitial() {
    try {
      const [taskPayload, skillPayload] = await Promise.all([
        requestJson<{ tasks: CommerceImageTask[] }>("/api/commerce-image/tasks"),
        requestJson<{ skills: CommerceImageStyleSkill[] }>("/api/commerce-image/style-skills")
      ]);
      setTasks(taskPayload.tasks || []);
      setStyleSkills(skillPayload.skills || []);
      const taskId = new URLSearchParams(window.location.search).get("task");
      const found = taskPayload.tasks?.find((item) => item.id === taskId);
      if (found) installTask(found, false);
    } catch (error) {
      setMessage(errorMessage(error));
    }
  }

  function installTask(next: CommerceImageTask, updateList = true) {
    taskRef.current = next;
    setTask(next);
    if (updateList) {
      setTasks((current) => [next, ...current.filter((item) => item.id !== next.id)].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)));
    }
    if (!next.panels.some((panel) => panel.id === selectedPanelId)) {
      setSelectedPanelId(next.panels[0]?.id || "");
      setSelectedLayerId("");
    }
    syncProjectAsset(next);
  }

  function chooseProduct(productId: string) {
    const product = products.find((item) => item.id === productId);
    if (!product) {
      setDraft((current) => ({ ...current, productId: "", productSnapshot: undefined }));
      return;
    }
    const snapshot = createProductReferenceSnapshot(product);
    setDraft((current) => ({
      ...current,
      productId: product.id,
      productName: product.name,
      productSnapshot: snapshot,
      audience: snapshot.targetAudience || current.audience,
      sellingPoints: [snapshot.coreSellingPoints, snapshot.secondarySellingPoints].filter(Boolean).join("\n") || current.sellingPoints,
      scene: snapshot.useScenarios || current.scene
    }));
  }

  function choosePrimaryScene(kind: "detail_page" | "commerce_post" | "free_chat") {
    if (kind === "free_chat") {
      setDraft((current) => ({ ...current, kind: "free_chat", ratio: "1:1", cardCount: 1 }));
      return;
    }
    if (kind === "detail_page") {
      setDraft((current) => ({ ...current, kind: "detail_page", ratio: "3:4", cardCount: 6 }));
      return;
    }
    const last = window.localStorage.getItem(lastPlatformKey);
    const platform = last === "douyin_post" ? "douyin_post" : "xiaohongshu_post";
    setDraft((current) => ({ ...current, kind: platform, ratio: "3:4", cardCount: platform === "xiaohongshu_post" ? 4 : 5 }));
  }

  function choosePlatform(kind: "douyin_post" | "xiaohongshu_post") {
    window.localStorage.setItem(lastPlatformKey, kind);
    setDraft((current) => ({ ...current, kind, cardCount: kind === "xiaohongshu_post" ? clamp(current.cardCount, 1, 9) : Math.min(6, current.cardCount) }));
  }

  async function createTask() {
    setBusy("create");
    setMessage("");
    try {
      const payload = await requestJson<{ task: CommerceImageTask }>("/api/commerce-image/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind: draft.kind,
          title: `${draft.productName || "未命名商品"} · ${commerceImageTaskLabels[draft.kind].title}`,
          productId: draft.productId,
          productName: draft.productName,
          productSnapshot: draft.productSnapshot,
          model: draft.model,
          ratio: draft.ratio,
          generationSetCount: 1,
          brief: {
            audience: draft.audience,
            sellingPoints: draft.sellingPoints,
            scene: draft.scene,
            style: draft.style,
            extra: draft.extra,
            strategy: draft.strategy,
            cardCount: draft.cardCount,
            quality: draft.quality,
            retouchOperation: draft.retouchOperation
          }
        })
      });
      installTask(payload.task);
      window.history.replaceState(null, "", `/image-generator?task=${encodeURIComponent(payload.task.id)}`);
      setMessage(payload.task.kind === "xiaohongshu_post" ? "项目已创建。上传商品素材后，先确认四图故事线，再生成整组图片。" : "项目已创建。上传素材、写下要求，然后直接点击生成图片。");
    } catch (error) {
      setMessage(errorMessage(error));
    } finally {
      setBusy("");
    }
  }

  function openTask(next: CommerceImageTask) {
    installTask(next, false);
    setHistoryVisible(false);
    window.history.replaceState(null, "", `/image-generator?task=${encodeURIComponent(next.id)}`);
  }

  function newTask() {
    setTask(null);
    taskRef.current = null;
    setSelectedPanelId("");
    setSelectedLayerId("");
    setMessage("");
    window.history.replaceState(null, "", "/image-generator");
  }

  async function refreshTask(taskId: string, notify = true) {
    try {
      const payload = await requestJson<{ task: CommerceImageTask }>(`/api/commerce-image/tasks/${encodeURIComponent(taskId)}`);
      installTask(payload.task);
      if (notify) setMessage("项目状态已刷新。");
    } catch (error) {
      if (notify) setMessage(errorMessage(error));
    }
  }

  async function saveTask(showMessage = false) {
    const current = taskRef.current;
    if (!current) return null;
    if (autoSaveTimer.current) window.clearTimeout(autoSaveTimer.current);
    pendingPanelSaves.current.clear();
    try {
      const payload = await requestJson<{ task: CommerceImageTask }>(`/api/commerce-image/tasks/${encodeURIComponent(current.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(editableTaskPayload(current))
      });
      installTask(payload.task);
      if (showMessage) setMessage("修改已保存。");
      return payload.task;
    } catch (error) {
      setMessage(errorMessage(error));
      return null;
    }
  }

  function patchTaskLocal(updater: (current: CommerceImageTask) => CommerceImageTask) {
    setTask((current) => {
      if (!current) return current;
      const next = updater(current);
      taskRef.current = next;
      return next;
    });
  }

  async function uploadImages(files: FileList | null, role: CommerceImageAssetRole) {
    let current = taskRef.current;
    if (!current || !files?.length) return;
    const ownCount = ownProductAssets(current).length;
    if (isProductRole(role) && ownCount + files.length > 8) {
      setMessage("自己的商品图最多 8 张，请先删除不需要的图片。");
      return;
    }
    setBusy(`upload:${role}`);
    try {
      const saved = await saveTask();
      if (!saved) return;
      current = saved;
      const form = new FormData();
      Array.from(files).forEach((file) => form.append("images", file));
      form.set("role", role);
      form.set("saveToProductProfile", role === "style_reference" || role === "benchmark_reference" ? "false" : "true");
      const payload = await requestJson<{ task: CommerceImageTask; message: string }>(`/api/commerce-image/tasks/${encodeURIComponent(current.id)}/assets`, { method: "POST", body: form });
      installTask(payload.task);
      setMessage(payload.message);
    } catch (error) {
      setMessage(errorMessage(error));
    } finally {
      if (benchmarkInput.current) benchmarkInput.current.value = "";
      if (productInput.current) productInput.current.value = "";
      setBusy("");
    }
  }

  async function removeAsset(assetId: string) {
    let current = taskRef.current;
    if (!current || !window.confirm("确定从当前项目删除这张素材吗？")) return;
    try {
      const saved = await saveTask();
      if (!saved) return;
      current = saved;
      const payload = await requestJson<{ task: CommerceImageTask }>(`/api/commerce-image/tasks/${encodeURIComponent(current.id)}/assets?assetId=${encodeURIComponent(assetId)}`, { method: "DELETE" });
      installTask(payload.task);
      setMessage("素材已移除。");
    } catch (error) {
      setMessage(errorMessage(error));
    }
  }

  async function uploadDocuments(files: FileList | null) {
    let current = taskRef.current;
    if (!current || !files?.length) return;
    setBusy("documents");
    try {
      const saved = await saveTask();
      if (!saved) return;
      current = saved;
      const form = new FormData();
      Array.from(files).forEach((file) => form.append("documents", file));
      const payload = await requestJson<{ task: CommerceImageTask; message: string }>(`/api/commerce-image/tasks/${encodeURIComponent(current.id)}/documents`, { method: "POST", body: form });
      installTask(payload.task);
      setMessage(payload.message);
    } catch (error) {
      setMessage(errorMessage(error));
    } finally {
      if (documentInput.current) documentInput.current.value = "";
      setBusy("");
    }
  }

  async function removeDocument(documentId: string) {
    let current = taskRef.current;
    if (!current || !window.confirm("确定从当前项目删除这份产品资料吗？")) return;
    try {
      const saved = await saveTask();
      if (!saved) return;
      current = saved;
      const payload = await requestJson<{ task: CommerceImageTask }>(`/api/commerce-image/tasks/${encodeURIComponent(current.id)}/documents?documentId=${encodeURIComponent(documentId)}`, { method: "DELETE" });
      installTask(payload.task);
    } catch (error) {
      setMessage(errorMessage(error));
    }
  }

  async function importStyleSkill(file: File | undefined) {
    if (!file) return;
    setBusy("skill-import");
    try {
      const form = new FormData();
      form.set("skill", file);
      const payload = await requestJson<{ skills: CommerceImageStyleSkill[]; skill: CommerceImageStyleSkill; message: string }>("/api/commerce-image/style-skills", { method: "POST", body: form });
      setStyleSkills(payload.skills);
      setSelectedSkillId(payload.skill.id);
      setMessage(payload.message);
    } catch (error) {
      setMessage(errorMessage(error));
    } finally {
      if (skillInput.current) skillInput.current.value = "";
      setBusy("");
    }
  }

  async function applyStyleSkill() {
    let current = taskRef.current;
    if (!current || !selectedSkillId) return;
    setBusy("skill-apply");
    try {
      const saved = await saveTask();
      if (!saved) return;
      current = saved;
      const payload = await requestJson<{ task: CommerceImageTask; message: string }>(`/api/commerce-image/tasks/${encodeURIComponent(current.id)}/style-skill`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ skillId: selectedSkillId })
      });
      installTask(payload.task);
      setMessage(payload.message);
    } catch (error) {
      setMessage(errorMessage(error));
    } finally {
      setBusy("");
    }
  }

  async function generate(panelIds?: string[]) {
    const current = taskRef.current;
    if (!current) return;
    if (current.kind === "xiaohongshu_post") {
      if (!panelIds?.length && current.storyboard?.status !== "confirmed") {
        if (current.status === "awaiting_approval" && current.panels.length) {
          await confirmStoryboardAndGenerate();
        } else {
          await prepareStoryboard();
        }
        return;
      }
      await generateConfirmedStoryboard(panelIds);
      return;
    }
    setBusy(panelIds?.length ? "regenerate" : "generate");
    const saved = await saveTask();
    if (!saved) {
      setBusy("");
      return;
    }
    try {
      const instruction = panelIds?.length ? "" : chatInput.trim();
      const payload = await requestJson<{ task: CommerceImageTask; message: string; started?: boolean }>(`/api/commerce-image/tasks/${encodeURIComponent(saved.id)}/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ panelIds, instruction, oneClick: true })
      });
      if (payload.started === false) {
        installTask(payload.task);
        setMessage(payload.message);
        return;
      }
      if (instruction) setChatInput("");
      installTask({ ...payload.task, status: panelIds?.length ? "queued" : "planning", progress: { completed: 0, total: Math.max(1, saved.brief.cardCount), currentPanelId: "", message: panelIds?.length ? "正在重新生成当前画面" : "AI 正在理解素材与需求", updatedAt: new Date().toISOString() } });
      setMessage(payload.message);
      await refreshTask(saved.id, false);
    } catch (error) {
      setMessage(errorMessage(error));
    } finally {
      setBusy("");
    }
  }

  async function prepareStoryboard() {
    const current = taskRef.current;
    if (!current) return;
    setBusy("storyboard");
    setMessage("");
    if (chatInput.trim()) {
      const theme = chatInput.trim().slice(0, 160);
      patchTaskLocal((value) => ({
        ...value,
        brief: { ...value.brief, extra: theme },
        storyboard: value.storyboard ? { ...value.storyboard, theme, status: "needs_revision", confirmedAt: "" } : value.storyboard
      }));
    }
    const saved = await saveTask();
    if (!saved) {
      setBusy("");
      return;
    }
    try {
      const payload = await requestJson<{ task: CommerceImageTask; message: string }>(`/api/commerce-image/tasks/${encodeURIComponent(saved.id)}/analyze`, { method: "POST" });
      installTask({ ...payload.task, status: "planning", progress: { completed: 0, total: 3, currentPanelId: "", message: "AI 正在整理四图故事线", updatedAt: new Date().toISOString() } });
      if (chatInput.trim()) setChatInput("");
      setMessage("正在先整理主题、四图顺序与统一视觉设定；确认后才会调用生图模型。");
      await refreshTask(saved.id, false);
    } catch (error) {
      setMessage(errorMessage(error));
    } finally {
      setBusy("");
    }
  }

  async function confirmStoryboardAndGenerate() {
    const current = taskRef.current;
    if (!current) return;
    setBusy("confirm-storyboard");
    const saved = await saveTask();
    if (!saved) {
      setBusy("");
      return;
    }
    try {
      const approved = await requestJson<{ task: CommerceImageTask; message: string }>(`/api/commerce-image/tasks/${encodeURIComponent(saved.id)}/approve`, { method: "POST" });
      const payload = await requestJson<{ task: CommerceImageTask; message: string; started?: boolean }>(`/api/commerce-image/tasks/${encodeURIComponent(saved.id)}/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ oneClick: false })
      });
      installTask({ ...approved.task, ...payload.task, status: payload.started === false ? payload.task.status : "queued", progress: { completed: 0, total: Math.max(1, approved.task.panels.length), currentPanelId: "", message: "故事线已确认，正在生成整组图片", updatedAt: new Date().toISOString() } });
      setMessage(payload.message);
      await refreshTask(saved.id, false);
    } catch (error) {
      setMessage(errorMessage(error));
    } finally {
      setBusy("");
    }
  }

  async function sendV4Message(planOnly = false) {
    const current = taskRef.current;
    if (!current || !chatInput.trim()) return;
    const message = chatInput.trim();
    setChatInput("");
    setBusy("v4-chat");
    setMessage("");
    try {
      const payload = await requestJson<{ task: CommerceImageTask; reply?: string; action?: string; runId?: string; planId?: string }>(
        `/api/commerce-image/tasks/${encodeURIComponent(current.id)}/v4-chat`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            message,
            mode: planOnly ? "plan_only" : "auto",
            requestId: `v4_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
          })
        }
      );
      installTask(payload.task);
      setMessage(payload.action === "plan" ? "AI 已完成规划，可点击\u201c生成图片\u201d执行。" : payload.reply || "已收到。");
      if (payload.runId && !planOnly && payload.action !== "discuss" && payload.action !== "clarify") {
        setBusy("v4-generate");
        try {
          const genPayload = await requestJson<{ task: CommerceImageTask; started: boolean; message: string }>(
            `/api/commerce-image/tasks/${encodeURIComponent(current.id)}/v4-generate`,
            { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({}) }
          );
          installTask(genPayload.task);
          setMessage(genPayload.message);
          await refreshTask(current.id, false);
        } catch { /* generate errors shown via task.error */ }
      }
    } catch (error) {
      setMessage(errorMessage(error));
      setChatInput(message);
    } finally {
      setBusy("");
    }
  }

  async function generateConfirmedStoryboard(panelIds?: string[]) {
    const current = taskRef.current;
    if (!current) return;
    setBusy(panelIds?.length ? "regenerate" : "generate");
    const saved = await saveTask();
    if (!saved) {
      setBusy("");
      return;
    }
    try {
      const payload = await requestJson<{ task: CommerceImageTask; message: string; started?: boolean }>(`/api/commerce-image/tasks/${encodeURIComponent(saved.id)}/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ panelIds, oneClick: false })
      });
      installTask(payload.started === false ? payload.task : { ...payload.task, status: "queued", progress: { completed: 0, total: panelIds?.length ? 1 : Math.max(1, saved.panels.length), currentPanelId: "", message: panelIds?.length ? "正在重新生成当前页面" : "正在生成已确认的小红书故事线", updatedAt: new Date().toISOString() } });
      setMessage(payload.message);
      await refreshTask(saved.id, false);
    } catch (error) {
      setMessage(errorMessage(error));
    } finally {
      setBusy("");
    }
  }

  async function stopGeneration() {
    const current = taskRef.current;
    if (!current) return;
    try {
      const payload = await requestJson<{ message: string }>(`/api/commerce-image/tasks/${encodeURIComponent(current.id)}/cancel`, { method: "POST" });
      setMessage(payload.message);
    } catch (error) {
      setMessage(errorMessage(error));
    }
  }

  async function selectSet(setId: string) {
    let current = taskRef.current;
    if (!current || setId === current.selectedSetId) return;
    try {
      const saved = await saveTask();
      if (!saved) return;
      current = saved;
      patchTaskLocal((value) => ({ ...value, selectedSetId: setId }));
      const payload = await requestJson<{ task: CommerceImageTask }>(`/api/commerce-image/tasks/${encodeURIComponent(current.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ selectedSetId: setId })
      });
      installTask(payload.task);
    } catch (error) {
      setMessage(errorMessage(error));
      await refreshTask(current.id, false);
    }
  }

  async function panelOperation(panelId: string, type: "delete" | "move_up" | "move_down" | "duplicate" | "merge_next") {
    let current = taskRef.current;
    if (!current) return;
    try {
      const saved = await saveTask();
      if (!saved) return;
      current = saved;
      const payload = await requestJson<{ task: CommerceImageTask }>(`/api/commerce-image/tasks/${encodeURIComponent(current.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ panelOperation: { panelId, type } })
      });
      installTask(payload.task);
      setMessage("页面结构已保存；点击生成图片时会自动使用最新方案。");
    } catch (error) {
      setMessage(errorMessage(error));
    }
  }

  async function adaptPlatform() {
    let current = taskRef.current;
    if (!current) return;
    setBusy("adapt");
    try {
      const saved = await saveTask();
      if (!saved) return;
      current = saved;
      const payload = await requestJson<{ task: CommerceImageTask; message: string }>(`/api/commerce-image/tasks/${encodeURIComponent(current.id)}/adapt`, { method: "POST" });
      installTask({ ...payload.task, status: "planning" });
      window.history.replaceState(null, "", `/image-generator?task=${encodeURIComponent(payload.task.id)}`);
      setMessage(payload.message);
    } catch (error) {
      setMessage(errorMessage(error));
    } finally {
      setBusy("");
    }
  }

  function previewLayers(panelId: string, layers: CommerceImageTextLayer[]) {
    patchTaskLocal((current) => ({
      ...current,
      panels: current.panels.map((panel) => panel.id === panelId ? { ...panel, textLayers: layers } : panel)
    }));
  }

  function commitLayers(panelId: string, before: CommerceImageTextLayer[], after: CommerceImageTextLayer[], record = true) {
    if (JSON.stringify(before) === JSON.stringify(after)) return;
    if (record) {
      undoStack.current.push({ panelId, before, after });
      if (undoStack.current.length > 80) undoStack.current.shift();
      redoStack.current = [];
    }
    previewLayers(panelId, after);
    const panel = taskRef.current?.panels.find((item) => item.id === panelId);
    schedulePanelAutoSave(panelId, panel ? { ...panel, textLayers: after } : undefined);
  }

  function schedulePanelAutoSave(panelId: string, override?: CommerceImagePanel) {
    const current = taskRef.current;
    const panel = override || current?.panels.find((item) => item.id === panelId);
    if (!current || !panel) return;
    pendingPanelSaves.current.set(panelId, panel);
    editRevision.current += 1;
    if (autoSaveTimer.current) window.clearTimeout(autoSaveTimer.current);
    autoSaveTimer.current = window.setTimeout(async () => {
      const live = taskRef.current;
      if (!live) return;
      const revision = editRevision.current;
      const panels = [...pendingPanelSaves.current.values()];
      pendingPanelSaves.current.clear();
      try {
        const payload = await requestJson<{ task: CommerceImageTask }>(`/api/commerce-image/tasks/${encodeURIComponent(live.id)}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ panels })
        });
        if (revision === editRevision.current) installTask(payload.task);
      } catch (error) {
        setMessage(`文字自动保存失败：${errorMessage(error)}`);
      }
    }, 500);
  }

  function undoTextEdit() {
    const entry = undoStack.current.pop();
    if (!entry) return;
    redoStack.current.push(entry);
    commitLayers(entry.panelId, entry.after, entry.before, false);
  }

  function redoTextEdit() {
    const entry = redoStack.current.pop();
    if (!entry) return;
    undoStack.current.push(entry);
    commitLayers(entry.panelId, entry.before, entry.after, false);
  }

  function selectVersion(panel: CommerceImagePanel, versionId: string) {
    const updated = { ...panel, selectedVersionId: versionId };
    patchTaskLocal((current) => ({
      ...current,
      panels: current.panels.map((item) => item.id === panel.id ? { ...item, selectedVersionId: versionId } : item)
    }));
    schedulePanelAutoSave(panel.id, updated);
  }

  function exportUrl(format: "zip" | "long" | "panel", panelId?: string) {
    const current = taskRef.current;
    if (!current) return "#";
    const params = new URLSearchParams({ format, setId: current.selectedSetId });
    if (panelId) params.set("panelId", panelId);
    return `/api/commerce-image/tasks/${encodeURIComponent(current.id)}/export?${params.toString()}`;
  }

  async function downloadExport(format: "zip" | "long" | "panel", panelId?: string) {
    if (!taskRef.current) return;
    setBusy("export");
    const saved = await saveTask();
    if (saved) {
      const link = document.createElement("a");
      const params = new URLSearchParams({ format, setId: saved.selectedSetId });
      if (panelId) params.set("panelId", panelId);
      link.href = `/api/commerce-image/tasks/${encodeURIComponent(saved.id)}/export?${params.toString()}`;
      link.click();
      setMessage("正在导出已保存的当前方案。");
    }
    setBusy("");
  }

  if (!task) {
    return (
      <div className="ui-shell desktop-page mx-auto max-w-6xl space-y-6 pb-10">
        <header className="flex items-start justify-between gap-4">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-brand-solid">AI 电商视觉</p>
            <h1 className="mt-2 text-[26px] font-semibold tracking-tight text-ink-1">先选一个真正要完成的场景</h1>
            <p className="mt-2 text-[13px] text-ink-2">选场景 → 填 4 个关键信息 → 进工作台；自然对话生图可以直接开聊。</p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => setHistoryVisible((value) => !value)}><History className="h-4 w-4" />历史项目</Button>
            <Button variant="outline" asChild><Link href="/settings"><Settings className="h-4 w-4" />模型设置</Link></Button>
          </div>
        </header>

        {historyVisible ? <HistoryDrawer tasks={tasks} onOpen={openTask} onClose={() => setHistoryVisible(false)} /> : null}

        <div className="grid gap-4 lg:grid-cols-3">
          <SceneCard
            active={draft.kind === "detail_page"}
            preview="detail"
            icon={<FileImage className="h-5 w-5" />}
            title="对标详情图复刻"
            description="上传对标长图和自己的商品，迁移版式、构图与视觉风格，卖点文字保持可编辑。"
            note="淘宝 / 天猫 / 抖店 详情页"
            onClick={() => choosePrimaryScene("detail_page")}
          />
          <SceneCard
            active={draft.kind === "douyin_post" || draft.kind === "xiaohongshu_post"}
            preview="post"
            icon={<Images className="h-5 w-5" />}
            title="小红书／抖音电商图文"
            description="围绕买家痛点、强对比、场景与证据组织整套图文，目标是停留、收藏和转化。"
            note="小红书图文、抖音图文"
            onClick={() => choosePrimaryScene("commerce_post")}
          />
          <SceneCard
            active={draft.kind === "free_chat"}
            preview="chat"
            icon={<MessageSquare className="h-5 w-5" />}
            title="自然对话生图"
            description="像 GPT 网页生图一样直接聊：打字说要什么效果就生成什么效果，文字原样交给 GPT Image 2.5。"
            note="快速出图、灵感尝试、自由创作"
            onClick={() => choosePrimaryScene("free_chat")}
          />
        </div>

        <section className="rounded-3xl border border-line bg-surface p-5">
          {draft.kind === "free_chat" ? (
            <div className="anim-fade-up">
              <div className="grid gap-4 lg:grid-cols-2">
                <Field label="生图模型">
                  <div className="flex h-10 items-center rounded-xl border border-brand-ring bg-brand-soft px-3 text-[13px] font-medium text-brand-solid">GPT Image 2.5（Sunburst）· 对话直连</div>
                </Field>
                <Field label="默认生图比例（对话中可随时切换）">
                  <Select value={draft.ratio} onChange={(event) => setDraft({ ...draft, ratio: event.target.value as CommerceImageOutputRatio })} options={ratioOptions("free_chat")} />
                </Field>
              </div>
              <p className="mt-4 rounded-xl bg-surface-2 px-4 py-3 text-[11px] leading-5 text-ink-2">
                进入后直接输入画面描述即可生图：可随消息附带参考图、切换比例与清晰度，并支持「基于上一张继续修改」；所有对话与图片自动保存在历史项目里。
              </p>
            </div>
          ) : (
            <div className="anim-fade-up">
              <div className="grid gap-4 lg:grid-cols-2">
                <Field label="商品名称">
                  <Input value={draft.productName} onChange={(event) => setDraft({ ...draft, productName: event.target.value })} placeholder="例如：轻量中长款羽绒服" />
                </Field>
                <Field label="使用场景">
                  <Input value={draft.scene} onChange={(event) => setDraft({ ...draft, scene: event.target.value })} placeholder="通勤、门店、居家等" />
                </Field>
                <Field label="目标人群"><Textarea value={draft.audience} onChange={(event) => setDraft({ ...draft, audience: event.target.value })} placeholder="谁会买，最在意什么" /></Field>
                <Field label="已知卖点"><Textarea value={draft.sellingPoints} onChange={(event) => setDraft({ ...draft, sellingPoints: event.target.value })} placeholder="一行一个，只写有资料依据的事实" /></Field>
              </div>

              <button
                type="button"
                aria-expanded={advancedOpen}
                onClick={() => setAdvancedOpen((value) => !value)}
                className="mt-4 inline-flex items-center gap-1.5 text-[12px] text-ink-2 transition-colors duration-[var(--dur-instant)] hover:text-ink-1"
              >
                高级设置（模型、比例、张数、清晰度、资料引用）
                <ChevronDown className={`h-3.5 w-3.5 transition-transform duration-[var(--dur-fast)] ${advancedOpen ? "rotate-180" : ""}`} />
              </button>

              {advancedOpen ? (
                <div className="anim-fade-up mt-4 space-y-4 rounded-2xl bg-surface-2 p-4">
                  <div className="grid gap-4 lg:grid-cols-2">
                    <Field label="引用已有商品资料">
                      <Select value={draft.productId} onChange={(event) => chooseProduct(event.target.value)} options={[{ label: "不引用，手动输入", value: "" }, ...products.map((item) => ({ label: item.name, value: item.id }))]} />
                    </Field>
                    <Field label="视觉方向"><Input value={draft.style} onChange={(event) => setDraft({ ...draft, style: event.target.value })} /></Field>
                  </div>
                  {(draft.kind === "xiaohongshu_post" || draft.kind === "douyin_post") ? (
                    <div>
                      <Label>发布平台</Label>
                      <div className="mt-2 flex gap-2">
                        <ChoiceButton active={draft.kind === "xiaohongshu_post"} onClick={() => choosePlatform("xiaohongshu_post")}>小红书</ChoiceButton>
                        <ChoiceButton active={draft.kind === "douyin_post"} onClick={() => choosePlatform("douyin_post")}>抖音</ChoiceButton>
                      </div>
                    </div>
                  ) : null}
                  <div className="grid gap-4 lg:grid-cols-2">
                    <Field label="生图模型"><Select value={draft.model} onChange={(event) => setDraft({ ...draft, model: event.target.value as CommerceImageModel })} options={commerceImageModelOptions.map((item) => ({ label: item.label, value: item.value }))} /></Field>
                    <Field label="生图比例"><Select value={draft.ratio} onChange={(event) => setDraft({ ...draft, ratio: event.target.value as CommerceImageOutputRatio })} options={ratioOptions(draft.kind)} /></Field>
                  </div>
                  <div className="grid gap-4 lg:grid-cols-2">
                    <Field label="生成张数"><Select value={String(draft.cardCount)} onChange={(event) => setDraft({ ...draft, cardCount: Number(event.target.value) })} options={outputCountOptions(draft.kind)} /></Field>
                    <Field label="清晰度"><Select value={draft.quality} onChange={(event) => setDraft({ ...draft, quality: event.target.value as CommerceImageQuality })} options={qualityOptionsForModel(draft.model)} /></Field>
                  </div>
                  {draft.kind === "retouch" ? <Field label="修图任务"><Select value={draft.retouchOperation} onChange={(event) => setDraft({ ...draft, retouchOperation: event.target.value as CommerceImageRetouchOperation })} options={retouchOptions} /></Field> : null}
                </div>
              ) : null}
            </div>
          )}

          <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4">
            <div className="flex flex-wrap gap-3">
              {draft.kind === "free_chat" ? (
                <button type="button" className="text-[11px] text-ink-3 underline-offset-4 transition-colors duration-[var(--dur-instant)] hover:text-ink-1 hover:underline" onClick={() => choosePrimaryScene("commerce_post")}>需要成套图文？切换到电商图文</button>
              ) : (
                <>
                  <button type="button" className="text-[11px] text-ink-3 underline-offset-4 transition-colors duration-[var(--dur-instant)] hover:text-ink-1 hover:underline" onClick={() => setDraft((current) => ({ ...current, kind: "retouch", ratio: "1:1" }))}>使用保留的商品精修入口</button>
                  <button type="button" className="text-[11px] text-brand-solid underline-offset-4 transition-colors duration-[var(--dur-instant)] hover:underline" onClick={() => choosePrimaryScene("free_chat")}>想直接对话生图？切换到自然对话生图</button>
                </>
              )}
            </div>
            <button
              type="button"
              onClick={createTask}
              disabled={busy === "create"}
              className="inline-flex items-center gap-1.5 rounded-full bg-brand-solid px-5 py-2 text-[13px] font-medium text-white transition-colors duration-[var(--dur-instant)] hover:bg-brand-hover disabled:opacity-40"
            >
              {busy === "create" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
              {draft.kind === "free_chat" ? "进入对话工作台" : "进入工作台"}
            </button>
          </div>
        </section>
        {message ? <Toast message={message} onClose={() => setMessage("")} /> : null}
      </div>
    );
  }

  if (task.kind === "free_chat") {
    return (
      <FreeChatWorkbench
        task={task}
        tasks={tasks}
        message={message}
        historyVisible={historyVisible}
        onToggleHistory={() => setHistoryVisible((value) => !value)}
        onCloseHistory={() => setHistoryVisible(false)}
        onOpenTask={openTask}
        onNewTask={newTask}
        onTaskUpdated={(next) => installTask(next, false)}
        onNotify={setMessage}
      />
    );
  }

  const benchmark = task.sourceAssets.find((asset) => asset.role === "benchmark_reference");
  const productsForTask = ownProductAssets(task);
  const displayedMaterials = task.sourceAssets.filter((asset) => isProductRole(asset.role) || asset.role === "style_reference");
  const isSocial = task.kind === "douyin_post" || task.kind === "xiaohongshu_post";
  const isXiaohongshu = task.kind === "xiaohongshu_post";
  const storyAwaitingConfirmation = isXiaohongshu && task.status === "awaiting_approval" && task.storyboard?.status !== "confirmed" && task.panels.length > 0;
  const primaryActionLabel = isXiaohongshu
    ? storyAwaitingConfirmation ? "确认故事线并生成" : task.storyboard?.status === "confirmed" ? "生成图片" : "先生成故事线"
    : "生成图片";
  const needsModelAttention = Boolean(task.error) && (
    ["configuration", "authorization", "model_access", "quota"].includes(task.lastError?.category || "")
    || /API\s*Key|模型|余额|额度|权限|鉴权/i.test(task.error)
  );

  return (
    <div className="ui-shell desktop-page flex h-[calc(100dvh-8.5rem)] min-h-[650px] flex-col overflow-hidden">
      <header className="mb-3 flex shrink-0 items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <Button size="sm" variant="ghost" onClick={newTask}><ChevronLeft className="h-4 w-4" />新建</Button>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h1 className="truncate text-[15px] font-semibold text-ink-1">{task.title}</h1>
              <Badge variant="secondary">{statusLabels[task.status]}</Badge>
            </div>
            <p className="truncate text-[11px] text-ink-3">{task.kind === "detail_page" ? "对标详情图复刻" : task.kind === "xiaohongshu_post" ? "小红书电商图文" : task.kind === "douyin_post" ? "抖音电商图文" : "商品精修（兼容模式）"}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" onClick={() => setHistoryVisible((value) => !value)}><History className="h-4 w-4" />历史</Button>
          <Button size="sm" variant="outline" asChild><Link href="/settings"><Settings className="h-4 w-4" />设置</Link></Button>
        </div>
      </header>

      {historyVisible ? <HistoryDrawer tasks={tasks} onOpen={openTask} onClose={() => setHistoryVisible(false)} compact /> : null}

      <div className="grid min-h-0 flex-1 gap-3 xl:grid-cols-[430px_minmax(0,1fr)]">
        <aside className="flex min-h-0 flex-col overflow-hidden rounded-2xl border border-line bg-surface">
          <div className="shrink-0 border-b border-slate-200/70 px-4 py-3 dark:border-slate-800">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-sm font-semibold">素材、资料与 AI 沟通</h2>
                <p className="mt-0.5 text-[11px] text-slate-500">素材只保存在本机项目目录</p>
              </div>
              <Badge variant="secondary">{productsForTask.length}/8 商品图</Badge>
            </div>
          </div>

          <div className="shrink-0 space-y-3 px-4 py-3">
            {task.kind === "detail_page" ? (
              <MaterialRow
                title="对标详情长图"
                hint="1 张，替换时自动覆盖旧对标"
                action={<Button size="sm" variant="outline" onClick={() => benchmarkInput.current?.click()} disabled={running}><Upload className="h-3.5 w-3.5" />{benchmark ? "替换" : "上传"}</Button>}
              >
                <input ref={benchmarkInput} hidden type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => void uploadImages(event.target.files, "benchmark_reference")} />
                {benchmark ? <AssetChip asset={benchmark} onRemove={() => void removeAsset(benchmark.id)} /> : <EmptyMaterial icon={<FileImage className="h-4 w-4" />} text="用于分析构图、色彩、留白和模块结构" />}
              </MaterialRow>
            ) : null}
            <MaterialRow
              title="自己的商品"
              hint="1–8 张，衣服样式以你上传的图为准"
              action={<Button size="sm" variant="outline" onClick={() => productInput.current?.click()} disabled={running || productsForTask.length >= 8}><Plus className="h-3.5 w-3.5" />添加</Button>}
            >
              <input ref={productInput} hidden multiple type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => void uploadImages(event.target.files, PRODUCT_UPLOAD_ROLE)} />
              {displayedMaterials.length ? <div className="flex gap-2 overflow-x-auto pb-1">{displayedMaterials.map((asset) => <AssetChip key={asset.id} asset={asset} onRemove={() => void removeAsset(asset.id)} />)}</div> : <EmptyMaterial icon={<Package className="h-4 w-4" />} text="上传商品参考图（1–8 张），生成的衣服样式会严格按这里的图来" />}
            </MaterialRow>
            <MaterialRow
              title="产品资料"
              hint="Word、Markdown、TXT，最多 5 份"
              action={<Button size="sm" variant="outline" onClick={() => documentInput.current?.click()} disabled={running || task.documents.length >= 5}><FileText className="h-3.5 w-3.5" />添加资料</Button>}
            >
              <input ref={documentInput} hidden multiple type="file" accept=".docx,.doc,.md,.markdown,.txt,text/plain,text/markdown,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/msword" onChange={(event) => void uploadDocuments(event.target.files)} />
              {task.documents.length ? <div className="flex flex-wrap gap-1.5">{task.documents.map((document) => <span key={document.id} className="inline-flex items-center gap-1 rounded-lg bg-slate-100 px-2 py-1 text-[11px] text-slate-600 dark:bg-slate-900 dark:text-slate-300"><FileText className="h-3 w-3" />{document.name}<button type="button" onClick={() => void removeDocument(document.id)}><X className="h-3 w-3" /></button></span>)}</div> : <EmptyMaterial icon={<FileText className="h-4 w-4" />} text="资料会被提取为有来源的商品事实" />}
            </MaterialRow>
          </div>

          <section className="mx-4 mb-3 flex min-h-[220px] flex-1 flex-col overflow-hidden rounded-2xl border border-border bg-muted/40">
            <div className="flex shrink-0 items-center justify-between border-b border-border px-3 py-2">
              <div className="flex items-center gap-2 text-xs font-semibold text-foreground"><MessageSquare className="h-4 w-4" />AI 需求沟通</div>
              <span className="text-[10px] text-slate-400">对话可修改结构与文案</span>
            </div>
            <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-3">
              {!task.chatMessages.length ? (
                <div className="rounded-xl bg-white/75 p-3 text-xs leading-5 text-slate-500 dark:bg-slate-950/60">
                  告诉 AI 你想要的受众、场景、卖点与情绪。{task.kind === "xiaohongshu_post" ? "小红书会先把它整理成连续的故事线，等你确认后才开始生图。" : "点击下方“生成图片”后，AI 会自动理解这段要求并直接开始生图。"}
                </div>
              ) : task.chatMessages.map((chat) => (
                <div key={chat.id} className={`max-w-[92%] rounded-2xl px-3 py-2 text-xs leading-5 ${chat.role === "user" ? "ml-auto bg-brand text-brand-foreground" : "bg-card text-foreground"}`}>{chat.content}</div>
              ))}
            </div>
            <div className="shrink-0 border-t border-border p-2">
              <Textarea
                className="min-h-24 resize-y bg-white dark:bg-slate-950"
                value={chatInput}
                onChange={(event) => setChatInput(event.target.value)}
                placeholder={task.workflowVersion === "conversation-v4"
                  ? "直接说出你的创作需求，AI 会自动规划并生成。例如：给这件红色羽绒服做一组回家过年的小红书图片，要有生活感……"
                  : task.kind === "xiaohongshu_post" ? "例如：穿红色羽绒服回家过年；第一张抓情绪，后面用真实细节收尾……" : "例如：前两屏先讲通勤保暖痛点，卖点文字更克制；把材质细节拆成一屏……"}
              />
              <div className="mt-2 flex items-center gap-2">
                {task.workflowVersion === "conversation-v4" || isSocial ? (
                  <>
                    <Button size="sm" onClick={() => void sendV4Message(false)} disabled={!chatInput.trim() || busy === "v4-chat" || busy === "v4-generate" || running}>
                      {busy === "v4-chat" ? <><Loader2 className="h-3.5 w-3.5 animate-spin" /> 理解中</> : <><Sparkles className="h-3.5 w-3.5" /> AI 创作</>}
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => void sendV4Message(true)} disabled={!chatInput.trim() || busy === "v4-chat" || running}>
                      先出方案
                    </Button>
                  </>
                ) : null}
              </div>
              <p className="mt-1 text-[10px] text-slate-400">{task.workflowVersion === "conversation-v4" ? "对话式创作：直接表达需求，AI 自主规划并生成。" : `无需单独发送；${task.kind === "xiaohongshu_post" ? "内容会随\u201c先生成故事线\u201d一起进入方案。" : "内容会随\u201c生成图片\u201d一起提交。"}`}</p>
            </div>
          </section>

          <div className="shrink-0 space-y-2 border-t border-slate-200/70 bg-slate-50/70 px-4 py-3 dark:border-slate-800 dark:bg-slate-900/45">
            {isSocial ? (
              <div>
                <Select value={task.brief.strategy} onChange={(event) => patchTaskLocal((current) => ({ ...current, brief: { ...current.brief, strategy: event.target.value as CommerceImageMarketingStrategy } }))} options={strategyOptions} />
              </div>
            ) : null}
            {isSocial ? (
              <div className="flex gap-2">
                <Select className="min-w-0 flex-1" value={selectedSkillId} onChange={(event) => setSelectedSkillId(event.target.value)} options={[{ label: task.strategySnapshot ? `已用：${task.strategySnapshot.name}` : "选择本机风格 Skill", value: "" }, ...styleSkills.filter((skill) => skill.enabled).map((skill) => ({ label: `${skill.name} · ${skill.version}`, value: skill.id }))]} />
                <Button size="sm" variant="outline" onClick={applyStyleSkill} disabled={!selectedSkillId || running}>应用</Button>
                <Button size="sm" variant="ghost" onClick={() => skillInput.current?.click()} disabled={running}><Upload className="h-4 w-4" /></Button>
                <input ref={skillInput} hidden type="file" accept=".md,.markdown,.zip,text/markdown,application/zip" onChange={(event) => void importStyleSkill(event.target.files?.[0])} />
              </div>
            ) : null}
            <div className="grid grid-cols-2 gap-2">
              <Field label="生图模型" compact><Select value={task.model} onChange={(event) => patchTaskLocal((current) => ({ ...current, model: event.target.value as CommerceImageModel }))} options={commerceImageModelOptions.map((item) => ({ label: item.label, value: item.value }))} /></Field>
              <Field label="比例" compact><Select value={task.ratio} onChange={(event) => patchTaskLocal((current) => ({ ...current, ratio: event.target.value as CommerceImageOutputRatio }))} options={ratioOptions(task.kind, true)} /></Field>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <Field label="生成张数" compact><Select value={String(task.brief.cardCount)} onChange={(event) => patchTaskLocal((current) => ({ ...current, brief: { ...current.brief, cardCount: Number(event.target.value) } }))} options={outputCountOptions(task.kind)} /></Field>
              <Field label="清晰度" compact><Select value={task.quality || "high"} onChange={(event) => patchTaskLocal((current) => ({ ...current, quality: event.target.value as CommerceImageQuality }))} options={qualityOptionsForModel(task.model)} /></Field>
            </div>
          </div>
        </aside>

        <main className="relative flex min-h-0 flex-col overflow-hidden rounded-3xl border border-slate-200/80 bg-slate-100/65 shadow-sm dark:border-slate-800 dark:bg-slate-900/45">
          <div className="z-20 flex shrink-0 items-center justify-between gap-3 border-b border-slate-200/80 bg-white/90 px-4 py-2.5 backdrop-blur dark:border-slate-800 dark:bg-slate-950/90">
            <div className="min-w-0">
              <h2 className="text-sm font-semibold">{task.kind === "detail_page" ? "对标图与生成结果" : "整套图文编辑器"}</h2>
              <p className="truncate text-[11px] text-slate-500">{task.panels.length ? `${task.panels.length} 张图片 · 文字可继续编辑` : "点击一次生成，AI 会自动完成理解、规划和生图"}</p>
            </div>
            <div className="flex items-center gap-1.5">
              <Button size="sm" variant="ghost" title="缩小（⌘/Ctrl -）" onClick={() => setZoom((value) => clamp(value - 10, 25, 300))}><ZoomOut className="h-4 w-4" /></Button>
              <input aria-label="画布缩放比例" className="h-7 w-14 rounded-md border border-slate-200 bg-white px-1 text-center text-xs tabular-nums dark:border-slate-800 dark:bg-slate-950" type="number" min="25" max="300" value={zoom} onChange={(event) => setZoom(clamp(Number(event.target.value) || 25, 25, 300))} />
              <span className="-ml-1 text-xs text-slate-400">%</span>
              <input aria-label="拖动调整画布缩放" className="hidden w-20 accent-accent lg:block" type="range" min="25" max="300" step="1" value={zoom} onChange={(event) => setZoom(Number(event.target.value))} />
              <Button size="sm" variant="ghost" title="放大（⌘/Ctrl +）" onClick={() => setZoom((value) => clamp(value + 10, 25, 300))}><ZoomIn className="h-4 w-4" /></Button>
              <Button size="sm" variant="ghost" onClick={() => setZoom(100)}>适应宽度</Button>
              <Button size="sm" variant="ghost" title="100%（⌘/Ctrl 0）" onClick={() => setZoom(100)}>100%</Button>
              {task.generationSets.length > 1 ? <div className="ml-2 flex rounded-xl bg-slate-100 p-1 dark:bg-slate-900">{task.generationSets.map((set) => <button type="button" key={set.id} onClick={() => void selectSet(set.id)} className={`rounded-lg px-2.5 py-1 text-xs transition ${task.selectedSetId === set.id ? "bg-card font-semibold text-foreground shadow-sm" : "text-muted-foreground"}`}>{set.label}</button>)}</div> : null}
            </div>
          </div>

          {selectedLayer && selectedPanel ? (
            <TextLayerToolbar
              layer={selectedLayer}
              onChange={(patch) => {
                const before = selectedPanel.textLayers;
                const after = before.map((layer) => layer.id === selectedLayer.id ? { ...layer, ...patch } : layer);
                commitLayers(selectedPanel.id, before, after);
              }}
              onUndo={undoTextEdit}
              onRedo={redoTextEdit}
            />
          ) : null}

          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
            {!task.panels.length ? (
              <EmptyCanvas task={task} />
            ) : isXiaohongshu && task.storyboard && task.storyboard.status !== "confirmed" ? (
              <XiaohongshuStoryboardReview
                task={task}
                onChange={(updater) => patchTaskLocal((current) => ({ ...current, storyboard: current.storyboard ? updater(current.storyboard) : current.storyboard }))}
                onSave={() => void saveTask(true)}
                onOperation={(panelId, type) => void panelOperation(panelId, type)}
                onGeneratePlan={() => void prepareStoryboard()}
                onConfirm={() => void confirmStoryboardAndGenerate()}
                busy={busy}
              />
            ) : task.kind === "detail_page" ? (
              <DetailEditor
                task={task}
                zoom={zoom}
                selectedPanelId={selectedPanelId}
                selectedLayerId={selectedLayerId}
                onSelectPanel={setSelectedPanelId}
                onSelectLayer={setSelectedLayerId}
                onPreviewLayers={previewLayers}
                onCommitLayers={commitLayers}
                onOperation={panelOperation}
              />
            ) : (
              <div className="flex h-full flex-col">
                {task.workflowVersion === "conversation-v4" && task.creative?.plans.length ? <V4CreativePlanDisplay task={task} /> : null}
                <div className="min-h-0 flex-1 overflow-hidden">
                  <SocialEditor
                    task={task}
                    zoom={zoom}
                    selectedPanelId={selectedPanelId}
                    selectedLayerId={selectedLayerId}
                    onSelectPanel={setSelectedPanelId}
                    onSelectLayer={setSelectedLayerId}
                    onPreviewLayers={previewLayers}
                    onCommitLayers={commitLayers}
                    onSelectVersion={selectVersion}
                    onZoom={(next) => setZoom(clamp(next, 25, 300))}
                    onPublishChange={(patch) => patchTaskLocal((current) => ({ ...current, publishPackage: { ...current.publishPackage, ...patch } }))}
                    onAdapt={adaptPlatform}
                  />
                </div>
              </div>
            )}
          </div>

          <div className="z-20 flex shrink-0 items-center justify-between gap-3 border-t border-slate-200/80 bg-white/95 px-4 py-3 backdrop-blur dark:border-slate-800 dark:bg-slate-950/95">
            <div className="min-w-0 text-xs text-slate-500">
              {task.error ? <span className="text-rose-600">{task.error}{needsModelAttention ? <Link href="/settings" className="ml-2 font-semibold underline underline-offset-2">检查模型设置／额度</Link> : null}</span> : task.progress ? <span>{task.progress.message}{task.progress.total ? ` · ${task.progress.completed}/${task.progress.total}` : ""}</span> : <span>填写要求后直接生成；文字修改不会调用生图模型</span>}
            </div>
            <div className="flex shrink-0 items-center gap-2">
              {task.status === "queued" || task.status === "generating" ? <Button size="sm" variant="destructive" onClick={stopGeneration}><Pause className="h-4 w-4" />停止</Button> : null}
              {running ? <Button size="sm" disabled><Loader2 className="h-4 w-4 animate-spin" />{task.status === "planning" ? (isXiaohongshu ? "AI 正在整理故事线" : "AI 正在理解素材") : "正在生成图片"}</Button> : <Button size="sm" onClick={() => void generate()} disabled={Boolean(busy)}><Sparkles className="h-4 w-4" />{primaryActionLabel}</Button>}
              {selectedPanel?.versions.length && !running ? <Button size="sm" variant="outline" onClick={() => void generate([selectedPanel.id])} disabled={busy === "regenerate"}><RefreshCw className="h-4 w-4" />重做当前</Button> : null}
              {task.panels.some((panel) => panel.versions.length) ? (
                <>
                  {task.kind === "detail_page" ? <Button size="sm" variant="outline" onClick={() => void downloadExport("long")} disabled={busy === "export"}><FileImage className="h-4 w-4" />长图</Button> : null}
                  <Button size="sm" variant="outline" onClick={() => void downloadExport("zip")} disabled={busy === "export"}><Download className="h-4 w-4" />导出 ZIP</Button>
                </>
              ) : null}
            </div>
          </div>
        </main>
      </div>

      {message ? <Toast message={message} onClose={() => setMessage("")} /> : null}
    </div>
  );
}

type FreeChatTemplate = {
  key: string;
  title: string;
  description: string;
  prompt: string;
  ratio: CommerceImageRatio;
};

const freeChatTemplates: FreeChatTemplate[] = [
  { key: "product", title: "电商主图", description: "干净背景，突出商品质感", prompt: "为这件商品生成一张电商主图：背景干净高级，突出材质与细节，柔和棚拍光线，商品完整居中。", ratio: "1:1" },
  { key: "cover", title: "小红书封面", description: "真人手持，暖光，上方留白", prompt: "生成一张小红书封面：真人手持商品，暖光自然光，生活化场景，画面上方留白方便放标题。", ratio: "3:4" },
  { key: "scene", title: "场景大片", description: "把商品放进真实场景", prompt: "把商品放进真实的冬季雪景里，自然光影，画面干净高级，商品细节清晰可辨。", ratio: "9:16" },
  { key: "model", title: "模特上身", description: "真人上身，动作自然", prompt: "让真人模特自然地穿着这件商品，全身入镜，动作自然放松，背景简洁，光线真实。", ratio: "3:4" }
];

const freeChatQualityOptions: Array<{ value: CommerceImageQuality; label: string; hint: string }> = [
  { value: "standard", label: "1K", hint: "出图快" },
  { value: "high", label: "2K", hint: "原生最高" },
  { value: "ultra", label: "4K", hint: "2K 放大" }
];

const freeChatQualityLabel: Record<CommerceImageQuality, string> = {
  standard: "1K",
  high: "2K",
  ultra: "4K"
};

function FreeChatWorkbench(props: {
  task: CommerceImageTask;
  tasks: CommerceImageTask[];
  message: string;
  historyVisible: boolean;
  onToggleHistory: () => void;
  onCloseHistory: () => void;
  onOpenTask: (task: CommerceImageTask) => void;
  onNewTask: () => void;
  onTaskUpdated: (task: CommerceImageTask) => void;
  onNotify: (message: string) => void;
}) {
  const [input, setInput] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [continueLast, setContinueLast] = useState(true);
  const [referenceAssetId, setReferenceAssetId] = useState("");
  const [sending, setSending] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [lightboxId, setLightboxId] = useState("");
  const fileInput = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);
  const task = props.task;
  const generating = task.status === "generating" || task.status === "queued" || task.status === "planning";
  const assetById = useMemo(() => new Map(task.sourceAssets.map((asset) => [asset.id, asset])), [task.sourceAssets]);
  const lastGeneratedId = useMemo(
    () => [...task.sourceAssets].reverse().find((asset) => asset.role === "chat_generated")?.id || "",
    [task.sourceAssets]
  );
  const generatedImages = useMemo(
    () => task.chatMessages
      .flatMap((chat) => (chat.imageAssetIds || []).map((id) => assetById.get(id)))
      .filter((asset): asset is CommerceImageAsset => Boolean(asset)),
    [task.chatMessages, assetById]
  );
  const quality = task.quality || "high";
  const ratio = task.ratio === "original" ? "1:1" : task.ratio;

  useEffect(() => {
    if (!stickToBottom.current) return;
    const node = scrollRef.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, [task.id, task.chatMessages.length, generating]);

  useEffect(() => {
    if (!generating) {
      setElapsed(0);
      return;
    }
    setElapsed(0);
    const timer = window.setInterval(() => setElapsed((value) => value + 1), 1000);
    return () => window.clearInterval(timer);
  }, [generating, task.id, task.updatedAt]);

  function pickFiles(list: FileList | null) {
    if (!list?.length) return;
    const accepted: File[] = [];
    for (const file of Array.from(list)) {
      if (!["image/png", "image/jpeg", "image/webp"].includes(file.type)) {
        props.onNotify(`${file.name} 不是支持的 PNG、JPG 或 WEBP 图片。`);
        continue;
      }
      if (file.size <= 0 || file.size > 25 * 1024 * 1024) {
        props.onNotify(`${file.name} 为空或超过 25MB。`);
        continue;
      }
      accepted.push(file);
    }
    setFiles((current) => [...current, ...accepted].slice(0, 4));
    if (fileInput.current) fileInput.current.value = "";
  }

  function removeFile(index: number) {
    setFiles((current) => current.filter((_, itemIndex) => itemIndex !== index));
  }

  function applyTemplate(template: FreeChatTemplate) {
    setInput(template.prompt);
    if (template.ratio !== ratio) void updateSettings({ ratio: template.ratio });
    window.setTimeout(() => document.getElementById("free-chat-input")?.focus(), 0);
  }

  async function send(overridePrompt?: string) {
    const prompt = (overridePrompt ?? input).trim();
    if (!prompt || sending || generating) return;
    setSending(true);
    stickToBottom.current = true;
    try {
      const form = new FormData();
      form.set("prompt", prompt);
      form.set("ratio", ratio);
      form.set("quality", quality);
      form.set("continueLast", continueLast && Boolean(lastGeneratedId) && !files.length && !referenceAssetId ? "true" : "false");
      if (referenceAssetId) form.set("referenceAssetIds", JSON.stringify([referenceAssetId]));
      files.forEach((file) => form.append("images", file));
      const response = await fetch(`/api/commerce-image/tasks/${encodeURIComponent(task.id)}/free-chat`, { method: "POST", body: form });
      const payload = await response.json().catch(() => ({})) as { success?: boolean; message?: string };
      if (!response.ok || payload.success === false) throw new Error(payload.message || "发送失败，请稍后重试。");
      setInput("");
      setFiles([]);
      props.onNotify(payload.message || "已开始生成图片。");
    } catch (error) {
      props.onNotify(errorMessage(error));
    } finally {
      setSending(false);
    }
  }

  async function stop() {
    try {
      const payload = await requestJson<{ message: string }>(`/api/commerce-image/tasks/${encodeURIComponent(task.id)}/free-chat`, { method: "DELETE" });
      props.onNotify(payload.message);
    } catch (error) {
      props.onNotify(errorMessage(error));
    }
  }

  async function updateSettings(patch: { ratio?: CommerceImageOutputRatio; quality?: CommerceImageQuality }) {
    try {
      const payload = await requestJson<{ task: CommerceImageTask }>(`/api/commerce-image/tasks/${encodeURIComponent(task.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch)
      });
      props.onTaskUpdated(payload.task);
    } catch (error) {
      props.onNotify(errorMessage(error));
    }
  }

  function promptBefore(chatId: string) {
    const index = task.chatMessages.findIndex((chat) => chat.id === chatId);
    if (index < 0) return "";
    for (let cursor = index - 1; cursor >= 0; cursor -= 1) {
      if (task.chatMessages[cursor].role === "user") return task.chatMessages[cursor].content;
    }
    return "";
  }

  const referenceAsset = referenceAssetId ? assetById.get(referenceAssetId) : undefined;

  return (
    <div className="ui-shell desktop-page flex h-[calc(100dvh-8.5rem)] min-h-[650px] flex-col overflow-hidden">
      <header className="mb-3 flex shrink-0 items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <Button size="sm" variant="ghost" onClick={props.onNewTask}><ChevronLeft className="h-4 w-4" />新建</Button>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h1 className="truncate text-[15px] font-semibold text-ink-1">{task.title}</h1>
              <span className="shrink-0 rounded-full bg-surface-2 px-2 py-0.5 text-[11px] text-ink-2">{statusLabels[task.status]}</span>
            </div>
            <p className="truncate text-[11px] text-ink-3">自然对话生图 · GPT Image 2.5 直连，文字原样生成</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" onClick={props.onToggleHistory}><History className="h-4 w-4" />历史</Button>
          <Button size="sm" variant="outline" asChild><Link href="/settings"><Settings className="h-4 w-4" />设置</Link></Button>
        </div>
      </header>

      {props.historyVisible ? <HistoryDrawer tasks={props.tasks} onOpen={props.onOpenTask} onClose={props.onCloseHistory} compact /> : null}

      <div
        ref={scrollRef}
        onScroll={(event) => {
          const node = event.currentTarget;
          stickToBottom.current = node.scrollHeight - node.scrollTop - node.clientHeight < 120;
        }}
        className="min-h-0 flex-1 overflow-y-auto overscroll-contain rounded-3xl border border-line bg-canvas"
      >
        <div className="mx-auto max-w-3xl space-y-4 p-4 pb-10">
          {!task.chatMessages.length && !generating ? (
            <FreeChatEmptyState onPick={applyTemplate} />
          ) : task.chatMessages.map((chat, index) => (
            <ChatBubble
              key={chat.id}
              chat={chat}
              assetById={assetById}
              staggerIndex={Math.max(0, task.chatMessages.length - index - 1)}
              onOpenImage={setLightboxId}
              onUseAsReference={(assetId) => {
                setReferenceAssetId(assetId);
                props.onNotify("已设为参考图，写下要改的地方再发送。");
                window.setTimeout(() => document.getElementById("free-chat-input")?.focus(), 0);
              }}
              onRedo={() => void send(promptBefore(chat.id))}
            />
          ))}
          {generating ? <FreeChatGenerating elapsed={elapsed} stage={task.progress?.message || ""} /> : null}
        </div>
      </div>

      <div className="shrink-0 px-1 pb-1 pt-3">
        <div className="mx-auto max-w-3xl">
          <div className="rounded-[20px] border border-line bg-surface p-3 transition-colors duration-[var(--dur-fast)] focus-within:border-line-strong">
            {files.length || referenceAsset ? (
              <div className="mb-2 flex flex-wrap items-center gap-2">
                {referenceAsset ? (
                  <span className="inline-flex items-center gap-1.5 rounded-lg bg-brand-soft px-2 py-1 text-[11px] text-brand-solid">
                    <WandSparkles className="h-3 w-3" />参考：{referenceAsset.name}
                    <button type="button" aria-label="移除参考图" onClick={() => setReferenceAssetId("")}><X className="h-3 w-3" /></button>
                  </span>
                ) : null}
                {files.map((file, index) => (
                  <span key={`${file.name}-${index}`} className="inline-flex items-center gap-1 rounded-lg bg-surface-2 px-2 py-1 text-[11px] text-ink-2">
                    <FileImage className="h-3 w-3" /><span className="max-w-40 truncate">{file.name}</span>
                    <button type="button" aria-label={`移除 ${file.name}`} onClick={() => removeFile(index)}><X className="h-3 w-3" /></button>
                  </span>
                ))}
                <span className="text-[11px] text-ink-3">{files.length}/4 张参考图</span>
              </div>
            ) : null}
            <textarea
              id="free-chat-input"
              rows={2}
              className="w-full resize-none bg-transparent px-1 text-[13px] leading-6 text-ink-1 outline-none placeholder:text-ink-3"
              value={input}
              onChange={(event) => setInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                  event.preventDefault();
                  void send();
                }
              }}
              placeholder="直接描述想要的效果，例如：小红书封面，雪地里穿红色羽绒服的女生回眸，暖光真实感……"
            />
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <button
                type="button"
                title="附带参考图（最多 4 张）"
                onClick={() => fileInput.current?.click()}
                disabled={generating || files.length >= 4}
                className="inline-flex items-center gap-1.5 rounded-full border border-line px-3 py-1.5 text-[12px] text-ink-2 transition-colors duration-[var(--dur-instant)] hover:border-line-strong hover:text-ink-1 disabled:opacity-40"
              >
                <Paperclip className="h-3.5 w-3.5" />附件
              </button>
              <input ref={fileInput} hidden type="file" multiple accept="image/png,image/jpeg,image/webp" onChange={(event) => pickFiles(event.target.files)} />
              <PopoverPill
                label={ratio}
                title="画面比例"
                value={ratio}
                disabled={generating}
                options={commerceImageRatioOrder.map((item) => ({ value: item, label: item }))}
                onChange={(value) => void updateSettings({ ratio: value as CommerceImageRatio })}
              />
              <PopoverPill
                label={`${freeChatQualityLabel[quality]}（${freeChatQualityOptions.find((item) => item.value === quality)?.hint || ""}）`}
                title="清晰度"
                value={quality}
                disabled={generating}
                options={freeChatQualityOptions.map((item) => ({ value: item.value, label: item.label, hint: item.hint }))}
                onChange={(value) => void updateSettings({ quality: value as CommerceImageQuality })}
              />
              {lastGeneratedId ? (
                <button
                  type="button"
                  onClick={() => setContinueLast((value) => !value)}
                  className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[12px] transition-colors duration-[var(--dur-instant)] ${continueLast ? "bg-brand-soft text-brand-solid" : "border border-line text-ink-3 hover:border-line-strong hover:text-ink-2"}`}
                >
                  <WandSparkles className="h-3.5 w-3.5" />基于上一张{continueLast ? "（开）" : ""}
                </button>
              ) : null}
              <div className="ml-auto flex items-center gap-2">
                {generating ? (
                  <button
                    type="button"
                    onClick={() => void stop()}
                    className="inline-flex items-center gap-1.5 rounded-full bg-danger px-4 py-1.5 text-[12px] font-medium text-white transition-colors duration-[var(--dur-instant)] hover:opacity-90"
                  >
                    <Pause className="h-3.5 w-3.5" />停止
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => void send()}
                    disabled={!input.trim() || sending}
                    className="inline-flex items-center gap-1.5 rounded-full bg-brand-solid px-4 py-1.5 text-[12px] font-medium text-white transition-colors duration-[var(--dur-instant)] hover:bg-brand-hover disabled:opacity-40"
                  >
                    {sending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ArrowUp className="h-3.5 w-3.5" />}发送
                  </button>
                )}
              </div>
            </div>
          </div>
          <p className="mt-2 px-1 text-[11px] leading-4 text-ink-3">
            文字原样交给 GPT Image 2.5，不改写、不加流程；Enter 发送，Shift+Enter 换行。image2.5 原生最高约 2K，选 4K 会先按 2K 生成、再本地放大到 4K 像素。
          </p>
        </div>
      </div>

      {lightboxId ? (
        <FreeChatLightbox
          images={generatedImages}
          activeId={lightboxId}
          onActiveChange={setLightboxId}
          onClose={() => setLightboxId("")}
          onUseAsReference={(assetId) => {
            setReferenceAssetId(assetId);
            setLightboxId("");
            props.onNotify("已设为参考图，写下要改的地方再发送。");
          }}
        />
      ) : null}

      {props.message ? <Toast message={props.message} onClose={() => props.onNotify("")} /> : null}
    </div>
  );
}

function PopoverPill(props: {
  label: string;
  title: string;
  value: string;
  options: Array<{ value: string; label: string; hint?: string }>;
  onChange: (value: string) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const container = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handlePointer(event: MouseEvent) {
      if (container.current && !container.current.contains(event.target as Node)) setOpen(false);
    }
    function handleKey(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", handlePointer);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handlePointer);
      document.removeEventListener("keydown", handleKey);
    };
  }, [open]);

  return (
    <div ref={container} className="relative">
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        disabled={props.disabled}
        onClick={() => setOpen((value) => !value)}
        className="inline-flex items-center gap-1.5 rounded-full border border-line px-3 py-1.5 text-[12px] text-ink-2 transition-colors duration-[var(--dur-instant)] hover:border-line-strong hover:text-ink-1 disabled:opacity-40"
      >
        {props.label}
        <ChevronDown className={`h-3 w-3 transition-transform duration-[var(--dur-fast)] ${open ? "rotate-180" : ""}`} />
      </button>
      {open ? (
        <div role="listbox" className="anim-pop-in absolute bottom-[calc(100%+6px)] left-0 z-30 min-w-[168px] rounded-xl border border-line bg-surface p-1 shadow-lg">
          <p className="px-2 pb-1 pt-1.5 text-[11px] text-ink-3">{props.title}</p>
          {props.options.map((option) => (
            <button
              key={option.value}
              type="button"
              role="option"
              aria-selected={option.value === props.value}
              onClick={() => {
                props.onChange(option.value);
                setOpen(false);
              }}
              className={`flex w-full items-center justify-between gap-3 rounded-lg px-2 py-1.5 text-left text-[12px] transition-colors duration-[var(--dur-instant)] ${option.value === props.value ? "bg-brand-soft text-brand-solid" : "text-ink-2 hover:bg-surface-2 hover:text-ink-1"}`}
            >
              <span>{option.label}</span>
              {option.hint ? <span className="text-[11px] text-ink-3">{option.hint}</span> : null}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function ChatBubble(props: {
  chat: CommerceImageChatMessage;
  assetById: Map<string, CommerceImageAsset>;
  staggerIndex: number;
  onOpenImage: (assetId: string) => void;
  onUseAsReference: (assetId: string) => void;
  onRedo: () => void;
}) {
  const { chat } = props;
  const images = (chat.imageAssetIds || []).map((id) => props.assetById.get(id)).filter((asset): asset is CommerceImageAsset => Boolean(asset));
  const animStyle = props.staggerIndex < 3 ? { animationDelay: `${props.staggerIndex * 40}ms` } : undefined;

  if (chat.role === "user") {
    return (
      <div className="anim-fade-up ml-auto max-w-[85%] space-y-2" style={animStyle}>
        {images.length ? (
          <div className="flex flex-wrap justify-end gap-2">
            {images.map((asset) => (
              <button key={asset.id} type="button" onClick={() => props.onOpenImage(asset.id)} className="overflow-hidden rounded-xl border border-line transition-colors duration-[var(--dur-instant)] hover:border-line-strong">
                <img src={asset.url} alt={asset.name} className="h-20 w-20 object-cover" />
              </button>
            ))}
          </div>
        ) : null}
        {chat.content ? (
          <div className="ml-auto w-fit rounded-2xl rounded-br-md bg-brand-solid px-4 py-2.5 text-[13px] leading-6 text-white">{chat.content}</div>
        ) : null}
      </div>
    );
  }

  if (chat.status === "error") {
    return (
      <div className="anim-fade-up mr-auto max-w-[85%] rounded-2xl rounded-bl-md border border-danger/30 bg-danger-soft px-4 py-2.5 text-[13px] leading-6 text-danger" style={animStyle}>
        {chat.content}
      </div>
    );
  }

  const isNote = /降档|放大|上限/.test(chat.content || "");

  return (
    <div className="anim-fade-up mr-auto max-w-[86%] space-y-2" style={animStyle}>
      {images.map((asset) => (
        <figure key={asset.id} className="group overflow-hidden rounded-2xl border border-line bg-surface transition-[border-color,transform] duration-[var(--dur-fast)] hover:-translate-y-px hover:border-line-strong">
          <div className="relative">
            <img
              src={asset.url}
              alt={asset.name}
              onClick={() => props.onOpenImage(asset.id)}
              className="anim-fade-in block max-h-[520px] w-auto max-w-full cursor-zoom-in object-contain"
            />
            <span className="pointer-events-none absolute left-2.5 top-2.5 rounded-full bg-[rgba(11,13,18,0.72)] px-2 py-0.5 text-[11px] text-white/90">
              {asset.width && asset.height ? `${asset.width} × ${asset.height}` : "已生成"}
            </span>
            <div className="absolute right-2.5 top-2.5 flex gap-1 opacity-0 transition-opacity duration-[var(--dur-fast)] group-hover:opacity-100 focus-within:opacity-100">
              <button type="button" onClick={() => props.onOpenImage(asset.id)} className="rounded-lg bg-[rgba(11,13,18,0.78)] px-2 py-1 text-[11px] text-white/90 transition-colors duration-[var(--dur-instant)] hover:bg-[rgba(11,13,18,0.92)]">放大</button>
              <a href={asset.url} download={asset.name} className="rounded-lg bg-[rgba(11,13,18,0.78)] px-2 py-1 text-[11px] text-white/90 transition-colors duration-[var(--dur-instant)] hover:bg-[rgba(11,13,18,0.92)]">下载</a>
              <button type="button" onClick={props.onRedo} className="rounded-lg bg-[rgba(11,13,18,0.78)] px-2 py-1 text-[11px] text-white/90 transition-colors duration-[var(--dur-instant)] hover:bg-[rgba(11,13,18,0.92)]">重做</button>
              <button type="button" onClick={() => props.onUseAsReference(asset.id)} className="rounded-lg bg-brand-solid/80 px-2 py-1 text-[11px] text-white transition-colors duration-[var(--dur-instant)] hover:bg-brand-solid">继续改</button>
            </div>
          </div>
        </figure>
      ))}
      {chat.content ? (
        isNote ? (
          <p className="w-fit rounded-xl border border-warn/25 bg-warn-soft px-3 py-2 text-[11px] leading-5 text-warn">{chat.content}</p>
        ) : (
          <p className="w-fit rounded-2xl rounded-bl-md border border-line bg-surface px-4 py-2.5 text-[13px] leading-6 text-ink-2">{chat.content}</p>
        )
      ) : null}
    </div>
  );
}

function FreeChatGenerating(props: { elapsed: number; stage: string }) {
  return (
    <div className="anim-fade-up mr-auto w-[min(420px,86%)]">
      <div className="overflow-hidden rounded-2xl border border-line bg-surface">
        <div className="skeleton-shimmer flex h-[300px] flex-col items-center justify-center gap-2">
          <Loader2 className="h-5 w-5 animate-spin text-brand-solid" />
          <span className="text-[12px] text-ink-2">{props.stage || "GPT Image 2.5 正在生成图片"}</span>
          <span className="text-[11px] text-ink-3">已等待 {props.elapsed} 秒</span>
        </div>
        <div className="border-t border-line px-3 py-2 text-[11px] text-ink-3">
          {props.elapsed > 180 ? "已超过 3 分钟：大尺寸与 4K 会明显更慢，可继续等待或点「停止」" : "通常 1–3 分钟；等待期间可以继续打字，生成完会自动出现"}
        </div>
      </div>
    </div>
  );
}

function FreeChatLightbox(props: {
  images: CommerceImageAsset[];
  activeId: string;
  onActiveChange: (assetId: string) => void;
  onClose: () => void;
  onUseAsReference: (assetId: string) => void;
}) {
  const index = Math.max(0, props.images.findIndex((asset) => asset.id === props.activeId));
  const active = props.images[index];
  const [scale, setScale] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const dragState = useRef<{ x: number; y: number; ox: number; oy: number } | null>(null);

  useEffect(() => {
    setScale(1);
    setOffset({ x: 0, y: 0 });
  }, [props.activeId]);

  useEffect(() => {
    function handleKey(event: KeyboardEvent) {
      if (event.key === "Escape") props.onClose();
      if (event.key === "ArrowLeft" && index > 0) props.onActiveChange(props.images[index - 1].id);
      if (event.key === "ArrowRight" && index < props.images.length - 1) props.onActiveChange(props.images[index + 1].id);
      if (event.key === "0") {
        setScale(1);
        setOffset({ x: 0, y: 0 });
      }
    }
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [index, props]);

  if (!active) return null;

  return (
    <div className="anim-fade-in fixed inset-0 z-50 flex flex-col bg-[rgba(4,5,8,0.92)]">
      <div className="flex shrink-0 items-center gap-3 px-4 py-3">
        <span className="text-[12px] text-white/70">{index + 1} / {props.images.length}{active.width && active.height ? ` · ${active.width} × ${active.height}` : ""}</span>
        <div className="ml-auto flex items-center gap-2">
          <button type="button" onClick={() => setScale((value) => Math.max(1, Number((value - 0.25).toFixed(2))))} className="rounded-lg border border-white/20 px-2 py-1 text-[12px] text-white/80 transition-colors duration-[var(--dur-instant)] hover:border-white/40 hover:text-white">缩小</button>
          <button type="button" onClick={() => setScale((value) => Math.min(4, Number((value + 0.25).toFixed(2))))} className="rounded-lg border border-white/20 px-2 py-1 text-[12px] text-white/80 transition-colors duration-[var(--dur-instant)] hover:border-white/40 hover:text-white">放大</button>
          <button type="button" onClick={() => { setScale(1); setOffset({ x: 0, y: 0 }); }} className="rounded-lg border border-white/20 px-2 py-1 text-[12px] text-white/80 transition-colors duration-[var(--dur-instant)] hover:border-white/40 hover:text-white">原始大小</button>
          <button type="button" onClick={() => props.onUseAsReference(active.id)} className="rounded-lg bg-brand-solid px-2.5 py-1 text-[12px] text-white transition-colors duration-[var(--dur-instant)] hover:bg-brand-hover">继续改</button>
          <a href={active.url} download={active.name} className="rounded-lg border border-white/20 px-2.5 py-1 text-[12px] text-white/80 transition-colors duration-[var(--dur-instant)] hover:border-white/40 hover:text-white">下载</a>
          <button type="button" aria-label="关闭" onClick={props.onClose} className="rounded-lg border border-white/20 px-2.5 py-1 text-[12px] text-white/80 transition-colors duration-[var(--dur-instant)] hover:border-white/40 hover:text-white">关闭</button>
        </div>
      </div>
      <div
        className="relative min-h-0 flex-1 overflow-hidden"
        onWheel={(event) => {
          event.preventDefault();
          setScale((value) => Math.min(4, Math.max(1, Number((value + (event.deltaY < 0 ? 0.2 : -0.2)).toFixed(2)))));
        }}
        onPointerDown={(event) => {
          if (scale === 1) return;
          dragState.current = { x: event.clientX, y: event.clientY, ox: offset.x, oy: offset.y };
          event.currentTarget.setPointerCapture(event.pointerId);
        }}
        onPointerMove={(event) => {
          const drag = dragState.current;
          if (!drag) return;
          setOffset({ x: drag.ox + (event.clientX - drag.x), y: drag.oy + (event.clientY - drag.y) });
        }}
        onPointerUp={() => { dragState.current = null; }}
      >
        {index > 0 ? (
          <button type="button" aria-label="上一张" onClick={() => props.onActiveChange(props.images[index - 1].id)} className="absolute left-4 top-1/2 z-10 -translate-y-1/2 rounded-full border border-white/20 px-3 py-2 text-[12px] text-white/70 transition-colors duration-[var(--dur-instant)] hover:border-white/40 hover:text-white">上一张</button>
        ) : null}
        {index < props.images.length - 1 ? (
          <button type="button" aria-label="下一张" onClick={() => props.onActiveChange(props.images[index + 1].id)} className="absolute right-4 top-1/2 z-10 -translate-y-1/2 rounded-full border border-white/20 px-3 py-2 text-[12px] text-white/70 transition-colors duration-[var(--dur-instant)] hover:border-white/40 hover:text-white">下一张</button>
        ) : null}
        <div className="flex h-full items-center justify-center p-4">
          <img
            src={active.url}
            alt={active.name}
            draggable={false}
            style={{ transform: `translate(${offset.x}px, ${offset.y}px) scale(${scale})` }}
            className={`max-h-full max-w-full select-none object-contain ${scale > 1 ? "cursor-grab" : "cursor-zoom-in"}`}
          />
        </div>
      </div>
      <p className="shrink-0 px-4 pb-3 text-center text-[11px] text-white/40">滚轮缩放 · 放大后可拖动 · ← → 切换 · Esc 关闭</p>
    </div>
  );
}

function FreeChatEmptyState(props: { onPick: (template: FreeChatTemplate) => void }) {
  return (
    <div className="anim-fade-up rounded-3xl border border-dashed border-line-strong bg-surface/60 p-6">
      <div className="flex items-center gap-2">
        <Sparkles className="h-4 w-4 text-brand-solid" />
        <span className="text-[13px] text-ink-1">直接说出想要的效果，或者从模板开始</span>
      </div>
      <div className="mt-4 grid gap-2 sm:grid-cols-2">
        {freeChatTemplates.map((template) => (
          <button
            key={template.key}
            type="button"
            onClick={() => props.onPick(template)}
            className="rounded-2xl border border-line bg-surface p-3 text-left transition-[transform,border-color,background-color] duration-[var(--dur-fast)] hover:-translate-y-px hover:border-brand-solid hover:bg-brand-soft"
          >
            <p className="text-[13px] text-ink-1">{template.title}</p>
            <p className="mt-1 text-[11px] leading-4 text-ink-3">{template.description}</p>
          </button>
        ))}
      </div>
      <p className="mt-4 text-[11px] leading-5 text-ink-3">
        生成后可以继续说「把雪地换成夜景」「标题再大一点」，点图片上的「继续改」就会把这张图当作参考继续修改。
      </p>
    </div>
  );
}

function XiaohongshuStoryboardReview(props: {
  task: CommerceImageTask;
  onChange: (updater: (storyboard: CommerceImageStoryboard) => CommerceImageStoryboard) => void;
  onSave: () => void;
  onOperation: (panelId: string, type: "delete" | "move_up" | "move_down" | "duplicate" | "merge_next") => void;
  onGeneratePlan: () => void;
  onConfirm: () => void;
  busy: string;
}) {
  const storyboard = props.task.storyboard;
  if (!storyboard) return null;
  const updateCard = (index: number, patch: Partial<CommerceImageStoryboard["cards"][number]>) => {
    props.onChange((current) => ({
      ...current,
      status: "needs_revision",
      confirmedAt: "",
      updatedAt: new Date().toISOString(),
      cards: current.cards.map((card, cardIndex) => cardIndex === index ? { ...card, ...patch } : card)
    }));
  };
  return (
    <div className="mx-auto max-w-5xl space-y-4 p-4">
      <section className="rounded-3xl border border-border bg-card p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-xs font-semibold text-foreground dark:text-foreground">小红书种草图文 · 先确认故事线</p>
            <h3 className="mt-1 text-lg font-semibold">先让 {storyboard.cards.length} 张图讲同一件事，再开始出图</h3>
            <p className="mt-1 text-xs leading-5 text-slate-500">底图会统一使用这份视觉设定；文字会先落在模型预留的安全区，而不是压住商品。</p>
          </div>
          <Badge variant="secondary">{storyboard.cards.length} 张 · {storyboard.status === "planned" ? "待确认" : storyboard.status === "confirmed" ? "已确认" : "可继续修改"}</Badge>
        </div>
        <div className="mt-4 grid gap-3 lg:grid-cols-[1.15fr_0.85fr]">
          <Field label="整篇主题">
            <Input value={storyboard.theme} onChange={(event) => props.onChange((current) => ({ ...current, theme: event.target.value.slice(0, 160), status: "needs_revision", confirmedAt: "", updatedAt: new Date().toISOString() }))} placeholder="例如：穿红色羽绒服回家过年" />
          </Field>
          <Field label="封面情绪钩子">
            <Input value={storyboard.emotionalHook} onChange={(event) => props.onChange((current) => ({ ...current, emotionalHook: event.target.value.slice(0, 100), status: "needs_revision", confirmedAt: "", updatedAt: new Date().toISOString() }))} placeholder="一句让人停下来的话" />
          </Field>
        </div>
        <p className="mt-3 rounded-xl bg-white/75 px-3 py-2 text-xs leading-5 text-slate-600 shadow-sm dark:bg-slate-900/70 dark:text-slate-300">{storyboard.summary}</p>
        <div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
          <StoryBibleItem label="商品保真" value={storyboard.visualBible.productAnchor} />
          <StoryBibleItem label="摄影与色彩" value={`${storyboard.visualBible.colorMood} ${storyboard.visualBible.photography}`} />
          <StoryBibleItem label="人物边界" value={storyboard.visualBible.subjectRule} />
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          <Button size="sm" variant="outline" onClick={props.onSave} disabled={Boolean(props.busy)}>保存方案修改</Button>
          <Button size="sm" variant="outline" onClick={props.onGeneratePlan} disabled={Boolean(props.busy)}><RefreshCw className="h-4 w-4" />重新生成故事方案</Button>
          <Button size="sm" onClick={props.onConfirm} disabled={Boolean(props.busy) || props.task.status === "planning"}><Sparkles className="h-4 w-4" />确认故事线并生成</Button>
        </div>
      </section>

      <section className="grid gap-3 md:grid-cols-2">
        {storyboard.cards.map((card, index) => {
          const panel = props.task.panels[index];
          return (
            <article key={card.id} className="relative rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-950">
              <div className="mb-3 flex items-center justify-between gap-3">
                <div className="flex items-center gap-2"><span className="flex h-6 w-6 items-center justify-center rounded-full bg-muted text-xs font-bold text-muted-foreground">{index + 1}</span><span className="text-xs font-semibold text-foreground dark:text-foreground">{storyRoleLabel(card.role)}</span></div>
                {panel ? <div className="flex"><IconButton label="上移这张图" onClick={() => props.onOperation(panel.id, "move_up")} disabled={index === 0}><ArrowUp className="h-3.5 w-3.5" /></IconButton><IconButton label="下移这张图" onClick={() => props.onOperation(panel.id, "move_down")} disabled={index === storyboard.cards.length - 1}><ArrowDown className="h-3.5 w-3.5" /></IconButton><IconButton label="删除这张图" onClick={() => props.onOperation(panel.id, "delete")} disabled={storyboard.cards.length <= 3}><Trash2 className="h-3.5 w-3.5" /></IconButton></div> : null}
              </div>
              <Input className="h-9 text-sm font-semibold" value={card.title} onChange={(event) => updateCard(index, { title: event.target.value.slice(0, 80) })} />
              <div className="mt-2 grid gap-2">
                <Field label="这张图要完成什么"><Textarea className="min-h-16 resize-y text-xs" value={card.purpose} onChange={(event) => updateCard(index, { purpose: event.target.value.slice(0, 360) })} /></Field>
                <Field label="画面描述"><Textarea className="min-h-16 resize-y text-xs" value={card.visual} onChange={(event) => updateCard(index, { visual: event.target.value.slice(0, 600) })} /></Field>
                <Field label="这张图要说什么"><Input className="h-8 text-xs" value={card.copyIntent} onChange={(event) => updateCard(index, { copyIntent: event.target.value.slice(0, 180) })} /></Field>
              </div>
            </article>
          );
        })}
      </section>
    </div>
  );
}

function StoryBibleItem(props: { label: string; value: string }) {
  return <div className="rounded-xl bg-white/70 p-2.5 text-[11px] leading-5 text-slate-600 shadow-sm dark:bg-slate-900/70 dark:text-slate-300"><span className="font-semibold text-slate-800 dark:text-slate-100">{props.label}</span><p className="mt-0.5 line-clamp-3">{props.value}</p></div>;
}

function storyRoleLabel(role: CommerceImageStoryboard["cards"][number]["role"]) {
  return ({ cover_hook: "封面情绪引子", scene_context: "场景代入", fact_proof: "真实商品证明", outfit_closing: "穿搭／收藏收尾", highlight: "主题延展" } as const)[role];
}

function DetailEditor(props: {
  task: CommerceImageTask;
  zoom: number;
  selectedPanelId: string;
  selectedLayerId: string;
  onSelectPanel: (id: string) => void;
  onSelectLayer: (id: string) => void;
  onPreviewLayers: (panelId: string, layers: CommerceImageTextLayer[]) => void;
  onCommitLayers: (panelId: string, before: CommerceImageTextLayer[], after: CommerceImageTextLayer[]) => void;
  onOperation: (panelId: string, type: "delete" | "move_up" | "move_down" | "duplicate" | "merge_next") => void;
}) {
  const { task } = props;
  return (
    <div className="mx-auto space-y-4 p-4" style={{ width: `${props.zoom}%`, minWidth: "660px" }}>
      <div className="grid grid-cols-2 gap-3 px-1 text-xs font-semibold text-slate-500"><span>对标模块</span><span>你的生成结果 · 双击文字可编辑</span></div>
      {[...task.panels].sort((a, b) => (a.order || 0) - (b.order || 0)).map((panel, index) => {
        const segment = task.referenceAnalysis.segments.find((item) => item.id === panel.referenceSegmentId);
        const source = task.sourceAssets.find((asset) => asset.id === segment?.assetId);
        const selected = panel.id === props.selectedPanelId;
        return (
          <section key={panel.id} className={`rounded-2xl border bg-white p-3 shadow-sm transition dark:bg-slate-950 ${selected ? "border-foreground/60 ring-2 ring-foreground/10" : "border-border"}`}>
            <div className="mb-2 flex items-center justify-between gap-2">
              <button type="button" className="min-w-0 text-left" onClick={() => props.onSelectPanel(panel.id)}>
                <div className="truncate text-sm font-semibold">{panel.title}</div>
                <div className="line-clamp-1 text-[10px] text-slate-400">{panel.description}</div>
              </button>
              <div className="flex shrink-0">
                <IconButton label="上移" onClick={() => props.onOperation(panel.id, "move_up")} disabled={index === 0}><ArrowUp className="h-3.5 w-3.5" /></IconButton>
                <IconButton label="下移" onClick={() => props.onOperation(panel.id, "move_down")} disabled={index === task.panels.length - 1}><ArrowDown className="h-3.5 w-3.5" /></IconButton>
                <IconButton label="拆分" onClick={() => props.onOperation(panel.id, "duplicate")}><Scissors className="h-3.5 w-3.5" /></IconButton>
                <IconButton label="合并下一模块" onClick={() => props.onOperation(panel.id, "merge_next")} disabled={index === task.panels.length - 1}><ArrowLeftRight className="h-3.5 w-3.5" /></IconButton>
                <IconButton label="删除" onClick={() => props.onOperation(panel.id, "delete")} disabled={task.panels.length <= 1}><Trash2 className="h-3.5 w-3.5" /></IconButton>
              </div>
            </div>
            <div className="grid grid-cols-2 items-start gap-3">
              <div className="overflow-hidden rounded-xl border border-slate-200 bg-slate-100 dark:border-slate-800 dark:bg-slate-900">
                {source?.url ? <img src={source.url} alt={panel.title} className="h-auto w-full object-contain" /> : <div className="flex aspect-[3/4] items-center justify-center p-4 text-center text-xs text-slate-400">{task.referenceAnalysis.status === "analyzing" ? "AI 正在拆解长图" : "暂无对应参考裁片"}</div>}
              </div>
              <EditableCanvas
                panel={panel}
                setId={task.selectedSetId}
                selectedLayerId={selected ? props.selectedLayerId : ""}
                onSelect={() => props.onSelectPanel(panel.id)}
                onSelectLayer={(id) => { props.onSelectPanel(panel.id); props.onSelectLayer(id); }}
                onPreview={(layers) => props.onPreviewLayers(panel.id, layers)}
                onCommit={(before, after) => props.onCommitLayers(panel.id, before, after)}
              />
            </div>
          </section>
        );
      })}
    </div>
  );
}

function SocialEditor(props: {
  task: CommerceImageTask;
  zoom: number;
  selectedPanelId: string;
  selectedLayerId: string;
  onSelectPanel: (id: string) => void;
  onSelectLayer: (id: string) => void;
  onPreviewLayers: (panelId: string, layers: CommerceImageTextLayer[]) => void;
  onCommitLayers: (panelId: string, before: CommerceImageTextLayer[], after: CommerceImageTextLayer[]) => void;
  onSelectVersion: (panel: CommerceImagePanel, versionId: string) => void;
  onZoom: (zoom: number) => void;
  onPublishChange: (patch: Partial<CommerceImageTask["publishPackage"]>) => void;
  onAdapt: () => void;
}) {
  const panel = props.task.panels.find((item) => item.id === props.selectedPanelId) || props.task.panels[0];
  if (!panel) return null;
  const versions = panel.versions.filter((version) => version.setId === props.task.selectedSetId);
  return (
    <div className="space-y-4 p-4">
      <ZoomableCanvasViewport zoom={props.zoom} onZoom={props.onZoom}>
        <div className="mb-2 flex items-center justify-between gap-3">
          <div className="min-w-0"><h3 className="truncate text-sm font-semibold">{panel.title}</h3><p className="line-clamp-1 text-[11px] text-slate-500">{panel.description}</p></div>
          {versions.length ? <div className="flex shrink-0 items-center gap-1">{versions.map((version, index) => <button type="button" key={version.id} onClick={() => props.onSelectVersion(panel, version.id)} className={`rounded-lg px-2 py-1 text-[10px] ${panel.selectedVersionId === version.id ? "bg-brand text-brand-foreground" : "bg-muted text-muted-foreground"}`}>V{index + 1}</button>)}</div> : null}
        </div>
        <EditableCanvas
          panel={panel}
          setId={props.task.selectedSetId}
          selectedLayerId={props.selectedLayerId}
          onSelect={() => props.onSelectPanel(panel.id)}
          onSelectLayer={props.onSelectLayer}
          onPreview={(layers) => props.onPreviewLayers(panel.id, layers)}
          onCommit={(before, after) => props.onCommitLayers(panel.id, before, after)}
        />
      </ZoomableCanvasViewport>
      {panel.quality?.warnings.length ? (() => {
        const productMismatch = panel.quality?.productFidelity === false || panel.quality?.productVisible === false;
        const layoutIssue = panel.quality?.status === "needs_layout_retry";
        const tone = productMismatch
          ? "bg-red-100 text-red-900 dark:bg-red-950/50 dark:text-red-100"
          : layoutIssue
            ? "bg-amber-100 text-amber-900 dark:bg-amber-950/45 dark:text-amber-100"
            : "bg-slate-100 text-slate-600 dark:bg-slate-900 dark:text-slate-300";
        return <div className={`rounded-xl px-3 py-2 text-xs leading-5 ${tone}`}><span className="font-semibold">{productMismatch ? "商品一致性检查未通过：" : "画面质检："}</span>{panel.quality?.warnings.join("；")}{productMismatch ? " 系统不会自动重做；确认需要修改时再点击“重做当前”。" : layoutIssue ? " 可点击“重做当前”，或保留底图后手动把文字拖进虚线留白区。" : ""}</div>;
      })() : null}
      <div className="overflow-x-auto rounded-2xl border border-slate-200/80 bg-white p-3 dark:border-slate-800 dark:bg-slate-950">
        <div className="flex gap-2">
          {[...props.task.panels].sort((a, b) => (a.order || 0) - (b.order || 0)).map((item) => {
            const version = currentSetVersion(item, props.task.selectedSetId);
            return <button type="button" key={item.id} onClick={() => { props.onSelectPanel(item.id); props.onSelectLayer(""); }} className={`w-24 shrink-0 overflow-hidden rounded-xl border-2 text-left ${item.id === panel.id ? "border-foreground" : "border-transparent"}`}><div className="aspect-[3/4] bg-slate-100 dark:bg-slate-900">{version?.imageUrl ? <img src={version.imageUrl} alt={item.title} className="h-full w-full object-cover" /> : <div className="flex h-full items-center justify-center px-2 text-center text-[10px] text-slate-400">等待生成</div>}</div><div className="truncate bg-white px-2 py-1.5 text-[10px] dark:bg-slate-950">{item.title}</div></button>;
          })}
        </div>
      </div>
      <section className="rounded-2xl border border-slate-200/80 bg-white p-4 dark:border-slate-800 dark:bg-slate-950">
        <div className="mb-3 flex items-center justify-between">
          <div><h3 className="text-sm font-semibold">发布文案与合规提醒</h3><p className="text-[11px] text-slate-500">标题、正文和标签会随 ZIP 一起导出</p></div>
          <Button size="sm" variant="outline" onClick={props.onAdapt}><Copy className="h-4 w-4" />复制并适配{props.task.kind === "xiaohongshu_post" ? "抖音" : "小红书"}</Button>
        </div>
        <div className="grid gap-3 lg:grid-cols-2">
          <Field label="标题"><Textarea value={props.task.publishPackage.title} onChange={(event) => props.onPublishChange({ title: event.target.value })} /></Field>
          <Field label="标签"><Textarea value={props.task.publishPackage.tags.join(" ")} onChange={(event) => props.onPublishChange({ tags: event.target.value.split(/\s+/).filter(Boolean) })} /></Field>
          <div className="lg:col-span-2"><Field label="正文"><Textarea className="min-h-32 resize-y" value={props.task.publishPackage.body} onChange={(event) => props.onPublishChange({ body: event.target.value })} /></Field></div>
        </div>
        {props.task.publishPackage.complianceWarnings.length ? <div className="mt-3 rounded-xl bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-800 dark:bg-amber-950/30 dark:text-amber-200">{props.task.publishPackage.complianceWarnings.join("；")}</div> : null}
      </section>
    </div>
  );
}

function ZoomableCanvasViewport(props: { zoom: number; onZoom: (zoom: number) => void; children: ReactNode }) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const pan = useRef<{ pointerId: number; x: number; y: number; left: number; top: number } | null>(null);
  return (
    <div
      ref={viewportRef}
      className="relative min-h-[440px] max-h-[min(68vh,760px)] overflow-auto rounded-2xl border border-slate-200/80 bg-slate-50/70 p-4 shadow-inner dark:border-slate-800 dark:bg-slate-950/45"
      onWheel={(event) => {
        if (!(event.ctrlKey || event.metaKey)) return;
        event.preventDefault();
        props.onZoom(clamp(props.zoom + (event.deltaY < 0 ? 8 : -8), 25, 300));
      }}
      onPointerDown={(event) => {
        if (event.button !== 1 && event.target !== event.currentTarget) return;
        const viewport = viewportRef.current;
        if (!viewport) return;
        event.preventDefault();
        event.currentTarget.setPointerCapture(event.pointerId);
        pan.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, left: viewport.scrollLeft, top: viewport.scrollTop };
      }}
      onPointerMove={(event) => {
        const active = pan.current;
        const viewport = viewportRef.current;
        if (!active || active.pointerId !== event.pointerId || !viewport) return;
        viewport.scrollLeft = active.left - (event.clientX - active.x);
        viewport.scrollTop = active.top - (event.clientY - active.y);
      }}
      onPointerUp={(event) => { if (pan.current?.pointerId === event.pointerId) pan.current = null; }}
      onPointerCancel={(event) => { if (pan.current?.pointerId === event.pointerId) pan.current = null; }}
    >
      <div className="pointer-events-none sticky left-0 top-0 z-10 mb-2 w-fit rounded-md bg-slate-950/75 px-2 py-1 text-[10px] text-white shadow-sm">{props.zoom}% · ⌘/Ctrl + 滚轮缩放；空白处或中键拖动查看</div>
      <div className="mx-auto min-h-full" style={{ width: `${props.zoom}%`, minWidth: `${Math.max(200, 560 * props.zoom / 100)}px` }}>
        {props.children}
      </div>
    </div>
  );
}

function EditableCanvas(props: {
  panel: CommerceImagePanel;
  setId: string;
  selectedLayerId: string;
  onSelect: () => void;
  onSelectLayer: (id: string) => void;
  onPreview: (layers: CommerceImageTextLayer[]) => void;
  onCommit: (before: CommerceImageTextLayer[], after: CommerceImageTextLayer[]) => void;
}) {
  const canvasRef = useRef<HTMLDivElement>(null);
  const latestLayers = useRef(props.panel.textLayers);
  const drag = useRef<{
    mode: "move" | "resize";
    pointerId: number;
    startX: number;
    startY: number;
    layer: CommerceImageTextLayer;
    before: CommerceImageTextLayer[];
  } | null>(null);
  const editingBefore = useRef<CommerceImageTextLayer[] | null>(null);
  const [editingLayerId, setEditingLayerId] = useState("");
  useEffect(() => { latestLayers.current = props.panel.textLayers; }, [props.panel.textLayers]);
  const version = currentSetVersion(props.panel, props.setId)
    || props.panel.versions.find((item) => item.id === props.panel.selectedVersionId);
  const ratio = version ? `${version.width} / ${version.height}` : props.panel.ratio === "original" ? "1 / 1" : props.panel.ratio.replace(":", " / ");
  const subjectBox = props.panel.layoutGuide?.subjectBox;
  const unsafeLayerIds = new Set(props.panel.textLayers.filter((layer) => subjectBox && boxesOverlap(layer, subjectBox)).map((layer) => layer.id));

  function startDrag(event: ReactPointerEvent<HTMLDivElement>, layer: CommerceImageTextLayer, mode: "move" | "resize") {
    if (layer.locked) return;
    event.preventDefault();
    event.stopPropagation();
    props.onSelectLayer(layer.id);
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { mode, pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, layer, before: latestLayers.current.map((item) => ({ ...item })) };
  }

  function moveDrag(event: ReactPointerEvent<HTMLDivElement>) {
    const state = drag.current;
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!state || !rect || state.pointerId !== event.pointerId) return;
    const dx = (event.clientX - state.startX) / rect.width;
    const dy = (event.clientY - state.startY) / rect.height;
    const next = latestLayers.current.map((layer) => {
      if (layer.id !== state.layer.id) return layer;
      if (state.mode === "move") {
        return { ...layer, x: clamp(state.layer.x + dx, 0, 1 - layer.width), y: clamp(state.layer.y + dy, 0, 1 - layer.height) };
      }
      return { ...layer, width: clamp(state.layer.width + dx, 0.04, 1 - layer.x), height: clamp(state.layer.height + dy, 0.04, 1 - layer.y) };
    });
    latestLayers.current = next;
    props.onPreview(next);
  }

  function endDrag(event: ReactPointerEvent<HTMLDivElement>) {
    const state = drag.current;
    if (!state || state.pointerId !== event.pointerId) return;
    drag.current = null;
    props.onCommit(state.before, latestLayers.current);
  }

  function beginTextEdit(layer: CommerceImageTextLayer) {
    editingBefore.current = latestLayers.current.map((item) => ({ ...item }));
    setEditingLayerId(layer.id);
    props.onSelectLayer(layer.id);
  }

  function editText(layerId: string, text: string) {
    const next = latestLayers.current.map((layer) => layer.id === layerId ? { ...layer, text } : layer);
    latestLayers.current = next;
    props.onPreview(next);
  }

  function finishTextEdit() {
    const before = editingBefore.current;
    setEditingLayerId("");
    editingBefore.current = null;
    if (before) props.onCommit(before, latestLayers.current);
  }

  return (
    <div ref={canvasRef} onClick={props.onSelect} className="relative w-full overflow-hidden rounded-xl border border-slate-200 bg-slate-200 shadow-inner dark:border-slate-800 dark:bg-slate-900" style={{ aspectRatio: ratio, containerType: "inline-size" }}>
      {version?.imageUrl ? <img src={version.imageUrl} alt={props.panel.title} draggable={false} className={`absolute inset-0 h-full w-full select-none ${props.panel.imageFit === "contain" ? "object-contain" : "object-cover"}`} /> : <div className="absolute inset-0 flex flex-col items-center justify-center p-5 text-center text-xs text-slate-400">{props.panel.status === "generating" ? <><Loader2 className="mb-2 h-6 w-6 animate-spin" />模型正在生成底图</> : props.panel.error ? <span className="text-rose-500">{props.panel.error}</span> : <><Images className="mb-2 h-6 w-6" />等待生成无文字底图</>}</div>}
      {props.panel.layoutGuide?.safeZones.map((zone) => (
        <div key={zone.id} className="pointer-events-none absolute border border-dashed border-foreground/70 bg-foreground/5" style={{ left: `${zone.x * 100}%`, top: `${zone.y * 100}%`, width: `${zone.width * 100}%`, height: `${zone.height * 100}%` }}>
          <span className="absolute -top-4 left-0 rounded bg-foreground/85 px-1 py-0.5 text-[8px] text-white">{zone.label}</span>
        </div>
      ))}
      {props.panel.textLayers.filter((layer) => layer.visible).map((layer) => {
        const selected = props.selectedLayerId === layer.id;
        const unsafe = unsafeLayerIds.has(layer.id);
        return (
          <div
            key={layer.id}
            className={`absolute touch-none select-none whitespace-pre-wrap rounded-sm ${selected ? unsafe ? "outline outline-2 outline-amber-500 outline-offset-1" : "outline outline-2 outline-foreground/80 outline-offset-1" : unsafe ? "outline outline-1 outline-amber-400/90" : "hover:outline hover:outline-1 hover:outline-white/70"}`}
            style={{
              left: `${layer.x * 100}%`, top: `${layer.y * 100}%`, width: `${layer.width * 100}%`, height: `${layer.height * 100}%`,
              color: layer.color, backgroundColor: hexWithOpacity(layer.backgroundColor, layer.backgroundOpacity),
              fontFamily: fontFamily(layer.fontFamily), fontSize: `${layer.fontSize * 100}cqw`, fontWeight: layer.fontWeight,
              lineHeight: layer.lineHeight, textAlign: layer.align, overflow: "hidden"
            }}
            onPointerDown={(event) => startDrag(event, layer, "move")}
            onPointerMove={moveDrag}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
            onDoubleClick={(event) => { event.stopPropagation(); beginTextEdit(layer); }}
          >
            {editingLayerId === layer.id ? (
              <textarea
                autoFocus
                value={layer.text}
                onChange={(event) => editText(layer.id, event.target.value)}
                onBlur={finishTextEdit}
                onKeyDown={(event) => { if (event.key === "Escape") finishTextEdit(); }}
                onPointerDown={(event) => event.stopPropagation()}
                className="h-full w-full resize-none bg-transparent p-0 text-inherit outline-none"
                style={{ color: "inherit", font: "inherit", lineHeight: "inherit", textAlign: layer.align }}
              />
            ) : layer.text}
            {selected && !layer.locked ? <div className="absolute bottom-0 right-0 h-3 w-3 cursor-nwse-resize rounded-tl bg-foreground" onPointerDown={(event) => startDrag(event, layer, "resize")} onPointerMove={moveDrag} onPointerUp={endDrag} onPointerCancel={endDrag} /> : null}
          </div>
        );
      })}
      {unsafeLayerIds.size ? <div className="absolute bottom-2 left-2 right-2 z-20 rounded-lg bg-amber-500/95 px-2 py-1.5 text-[10px] font-medium text-amber-950 shadow-sm">文字正在遮挡商品主体。请拖入虚线留白区；仍可保留此位置，但导出前请确认。</div> : null}
      {props.panel.status === "generating" ? <div className="absolute inset-0 flex items-center justify-center bg-black/25"><Loader2 className="h-7 w-7 animate-spin text-white" /></div> : null}
    </div>
  );
}

function TextLayerToolbar(props: {
  layer: CommerceImageTextLayer;
  onChange: (patch: Partial<CommerceImageTextLayer>) => void;
  onUndo: () => void;
  onRedo: () => void;
}) {
  return (
    <div className="z-10 flex shrink-0 items-center gap-2 overflow-x-auto border-b border-slate-200/80 bg-white px-4 py-2 dark:border-slate-800 dark:bg-slate-950">
      <span className="shrink-0 text-xs font-semibold">{props.layer.name}</span>
      <Select className="h-8 w-28 text-xs" value={props.layer.fontFamily} onChange={(event) => props.onChange({ fontFamily: event.target.value as CommerceImageTextLayer["fontFamily"] })} options={[{ label: "黑体", value: "sans" }, { label: "宋体", value: "serif" }, { label: "圆体", value: "rounded" }]} />
      <Select className="h-8 w-24 text-xs" value={String(props.layer.fontWeight)} onChange={(event) => props.onChange({ fontWeight: Number(event.target.value) as CommerceImageTextLayer["fontWeight"] })} options={[400, 500, 600, 700, 800, 900].map((value) => ({ label: String(value), value: String(value) }))} />
      <label className="flex shrink-0 items-center gap-1 text-[10px] text-slate-500">字号<input className="w-24 accent-accent" type="range" min="1.2" max="12" step="0.2" value={props.layer.fontSize * 100} onChange={(event) => props.onChange({ fontSize: Number(event.target.value) / 100 })} /></label>
      <label className="flex shrink-0 items-center gap-1 text-[10px] text-slate-500">行距<input className="w-20 accent-accent" type="range" min="0.8" max="2" step="0.05" value={props.layer.lineHeight} onChange={(event) => props.onChange({ lineHeight: Number(event.target.value) })} /></label>
      <input title="文字颜色" className="h-8 w-8 rounded border-0 p-0" type="color" value={props.layer.color} onChange={(event) => props.onChange({ color: event.target.value })} />
      <Select className="h-8 w-24 text-xs" value={props.layer.align} onChange={(event) => props.onChange({ align: event.target.value as CommerceImageTextLayer["align"] })} options={[{ label: "左对齐", value: "left" }, { label: "居中", value: "center" }, { label: "右对齐", value: "right" }]} />
      <IconButton label="撤销文字修改" onClick={props.onUndo}><Undo2 className="h-4 w-4" /></IconButton>
      <IconButton label="重做文字修改" onClick={props.onRedo}><Redo2 className="h-4 w-4" /></IconButton>
    </div>
  );
}

function V4CreativePlanDisplay({ task }: { task: CommerceImageTask }) {
  const [expanded, setExpanded] = useState(false);
  const creative = task.creative;
  const plan = creative?.plans.find((p) => p.id === creative?.activePlanId) || creative?.plans[creative.plans.length - 1];
  if (!plan) return null;
  return (
    <div className="shrink-0 border-b border-border bg-muted/50">
      <button type="button" onClick={() => setExpanded(!expanded)} className="flex w-full items-center justify-between px-4 py-2 text-left">
        <span className="flex items-center gap-2 text-xs font-semibold text-foreground dark:text-foreground">
          <Sparkles className="h-3.5 w-3.5" />
          AI 创作说明 · {plan.panels.length} 张 · {plan.intent.ratio}
        </span>
        <span className="text-xs text-muted-foreground">{expanded ? "收起" : "展开"}</span>
      </button>
      {expanded ? (
        <div className="space-y-3 px-4 pb-3 text-xs leading-5 text-slate-600 dark:text-slate-300">
          <div className="grid grid-cols-2 gap-2">
            <div><span className="font-semibold">目标人群：</span>{plan.intent.audienceHypothesis}</div>
            <div><span className="font-semibold">购买场景：</span>{plan.intent.buyingScenario}</div>
            <div><span className="font-semibold">核心理由：</span>{plan.intent.purchaseReason}</div>
            <div><span className="font-semibold">希望行动：</span>{plan.intent.desiredAction}</div>
          </div>
          <div><span className="font-semibold">视觉方向：</span>{plan.visualDirection.description}</div>
          {plan.visualDirection.palette.length ? (
            <div className="flex items-center gap-1.5">
              <span className="font-semibold">色板：</span>
              {plan.visualDirection.palette.map((color) => (
                <span key={color} className="inline-block h-4 w-4 rounded-full border border-slate-200" style={{ backgroundColor: color }} title={color} />
              ))}
            </div>
          ) : null}
          {plan.intent.explicitConstraints.length ? (
            <div><span className="font-semibold">持续约束：</span>{plan.intent.explicitConstraints.join("；")}</div>
          ) : null}
          <div className="space-y-1.5">
            <span className="font-semibold">页面规划：</span>
            {plan.panels.map((panel, index) => (
              <div key={panel.id} className="rounded-lg bg-white/80 px-3 py-2 dark:bg-slate-900/60">
                <span className="font-medium text-foreground dark:text-foreground">第 {index + 1} 张：</span>
                {panel.purpose}
                {panel.relationToPrevious ? <span className="ml-1 text-slate-400">（{panel.relationToPrevious}）</span> : null}
                {panel.renderMode === "source_composition" ? <span className="ml-1 text-amber-600">原图构图</span> : null}
              </div>
            ))}
          </div>
          {plan.intent.assumptions.length ? (
            <div className="text-slate-400"><span className="font-medium">AI 推测：</span>{plan.intent.assumptions.join("；")}</div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}


function EmptyCanvas({ task }: { task: CommerceImageTask }) {
  const isXiaohongshu = task.kind === "xiaohongshu_post";
  return (
    <div className="flex min-h-full items-center justify-center p-8">
      <div className="max-w-md rounded-3xl border border-dashed border-slate-300 bg-white/75 p-8 text-center dark:border-slate-700 dark:bg-slate-950/60">
        {task.status === "planning" ? <Loader2 className="mx-auto h-8 w-8 animate-spin text-foreground" /> : <WandSparkles className="mx-auto h-8 w-8 text-foreground" />}
        <h3 className="mt-4 font-semibold">{task.status === "planning" ? (isXiaohongshu ? "AI 正在整理四图故事线" : "AI 正在理解商品与视觉结构") : isXiaohongshu ? "先确认一篇完整的种草故事" : "准备好后，只需点击一次生成"}</h3>
        <p className="mt-2 text-sm leading-6 text-slate-500">{task.status === "planning" ? task.progress?.message || "正在提取商品事实、规划连续画面与文字安全区" : isXiaohongshu ? "上传自己的商品图和真实资料，写下主题；系统会先给你四张图的前中后顺序，确认后才调用生图模型。" : "上传自己的商品图；详情页再上传一张对标长图。写下想要的效果后，点击底部“生成图片”。"}</p>
      </div>
    </div>
  );
}

function SceneCard(props: {
  active: boolean;
  icon: ReactNode;
  title: string;
  description: string;
  note: string;
  preview: "detail" | "post" | "chat";
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={props.active}
      onClick={props.onClick}
      className={`group flex flex-col rounded-2xl border p-5 text-left transition-[transform,border-color,background-color,box-shadow] duration-[var(--dur-fast)] hover:-translate-y-px ${props.active ? "border-brand-ring bg-brand-soft" : "border-line bg-surface hover:border-line-strong"}`}
    >
      <ScenePreview variant={props.preview} active={props.active} />
      <div className={`mt-4 flex h-10 w-10 items-center justify-center rounded-xl ${props.active ? "bg-brand-solid text-white" : "bg-surface-2 text-ink-2"}`}>{props.icon}</div>
      <h2 className="mt-3 text-[15px] font-semibold text-ink-1">{props.title}</h2>
      <p className="mt-1.5 text-[12px] leading-5 text-ink-2">{props.description}</p>
      <p className={`mt-3 text-[11px] font-medium ${props.active ? "text-brand-solid" : "text-ink-3"}`}>{props.note}</p>
    </button>
  );
}

/** 场景线框示意：一眼看出这个场景产出什么形状的东西。 */
function ScenePreview(props: { variant: "detail" | "post" | "chat"; active: boolean }) {
  const block = `rounded-md ${props.active ? "bg-brand-solid/25" : "bg-surface-2"}`;
  if (props.variant === "detail") {
    return (
      <div className={`flex h-24 flex-col gap-1.5 rounded-xl border p-2.5 ${props.active ? "border-brand-ring" : "border-line"}`}>
        <span className={`h-3 w-2/3 ${block}`} />
        <span className={`h-6 w-full ${block}`} />
        <span className={`h-3 w-1/2 ${block}`} />
        <span className={`h-5 w-full ${block}`} />
      </div>
    );
  }
  if (props.variant === "post") {
    return (
      <div className={`grid h-24 grid-cols-3 grid-rows-2 gap-1.5 rounded-xl border p-2.5 ${props.active ? "border-brand-ring" : "border-line"}`}>
        <span className={`row-span-2 ${block}`} />
        <span className={block} />
        <span className={block} />
        <span className={block} />
        <span className={block} />
      </div>
    );
  }
  return (
    <div className={`flex h-24 flex-col justify-end gap-1.5 rounded-xl border p-2.5 ${props.active ? "border-brand-ring" : "border-line"}`}>
      <span className={`h-10 w-3/4 self-start ${block}`} />
      <span className={`h-4 w-1/2 self-end rounded-full ${props.active ? "bg-brand-solid/40" : "bg-surface-2"}`} />
      <span className={`h-5 w-2/3 self-end rounded-full ${props.active ? "bg-brand-solid/30" : "bg-surface-2"}`} />
    </div>
  );
}

function ChoiceButton(props: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={props.onClick}
      className={`rounded-full px-4 py-1.5 text-[12px] transition-colors duration-[var(--dur-instant)] ${props.active ? "bg-brand-soft font-medium text-brand-solid" : "border border-line text-ink-2 hover:border-line-strong hover:text-ink-1"}`}
    >
      {props.children}
    </button>
  );
}

function MaterialRow(props: { title: string; hint: string; action: ReactNode; children: ReactNode }) {
  return <div><div className="mb-1.5 flex items-center justify-between gap-2"><div><span className="text-xs font-semibold">{props.title}</span><span className="ml-2 text-[10px] text-slate-400">{props.hint}</span></div>{props.action}</div>{props.children}</div>;
}

function EmptyMaterial({ icon, text }: { icon: ReactNode; text: string }) {
  return <div className="flex items-center gap-2 rounded-xl border border-dashed border-slate-200 px-3 py-2 text-[11px] text-slate-400 dark:border-slate-800">{icon}<span>{text}</span></div>;
}

function AssetChip({ asset, onRemove }: { asset: CommerceImageAsset; onRemove: () => void }) {
  return <div className="group relative h-14 w-14 shrink-0 overflow-hidden rounded-xl border border-slate-200 bg-slate-100 dark:border-slate-800 dark:bg-slate-900">{asset.url ? <img src={asset.url} alt={asset.name} className="h-full w-full object-cover" /> : null}<button type="button" onClick={onRemove} className="absolute right-0.5 top-0.5 rounded-full bg-black/65 p-0.5 text-white opacity-0 transition group-hover:opacity-100"><X className="h-3 w-3" /></button><span className="absolute inset-x-0 bottom-0 truncate bg-black/60 px-1 py-0.5 text-[8px] text-white">{assetRoleLabel(asset.role)}</span></div>;
}

function HistoryDrawer({ tasks, onOpen, onClose, compact = false }: { tasks: CommerceImageTask[]; onOpen: (task: CommerceImageTask) => void; onClose: () => void; compact?: boolean }) {
  return <div className={`${compact ? "anim-pop-in absolute left-7 right-7 top-16 z-50 max-h-[55vh]" : "anim-fade-up"} overflow-y-auto rounded-2xl border border-line bg-surface p-3 shadow-xl`}><div className="mb-2 flex items-center justify-between"><span className="text-[13px] font-medium text-ink-1">历史项目</span><Button size="sm" variant="ghost" onClick={onClose}><X className="h-4 w-4" /></Button></div>{tasks.length ? <div className="space-y-1">{tasks.map((item) => <button key={item.id} type="button" onClick={() => onOpen(item)} className="flex w-full items-center justify-between gap-3 rounded-xl px-3 py-2 text-left transition-colors duration-[var(--dur-instant)] hover:bg-surface-2"><span className="min-w-0"><span className="block truncate text-[13px] text-ink-1">{item.title}</span><span className="block text-[11px] text-ink-3">{commerceImageTaskLabels[item.kind].title} · {new Date(item.updatedAt).toLocaleString("zh-CN")}</span></span><span className="shrink-0 rounded-full bg-surface-2 px-2 py-0.5 text-[11px] text-ink-2">{statusLabels[item.status]}</span></button>)}</div> : <p className="p-5 text-center text-[13px] text-ink-3">还没有历史项目</p>}</div>;
}

function Field({ label, children, compact = false }: { label: string; children: ReactNode; compact?: boolean }) {
  return <div className={compact ? "space-y-1" : "space-y-2"}><Label className={compact ? "text-[10px] text-ink-3" : "text-[12px] text-ink-2"}>{label}</Label>{children}</div>;
}

function IconButton({ label, onClick, disabled, children }: { label: string; onClick: () => void; disabled?: boolean; children: ReactNode }) {
  return <button type="button" title={label} aria-label={label} disabled={disabled} onClick={onClick} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700 disabled:opacity-25 dark:hover:bg-slate-900 dark:hover:text-slate-200">{children}</button>;
}

function Toast({ message, onClose }: { message: string; onClose: () => void }) {
  return <div className="anim-fade-up fixed bottom-6 left-1/2 z-[100] flex max-w-xl -translate-x-1/2 items-center gap-3 rounded-2xl border border-line-strong bg-surface px-4 py-3 text-[13px] text-ink-1 shadow-2xl"><span>{message}</span><button type="button" aria-label="关闭提示" onClick={onClose}><X className="h-4 w-4 text-ink-3" /></button></div>;
}

function editableTaskPayload(task: CommerceImageTask) {
  return {
    title: task.title,
    model: task.model,
    ratio: task.ratio,
    generationSetCount: task.generationSetCount,
    selectedSetId: task.selectedSetId,
    brandProfile: task.brandProfile,
    brief: task.brief,
    storyboard: task.storyboard,
    panels: task.panels,
    publishPackage: task.publishPackage
  };
}

function ownProductAssets(task: CommerceImageTask) {
  return task.sourceAssets.filter((asset) => isProductRole(asset.role));
}

function isProductRole(role: CommerceImageAssetRole) {
  return !["benchmark_reference", "reference_segment", "skill_reference", "style_reference"].includes(role);
}

function currentSetVersion(panel: CommerceImagePanel, setId: string) {
  const selected = panel.versions.find((version) => version.id === panel.selectedVersionId && version.setId === setId);
  return selected || [...panel.versions].reverse().find((version) => version.setId === setId);
}

function ratioOptions(kind: CommerceImageTaskKind, short = false) {
  const values = commerceImageRatioOrder.map((ratio) => ({ label: short ? ratio : `${ratio} · ${commerceImageRatioSizes[ratio].label}`, value: ratio }));
  return kind === "retouch" ? [{ label: "保持原尺寸", value: "original" }, ...values] : values;
}


function qualityOptionsForModel(model: CommerceImageModel) {
  if (model === "auto") {
    return [
      { label: "标准（1K）", value: "standard" },
      { label: "高清（2K）", value: "high" },
      { label: "超清（4K）", value: "ultra" }
    ];
  }
  const resolved = model as ResolvedCommerceImageModel;
  const entry = commerceImageModelRegistry[resolved];
  if (!entry?.qualityOptions) return [{ label: "高清", value: "high" }];
  return entry.qualityOptions.map((q) => ({ label: `${q.label} · ${q.description}`, value: q.value }));
}

function outputCountOptions(kind: CommerceImageTaskKind) {
  const min = 1;
  const max = kind === "detail_page" ? 12 : kind === "retouch" ? 1 : 9;
  return Array.from({ length: max - min + 1 }, (_, index) => {
    const value = min + index;
    return { label: `${value} 张`, value: String(value) };
  });
}

function fontFamily(value: CommerceImageTextLayer["fontFamily"]) {
  if (value === "serif") return "'Songti SC','Noto Serif CJK SC',serif";
  if (value === "rounded") return "'PingFang SC','Arial Rounded MT Bold',sans-serif";
  return "'PingFang SC','Noto Sans CJK SC',sans-serif";
}

function hexWithOpacity(color: string, opacity: number) {
  const alpha = Math.round(clamp(opacity, 0, 1) * 255).toString(16).padStart(2, "0");
  return `${color}${alpha}`;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function boxesOverlap(a: Pick<CommerceImageTextLayer, "x" | "y" | "width" | "height">, b: { x: number; y: number; width: number; height: number }) {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}

function hydrateLegacyDraft(products: ProductRecord[], setDraft: React.Dispatch<React.SetStateAction<Draft>>) {
  try {
    const saved = window.localStorage.getItem(imagePromptDraftStorageKey);
    if (!saved) return;
    const legacy = JSON.parse(saved) as Record<string, unknown>;
    const snapshot = legacy.productSnapshot as ProductReferenceSnapshot | undefined;
    const product = products.find((item) => item.id === legacy.productId);
    setDraft((current) => ({
      ...current,
      productId: typeof legacy.productId === "string" ? legacy.productId : "",
      productName: typeof legacy.product === "string" ? legacy.product : snapshot?.name || product?.name || "",
      productSnapshot: snapshot || (product ? createProductReferenceSnapshot(product) : undefined),
      audience: typeof legacy.audience === "string" ? legacy.audience : current.audience,
      sellingPoints: typeof legacy.sellingPoint === "string" ? legacy.sellingPoint : current.sellingPoints,
      scene: typeof legacy.scene === "string" ? legacy.scene : current.scene,
      style: typeof legacy.style === "string" ? legacy.style : current.style,
      extra: typeof legacy.extra === "string" ? legacy.extra : current.extra,
      ratio: typeof legacy.ratio === "string" && commerceImageRatioOrder.includes(legacy.ratio as never) ? legacy.ratio as CommerceImageOutputRatio : current.ratio
    }));
  } catch { /* 旧草稿损坏不阻塞新工作台 */ }
}

function syncProjectAsset(task: CommerceImageTask) {
  createAsset({
    id: `asset_image_project_${task.id}`,
    type: "image_project",
    title: task.title,
    summary: `${commerceImageTaskLabels[task.kind].title} · ${task.panels.filter((panel) => panel.versions.length).length}/${task.panels.length || 0} 张`,
    content: [task.publishPackage.title, task.publishPackage.body, task.warnings.join("\n")].filter(Boolean).join("\n\n"),
    rawData: { taskId: task.id, kind: task.kind, ratio: task.ratio, model: task.model, resolvedModelId: task.resolvedModelId, status: task.status },
    sourceModule: "image",
    platform: task.kind === "douyin_post" ? "douyin" : task.kind === "xiaohongshu_post" ? "xiaohongshu" : "taobao",
    productId: task.productId,
    productName: task.productName,
    tags: [commerceImageTaskLabels[task.kind].title, task.ratio, task.resolvedModelId].filter(Boolean),
    status: task.status === "failed" ? "failed" : task.status === "completed" ? "completed" : "draft",
    linkedRecordIds: [task.id]
  });
}

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  const payload = await response.json().catch(() => ({})) as T & { success?: boolean; message?: string };
  if (!response.ok || payload.success === false) throw new Error(payload.message || `请求失败（${response.status}）`);
  return payload;
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "操作失败，请稍后重试。";
}
