"use client";

import { CheckCircle2, Loader2, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CommerceDetailWorkspace } from "@/components/image-generator/detail-workspace";
import { ImageGeneratorHome } from "@/components/image-generator/image-generator-home";
import { MarketingLearningDrawer } from "@/components/image-generator/marketing-learning-drawer";
import { SocialCommerceWorkspace, type SocialGoal } from "@/components/image-generator/social-workspace";
import type { ComposerControl } from "@/components/image-generator/workspace-frame";
import {
  DEFAULT_COMMERCE_IMAGE_MODEL,
  commerceImageDefaultCardCount,
  commerceImageModelOptions,
  defaultCommerceImageModelId,
  commerceImageModelRegistry,
  commerceImageRatioOrder,
  commerceImageTaskLabels
} from "@/lib/commerce-image-models";
import { ProductPickerDialog, type SelectedProductInfo } from "@/components/image-generator/product-selection";
import { PromptSnapshotDrawer } from "@/components/image-generator/prompt-snapshot-drawer";
import { readCommerceImageDraft, saveCommerceImageDraft } from "@/lib/commerce-image-draft";
import { chooseResumeTask, rememberActiveCommerceTask } from "@/lib/commerce-image-last-task";
import { CreateProductDialog } from "@/components/products/product-asset-center";
import { ProductEditor } from "@/components/products/product-editor";
import { createAsset } from "@/lib/stores/asset-store";
import { listProductsWithAssets, buildProductPromptFacts, getProductWithAssets, hydrateProductRecord, resumePendingDocumentAnalyses, subscribeProductUpdates } from "@/lib/product-assets-client";
import { createProductReferenceSnapshot, formatProductReferenceForPrompt } from "@/lib/product-reference";
import type { ProductRecord } from "@/lib/pipeline-types";
import type {
  CommerceImageAssetRole,
  CommerceImageModel,
  CommerceImageOutputRatio,
  CommerceImagePanel,
  CommerceImageQuality,
  CommerceImageTask,
  CommerceImageTaskKind,
  CommerceImageVersion
} from "@/lib/commerce-image-types";

const socialGoalKey = "director-platform:commerce-image:social-goal";

const statusLabels: Record<CommerceImageTask["status"], string> = {
  draft: "草稿",
  awaiting_input: "待补充",
  planning: "理解中",
  awaiting_approval: "待确认",
  queued: "排队中",
  generating: "生成中",
  partial: "部分完成",
  completed: "已完成",
  failed: "失败",
  cancelled: "已取消"
};

type Controls = {
  model: CommerceImageModel;
  ratio: CommerceImageOutputRatio;
  count: number;
  quality: CommerceImageQuality;
};

export function ImageGeneratorPage() {
  const [tasks, setTasks] = useState<CommerceImageTask[]>([]);
  const [task, setTask] = useState<CommerceImageTask | null>(null);
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");
  const [prompt, setPrompt] = useState("");
  const [historyVisible, setHistoryVisible] = useState(false);
  const [settingsVisible, setSettingsVisible] = useState(false);
  const [learningOpen, setLearningOpen] = useState(false);
  const [promptSnapshotVisible, setPromptSnapshotVisible] = useState(false);
  const [learningFocus, setLearningFocus] = useState<{ taskId?: string; versionId?: string; creativeId?: string }>({});
  const [providers, setProviders] = useState<Array<{ provider: string; label: string; configured: boolean; maskedKey: string; verifiedForCurrentConfig: boolean; message: string }>>([]);
  const [referenceLink, setReferenceLink] = useState("");
  const [goal, setGoal] = useState<SocialGoal>("traffic");
  const [controls, setControls] = useState<Controls>({
    model: DEFAULT_COMMERCE_IMAGE_MODEL,
    ratio: "9:16",
    count: 1,
    quality: "high"
  });
  /* ---- 产品资产 ---- */
  const [productLibrary, setProductLibrary] = useState<ProductRecord[]>([]);
  const [productPickerOpen, setProductPickerOpen] = useState(false);
  const [createProductOpen, setCreateProductOpen] = useState(false);
  const [editingProductId, setEditingProductId] = useState("");
  const [selectionDraft, setSelectionDraft] = useState<{ mode: "all" | "selected"; selectedImageIds: string[] }>({ mode: "all", selectedImageIds: [] });

  const taskRef = useRef<CommerceImageTask | null>(null);
  const tasksRef = useRef<CommerceImageTask[]>([]);
  const taskListReadyRef = useRef(false);
  const messageTimer = useRef<number | null>(null);
  /* 正在跟踪的生成任务：点过生成之后就一直轮询真实任务状态，
   * 直到任务进入终态或等待确认。不依赖某一帧的 status，避免被迟到的旧状态打断。 */
  const [watchingTaskId, setWatchingTaskId] = useState("");
  const watchingRef = useRef("");
  const submitLockRef = useRef(false);
  watchingRef.current = watchingTaskId;

  taskRef.current = task;

  const notify = useCallback((text: string) => {
    setMessage(text);
    if (messageTimer.current) window.clearTimeout(messageTimer.current);
    messageTimer.current = window.setTimeout(() => setMessage(""), 5200);
  }, []);

  const installTask = useCallback((next: CommerceImageTask, updateList = true) => {
    const previous = taskRef.current;
    /* 刚点过生成时，服务端文件可能还没写上 running 状态，
     * 这时读到 draft 属于「迟到的旧状态」，不能把已经开始的生成打回空状态。 */
    const staleDraft = watchingRef.current === next.id
      && previous?.id === next.id
      && ["planning", "queued", "generating"].includes(previous.status)
      && ["draft", "awaiting_input"].includes(next.status);
    const applied = staleDraft
      ? { ...next, status: previous.status, progress: previous.progress }
      : next;
    taskRef.current = applied;
    setTask(applied);
    /* 记住「最近一次在用的任务」：离开页面再回来默认恢复到它，而不是新建空白任务。 */
    rememberActiveCommerceTask(applied.id, applied.kind);
    if (updateList) {
      setTasks((current) => {
        const next = [applied, ...current.filter((item) => item.id !== applied.id)].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
        tasksRef.current = next;
        return next;
      });
    }
    syncProjectAsset(applied);
  }, []);

  const refreshTask = useCallback(async (taskId: string) => {
    try {
      const payload = await requestJson<{ task: CommerceImageTask }>(`/api/commerce-image/tasks?taskId=${encodeURIComponent(taskId)}`);
      installTask(payload.task);
    } catch (error) {
      notify(errorMessage(error));
    }
  }, [installTask, notify]);

  const loadTaskList = useCallback(async () => {
    const payload = await requestJson<{ tasks: CommerceImageTask[] }>("/api/commerce-image/tasks");
    const list = payload.tasks || [];
    tasksRef.current = list;
    taskListReadyRef.current = true;
    setTasks(list);
    return list;
  }, []);

  useEffect(() => {
    const savedGoal = window.localStorage.getItem(socialGoalKey);
    if (savedGoal === "traffic" || savedGoal === "conversion") setGoal(savedGoal);
    void (async () => {
      try {
        const [list, providerPayload] = await Promise.all([
          loadTaskList(),
          requestJson<{ providers: typeof providers }>("/api/commerce-image/providers").catch(() => ({ providers: [] }))
        ]);
        setProviders(providerPayload.providers || []);
        /* 只有 URL 明确带任务时才直接进任务；否则停在首页，由用户点模式卡片时恢复最近任务。 */
        const taskId = new URLSearchParams(window.location.search).get("task");
        const found = list.find((item) => item.id === taskId);
        /* 没有 URL 指定时，恢复最近一次在用的任务：离开页面再回来不回到空白首页。 */
        const resume = found || list[0] || null;
        if (resume) {
          if (["planning", "queued", "generating"].includes(resume.status)) setWatchingTaskId(resume.id);
          installTask(resume, false);
          window.history.replaceState(null, "", "/image-generator?task=" + encodeURIComponent(resume.id));
        }
      } catch (error) {
        notify(errorMessage(error));
      }
    })();
  }, [installTask, loadTaskList, notify]);

  /* 打开任务（含刷新、从历史记录进入）时恢复这个任务的创作状态：
   * 输入框文字、模型 / 比例 / 数量 / 清晰度、内容目标、对标链接。
   * 优先用本地草稿（用户最后编辑但还没生成的内容），没有草稿就用任务快照里的原始需求。 */
  useEffect(() => {
    const current = taskRef.current;
    if (!task?.id || !current) return;
    const draft = readCommerceImageDraft(task.id);
    setPrompt(draft?.prompt ?? current.promptSnapshot?.userInstruction ?? "");
    setControls({
      /* 「自动推荐」是旧版本的默认值，不代表用户主动选过；统一落到新默认模型，
       * 用户自己选过的其它模型照旧保留。 */
      model: draft?.model || (current.model === "auto" ? DEFAULT_COMMERCE_IMAGE_MODEL : current.model),
      ratio: draft?.ratio || current.ratio,
      count: draft?.count || current.brief.cardCount,
      quality: draft?.quality || current.quality || "high"
    });
    if (draft?.goal === "traffic" || draft?.goal === "conversion") setGoal(draft.goal);
    setReferenceLink(draft?.referenceLink || "");
    // 仅在同一项目切换时恢复，避免覆盖用户正在调整的参数
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [task?.id]);

  /* 还没点生成的编辑也留在本地：切去别的页面再回来不用重打。 */
  useEffect(() => {
    const current = taskRef.current;
    if (!task?.id || !current || current.id !== task.id) return;
    saveCommerceImageDraft(task.id, {
      kind: current.kind,
      prompt,
      model: controls.model,
      ratio: controls.ratio,
      count: controls.count,
      quality: controls.quality,
      goal,
      referenceLink
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [task?.id, prompt, controls.model, controls.ratio, controls.count, controls.quality, goal, referenceLink]);

  const taskRunning = Boolean(task && ["planning", "queued", "generating"].includes(task.status));
  const terminalStatuses: CommerceImageTask["status"][] = ["completed", "partial", "failed", "cancelled", "awaiting_approval"];

  useEffect(() => {
    if (!task) return;
    // 跟踪中：即使某一帧读到还没开始的旧状态，也继续轮询真实任务。
    const watching = watchingTaskId === task.id;
    if (!watching && !taskRunning) return;
    const timer = window.setInterval(() => void refreshTask(task.id), 1500);
    return () => window.clearInterval(timer);
  }, [task?.id, task?.status, taskRunning, watchingTaskId, refreshTask]);

  // 任务进入终态（或等待故事线确认）后结束跟踪。
  useEffect(() => {
    if (!task || !watchingTaskId || watchingTaskId !== task.id) return;
    if (terminalStatuses.includes(task.status)) setWatchingTaskId("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [task?.id, task?.status, watchingTaskId]);

  useEffect(() => () => {
    if (messageTimer.current) window.clearTimeout(messageTimer.current);
  }, []);

  /* ---- 产品资产：读取可选产品、维护本次选择 ---- */
  const refreshProductLibrary = useCallback(() => {
    try {
      // 上次中途关过页面时，把没跑完的产品资料解析接着跑
      resumePendingDocumentAnalyses();
      setProductLibrary(listProductsWithAssets());
    } catch {
      setProductLibrary([]);
    }
  }, []);

  useEffect(() => { refreshProductLibrary(); }, [refreshProductLibrary]);
  useEffect(() => subscribeProductUpdates(() => refreshProductLibrary()), [refreshProductLibrary]);

  useEffect(() => {
    if (!task?.productId) return;
    setSelectionDraft({
      mode: task.productImageSelection?.mode || "all",
      selectedImageIds: task.productImageSelection?.selectedImageIds || []
    });
  }, [task?.id, task?.productId, task?.productImageSelection?.updatedAt, task?.productImageSelection?.mode, task?.productImageSelection?.selectedImageIds]);

  const productModelLimit = useMemo(() => {
    const modelId = controls.model === "auto" ? defaultCommerceImageModelId : controls.model;
    return commerceImageModelRegistry[modelId as Exclude<CommerceImageModel, "auto">]?.maxReferenceImages || 8;
  }, [controls.model]);

  /* 历史任务：产品被删除或改过之后，仍然按生成时的快照展示当时的产品与图片。 */
  const selectedProduct = useMemo<SelectedProductInfo | null>(() => {
    if (!task?.productId) return null;
    const live = productLibrary.find((item) => item.id === task.productId);
    const snapshot = task.productAssetSnapshot;
    if (live) {
      return {
        id: live.id,
        name: live.name,
        imageCount: (live.images || []).length,
        documentName: live.document?.name || "",
        hasDocument: Boolean(live.document?.id),
        images: live.images || [],
        mode: selectionDraft.mode,
        selectedImageIds: selectionDraft.selectedImageIds
      };
    }
    const attached = task.sourceAssets.filter((asset) => (task.productImageSelection?.attachedAssetIds || []).includes(asset.id));
    return {
      id: task.productId,
      name: snapshot?.productName || task.productName || "已删除的产品",
      imageCount: snapshot?.imageCount || attached.length,
      documentName: snapshot?.documentName || "",
      hasDocument: Boolean(snapshot?.documentId),
      images: attached.map((asset) => ({
        id: asset.id,
        name: asset.name,
        role: "",
        mimeType: asset.mimeType,
        width: asset.width || 0,
        height: asset.height || 0,
        size: asset.size,
        addedAt: asset.createdAt,
        url: asset.url,
        thumbUrl: asset.url
      })),
      mode: selectionDraft.mode,
      selectedImageIds: selectionDraft.selectedImageIds
    };
  }, [task, productLibrary, selectionDraft]);

  function selectionDirty() {
    const current = taskRef.current;
    if (!current?.productId) return false;
    const applied = current.productImageSelection;
    if (!applied) return true;
    if (applied.mode !== selectionDraft.mode) return true;
    if (selectionDraft.mode === "all") return false;
    const a = [...(applied.selectedImageIds || [])].sort().join(",");
    const b = [...selectionDraft.selectedImageIds].sort().join(",");
    return a !== b;
  }

  /** 把当前「我的产品 + 本次参考图片」交给服务端：复制图片到任务目录并固化产品快照。 */
  const applyProduct = useCallback(async (
    record: ProductRecord,
    mode: "all" | "selected",
    selectedImageIds: string[],
    silent = false
  ): Promise<CommerceImageTask | null> => {
    const current = taskRef.current;
    if (!current) return null;
    const hydrated = getProductWithAssets(record.id, { includeArchived: true }) || hydrateProductRecord(record);
    const payload = await requestJson<{ task: CommerceImageTask; message: string }>(
      `/api/commerce-image/tasks/${encodeURIComponent(current.id)}/product`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          product: {
            id: hydrated.id,
            name: hydrated.name,
            brandName: hydrated.brandName || "",
            category: hydrated.category || "",
            documentId: hydrated.document?.id || "",
            documentName: hydrated.document?.name || "",
            documentRevision: hydrated.document?.revision || 0,
            documentUpdatedAt: hydrated.document?.updatedAt || "",
            documentText: hydrated.document?.text || hydrated.sourceDocumentText || "",
            referenceText: formatProductReferenceForPrompt(createProductReferenceSnapshot(hydrated)),
            facts: buildProductPromptFacts(hydrated),
            images: (hydrated.images || []).map((image) => ({ id: image.id, role: image.role || "", name: image.name }))
          },
          mode,
          selectedImageIds
        })
      }
    );
    installTask(payload.task);
    if (!silent) notify(payload.message);
    return payload.task;
  }, [installTask, notify]);

  const running = Boolean(task && ["planning", "queued", "generating"].includes(task.status));
  /* 点完「生成图片」到服务端受理之间也要立刻有反馈：进度条从这里就开始走。 */
  const submitting = (busy === "generate" || busy === "regenerate") && !running;
  const isSocial = task?.kind === "douyin_post" || task?.kind === "xiaohongshu_post";

  async function saveTask(current: CommerceImageTask): Promise<CommerceImageTask | null> {
    try {
      const payload = await requestJson<{ task: CommerceImageTask }>(`/api/commerce-image/tasks/${encodeURIComponent(current.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: current.title,
          model: controls.model,
          ratio: controls.ratio,
          quality: controls.quality,
          generationSetCount: current.generationSetCount,
          selectedSetId: current.selectedSetId,
          brief: { ...current.brief, cardCount: controls.count },
          panels: current.panels,
          publishPackage: current.publishPackage
        })
      });
      installTask(payload.task);
      return payload.task;
    } catch (error) {
      notify(errorMessage(error));
      return null;
    }
  }

  /**
   * 进入某个模式：默认恢复「最近一次该类型的任务」。
   * 只有从来没有过该类型任务时，才真正新建——这样离开页面再回来不会莫名多出空白任务。
   */
  async function startMode(kind: CommerceImageTaskKind) {
    try {
      const list = taskListReadyRef.current ? tasksRef.current : await loadTaskList();
      const resume = chooseResumeTask(list, kind);
      if (resume) {
        openTask(resume);
        return;
      }
    } catch (error) {
      notify(errorMessage(error));
      return;
    }
    await createTask(kind);
  }

  /** 明确新建：只有用户点「新建」才会得到空白任务。 */
  function newTask() {
    void createTask(taskRef.current?.kind || "xiaohongshu_post");
  }

  async function createTask(kind: CommerceImageTaskKind) {
    setBusy("create");
    try {
      const payload = await requestJson<{ task: CommerceImageTask }>("/api/commerce-image/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind,
          title: `${commerceImageTaskLabels[kind].title} · ${new Date().toLocaleDateString("zh-CN")}`,
          model: DEFAULT_COMMERCE_IMAGE_MODEL,
          ratio: commerceImageTaskLabels[kind].defaultRatio,
          generationSetCount: 1,
          quality: "high",
          brief: {
            cardCount: commerceImageDefaultCardCount[kind],
            strategy: "auto"
          }
        })
      });
      installTask(payload.task);
      window.history.replaceState(null, "", `/image-generator?task=${encodeURIComponent(payload.task.id)}`);
    } catch (error) {
      notify(errorMessage(error));
    } finally {
      setBusy("");
    }
  }

  /** 打开营销学习闭环：有具体画面时定位到那张图的 creativeId。 */
  function openLearning(panel?: CommerceImagePanel, version?: CommerceImageVersion) {
    const current = taskRef.current;
    setLearningFocus(panel && version && current ? { taskId: current.id, versionId: version.id } : {});
    setLearningOpen(true);
  }

  function backToHome() {
    setTask(null);
    taskRef.current = null;
    setWatchingTaskId("");
    setPrompt("");
    setReferenceLink("");
    window.history.replaceState(null, "", "/image-generator");
  }

  function openTask(next: CommerceImageTask) {
    setWatchingTaskId(["planning", "queued", "generating"].includes(next.status) ? next.id : "");
    installTask(next, false);
    setHistoryVisible(false);
    window.history.replaceState(null, "", `/image-generator?task=${encodeURIComponent(next.id)}`);
  }

  async function uploadAssets(files: File[], role: CommerceImageAssetRole) {
    const current = taskRef.current;
    if (!current || !files.length) return;
    const productCount = current.sourceAssets.filter((asset) => isProductRole(asset.role)).length;
    if (isProductRole(role) && productCount + files.length > 8) {
      notify("自己的商品图最多 8 张，请先删除不需要的图片。");
      return;
    }
    setBusy(`upload:${role}`);
    try {
      const saved = await saveTask(current);
      if (!saved) return;
      const form = new FormData();
      Array.from(files).forEach((file) => form.append("images", file));
      form.set("role", role);
      form.set("saveToProductProfile", role === "benchmark_reference" ? "false" : "true");
      const payload = await requestJson<{ task: CommerceImageTask; message: string }>(
        `/api/commerce-image/tasks/${encodeURIComponent(saved.id)}/assets`,
        { method: "POST", body: form }
      );
      installTask(payload.task);
      notify(payload.message || "素材已上传。");
    } catch (error) {
      notify(errorMessage(error));
    } finally {
      setBusy("");
    }
  }

  async function removeAsset(assetId: string) {
    const current = taskRef.current;
    if (!current || !window.confirm("确定从当前项目删除这张素材吗？")) return;
    try {
      const payload = await requestJson<{ task: CommerceImageTask }>(
        `/api/commerce-image/tasks/${encodeURIComponent(current.id)}/assets?assetId=${encodeURIComponent(assetId)}`,
        { method: "DELETE" }
      );
      installTask(payload.task);
      notify("素材已移除。");
    } catch (error) {
      notify(errorMessage(error));
    }
  }

  async function uploadDocuments(files: File[]) {
    const current = taskRef.current;
    if (!current || !files.length) return;
    setBusy("documents");
    try {
      const saved = await saveTask(current);
      if (!saved) return;
      const form = new FormData();
      Array.from(files).forEach((file) => form.append("documents", file));
      const payload = await requestJson<{ task: CommerceImageTask; message: string }>(
        `/api/commerce-image/tasks/${encodeURIComponent(saved.id)}/documents`,
        { method: "POST", body: form }
      );
      installTask(payload.task);
      notify(payload.message || "产品资料已上传。");
    } catch (error) {
      notify(errorMessage(error));
    } finally {
      setBusy("");
    }
  }

  /** 产品被编辑后：刷新产品库；已经删掉的图片从本次勾选里剔除；不动已创建任务的快照。 */
  function handleProductEdited(record: ProductRecord, options: { deletedImageIds: string[] }) {
    const deletedImageIds = options.deletedImageIds;
    refreshProductLibrary();
    const live = getProductWithAssets(record.id, { includeArchived: true }) || record;
    const liveIds = new Set((live.images || []).map((image) => image.id));
    setSelectionDraft((current) => {
      if (!current.selectedImageIds.length) return current;
      const kept = current.selectedImageIds.filter((id) => liveIds.has(id) && !deletedImageIds.includes(id));
      return kept.length === current.selectedImageIds.length ? current : { ...current, selectedImageIds: kept };
    });
    if (deletedImageIds.length) {
      notify(`产品已更新。被删除的 ${deletedImageIds.length} 张图片已从本次选择中移除。`);
    } else {
      notify("产品已更新，本次选择会在下次生成时使用最新数据。");
    }
  }

  function pickProduct(record: ProductRecord) {
    setProductPickerOpen(false);
    setSelectionDraft({ mode: "all", selectedImageIds: [] });
    setBusy("product");
    void (async () => {
      try {
        await applyProduct(record, "all", []);
      } catch (error) {
        notify(errorMessage(error));
      } finally {
        setBusy("");
      }
    })();
  }

  function detachProduct() {
    const current = taskRef.current;
    if (!current) return;
    setBusy("product");
    void (async () => {
      try {
        const payload = await requestJson<{ task: CommerceImageTask; message: string }>(
          `/api/commerce-image/tasks/${encodeURIComponent(current.id)}/product`,
          { method: "DELETE" }
        );
        installTask(payload.task);
        setSelectionDraft({ mode: "all", selectedImageIds: [] });
        notify(payload.message);
      } catch (error) {
        notify(errorMessage(error));
      } finally {
        setBusy("");
      }
    })();
  }

  function changeProductImageMode(mode: "all" | "selected") {
    setSelectionDraft((current) => mode === "all"
      ? { mode: "all", selectedImageIds: [] }
      : {
        mode: "selected",
        selectedImageIds: current.selectedImageIds.length
          ? current.selectedImageIds
          : (selectedProduct?.images || []).map((image) => image.id)
      });
  }

  function toggleProductImage(imageId: string) {
    setSelectionDraft((current) => ({
      mode: "selected",
      selectedImageIds: current.selectedImageIds.includes(imageId)
        ? current.selectedImageIds.filter((id) => id !== imageId)
        : [...current.selectedImageIds, imageId]
    }));
  }

  async function removeDocument(documentId: string) {
    const current = taskRef.current;
    if (!current || !window.confirm("确定删除这份产品资料吗？")) return;
    try {
      const payload = await requestJson<{ task: CommerceImageTask }>(
        `/api/commerce-image/tasks/${encodeURIComponent(current.id)}/documents?documentId=${encodeURIComponent(documentId)}`,
        { method: "DELETE" }
      );
      installTask(payload.task);
    } catch (error) {
      notify(errorMessage(error));
    }
  }

  async function syncProductSelection() {
    const current = taskRef.current;
    if (!current?.productId || !selectionDirty()) return;
    const record = getProductWithAssets(current.productId, { includeArchived: true });
    if (!record) return;
    await applyProduct(record, selectionDraft.mode, selectionDraft.selectedImageIds, true);
  }

  async function generate(panelIds?: string[]) {
    const current = taskRef.current;
    if (!current) return;
    // 同步锁：连点两次不会发两次请求（服务端也有兜底，避免重复扣费）。
    if (submitLockRef.current) return;
    submitLockRef.current = true;
    try {
      await syncProductSelection();
    } catch (error) {
      notify(errorMessage(error));
      submitLockRef.current = false;
      return;
    }
    /* 电商图文不再有「先确认故事线」这一步：内部规划（多图顺序、卖点分配、文案结构）
     * 由后台在这一次生成里自动完成，用户只点一次「生成图片」。 */
    setBusy(panelIds?.length ? "regenerate" : "generate");
    /* 点下生成就立刻让右侧进入「生成中」：不等网络返回，也不需要切页面或刷新。 */
    setWatchingTaskId(current.id);
    installTask({
      ...current,
      status: "queued",
      progress: {
        completed: 0,
        total: Math.max(1, panelIds?.length || current.brief.cardCount),
        currentPanelId: "",
        message: panelIds?.length ? "正在重新生成当前画面" : "已开始生成，正在准备直连出图",
        updatedAt: new Date().toISOString()
      }
    });
    const saved = await saveTask(current);
    if (!saved) {
      setBusy("");
      return;
    }
    try {
      const instruction = panelIds?.length ? "" : prompt.trim();
      const payload = await requestJson<{ task: CommerceImageTask; message: string; started?: boolean }>(
        `/api/commerce-image/tasks/${encodeURIComponent(saved.id)}/generate`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ panelIds, instruction, oneClick: true })
        }
      );
      if (payload.started === false) {
        installTask(payload.task);
        notify(payload.message);
        return;
      }
      /* 输入框不要清空：任务完成后用户仍能看到这次真正提的需求（也留在提示词快照里）。 */
      // 立即进入生成中，并把当前项目登记为「跟踪中」——右侧马上出现生成占位。
      setWatchingTaskId(saved.id);
      installTask({
        ...payload.task,
        status: "queued",
        progress: {
          completed: 0,
          total: Math.max(1, saved.brief.cardCount),
          currentPanelId: "",
          message: panelIds?.length ? "正在重新生成当前画面" : "AI 正在理解素材与需求",
          updatedAt: new Date().toISOString()
        }
      });
      notify(payload.message);
      await refreshTask(saved.id);
    } catch (error) {
      notify(errorMessage(error));
    } finally {
      setBusy("");
      submitLockRef.current = false;
    }
  }

  async function stopGeneration() {
    const current = taskRef.current;
    if (!current) return;
    try {
      const payload = await requestJson<{ message: string }>(`/api/commerce-image/tasks/${encodeURIComponent(current.id)}/cancel`, { method: "POST" });
      notify(payload.message || "已请求停止生成。");
      await refreshTask(current.id);
    } catch (error) {
      notify(errorMessage(error));
    }
  }

  async function selectVersion(panel: CommerceImagePanel, versionId: string) {
    const current = taskRef.current;
    if (!current) return;
    const nextPanels = current.panels.map((item) => item.id === panel.id ? { ...item, selectedVersionId: versionId } : item);
    installTask({ ...current, panels: nextPanels });
    try {
      await requestJson<{ task: CommerceImageTask }>(`/api/commerce-image/tasks/${encodeURIComponent(current.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ panels: nextPanels.filter((item) => item.id === panel.id) })
      });
    } catch (error) {
      notify(errorMessage(error));
    }
  }

  function downloadVersion(_panel: CommerceImagePanel, version: CommerceImageVersion) {
    if (!version.imageUrl) {
      notify("这张图片暂时无法直接下载，请使用导出功能。");
      return;
    }
    const link = document.createElement("a");
    link.href = version.imageUrl;
    link.download = `${version.id}.png`;
    link.click();
  }

  async function saveReferenceLink() {
    const current = taskRef.current;
    if (!current) return;
    const link = referenceLink.trim();
    if (!link) return;
    try {
      const payload = await requestJson<{ task: CommerceImageTask }>(`/api/commerce-image/tasks/${encodeURIComponent(current.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ brief: { ...current.brief, extra: [current.brief.extra, `对标内容链接：${link}`].filter(Boolean).join("\n") } })
      });
      installTask(payload.task);
      setReferenceLink("");
      notify("链接已保存为创作参考文本。");
    } catch (error) {
      notify(errorMessage(error));
    }
  }

  async function changeGoal(next: SocialGoal) {
    setGoal(next);
    window.localStorage.setItem(socialGoalKey, next);
    const current = taskRef.current;
    if (!current || !isSocial) return;
    try {
      const payload = await requestJson<{ task: CommerceImageTask }>(`/api/commerce-image/tasks/${encodeURIComponent(current.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ brief: { ...current.brief, strategy: next === "conversion" ? "evidence" : "scenario" } })
      });
      installTask(payload.task);
    } catch (error) {
      notify(errorMessage(error));
    }
  }

  const composerControls = useMemo<ComposerControl[]>(() => {
    /* 比例只表示构图比例：具体像素由「清晰度」档位决定（Direct Mode 下 4K 会真的请求长边 4096），
     * 所以这里不再显示固定尺寸，避免出现「选了 4K 但显示 1536 × 2048」的误导。 */
    const ratioOptions = commerceImageRatioOrder.map((ratio) => ({ value: ratio, label: ratio }));
    const maxCount = task?.kind === "detail_page" ? 12 : task?.kind === "retouch" ? 1 : 9;
    const countOptions = Array.from({ length: maxCount }, (_, index) => ({ value: String(index + 1), label: `${index + 1} 张` }));
    const modelId = controls.model === "auto" ? "auto" : controls.model;
    /* 档位只说名字，具体像素由下面的「请求 W × H」如实给出。
     * 2026-09-27 复测：GPT Image 2.5 通道已原生支持长边 4096，超清档即真 4K。 */
    const qualityOptions = controls.model === "auto"
      ? [{ value: "standard", label: "标准" }, { value: "high", label: "高清" }, { value: "ultra", label: "超清" }]
      : (commerceImageModelRegistry[controls.model as Exclude<CommerceImageModel, "auto">]?.qualityOptions || [{ value: "high", label: "高清" }])
        .map((option) => ({ value: option.value, label: option.label }));

    return [
      {
        key: "model",
        label: "模型",
        value: modelId,
        options: commerceImageModelOptions.map((option) => ({ value: option.value, label: option.label })),
        onChange: (value) => setControls((current) => ({ ...current, model: value as CommerceImageModel }))
      },
      {
        key: "ratio",
        label: "比例",
        value: controls.ratio === "original" ? "3:4" : controls.ratio,
        options: ratioOptions,
        onChange: (value) => setControls((current) => ({ ...current, ratio: value as CommerceImageOutputRatio }))
      },
      {
        key: "count",
        label: "数量",
        value: String(controls.count),
        options: countOptions,
        onChange: (value) => setControls((current) => ({ ...current, count: Number(value) }))
      },
      {
        key: "quality",
        label: "清晰度",
        value: controls.quality,
        options: qualityOptions,
        onChange: (value) => setControls((current) => ({ ...current, quality: value as CommerceImageQuality }))
      }
    ];
  }, [controls, task?.kind]);

  const canGenerate = Boolean(taskRef.current) && !running && Boolean(task?.sourceAssets.some((asset) => isProductRole(asset.role)));

  /* 首页模式卡片上的「继续上次」提示：让「默认恢复」这件事看得见。 */
  const resumeTitles = useMemo(() => ({
    detail: chooseResumeTask(tasks, "detail_page")?.title || "",
    social: chooseResumeTask(tasks, "xiaohongshu_post")?.title || ""
  }), [tasks]);

  if (!task) {
    return (
      <>
        <ImageGeneratorHome
          busy={busy === "create"}
          resume={resumeTitles}
          onSelectDetail={() => void startMode("detail_page")}
          onSelectSocial={() => void startMode("xiaohongshu_post")}
          onOpenHistory={() => setHistoryVisible(true)}
          onOpenSettings={() => setSettingsVisible(true)}
          onOpenLearning={() => openLearning()}
        />
        <Toast message={message} onClose={() => setMessage("")} />
        {historyVisible ? <HistoryDrawer tasks={tasks} onOpen={openTask} onClose={() => setHistoryVisible(false)} /> : null}
        {settingsVisible ? <SettingsDrawer providers={providers} onClose={() => setSettingsVisible(false)} /> : null}
        <MarketingLearningDrawer open={learningOpen} {...learningFocus} onClose={() => setLearningOpen(false)} />
      </>
    );
  }

  const shared = {
    task,
    busy,
    prompt,
    onPromptChange: setPrompt,
    onBack: backToHome,
    onOpenHistory: () => setHistoryVisible(true),
    onOpenSettings: () => setSettingsVisible(true),
    onNewTask: newTask,
    onOpenPrompt: () => setPromptSnapshotVisible(true),
    onOpenLearning: (panel?: CommerceImagePanel, version?: CommerceImageVersion) => openLearning(panel, version),
    onUploadAssets: uploadAssets,
    onRemoveAsset: removeAsset,
    onUploadDocuments: uploadDocuments,
    onRemoveDocument: removeDocument,
    selectedProduct,
    productModelLimit,
    onOpenProductPicker: () => setProductPickerOpen(true),
    onCreateProduct: () => setCreateProductOpen(true),
    onEditProduct: () => { if (task.productId) setEditingProductId(task.productId); },
    onDetachProduct: detachProduct,
    onProductImageMode: changeProductImageMode,
    onToggleProductImage: toggleProductImage,
    onSelectAllProductImages: () => setSelectionDraft({ mode: "selected", selectedImageIds: (selectedProduct?.images || []).map((image) => image.id) }),
    onClearProductImages: () => setSelectionDraft({ mode: "selected", selectedImageIds: [] }),
    onGenerate: () => void generate(),
    onStop: () => void stopGeneration(),
    generating: running || submitting,
    submitting,
    canGenerate,
    onDownload: downloadVersion,
    onRegenerate: (panelId: string) => void generate([panelId]),
    onRetryFailed: () => {
      const failed = (taskRef.current?.panels || []).filter((panel) => panel.status === "failed").map((panel) => panel.id);
      void generate(failed.length ? failed : undefined);
    },
    onSelectVersion: (panel: CommerceImagePanel, versionId: string) => void selectVersion(panel, versionId),
    composerControls: composerControls.filter((control) => control.key === "model"),
    settings: { ratio: controls.ratio, quality: controls.quality, count: controls.count },
    onSettingsChange: (next: { ratio: CommerceImageOutputRatio; quality: CommerceImageQuality; count: number }) =>
      setControls((current) => ({ ...current, ...next })),
    settingsModel: controls.model,
    composerHint: running
      ? "生成中，完成后会自动刷新。"
      : `${statusLabels[task.status]} · ${commerceImageTaskLabels[task.kind].title}`
  };

  return (
    <>
      {isSocial ? (
        <SocialCommerceWorkspace
          {...shared}
          referenceLink={referenceLink}
          onReferenceLinkChange={setReferenceLink}
          onSaveReferenceLink={() => void saveReferenceLink()}
        />
      ) : (
        <CommerceDetailWorkspace {...shared} />
      )}

      <Toast message={message} onClose={() => setMessage("")} />
      {historyVisible ? <HistoryDrawer tasks={tasks} onOpen={openTask} onClose={() => setHistoryVisible(false)} /> : null}
      {settingsVisible ? <SettingsDrawer providers={providers} onClose={() => setSettingsVisible(false)} /> : null}
      <MarketingLearningDrawer open={learningOpen} {...learningFocus} onClose={() => setLearningOpen(false)} />
      {promptSnapshotVisible ? (
        <PromptSnapshotDrawer
          snapshot={task.promptSnapshot}
          fallbackInstruction={task.brief.extra}
          onClose={() => setPromptSnapshotVisible(false)}
          onNotify={notify}
        />
      ) : null}
      {productPickerOpen ? (
        <ProductPickerDialog
          products={productLibrary}
          activeId={task.productId}
          busy={busy === "product"}
          onPick={pickProduct}
          onCreate={() => { setProductPickerOpen(false); setCreateProductOpen(true); }}
          onEdit={(productId) => setEditingProductId(productId)}
          onClose={() => setProductPickerOpen(false)}
        />
      ) : null}
      {editingProductId ? (
        <ProductEditor
          productId={editingProductId}
          onClose={() => setEditingProductId("")}
          onSaved={handleProductEdited}
        />
      ) : null}
      {createProductOpen ? (
        <CreateProductDialog
          onClose={() => setCreateProductOpen(false)}
          onCreated={(id) => {
            setCreateProductOpen(false);
            refreshProductLibrary();
            const record = getProductWithAssets(id, { includeArchived: true });
            if (record) pickProduct(record);
          }}
          onFail={(text) => { setCreateProductOpen(false); notify(text); }}
        />
      ) : null}
    </>
  );
}

function HistoryDrawer(props: { tasks: CommerceImageTask[]; onOpen: (task: CommerceImageTask) => void; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-[1px]" onClick={props.onClose}>
      <aside
        className="anim-fade-up absolute right-0 top-0 flex h-full w-[380px] max-w-[88vw] flex-col border-l border-line bg-surface"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex shrink-0 items-center justify-between border-b border-line px-4 py-3">
          <span className="text-[14px] font-medium text-ink-1">历史项目</span>
          <button type="button" aria-label="关闭" onClick={props.onClose} className="rounded-lg p-1 text-ink-3 hover:bg-surface-2 hover:text-ink-1">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto scrollbar-subtle p-2">
          {props.tasks.length ? props.tasks.map((item) => (
            <button
              key={item.id}
              type="button"
              data-task-id={item.id}
              onClick={() => props.onOpen(item)}
              className="flex w-full items-center justify-between gap-3 rounded-xl px-3 py-2.5 text-left transition-colors duration-150 hover:bg-surface-2"
            >
              <span className="min-w-0">
                <span className="block truncate text-[13px] text-ink-1">{item.title}</span>
                <span className="mt-0.5 block text-[11.5px] text-ink-3">
                  {commerceImageTaskLabels[item.kind].title} · {new Date(item.updatedAt).toLocaleString("zh-CN")}
                  {item.promptSnapshot ? " · 含提示词记录" : ""}
                </span>
              </span>
              <span className="shrink-0 rounded-full border border-line px-2 py-[2px] text-[11px] text-ink-3">{statusLabels[item.status]}</span>
            </button>
          )) : <p className="p-6 text-center text-[13px] text-ink-3">还没有历史项目</p>}
        </div>
      </aside>
    </div>
  );
}

function SettingsDrawer(props: { providers: Array<{ provider: string; label: string; configured: boolean; maskedKey: string; verifiedForCurrentConfig: boolean; message: string }>; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-[1px]" onClick={props.onClose}>
      <aside
        className="anim-fade-up absolute right-0 top-0 flex h-full w-[380px] max-w-[88vw] flex-col border-l border-line bg-surface"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex shrink-0 items-center justify-between border-b border-line px-4 py-3">
          <span className="text-[14px] font-medium text-ink-1">模型设置</span>
          <button type="button" aria-label="关闭" onClick={props.onClose} className="rounded-lg p-1 text-ink-3 hover:bg-surface-2 hover:text-ink-1">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="min-h-0 flex-1 space-y-2 overflow-y-auto scrollbar-subtle p-3">
          {props.providers.length ? props.providers.map((provider) => (
            <div key={provider.provider} className="rounded-xl border border-line px-3 py-2.5">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[13px] text-ink-1">{provider.label}</span>
                <span className={provider.configured ? "text-[11.5px] text-[var(--ui-ok)]" : "text-[11.5px] text-ink-3"}>
                  {provider.configured ? (provider.verifiedForCurrentConfig ? "已验证" : "已配置") : "未配置"}
                </span>
              </div>
              <p className="mt-1 truncate text-[11.5px] text-ink-3">{provider.maskedKey || "—"}</p>
            </div>
          )) : <p className="p-6 text-center text-[12.5px] text-ink-3">暂时读不到模型配置。</p>}
        </div>
        <div className="shrink-0 border-t border-line px-4 py-3">
          <a href="/settings" className="text-[12.5px] text-ink-2 underline decoration-line underline-offset-4 hover:text-ink-1">打开系统设置</a>
        </div>
      </aside>
    </div>
  );
}

function Toast(props: { message: string; onClose: () => void }) {
  if (!props.message) return null;
  return (
    <div className="anim-fade-up fixed bottom-6 left-1/2 z-[100] flex max-w-xl -translate-x-1/2 items-center gap-3 rounded-xl border border-line-strong bg-surface px-4 py-2.5 text-[12.5px] text-ink-1 shadow-2xl">
      <span>{props.message}</span>
      <button type="button" aria-label="关闭提示" onClick={props.onClose}><X className="h-3.5 w-3.5 text-ink-3" /></button>
    </div>
  );
}

function isProductRole(role: CommerceImageAssetRole) {
  return !["benchmark_reference", "reference_segment", "skill_reference", "style_reference", "chat_reference", "chat_generated"].includes(role);
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
