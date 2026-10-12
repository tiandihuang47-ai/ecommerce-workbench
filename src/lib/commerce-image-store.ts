import { randomUUID } from "node:crypto";
import { copyFile, mkdir, readFile, readdir, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { commerceImageDataRoot, ensureCommerceImageDataRoot } from "@/lib/commerce-image-config";
import { readImageMetadata } from "@/lib/commerce-image-file";
import { readProductImageBytes } from "@/lib/product-asset-store";
import { buildCommerceImageWarnings } from "@/lib/commerce-image-plan";
import { DEFAULT_COMMERCE_IMAGE_MODEL, commerceImageDefaultCardCount, isCommerceImageModel, isCommerceImageOutputRatio } from "@/lib/commerce-image-models";
import { validateCommerceCreativeState } from "@/lib/commerce-image-v4-validation";
import { emptyCommerceCreativeState, type CommerceCreativeState } from "@/lib/commerce-image-v4-types";
import { ownershipScope, ownershipStamp, recordBelongsToScope } from "@/lib/server/request-scope";
import type {
  CommerceImageAsset,
  CommerceImageAssetRole,
  CommerceImageBrandProfile,
  CommerceImageCanvasRegion,
  CommerceImageDocument,
  CommerceImageLayoutGuide,
  CommerceImagePanel,
  CommerceImagePanelQuality,
  CommerceImageProductFact,
  CommerceImageStoryboard,
  CommerceImageStoryboardCard,
  CommerceImageStoryboardRole,
  CommerceImageTask,
  CommerceImageTextSafeZone,
  CommerceImageTaskKind,
  CommerceImageVersion,
  CommerceProductVisualProfile,
  ResolvedCommerceImageModel
} from "@/lib/commerce-image-types";

const taskIdPattern = /^commerce_image_task_[a-z0-9_-]+$/i;
const assetIdPattern = /^commerce_image_(?:asset|version)_[a-z0-9_-]+$/i;
const documentIdPattern = /^commerce_image_document_[a-z0-9_-]+$/i;

export async function listCommerceImageTasks() {
  const scope = await ownershipScope();
  const root = await tasksRoot();
  let directories: string[] = [];
  try {
    directories = await readdir(root);
  } catch {
    return [];
  }
  const tasks = await Promise.all(directories.map((id) => getCommerceImageTask(id, { scope })));
  return tasks.filter((item): item is CommerceImageTask => Boolean(item)).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function getCommerceImageTask(taskId: string, options?: { scope?: Awaited<ReturnType<typeof ownershipScope>> }) {
  if (!taskIdPattern.test(taskId)) return null;
  const scope = options?.scope ?? await ownershipScope();
  try {
    const parsed = JSON.parse(await readFile(path.join(await taskDirectory(taskId), "task.json"), "utf8")) as Partial<CommerceImageTask>;
    const task = normalizeCommerceImageTask(parsed);
    if (!recordBelongsToScope(task.userId, scope)) return null;
    return task;
  } catch {
    return null;
  }
}

export async function createCommerceImageTask(input: Partial<CommerceImageTask> & { kind: CommerceImageTaskKind }) {
  const now = new Date().toISOString();
  const id = `commerce_image_task_${Date.now()}_${randomUUID().slice(0, 8)}`;
  const storedBrand = await getCommerceBrandProfile();
  const task = normalizeCommerceImageTask({
    ...input,
    id,
    title: input.title || `${input.productName || "未命名商品"} · 电商视觉项目`,
    status: "draft",
    brandProfile: { ...storedBrand, ...(input.brandProfile || {}) },
    approvedAt: "",
    createdAt: now,
    updatedAt: now
  });
  if (task.productId) {
    task.sourceAssets = await copyProductProfileAssetsIntoTask(task.id, task.productId);
  }
  await saveCommerceImageTask(task);
  if (hasBrandContent(task.brandProfile)) await saveCommerceBrandProfile(task.brandProfile);
  return task;
}

export async function saveCommerceImageTask(task: CommerceImageTask) {
  const next = normalizeCommerceImageTask({
    ...task,
    // 新建任务时按当前登录账号打归属标记；已有标记（更新/后台续跑）原样保留
    userId: task.userId ?? await ownershipStamp(),
    updatedAt: new Date().toISOString()
  });
  const directory = await taskDirectory(next.id);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await atomicJsonWrite(path.join(directory, "task.json"), next);
  return next;
}

export async function patchCommerceImageTask(taskId: string, patch: Partial<CommerceImageTask>) {
  const task = await getCommerceImageTask(taskId);
  if (!task) return null;
  return saveCommerceImageTask({ ...task, ...patch, id: task.id, createdAt: task.createdAt });
}

export async function enableConversationV4(taskId: string) {
  const task = await getCommerceImageTask(taskId);
  if (!task) return null;
  if (task.workflowVersion === "conversation-v4") return task;
  const state = emptyCommerceCreativeState();
  if (task.brief.extra) state.explicitConstraints = [task.brief.extra];
  return saveCommerceImageTask({ ...task, workflowVersion: "conversation-v4", creative: state });
}

export async function persistCommerceImageSource(options: {
  taskId: string;
  bytes: Uint8Array;
  name: string;
  role: CommerceImageAssetRole;
  saveToProductProfile?: boolean;
}) {
  const task = await getCommerceImageTask(options.taskId);
  if (!task) throw new Error("生图任务不存在。");
  const productCount = task.sourceAssets.filter((asset) => isUserProductRole(asset.role)).length;
  if (isUserProductRole(options.role) && productCount >= 8) throw new Error("单个任务最多上传 8 张自己的商品图，请先删除不需要的图片。");
  const uploadedCount = task.sourceAssets.filter((asset) => asset.role !== "reference_segment" && asset.role !== "skill_reference").length;
  const replacingBenchmark = options.role === "benchmark_reference" && task.sourceAssets.some((asset) => asset.role === "benchmark_reference");
  if (!replacingBenchmark && uploadedCount >= 10) throw new Error("单个任务最多上传 10 张人工参考图，请先删除不需要的图片。");
  const metadata = readImageMetadata(options.bytes);
  const id = `commerce_image_asset_${randomUUID()}`;
  const directory = path.join(await taskDirectory(task.id), "source");
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const storagePath = path.join(directory, `${id}${metadata.extension}`);
  await writeFile(storagePath, options.bytes, { mode: 0o600 });
  const asset: CommerceImageAsset = {
    id,
    role: options.role,
    name: safeFileName(options.name || `${options.role}${metadata.extension}`),
    mimeType: metadata.mimeType,
    size: options.bytes.byteLength,
    width: metadata.width,
    height: metadata.height,
    createdAt: new Date().toISOString(),
    storagePath
  };
  const withoutOldBenchmark = options.role === "benchmark_reference"
    ? task.sourceAssets.filter((item) => item.role !== "benchmark_reference" && item.role !== "reference_segment")
    : task.sourceAssets;
  const nextAssets = [...withoutOldBenchmark, asset];
  const updated = await saveCommerceImageTask({
    ...task,
    sourceAssets: nextAssets,
    referenceAnalysis: options.role === "benchmark_reference" ? emptyReferenceAnalysis() : task.referenceAnalysis,
    approvedAt: "",
    approvedPlanRevision: 0,
    planRevision: task.planRevision + 1,
    warnings: buildCommerceImageWarnings({ ...task, sourceAssets: nextAssets })
  });
  if (task.productId && options.saveToProductProfile !== false && !["style_reference", "benchmark_reference", "reference_segment", "skill_reference"].includes(options.role)) {
    await appendProductProfileAsset(task, asset);
  }
  return { task: updated, asset };
}

/**
 * 把产品资产（商品图片 + 产品资料）挂到生图任务上。
 *
 * - 选中的商品图会**复制**进任务自己的 source 目录，所以之后用户在产品里删图、改封面、删产品，
 *   历史任务仍然能显示当时的图片；
 * - 同时固化产品快照（名称、品牌、品类、资料版本与正文），历史任务不再回查当前产品。
 */
export async function attachProductToTask(options: {
  taskId: string;
  product: {
    id: string;
    name: string;
    brandName: string;
    category: string;
    documentId: string;
    documentName: string;
    documentRevision: number;
    documentUpdatedAt: string;
    documentText: string;
    referenceText: string;
    facts: Array<{ label: string; value: string }>;
    images: Array<{ id: string; role: string; name: string }>;
  };
  mode: "all" | "selected";
  selectedImageIds: string[];
}) {
  const task = await getCommerceImageTask(options.taskId);
  if (!task) throw new Error("生图任务不存在。");

  const allImages = options.product.images || [];
  const chosen = options.mode === "all"
    ? allImages
    : allImages.filter((image) => options.selectedImageIds.includes(image.id));
  if (!chosen.length) throw new Error("这次没有可用的商品图片，请先选择至少一张。");

  const directory = path.join(await taskDirectory(task.id), "source");
  await mkdir(directory, { recursive: true, mode: 0o700 });

  // 同一次挂载可以反复执行：先清掉之前由产品带来的素材，保留对标图等其它素材。
  const kept = task.sourceAssets.filter((asset) => !asset.sourceProfileAssetId?.startsWith("product_image_"));
  const attached: CommerceImageAsset[] = [];
  for (const image of chosen) {
    const source = await readProductImageBytes(options.product.id, image.id);
    if (!source) continue;
    const metadata = readImageMetadata(source.bytes);
    const id = `commerce_image_asset_${randomUUID()}`;
    const storagePath = path.join(directory, `${id}${metadata.extension}`);
    await writeFile(storagePath, source.bytes, { mode: 0o600 });
    attached.push({
      id,
      sourceProfileAssetId: image.id,
      role: productRoleToAssetRole(image.role),
      name: image.name || `${image.id}${metadata.extension}`,
      mimeType: metadata.mimeType,
      size: source.bytes.byteLength,
      width: metadata.width,
      height: metadata.height,
      createdAt: new Date().toISOString(),
      storagePath
    });
  }
  if (!attached.length) throw new Error("产品图片文件不可用，请重新上传商品图片。");

  const now = new Date().toISOString();
  const facts: CommerceImageProductFact[] = options.product.facts
    .filter((fact) => fact.value.trim())
    .slice(0, 24)
    .map((fact, index) => ({
      id: `commerce_image_fact_product_${index}`,
      label: fact.label,
      value: fact.value.trim(),
      sourceName: options.product.documentName || options.product.name,
      sourceExcerpt: fact.value.trim().slice(0, 200),
      confidence: "confirmed" as const
    }));

  return saveCommerceImageTask({
    ...task,
    productId: options.product.id,
    productName: options.product.name,
    productSnapshot: {
      ...(task.productSnapshot || {}),
      id: options.product.id,
      name: options.product.name,
      brandName: options.product.brandName || "",
      category: options.product.category || ""
    } as CommerceImageTask["productSnapshot"],
    productAssetSnapshot: {
      productId: options.product.id,
      productName: options.product.name,
      brandName: options.product.brandName || "",
      category: options.product.category || "",
      documentId: options.product.documentId || "",
      documentName: options.product.documentName || "",
      documentRevision: options.product.documentRevision || 0,
      documentUpdatedAt: options.product.documentUpdatedAt || "",
      documentText: options.product.documentText.slice(0, 200_000),
      referenceText: options.product.referenceText.slice(0, 20_000),
      imageCount: allImages.length,
      capturedAt: now
    },
    productImageSelection: {
      mode: options.mode,
      selectedImageIds: options.mode === "all" ? [] : chosen.map((image) => image.id),
      attachedAssetIds: attached.map((asset) => asset.id),
      usedAssetIds: [],
      updatedAt: now
    },
    sourceAssets: [...kept, ...attached],
    productFacts: facts.length ? facts : task.productFacts,
    approvedAt: "",
    approvedPlanRevision: 0,
    planRevision: task.planRevision + 1,
    error: "",
    lastError: undefined
  });
}

/** 记下这次真正发给模型的参考图，便于事后核对「用了哪些图」。 */
export async function recordUsedProductReferences(taskId: string, usedAssetIds: string[]) {
  const task = await getCommerceImageTask(taskId);
  if (!task?.productImageSelection) return task;
  const merged = [...new Set([...(task.productImageSelection.usedAssetIds || []), ...usedAssetIds.filter(Boolean)])];
  return saveCommerceImageTask({
    ...task,
    productImageSelection: { ...task.productImageSelection, usedAssetIds: merged, updatedAt: new Date().toISOString() }
  });
}

function productRoleToAssetRole(role: string): CommerceImageAssetRole {
  const allowed: CommerceImageAssetRole[] = ["front", "side", "back", "detail", "package", "logo", "on_body", "other"];
  return allowed.includes(role as CommerceImageAssetRole) ? role as CommerceImageAssetRole : "other";
}

export async function persistCommerceImageDerivedSource(options: {  taskId: string;
  bytes: Uint8Array;
  name: string;
  role: "reference_segment" | "skill_reference";
}) {
  const task = await getCommerceImageTask(options.taskId);
  if (!task) throw new Error("生图任务不存在。");
  const metadata = readImageMetadata(options.bytes);
  const id = `commerce_image_asset_${randomUUID()}`;
  const directory = path.join(await taskDirectory(task.id), "derived");
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const storagePath = path.join(directory, `${id}${metadata.extension}`);
  await writeFile(storagePath, options.bytes, { mode: 0o600 });
  const asset: CommerceImageAsset = {
    id,
    role: options.role,
    name: safeFileName(options.name),
    mimeType: metadata.mimeType,
    size: options.bytes.byteLength,
    width: metadata.width,
    height: metadata.height,
    createdAt: new Date().toISOString(),
    storagePath
  };
  const updated = await saveCommerceImageTask({ ...task, sourceAssets: [...task.sourceAssets, asset] });
  return { task: updated, asset };
}

/**
 * 自然对话生图专用：把用户附带的参考图或模型生成的图片存入任务。
 * 与 persistCommerceImageSource 不同，这里不参与商品资料、方案版本等流程状态。
 */
export async function persistCommerceChatAsset(options: {
  taskId: string;
  bytes: Uint8Array;
  name: string;
  role: "chat_reference" | "chat_generated";
}) {
  if (!taskIdPattern.test(options.taskId)) throw new Error("生图任务不存在。");
  const task = await getCommerceImageTask(options.taskId);
  if (!task) throw new Error("生图任务不存在。");
  const metadata = readImageMetadata(options.bytes);
  const id = `commerce_image_asset_${randomUUID()}`;
  const directory = path.join(await taskDirectory(task.id), "chat");
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const storagePath = path.join(directory, `${id}${metadata.extension}`);
  await writeFile(storagePath, options.bytes, { mode: 0o600 });
  const asset: CommerceImageAsset = {
    id,
    role: options.role,
    name: safeFileName(options.name || `对话生图${metadata.extension}`),
    mimeType: metadata.mimeType,
    size: options.bytes.byteLength,
    width: metadata.width,
    height: metadata.height,
    createdAt: new Date().toISOString(),
    storagePath
  };
  await saveCommerceImageTask({ ...task, sourceAssets: [...task.sourceAssets, asset] });
  return asset;
}

export async function persistCommerceImageReferenceSegments(taskId: string, crops: Array<{ bytes: Uint8Array; name: string }>) {
  const task = await getCommerceImageTask(taskId);
  if (!task) throw new Error("生图任务不存在。");
  const previous = task.sourceAssets.filter((asset) => asset.role === "reference_segment");
  for (const asset of previous) {
    if (asset.storagePath && isInsideCommerceImageRoot(asset.storagePath)) {
      try { await unlink(asset.storagePath); } catch { /* 已不存在 */ }
    }
  }
  const directory = path.join(await taskDirectory(task.id), "derived");
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const assets: CommerceImageAsset[] = [];
  for (const crop of crops) {
    const metadata = readImageMetadata(crop.bytes);
    const id = `commerce_image_asset_${randomUUID()}`;
    const storagePath = path.join(directory, `${id}${metadata.extension}`);
    await writeFile(storagePath, crop.bytes, { mode: 0o600 });
    assets.push({
      id,
      role: "reference_segment",
      name: safeFileName(crop.name),
      mimeType: metadata.mimeType,
      size: crop.bytes.byteLength,
      width: metadata.width,
      height: metadata.height,
      createdAt: new Date().toISOString(),
      storagePath
    });
  }
  const next = await saveCommerceImageTask({
    ...task,
    sourceAssets: [...task.sourceAssets.filter((asset) => asset.role !== "reference_segment"), ...assets]
  });
  return { task: next, assets };
}

export async function persistCommerceImageDocument(options: {
  taskId: string;
  bytes: Uint8Array;
  name: string;
  mimeType: string;
  extractedText: string;
}) {
  const task = await getCommerceImageTask(options.taskId);
  if (!task) throw new Error("生图任务不存在。");
  if (task.documents.length >= 5) throw new Error("单个项目最多上传 5 份产品资料。");
  const id = `commerce_image_document_${randomUUID()}`;
  const directory = path.join(await taskDirectory(task.id), "documents");
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const extension = [".docx", ".md", ".markdown", ".txt"].includes(path.extname(options.name).toLowerCase())
    ? path.extname(options.name).toLowerCase()
    : ".txt";
  const storagePath = path.join(directory, `${id}${extension}`);
  await writeFile(storagePath, options.bytes, { mode: 0o600 });
  const document: CommerceImageDocument = {
    id,
    name: safeFileName(options.name),
    mimeType: options.mimeType,
    size: options.bytes.byteLength,
    status: "ready",
    excerpt: options.extractedText.slice(0, 360),
    extractedText: options.extractedText.slice(0, 80_000),
    error: "",
    createdAt: new Date().toISOString(),
    storagePath
  };
  return saveCommerceImageTask({
    ...task,
    documents: [...task.documents, document],
    approvedAt: "",
    approvedPlanRevision: 0,
    planRevision: task.planRevision + 1
  });
}

export async function removeCommerceImageDocument(taskId: string, documentId: string) {
  if (!documentIdPattern.test(documentId)) return null;
  const task = await getCommerceImageTask(taskId);
  if (!task) return null;
  const document = task.documents.find((item) => item.id === documentId);
  if (!document) return null;
  if (document.storagePath && isInsideCommerceImageRoot(document.storagePath)) {
    try { await unlink(document.storagePath); } catch { /* 已不存在 */ }
  }
  return saveCommerceImageTask({
    ...task,
    documents: task.documents.filter((item) => item.id !== documentId),
    approvedAt: "",
    approvedPlanRevision: 0,
    planRevision: task.planRevision + 1
  });
}

export async function readCommerceImageAssetBytes(taskId: string, assetId: string) {
  const resolved = await resolveCommerceImageAsset(taskId, assetId);
  if (!resolved) return null;
  return { ...resolved, bytes: new Uint8Array(await readFile(resolved.path)) };
}

export async function commerceImageTaskArtifactDirectory(taskId: string) {
  const directory = path.join(await taskDirectory(taskId), "artifacts");
  await mkdir(directory, { recursive: true, mode: 0o700 });
  return directory;
}

export async function removeCommerceImageSource(taskId: string, assetId: string) {
  if (!assetIdPattern.test(assetId)) return null;
  const task = await getCommerceImageTask(taskId);
  if (!task) return null;
  const asset = task.sourceAssets.find((item) => item.id === assetId);
  if (!asset) return null;
  if (asset.storagePath && isInsideCommerceImageRoot(asset.storagePath)) {
    try {
      await unlink(asset.storagePath);
    } catch { /* 文件已经不存在时仍移除索引 */ }
  }
  const sourceAssets = task.sourceAssets.filter((item) => item.id !== assetId);
  return saveCommerceImageTask({
    ...task,
    sourceAssets,
    referenceAnalysis: asset.role === "benchmark_reference" || asset.role === "reference_segment" ? emptyReferenceAnalysis() : task.referenceAnalysis,
    approvedAt: "",
    approvedPlanRevision: 0,
    planRevision: task.planRevision + 1,
    warnings: buildCommerceImageWarnings({ ...task, sourceAssets })
  });
}

export async function persistCommerceImageVersion(options: {
  taskId: string;
  panelId: string;
  bytes: Uint8Array;
  modelId: ResolvedCommerceImageModel;
  providerModelId: string;
  prompt: string;
  setId?: string;
  /** 真正发往 Provider 的尺寸，存下来用于对比上游是否降档。 */
  requestedSize?: { width: number; height: number };
  /** 目标比例与上游原始尺寸：用于「比例严格一致」校验与结果区展示。 */
  ratio?: CommerceImageVersion["ratio"];
  providerSize?: { width: number; height: number };
}) {
  const metadata = readImageMetadata(options.bytes);
  const id = `commerce_image_version_${randomUUID()}`;
  const assetId = `commerce_image_version_${randomUUID()}`;
  const directory = path.join(await taskDirectory(options.taskId), "generated", safeSegment(options.panelId));
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const storagePath = path.join(directory, `${assetId}${metadata.extension}`);
  await writeFile(storagePath, options.bytes, { mode: 0o600 });
  const version: CommerceImageVersion = {
    id,
    assetId,
    modelId: options.modelId,
    providerModelId: options.providerModelId || options.modelId,
    width: metadata.width,
    height: metadata.height,
    mimeType: metadata.mimeType,
    prompt: options.prompt,
    setId: options.setId,
    requestedSize: options.requestedSize,
    ratio: options.ratio,
    providerSize: options.providerSize,
    createdAt: new Date().toISOString(),
    storagePath
  };
  return version;
}

export async function resolveCommerceImageAsset(taskId: string, assetId: string) {
  if (!taskIdPattern.test(taskId) || !assetIdPattern.test(assetId)) return null;
  const task = await getCommerceImageTask(taskId);
  if (!task) return null;
  const source = task.sourceAssets.find((item) => item.id === assetId);
  if (source?.storagePath && isInsideCommerceImageRoot(source.storagePath)) {
    return { path: source.storagePath, mimeType: source.mimeType, name: source.name };
  }
  for (const panel of task.panels) {
    const version = panel.versions.find((item) => item.assetId === assetId || item.id === assetId);
    if (version?.storagePath && isInsideCommerceImageRoot(version.storagePath)) {
      return { path: version.storagePath, mimeType: version.mimeType, name: `${panel.title}.${extensionFromMime(version.mimeType)}` };
    }
  }
  return null;
}

export function toPublicCommerceImageTask(task: CommerceImageTask): CommerceImageTask {
  return {
    ...task,
    userId: undefined, // 归属标记是服务端内部字段，不下发给前端
    sourceAssets: task.sourceAssets.map((asset) => ({
      ...asset,
      storagePath: undefined,
      url: `/api/commerce-image/assets?taskId=${encodeURIComponent(task.id)}&assetId=${encodeURIComponent(asset.id)}`
    })),
    documents: task.documents.map((document) => ({ ...document, storagePath: undefined, extractedText: undefined })),
    panels: task.panels.map((panel) => ({
      ...panel,
      versions: panel.versions.map((version) => ({
        ...version,
        storagePath: undefined,
        imageUrl: `/api/commerce-image/assets?taskId=${encodeURIComponent(task.id)}&assetId=${encodeURIComponent(version.assetId)}`
      }))
    }))
  };
}

export async function getCommerceBrandProfile(): Promise<CommerceImageBrandProfile> {
  try {
    return normalizeBrandProfile(JSON.parse(await readFile(path.join(await profilesRoot(), "brand.json"), "utf8")));
  } catch {
    return normalizeBrandProfile({});
  }
}

export async function saveCommerceBrandProfile(profile: CommerceImageBrandProfile) {
  const next = normalizeBrandProfile(profile);
  await atomicJsonWrite(path.join(await profilesRoot(), "brand.json"), next);
  return next;
}

export async function getCommerceProductVisualProfile(productId: string): Promise<CommerceProductVisualProfile | null> {
  if (!safeSegment(productId)) return null;
  try {
    const value = JSON.parse(await readFile(path.join(await profilesRoot(), `product-${safeSegment(productId)}.json`), "utf8")) as CommerceProductVisualProfile;
    return {
      ...value,
      productId,
      productName: value.productName || "",
      brandProfile: normalizeBrandProfile(value.brandProfile || {}),
      assets: Array.isArray(value.assets) ? value.assets.filter((asset) => asset.storagePath && isInsideCommerceImageRoot(asset.storagePath)) : [],
      createdAt: value.createdAt || new Date().toISOString(),
      updatedAt: value.updatedAt || value.createdAt || new Date().toISOString()
    };
  } catch {
    return null;
  }
}

export function isCommerceImageTaskId(value: string) {
  return taskIdPattern.test(value);
}

async function appendProductProfileAsset(task: CommerceImageTask, taskAsset: CommerceImageAsset) {
  const existing = await getCommerceProductVisualProfile(task.productId);
  if ((existing?.assets.length || 0) >= 8) return;
  const id = `commerce_image_asset_${randomUUID()}`;
  const directory = path.join(await profilesRoot(), "assets", safeSegment(task.productId));
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const extension = path.extname(taskAsset.storagePath || "") || ".png";
  const storagePath = path.join(directory, `${id}${extension}`);
  if (!taskAsset.storagePath) return;
  await copyFile(taskAsset.storagePath, storagePath);
  const profileAsset: CommerceImageAsset = { ...taskAsset, id, sourceProfileAssetId: id, storagePath };
  const now = new Date().toISOString();
  const profile: CommerceProductVisualProfile = {
    productId: task.productId,
    productName: task.productName,
    brandProfile: task.brandProfile,
    assets: [...(existing?.assets || []), profileAsset],
    createdAt: existing?.createdAt || now,
    updatedAt: now
  };
  await atomicJsonWrite(path.join(await profilesRoot(), `product-${safeSegment(task.productId)}.json`), profile);
}

async function copyProductProfileAssetsIntoTask(taskId: string, productId: string) {
  const profile = await getCommerceProductVisualProfile(productId);
  if (!profile?.assets.length) return [];
  const directory = path.join(await taskDirectory(taskId), "source");
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const copied: CommerceImageAsset[] = [];
  for (const profileAsset of profile.assets.slice(0, 8)) {
    if (!profileAsset.storagePath) continue;
    const id = `commerce_image_asset_${randomUUID()}`;
    const extension = path.extname(profileAsset.storagePath) || ".png";
    const storagePath = path.join(directory, `${id}${extension}`);
    try {
      await copyFile(profileAsset.storagePath, storagePath);
      copied.push({ ...profileAsset, id, sourceProfileAssetId: profileAsset.id, storagePath, createdAt: new Date().toISOString() });
    } catch { /* 单张历史素材缺失不阻塞新项目 */ }
  }
  return copied;
}

function normalizeCommerceImageTask(input: Partial<CommerceImageTask>): CommerceImageTask {
  const now = new Date().toISOString();
  const kind = normalizeTaskKind(input.kind);
  const ratio = isCommerceImageOutputRatio(input.ratio)
    ? input.ratio
    : kind === "retouch" || kind === "free_chat" ? "1:1" : kind === "detail_page" ? "3:4" : "9:16";
  const brief = {
    audience: input.brief?.audience || input.productSnapshot?.targetAudience || "",
    sellingPoints: input.brief?.sellingPoints || input.productSnapshot?.coreSellingPoints || "",
    scene: input.brief?.scene || input.productSnapshot?.useScenarios || "",
    style: input.brief?.style || "干净高级、真实可信",
    extra: input.brief?.extra || "",
    strategy: normalizeStrategy(input.brief?.strategy),
    cardCount: clampInteger(
      input.brief?.cardCount,
      commerceImageDefaultCardCount[kind] ?? 1,
      1,
      kind === "detail_page" ? 12 : kind === "retouch" ? 1 : 10
    ),
    retouchOperation: input.brief?.retouchOperation || "white_background"
  };
  const quality = input.quality || "high";
  const panels = Array.isArray(input.panels) ? input.panels.map((panel) => normalizePanel(panel, ratio)) : [];
  const storyboard = kind === "xiaohongshu_post"
    ? normalizeStoryboard(input.storyboard, { title: input.title || "电商视觉项目", productName: input.productName || input.productSnapshot?.name || "商品", brief, panels, approvedAt: input.approvedAt || "", now })
    : undefined;
  const workflowVersion = input.workflowVersion === "conversation-v4" ? "conversation-v4" as const : "legacy" as const;
  let creative: CommerceCreativeState | undefined;
  if (workflowVersion === "conversation-v4") {
    try {
      creative = validateCommerceCreativeState(input.creative || emptyCommerceCreativeState(), {
        sourceAssets: Array.isArray(input.sourceAssets) ? input.sourceAssets : [],
        documents: Array.isArray(input.documents) ? input.documents : [],
        chatMessages: Array.isArray(input.chatMessages) ? input.chatMessages : [],
        panels
      });
    } catch {
      creative = emptyCommerceCreativeState();
    }
  }
  return {
    schemaVersion: 3,
    workflowVersion,
    id: input.id && taskIdPattern.test(input.id) ? input.id : `commerce_image_task_${Date.now()}_${randomUUID().slice(0, 8)}`,
    userId: typeof input.userId === "string" && input.userId ? input.userId : undefined,
    title: input.title || "电商视觉项目",
    kind,
    status: normalizeTaskStatus(input.status),
    model: isCommerceImageModel(input.model) ? input.model : DEFAULT_COMMERCE_IMAGE_MODEL,
    resolvedModelId: input.resolvedModelId || "",
    ratio,
    quality,
    productId: input.productId || "",
    productName: input.productName || input.productSnapshot?.name || input.productAssetSnapshot?.productName || "",
    productSnapshot: input.productSnapshot,
    productAssetSnapshot: input.productAssetSnapshot,
    productImageSelection: input.productImageSelection,
    brandProfile: normalizeBrandProfile(input.brandProfile || {}),
    brief,
    sourceAssets: Array.isArray(input.sourceAssets) ? input.sourceAssets : [],
    documents: Array.isArray(input.documents) ? input.documents.map(normalizeDocument) : [],
    chatMessages: Array.isArray(input.chatMessages) ? input.chatMessages.filter((message) => message && (message.role === "user" || message.role === "assistant") && typeof message.content === "string") : [],
    referenceAnalysis: normalizeReferenceAnalysis(input.referenceAnalysis),
    productFacts: Array.isArray(input.productFacts) ? input.productFacts.filter((fact) => fact && fact.value).map((fact) => ({
      id: fact.id || `commerce_image_fact_${randomUUID()}`,
      label: fact.label || "产品信息",
      value: fact.value,
      sourceName: fact.sourceName || "用户资料",
      sourceExcerpt: fact.sourceExcerpt || fact.value,
      confidence: fact.confidence === "observed" || fact.confidence === "uncertain" ? fact.confidence : "confirmed"
    })) : [],
    strategySnapshot: input.strategySnapshot && input.strategySnapshot.id ? input.strategySnapshot : undefined,
    planRevision: clampInteger(input.planRevision, 1, 1, Number.MAX_SAFE_INTEGER),
    approvedPlanRevision: clampInteger(input.approvedPlanRevision, input.approvedAt ? 1 : 0, 0, Number.MAX_SAFE_INTEGER),
    generationSetCount: input.generationSetCount === 2 || input.generationSetCount === 4 ? input.generationSetCount : 1,
    generationSets: normalizeGenerationSets(input.generationSets),
    selectedSetId: input.selectedSetId || input.generationSets?.[0]?.id || "",
    storyboard,
    panels,
    publishPackage: {
      title: input.publishPackage?.title || "",
      body: input.publishPackage?.body || "",
      tags: Array.isArray(input.publishPackage?.tags) ? input.publishPackage.tags : [],
      complianceWarnings: Array.isArray(input.publishPackage?.complianceWarnings) ? input.publishPackage.complianceWarnings : []
    },
    warnings: Array.isArray(input.warnings) ? input.warnings.filter(Boolean) : [],
    error: input.error || "",
    lastError: input.lastError,
    creative,
    marketing: normalizeMarketingRecord(input.marketing),
    promptSnapshot: normalizePromptSnapshot(input.promptSnapshot),
    generationSpec: normalizeGenerationSpec(input.generationSpec),
    progress: input.progress,
    approvedAt: input.approvedAt || "",
    createdAt: input.createdAt || now,
    updatedAt: input.updatedAt || input.createdAt || now
  };
}

/** 生成参数快照：形状损坏就丢弃，旧任务没有也不补。 */
function normalizeGenerationSpec(value: unknown): CommerceImageTask["generationSpec"] {
  if (!value || typeof value !== "object") return undefined;
  const spec = value as Partial<NonNullable<CommerceImageTask["generationSpec"]>>;
  const width = Number(spec.requestedWidth);
  const height = Number(spec.requestedHeight);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return undefined;
  const ratio = typeof spec.aspectRatio === "string" && isCommerceImageOutputRatio(spec.aspectRatio) ? spec.aspectRatio : "9:16";
  return {
    aspectRatio: ratio,
    resolution: spec.resolution === "standard" || spec.resolution === "ultra" ? spec.resolution : "high",
    requestedWidth: Math.round(width),
    requestedHeight: Math.round(height),
    providerRequestSize: typeof spec.providerRequestSize === "string" ? spec.providerRequestSize : `${Math.round(width)}x${Math.round(height)}`,
    providerReturnedWidth: Number.isFinite(Number(spec.providerReturnedWidth)) ? Math.round(Number(spec.providerReturnedWidth)) : undefined,
    providerReturnedHeight: Number.isFinite(Number(spec.providerReturnedHeight)) ? Math.round(Number(spec.providerReturnedHeight)) : undefined,
    actualWidth: Number.isFinite(Number(spec.actualWidth)) ? Math.round(Number(spec.actualWidth)) : undefined,
    actualHeight: Number.isFinite(Number(spec.actualHeight)) ? Math.round(Number(spec.actualHeight)) : undefined,
    actualAspectRatio: typeof spec.actualAspectRatio === "string" ? spec.actualAspectRatio : undefined,
    ratioStatus: spec.ratioStatus === "cropped" || spec.ratioStatus === "retried" ? spec.ratioStatus : "ok",
    recordedAt: typeof spec.recordedAt === "string" ? spec.recordedAt : ""
  };
}

/** 提示词快照：旧任务没有这个字段，返回 undefined 即可，不能伪造。 */
function normalizePromptSnapshot(value: unknown): CommerceImageTask["promptSnapshot"] {
  if (!value || typeof value !== "object") return undefined;
  const snapshot = value as Partial<NonNullable<CommerceImageTask["promptSnapshot"]>>;
  const panels = Array.isArray(snapshot.panels)
    ? snapshot.panels
      .filter((panel) => panel && typeof panel.compiledPrompt === "string")
      .map((panel) => ({
        panelId: panel.panelId || "",
        title: panel.title || "",
        compiledPrompt: panel.compiledPrompt || "",
        model: panel.model || "",
        size: panel.size || "",
        capturedAt: panel.capturedAt || ""
      }))
    : [];
  const userInstruction = typeof snapshot.userInstruction === "string" ? snapshot.userInstruction : "";
  const compiledPrompt = typeof snapshot.compiledPrompt === "string" ? snapshot.compiledPrompt : "";
  if (!userInstruction && !compiledPrompt && !panels.length) return undefined;
  return {
    userInstruction,
    compiledPrompt,
    panels,
    model: isCommerceImageModel(snapshot.model) ? snapshot.model : "auto",
    resolvedModelId: snapshot.resolvedModelId || "",
    ratio: isCommerceImageOutputRatio(snapshot.ratio) ? snapshot.ratio : "3:4",
    quality: snapshot.quality === "standard" || snapshot.quality === "ultra" ? snapshot.quality : "high",
    count: clampInteger(snapshot.count, 1, 1, 12),
    contentGoal: snapshot.contentGoal || "",
    capturedAt: snapshot.capturedAt || "",
    updatedAt: snapshot.updatedAt || snapshot.capturedAt || ""
  };
}

/** 营销记录是引擎内部结构，只在形状明显损坏时丢弃，避免旧任务读取崩溃。 */
function normalizeMarketingRecord(value: unknown): CommerceImageTask["marketing"] {
  if (!value || typeof value !== "object") return undefined;
  const record = value as Partial<NonNullable<CommerceImageTask["marketing"]>>;
  if (!record.productTruth || !record.intent || !record.strategy || !record.creativePlan) return undefined;
  if (!Array.isArray(record.creativePlan.panels)) return undefined;
  return record as NonNullable<CommerceImageTask["marketing"]>;
}

function normalizePanel(panel: Partial<CommerceImagePanel>, fallbackRatio: CommerceImageTask["ratio"]): CommerceImagePanel {
  const overlay = {
    visible: panel.overlay?.visible !== false,
    title: panel.overlay?.title || "",
    body: panel.overlay?.body || "",
    textColor: panel.overlay?.textColor || "#ffffff",
    accentColor: panel.overlay?.accentColor || "#7c3aed",
    position: panel.overlay?.position === "bottom" ? "bottom" as const : "top" as const,
    align: panel.overlay?.align === "center" ? "center" as const : "left" as const
  };
  return {
    id: panel.id || `commerce_image_panel_${randomUUID()}`,
    kind: panel.kind || "visual",
    title: panel.title || "未命名画面",
    description: panel.description || "",
    prompt: panel.prompt || "",
    ratio: isCommerceImageOutputRatio(panel.ratio) ? panel.ratio : fallbackRatio,
    status: ["draft", "queued", "generating", "completed", "failed", "cancelled"].includes(String(panel.status)) ? panel.status as CommerceImagePanel["status"] : "draft",
    error: panel.error || "",
    overlay,
    storyboardCardId: panel.storyboardCardId || undefined,
    sellingPointCardId: panel.sellingPointCardId || undefined,
    sellingPoint: normalizeSellingPointCard(panel.sellingPoint),
    order: typeof panel.order === "number" ? panel.order : 0,
    referenceSegmentId: panel.referenceSegmentId || "",
    layoutGuide: normalizeLayoutGuide(panel.layoutGuide),
    quality: normalizePanelQuality(panel.quality),
    textLayers: Array.isArray(panel.textLayers) && panel.textLayers.length
      ? panel.textLayers.map(normalizeTextLayer)
      : legacyOverlayLayers(overlay),
    imageFit: panel.imageFit === "contain" ? "contain" : "cover",
    versions: Array.isArray(panel.versions) ? panel.versions.map((version) => ({ ...version, setId: version.setId || "legacy" })) : [],
    selectedVersionId: panel.selectedVersionId || panel.versions?.at(-1)?.id || ""
  };
}

function normalizeSellingPointCard(value: CommerceImagePanel["sellingPoint"]): CommerceImagePanel["sellingPoint"] {
  const card = value && typeof value === "object" ? value : undefined;
  const label = card?.label?.trim();
  const visualEvidence = card?.visualEvidence?.trim();
  if (!label || !visualEvidence) return undefined;
  return {
    id: card?.id || `commerce_image_sp_${randomUUID()}`,
    label: label.slice(0, 30),
    audience: (card?.audience || "").slice(0, 60),
    painPoint: (card?.painPoint || "").slice(0, 120),
    reason: (card?.reason || "").slice(0, 160),
    visualEvidence: visualEvidence.slice(0, 200),
    copyLine: (card?.copyLine || "").slice(0, 24)
  };
}

function normalizeStoryboard(value: CommerceImageStoryboard | undefined, context: {
  title: string;
  productName: string;
  brief: CommerceImageTask["brief"];
  panels: CommerceImagePanel[];
  approvedAt: string;
  now: string;
}): CommerceImageStoryboard {
  const raw = value && typeof value === "object" ? value : undefined;
  const legacy = !raw;
  const count = context.panels.length
    ? Math.min(9, Math.max(1, context.panels.length))
    : clampInteger(context.brief.cardCount, 4, 1, 9);
  const roles = storyboardRoles(count);
  const cards = Array.from({ length: count }, (_, index): CommerceImageStoryboardCard => {
    const source = raw?.cards?.[index];
    const panel = context.panels[index];
    const role = isStoryboardRole(source?.role) ? source.role : roles[index];
    return {
      id: source?.id || panel?.storyboardCardId || `commerce_image_story_card_${randomUUID()}`,
      order: index,
      role,
      title: safeText(source?.title, 80) || (legacy ? defaultStoryboardTitle(role, index) : panel?.title) || defaultStoryboardTitle(role, index),
      purpose: safeText(source?.purpose, 360) || (legacy ? defaultStoryboardPurpose(role) : panel?.description) || defaultStoryboardPurpose(role),
      visual: safeText(source?.visual, 600) || (legacy ? `${context.productName}的真实商品画面，预留独立文字区。` : panel?.description) || `${context.productName}的真实商品画面，预留独立文字区。`,
      copyIntent: safeText(source?.copyIntent, 180) || (legacy ? (index === 0 ? `先看${context.productName}真实是什么样` : "以真实商品资料为准") : panel?.overlay.title) || "以真实商品资料为准"
    };
  });
  const rawStatus = raw?.status;
  const status = rawStatus === "confirmed" || rawStatus === "needs_revision" || rawStatus === "planned" || rawStatus === "draft"
    ? rawStatus
    : context.approvedAt ? "confirmed" : context.panels.length ? "needs_revision" : "draft";
  return {
    version: 1,
    theme: safeText(raw?.theme, 160) || safeText(context.brief.extra, 160) || `${context.productName}的真实种草笔记`,
    audience: safeText(raw?.audience, 160) || context.brief.audience,
    emotionalHook: safeText(raw?.emotionalHook, 100) || `先看${context.productName}真实是什么样`,
    summary: safeText(raw?.summary, 600) || `围绕商品主题，按引子、代入、证明和收尾组织成一篇连续种草图文。`,
    visualBible: {
      productAnchor: safeText(raw?.visualBible?.productAnchor, 320) || `以用户上传的${context.productName}为唯一商品主体，锁定颜色、版型、材质、Logo、包装与可见文字。`,
      colorMood: safeText(raw?.visualBible?.colorMood, 240) || context.brief.style || "真实、克制、有生活感。",
      photography: safeText(raw?.visualBible?.photography, 240) || "同一组统一摄影风格、自然光线和商品质感。",
      typography: safeText(raw?.visualBible?.typography, 240) || "系统独立排版深色文字和柔和底色，不遮挡商品主体。",
      scene: safeText(raw?.visualBible?.scene, 240) || context.brief.scene || "真实生活场景。",
      subjectRule: safeText(raw?.visualBible?.subjectRule, 320) || "人物与场景以用户需求和参考图为准，不虚构模特。",
      referenceAssetIds: Array.isArray(raw?.visualBible?.referenceAssetIds) ? raw.visualBible.referenceAssetIds.filter((item): item is string => typeof item === "string") : []
    },
    cards,
    status,
    confirmedAt: status === "confirmed" ? raw?.confirmedAt || context.approvedAt : "",
    updatedAt: raw?.updatedAt || context.now
  };
}

function normalizeLayoutGuide(value: CommerceImageLayoutGuide | undefined): CommerceImageLayoutGuide | undefined {
  if (!value || typeof value !== "object") return undefined;
  const safeZones = Array.isArray(value.safeZones) ? value.safeZones.map((zone, index): CommerceImageTextSafeZone => ({
    id: typeof zone?.id === "string" && zone.id ? zone.id : `commerce_image_safe_zone_${randomUUID()}`,
    label: zone?.label === "正文留白" || zone?.label === "备用留白" ? zone.label : "标题留白",
    confidence: zone?.confidence === "verified" || zone?.confidence === "fallback" ? zone.confidence : "planned",
    ...normalizeRegion(zone, index === 0 ? { x: 0.08, y: 0.08, width: 0.45, height: 0.13 } : { x: 0.08, y: 0.23, width: 0.4, height: 0.1 })
  })) : [];
  if (!safeZones.length && !value.subjectBox) return undefined;
  return {
    subjectBox: value.subjectBox ? normalizeRegion(value.subjectBox, { x: 0.45, y: 0.28, width: 0.45, height: 0.62 }) : undefined,
    safeZones,
    source: value.source === "vision" || value.source === "fallback" ? value.source : "planned",
    checkedAt: value.checkedAt || ""
  };
}

function normalizePanelQuality(value: CommerceImagePanelQuality | undefined): CommerceImagePanelQuality | undefined {
  if (!value || typeof value !== "object") return undefined;
  return {
    status: value.status === "passed" || value.status === "needs_layout_retry" || value.status === "needs_regeneration" || value.status === "warning" ? value.status : "pending",
    productVisible: value.productVisible === true,
    productFidelity: value.productFidelity === true,
    textSafe: value.textSafe === true,
    storyFit: value.storyFit === true,
    marketingFit: value.marketingFit === true,
    seriesConsistent: value.seriesConsistent === true,
    unexpectedText: value.unexpectedText === true,
    textPresent: typeof value.textPresent === "boolean" ? value.textPresent : undefined,
    sellingPointFit: typeof value.sellingPointFit === "boolean" ? value.sellingPointFit : undefined,
    detectedText: Array.isArray(value.detectedText) ? value.detectedText.filter((item): item is string => typeof item === "string").map((item) => item.slice(0, 160)).slice(0, 12) : [],
    layoutRetryCount: clampInteger(value.layoutRetryCount, 0, 0, 1),
    qualityRetryCount: clampInteger(value.qualityRetryCount, 0, 0, 1),
    warnings: Array.isArray(value.warnings) ? value.warnings.filter((item): item is string => typeof item === "string").map((item) => item.slice(0, 400)).slice(0, 12) : [],
    checkedAt: value.checkedAt || ""
  };
}

function normalizeRegion(value: Partial<CommerceImageLayoutGuide["subjectBox"]>, fallback: CommerceImageCanvasRegion): CommerceImageCanvasRegion {
  return {
    x: clampNumber(value?.x, fallback.x, 0, 0.98),
    y: clampNumber(value?.y, fallback.y, 0, 0.98),
    width: clampNumber(value?.width, fallback.width, 0.02, 1),
    height: clampNumber(value?.height, fallback.height, 0.02, 1)
  };
}

function storyboardRoles(count: number): CommerceImageStoryboardRole[] {
  if (count === 1) return ["cover_hook"];
  if (count === 2) return ["cover_hook", "outfit_closing"];
  if (count === 3) return ["cover_hook", "scene_context", "outfit_closing"];
  return ["cover_hook", "scene_context", "fact_proof", ...Array.from({ length: Math.max(0, count - 4) }, () => "highlight" as const), "outfit_closing"];
}

function isStoryboardRole(value: unknown): value is CommerceImageStoryboardRole {
  return ["cover_hook", "scene_context", "fact_proof", "outfit_closing", "highlight"].includes(String(value));
}

function defaultStoryboardTitle(role: CommerceImageStoryboardRole, index: number) {
  if (role === "cover_hook") return "封面 · 情绪引子";
  if (role === "scene_context") return "第二张 · 场景代入";
  if (role === "fact_proof") return "第三张 · 真实证明";
  if (role === "outfit_closing") return "最后一张 · 收藏收尾";
  return `补充页 ${index + 1} · 细节延展`;
}

function defaultStoryboardPurpose(role: CommerceImageStoryboardRole) {
  if (role === "cover_hook") return "建立主题和情绪钩子，让读者愿意继续看。";
  if (role === "scene_context") return "让读者代入一个真实场景。";
  if (role === "fact_proof") return "用真实商品细节证明前面的选择理由。";
  if (role === "outfit_closing") return "收束主题，给出克制的收藏或挑选理由。";
  return "补足一个和主题相关的真实细节，使故事继续向收尾推进。";
}

function normalizeTaskKind(value: unknown): CommerceImageTaskKind {
  return value === "detail_page" || value === "douyin_post" || value === "xiaohongshu_post" || value === "retouch" || value === "free_chat" ? value : "detail_page";
}

function normalizeStrategy(value: unknown): CommerceImageTask["brief"]["strategy"] {
  const values: CommerceImageTask["brief"]["strategy"][] = ["auto", "pain_point", "contrast", "scenario", "emotion", "listicle", "evidence", "custom_skill"];
  return values.includes(value as CommerceImageTask["brief"]["strategy"]) ? value as CommerceImageTask["brief"]["strategy"] : "auto";
}

function normalizeDocument(value: CommerceImageDocument): CommerceImageDocument {
  return {
    id: documentIdPattern.test(value.id || "") ? value.id : `commerce_image_document_${randomUUID()}`,
    name: value.name || "产品资料",
    mimeType: value.mimeType || "text/plain",
    size: Number.isFinite(value.size) ? value.size : 0,
    status: value.status === "failed" ? "failed" : "ready",
    excerpt: value.excerpt || value.extractedText?.slice(0, 360) || "",
    extractedText: value.extractedText || "",
    error: value.error || "",
    createdAt: value.createdAt || new Date().toISOString(),
    storagePath: value.storagePath
  };
}

function normalizeReferenceAnalysis(value: CommerceImageTask["referenceAnalysis"] | undefined): CommerceImageTask["referenceAnalysis"] {
  if (!value) return emptyReferenceAnalysis();
  return {
    status: ["idle", "analyzing", "completed", "failed"].includes(value.status) ? value.status : "idle",
    sourceAssetId: value.sourceAssetId || "",
    width: Number.isFinite(value.width) ? value.width : 0,
    height: Number.isFinite(value.height) ? value.height : 0,
    summary: value.summary || "",
    segments: Array.isArray(value.segments) ? value.segments.map((segment, index) => ({
      id: segment.id || `commerce_image_segment_${randomUUID()}`,
      title: segment.title || `详情模块 ${index + 1}`,
      kind: segment.kind || "detail",
      order: index,
      yStart: clampNumber(segment.yStart, 0, 0, 1),
      yEnd: clampNumber(segment.yEnd, 1, 0, 1),
      layout: segment.layout || "",
      style: segment.style || "",
      detectedText: Array.isArray(segment.detectedText) ? segment.detectedText.filter(Boolean).slice(0, 20) : [],
      assetId: segment.assetId || ""
    })) : [],
    warnings: Array.isArray(value.warnings) ? value.warnings.filter(Boolean) : [],
    error: value.error || "",
    updatedAt: value.updatedAt || ""
  };
}

function emptyReferenceAnalysis(): CommerceImageTask["referenceAnalysis"] {
  return { status: "idle", sourceAssetId: "", width: 0, height: 0, summary: "", segments: [], warnings: [], error: "", updatedAt: "" };
}

function normalizeGenerationSets(value: CommerceImageTask["generationSets"] | undefined) {
  return Array.isArray(value) ? value.map((set, index) => ({
    id: set.id || `commerce_image_set_${randomUUID()}`,
    index,
    label: set.label || `方案 ${String.fromCharCode(65 + index)}`,
    status: ["draft", "generating", "partial", "completed", "failed"].includes(set.status) ? set.status : "draft",
    createdAt: set.createdAt || new Date().toISOString()
  })) : [];
}

function normalizeTextLayer(value: CommerceImagePanel["textLayers"][number]): CommerceImagePanel["textLayers"][number] {
  const weights = [400, 500, 600, 700, 800, 900] as const;
  return {
    id: value.id || `commerce_image_text_${randomUUID()}`,
    name: value.name || "文字",
    text: value.text || "",
    x: clampNumber(value.x, 0.08, 0, 0.98),
    y: clampNumber(value.y, 0.08, 0, 0.98),
    width: clampNumber(value.width, 0.84, 0.02, 1),
    height: clampNumber(value.height, 0.18, 0.02, 1),
    fontFamily: value.fontFamily === "serif" || value.fontFamily === "rounded" ? value.fontFamily : "sans",
    fontSize: clampNumber(value.fontSize, 0.055, 0.012, 0.2),
    fontWeight: weights.includes(value.fontWeight as typeof weights[number]) ? value.fontWeight as typeof weights[number] : 700,
    lineHeight: clampNumber(value.lineHeight, 1.2, 0.8, 2),
    color: /^#[0-9a-f]{6}$/i.test(value.color || "") ? value.color : "#ffffff",
    backgroundColor: /^#[0-9a-f]{6}$/i.test(value.backgroundColor || "") ? value.backgroundColor : "#000000",
    backgroundOpacity: clampNumber(value.backgroundOpacity, 0, 0, 1),
    align: value.align === "center" || value.align === "right" ? value.align : "left",
    visible: value.visible !== false,
    locked: value.locked === true
  };
}

function legacyOverlayLayers(overlay: CommerceImagePanel["overlay"]): CommerceImagePanel["textLayers"] {
  if (!overlay.visible || (!overlay.title && !overlay.body)) return [];
  const top = overlay.position === "top";
  return [
    overlay.title ? normalizeTextLayer({
      id: `commerce_image_text_${randomUUID()}`, name: "标题", text: overlay.title, x: 0.08, y: top ? 0.08 : 0.7,
      width: 0.84, height: 0.13, fontFamily: "sans", fontSize: 0.058, fontWeight: 800, lineHeight: 1.15,
      color: overlay.textColor, backgroundColor: "#000000", backgroundOpacity: 0, align: overlay.align, visible: true, locked: false
    }) : null,
    overlay.body ? normalizeTextLayer({
      id: `commerce_image_text_${randomUUID()}`, name: "正文", text: overlay.body, x: 0.08, y: top ? 0.23 : 0.84,
      width: 0.84, height: 0.1, fontFamily: "sans", fontSize: 0.032, fontWeight: 500, lineHeight: 1.3,
      color: overlay.accentColor, backgroundColor: "#000000", backgroundOpacity: 0, align: overlay.align, visible: true, locked: false
    }) : null
  ].filter((item): item is CommerceImagePanel["textLayers"][number] => Boolean(item));
}

function clampInteger(value: unknown, fallback: number, min: number, max: number) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.round(Math.min(max, Math.max(min, number))) : fallback;
}

function clampNumber(value: unknown, fallback: number, min: number, max: number) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : fallback;
}

function safeText(value: unknown, max: number) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function normalizeTaskStatus(value: unknown): CommerceImageTask["status"] {
  const statuses: CommerceImageTask["status"][] = ["draft", "awaiting_input", "planning", "awaiting_approval", "queued", "generating", "partial", "completed", "failed", "cancelled"];
  return statuses.includes(value as CommerceImageTask["status"]) ? value as CommerceImageTask["status"] : "draft";
}

function normalizeBrandProfile(value: Partial<CommerceImageBrandProfile>): CommerceImageBrandProfile {
  return {
    brandName: value.brandName || "",
    primaryColor: value.primaryColor || "#7c3aed",
    secondaryColor: value.secondaryColor || "#f4f4f5",
    fontStyle: value.fontStyle || "简洁现代",
    styleNotes: value.styleNotes || ""
  };
}

async function tasksRoot() {
  const root = path.join(await ensureCommerceImageDataRoot(), "tasks");
  await mkdir(root, { recursive: true, mode: 0o700 });
  return root;
}

async function taskDirectory(taskId: string) {
  if (!taskIdPattern.test(taskId)) throw new Error("任务 ID 不合法。");
  return path.join(await tasksRoot(), taskId);
}

async function profilesRoot() {
  const root = path.join(await ensureCommerceImageDataRoot(), "profiles");
  await mkdir(root, { recursive: true, mode: 0o700 });
  return root;
}

async function atomicJsonWrite(target: string, value: unknown) {
  await mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
  const temp = `${target}.${Date.now()}-${randomUUID()}.tmp`;
  await writeFile(temp, JSON.stringify(value, null, 2), { encoding: "utf8", mode: 0o600 });
  await rename(temp, target);
}

function safeSegment(value: string) {
  return value.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 120);
}

function safeFileName(value: string) {
  return value.replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_").slice(0, 160) || "image";
}

function isInsideCommerceImageRoot(filePath: string) {
  const root = path.resolve(commerceImageDataRoot());
  const target = path.resolve(filePath);
  return target === root || target.startsWith(`${root}${path.sep}`);
}

function extensionFromMime(mimeType: string) {
  if (mimeType === "image/jpeg") return "jpg";
  if (mimeType === "image/webp") return "webp";
  return "png";
}

function hasBrandContent(profile: CommerceImageBrandProfile) {
  return Boolean(profile.brandName || profile.styleNotes || profile.primaryColor !== "#7c3aed" || profile.secondaryColor !== "#f4f4f5");
}

function isUserProductRole(role: CommerceImageAssetRole) {
  return !["benchmark_reference", "reference_segment", "skill_reference", "style_reference"].includes(role);
}
