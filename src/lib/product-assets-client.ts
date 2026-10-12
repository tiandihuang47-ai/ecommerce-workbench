import {
  PRODUCT_IMAGE_LIMIT,
  productAssetUrl,
  productDocumentDownloadUrl,
  type ProductDocumentAsset,
  type ProductImageAsset,
  type ProductImageRole
} from "@/lib/product-assets-types";
import {
  archiveProductRecord,
  getAllProductRecords,
  getProductRecordById,
  getProductRecords,
  restoreProductRecord,
  saveProductRecord
} from "@/lib/pipeline-storage";
import type { ProductRecord, ProductRecordSaveInput } from "@/lib/pipeline-types";

/**
 * 产品资产中心的前端数据入口。
 * 产品档案（含图片/文档元数据）存在产品记录里，二进制文件由 /api/products/* 落到本地运行时目录。
 */

export type ProductAssetUploadResult = { images: ProductImageAsset[]; coverImageId: string };

/** 老档案里可能没有 url；这里统一补全，保证列表与网格都能直接显示。 */
export function withProductImageUrls(productId: string, images: ProductImageAsset[] | undefined): ProductImageAsset[] {
  return (images || []).map((image) => ({
    ...image,
    url: image.url || productAssetUrl(productId, image.id, "full"),
    thumbUrl: image.thumbUrl || productAssetUrl(productId, image.id, "thumb")
  }));
}

export function withProductDocumentUrl(productId: string, document: ProductDocumentAsset | null | undefined): ProductDocumentAsset | null {
  if (!document) return null;
  return { ...document, downloadUrl: document.downloadUrl || productDocumentDownloadUrl(productId, document.id) };
}

/** 读取产品时统一补全可访问的图片/文档地址。 */
export function hydrateProductRecord(record: ProductRecord): ProductRecord {
  return {
    ...record,
    images: withProductImageUrls(record.id, record.images),
    document: withProductDocumentUrl(record.id, record.document)
  };
}

export function listProductsWithAssets(options: { includeArchived?: boolean } = {}) {
  return getProductRecords(options).map(hydrateProductRecord);
}

export function getProductWithAssets(id: string, options: { includeArchived?: boolean } = {}) {
  const record = getProductRecordById(id, options);
  return record ? hydrateProductRecord(record) : null;
}

export function listAllProductsWithAssets() {
  return getAllProductRecords().map(hydrateProductRecord);
}

export function productImageCount(record: ProductRecord) {
  return (record.images || []).length;
}

export function productCoverImage(record: ProductRecord): ProductImageAsset | null {
  const images = record.images || [];
  if (!images.length) return null;
  return images.find((image) => image.id === record.coverImageId) || images[0];
}

export function remainingProductImageSlots(record: ProductRecord) {
  return Math.max(0, PRODUCT_IMAGE_LIMIT - productImageCount(record));
}

/* ------------------------------------------------------------------ 商品图片 */

export async function uploadProductImages(productId: string, files: File[], role: ProductImageRole | "" = ""): Promise<ProductImageAsset[]> {
  if (!files.length) return [];
  const form = new FormData();
  files.forEach((file) => form.append("images", file));
  if (role) form.set("role", role);
  const response = await fetch(`/api/products/${encodeURIComponent(productId)}/images`, { method: "POST", body: form });
  const payload = await response.json().catch(() => ({})) as { success?: boolean; images?: ProductImageAsset[]; message?: string };
  if (!response.ok || payload.success === false) {
    throw new Error(payload.message || "商品图片上传失败，请重试。");
  }
  return payload.images || [];
}

/**
 * 上传后写回产品档案；封面为空时自动使用第一张图片。
 *
 * 注意：这里必须重新读一次最新档案再合并。调用方手里的 record 可能是几百毫秒前的快照，
 * 而这段时间后台的 AI 资料解析可能已经写回了结果——直接用旧快照会把结果覆盖掉。
 */
export function appendProductImages(record: ProductRecord, images: ProductImageAsset[]): ProductRecord {
  const latest = getProductRecordById(record.id, { includeArchived: true }) || record;
  const next = withProductImageUrls(latest.id, [...(latest.images || []), ...images]).slice(0, PRODUCT_IMAGE_LIMIT);
  return saveProductRecord({
    ...latest,
    images: next,
    coverImageId: latest.coverImageId || next[0]?.id || ""
  });
}

export async function removeProductImage(record: ProductRecord, assetId: string): Promise<ProductRecord> {
  await fetch(`/api/products/${encodeURIComponent(record.id)}/images/${encodeURIComponent(assetId)}`, { method: "DELETE" });
  const remaining = (record.images || []).filter((image) => image.id !== assetId);
  return saveProductRecord({
    ...record,
    images: remaining,
    // 删除封面时自动用剩下的第一张顶上；没有图片就留空。
    coverImageId: record.coverImageId === assetId ? remaining[0]?.id || "" : record.coverImageId
  });
}

export function setProductCover(record: ProductRecord, assetId: string): ProductRecord {
  if (!(record.images || []).some((image) => image.id === assetId)) return record;
  return saveProductRecord({ ...record, coverImageId: assetId });
}

export function setProductImageRole(record: ProductRecord, assetId: string, role: ProductImageRole | ""): ProductRecord {
  return saveProductRecord({
    ...record,
    images: (record.images || []).map((image) => image.id === assetId ? { ...image, role } : image)
  });
}

/* ------------------------------------------------------------------ 产品文档 */

export type ProductDocumentUploadResult = {
  document: ProductDocumentAsset;
  /** 本地规则产出的基础资料（含原文），保证 AI 未完成时产品也可用。 */
  product: ProductRecordSaveInput;
  replaced: boolean;
  message: string;
};

/** 正在后台解析的文档 id，避免重复发起。 */
const analyzingDocumentIds = new Set<string>();

/**
 * 产品档案被后台异步改动时通知界面刷新。
 * 后台解析写的是 localStorage，React 状态不会自己更新，所以用一个轻量事件打通。
 */
export const PRODUCT_UPDATED_EVENT = "director-platform:product-updated";

export function notifyProductUpdated(productId: string) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(PRODUCT_UPDATED_EVENT, { detail: { productId } }));
}

/** 订阅产品档案变化，返回取消订阅函数。 */
export function subscribeProductUpdates(listener: (productId: string) => void) {
  if (typeof window === "undefined") return () => undefined;
  const handler = (event: Event) => {
    const detail = (event as CustomEvent<{ productId?: string }>).detail;
    listener(detail?.productId || "");
  };
  window.addEventListener(PRODUCT_UPDATED_EVENT, handler);
  return () => window.removeEventListener(PRODUCT_UPDATED_EVENT, handler);
}

export async function uploadProductDocument(record: ProductRecord, file: File): Promise<ProductDocumentUploadResult> {
  const form = new FormData();
  form.append("file", file);
  form.append("previousDocumentId", record.document?.id || "");
  form.append("revision", String(record.document?.revision || 0));
  const response = await fetch(`/api/products/${encodeURIComponent(record.id)}/document`, { method: "POST", body: form });
  const payload = await response.json().catch(() => ({})) as {
    success?: boolean;
    message?: string;
    suggestion?: string;
    replaced?: boolean;
    document?: ProductDocumentAsset;
    product?: ProductRecordSaveInput;
  };
  if (!response.ok || payload.success === false || !payload.document || !payload.product) {
    throw new Error([payload.message || "产品资料保存失败。", payload.suggestion].filter(Boolean).join(" "));
  }
  return {
    document: withProductDocumentUrl(record.id, payload.document) as ProductDocumentAsset,
    product: payload.product,
    replaced: Boolean(payload.replaced),
    message: payload.message || "产品资料已更新。"
  };
}

/**
 * 保存成功之后调用：把 AI 结构化放到后台，不阻塞任何用户操作。
 *
 * - 只有当前 document.id 仍然是最新那份时才会写回，避免「先传 A 后传 B，A 的结果覆盖 B」；
 * - 失败只把状态标成 failed，产品本身照常保留，可以单独重试。
 */
export function startProductDocumentAnalysis(
  productId: string,
  document: ProductDocumentAsset,
  options: { onDone?: (record: ProductRecord) => void } = {}
): void {
  if (!document?.id || !document.text?.trim()) return;
  if (analyzingDocumentIds.has(document.id)) return;
  analyzingDocumentIds.add(document.id);

  const mark = (patch: Partial<ProductRecord>) => {
    const latest = getProductRecordById(productId, { includeArchived: true });
    if (!latest || latest.document?.id !== document.id) return null;
    const saved = saveProductRecord({ ...latest, ...patch });
    notifyProductUpdated(productId);
    return saved;
  };

  mark({ documentAnalysisStatus: "processing", documentAnalysisError: "", documentAnalysisDocumentId: document.id });

  void (async () => {
    try {
      const response = await fetch("/api/products/analyze-document", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fileName: document.name, text: document.text, importedAt: document.updatedAt })
      });
      const payload = await response.json().catch(() => ({})) as {
        success?: boolean; message?: string; product?: ProductRecordSaveInput; source?: string;
      };
      if (!response.ok || payload.success === false || !payload.product) {
        throw new Error(payload.message || "产品资料解析失败。");
      }
      const saved = mark({
        ...payload.product,
        // 产品名称由用户决定，AI 结果不覆盖
        name: getProductRecordById(productId, { includeArchived: true })?.name || payload.product.name,
        documentAnalysisStatus: "ready",
        documentAnalysisError: "",
        documentAnalysisDocumentId: document.id
      });
      if (saved) options.onDone?.(saved);
    } catch (error) {
      const saved = mark({
        documentAnalysisStatus: "failed",
        documentAnalysisError: error instanceof Error ? error.message : "产品资料解析失败，可以重试。",
        documentAnalysisDocumentId: document.id
      });
      if (saved) options.onDone?.(saved);
    } finally {
      analyzingDocumentIds.delete(document.id);
    }
  })();
}

/** 手动重试当前文档的 AI 解析。 */
export function retryProductDocumentAnalysis(productId: string, options: { onDone?: (record: ProductRecord) => void } = {}) {
  const record = getProductRecordById(productId, { includeArchived: true });
  if (!record?.document) return false;
  analyzingDocumentIds.delete(record.document.id);
  startProductDocumentAnalysis(productId, record.document, options);
  return true;
}

/** 页面重新打开时，把「解析中」但没有在跑的文档接着解析（例如中途关过页面）。 */
export function resumePendingDocumentAnalyses(): void {
  for (const record of getAllProductRecords()) {
    if (record.documentAnalysisStatus === "processing" && record.document && !analyzingDocumentIds.has(record.document.id)) {
      startProductDocumentAnalysis(record.id, record.document);
    }
  }
}

export function isDocumentAnalysisRunning(documentId: string | undefined) {
  return Boolean(documentId && analyzingDocumentIds.has(documentId));
}

export async function removeProductDocument(record: ProductRecord): Promise<ProductRecord> {
  await fetch(`/api/products/${encodeURIComponent(record.id)}/document`, { method: "DELETE" });
  return saveProductRecord({
    ...record,
    document: null,
    sourceDocumentName: "",
    sourceDocumentText: "",
    sourceDocumentImportedAt: "",
    documentAnalysisStatus: "none",
    documentAnalysisError: "",
    documentAnalysisDocumentId: ""
  });
}

/**
 * 用一份文档创建新产品：先建档案拿到 productId，再把文档绑上去。
 * 解析失败时会把刚建的空产品回滚掉，避免留下垃圾产品。
 */
export async function createProductFromDocument(input: { name: string; file?: File | null }): Promise<{ record: ProductRecord; message: string }> {
  const created = saveProductRecord({ name: input.name.trim() || "未命名产品", sourceType: input.file ? "word" : "manual" });
  let record = hydrateProductRecord(created);
  if (!input.file) return { record, message: "产品已创建。" };
  try {
    const result = await uploadProductDocument(record, input.file);
    record = saveProductRecord({
      ...record,
      ...result.product,
      name: record.name,
      document: result.document,
      sourceDocumentName: result.document.name,
      sourceDocumentText: result.document.text,
      sourceDocumentImportedAt: result.document.updatedAt,
      documentAnalysisStatus: "processing",
      documentAnalysisError: "",
      documentAnalysisDocumentId: result.document.id
    });
    // 文件已经真正落盘，AI 理解转后台，不再占用用户的保存等待时间
    startProductDocumentAnalysis(record.id, result.document);
    return { record: hydrateProductRecord(record), message: "产品已保存，资料正在后台解析。" };
  } catch (error) {
    archiveProductRecord(record.id);
    throw error;
  }
}

/* ------------------------------------------------------------------ 归档 */

export function archiveProduct(id: string) {
  return archiveProductRecord(id);
}

export function restoreProduct(id: string) {
  return restoreProductRecord(id);
}

export function productHasDocument(record: ProductRecord) {
  return Boolean(record.document?.id);
}

/* ------------------------------------------------------------------ 生图引用 */

/** 产品档案 → 生图提示词用的产品事实列表（只取真实存在的字段）。 */
export function buildProductPromptFacts(record: ProductRecord): Array<{ label: string; value: string }> {
  const fields: Array<[string, string | undefined]> = [
    ["产品名称", record.name],
    ["品牌", record.brandName],
    ["品类", record.category],
    ["价格信息", record.priceRange],
    ["规格参数", record.specifications],
    ["颜色款式", record.colors],
    ["核心卖点", record.coreSellingPoints],
    ["次级卖点", record.secondarySellingPoints],
    ["目标人群", record.targetAudience],
    ["用户痛点", record.painPoints],
    ["用户顾虑", record.objections],
    ["使用场景", record.useScenarios],
    ["竞品区别", record.competitorComparison],
    ["买家反馈", record.buyerFeedback],
    ["产品事实", record.productFacts],
    ["证据材料", record.proofMaterials],
    ["不可承诺", record.forbiddenClaims]
  ];
  return fields
    .filter(([, value]) => Boolean(value && value.trim()))
    .map(([label, value]) => ({ label, value: String(value).trim() }));
}
