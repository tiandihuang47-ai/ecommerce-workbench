/**
 * 产品资产（商品图片 + 产品文档）的共享类型。
 *
 * 设计原则：
 * - 产品元数据（名称、卖点、文档正文等）保存在产品档案里；
 * - 图片与文档的**二进制文件**放在本地运行时目录，档案里只存引用与元数据；
 * - 任何模块引用产品时都通过 productId，不复制第二套资产系统。
 */

export const PRODUCT_IMAGE_LIMIT = 50;

export const PRODUCT_IMAGE_ROLES = ["front", "side", "back", "detail", "logo", "on_body", "scene", "package", "other"] as const;

export type ProductImageRole = typeof PRODUCT_IMAGE_ROLES[number];

export const PRODUCT_IMAGE_ROLE_LABELS: Record<ProductImageRole, string> = {
  front: "正面",
  side: "侧面",
  back: "背面",
  detail: "细节",
  logo: "Logo",
  on_body: "模特图",
  scene: "场景图",
  package: "包装",
  other: "其他"
};

export interface ProductImageAsset {
  id: string;
  name: string;
  role: ProductImageRole | "";
  mimeType: string;
  width: number;
  height: number;
  size: number;
  addedAt: string;
  /** 由服务端按需生成；档案里通常不落盘，读取时补全。 */
  url?: string;
  thumbUrl?: string;
}

export type ProductDocumentFormat = "docx" | "doc" | "md" | "txt";

/**
 * 产品资料的 AI 理解状态。
 * 文档正文是本地解析的，保存时就已经可用；AI 结构化属于后台增强，不阻塞保存。
 */
export type ProductDocumentAnalysisStatus = "none" | "processing" | "ready" | "failed";

export const PRODUCT_DOCUMENT_ANALYSIS_LABELS: Record<ProductDocumentAnalysisStatus, string> = {
  none: "未解析",
  processing: "资料解析中",
  ready: "资料已就绪",
  failed: "资料解析失败"
};

export const PRODUCT_DOCUMENT_FORMATS: ProductDocumentFormat[] = ["docx", "doc", "md", "txt"];

export interface ProductDocumentAsset {
  id: string;
  name: string;
  format: ProductDocumentFormat;
  size: number;
  /** 解析出的纯文本正文；这是 AI 引用产品资料时使用的内容。 */
  text: string;
  uploadedAt: string;
  updatedAt: string;
  /** 文档被替换过几次（内部版本标识，UI 不展开版本树）。 */
  revision: number;
  downloadUrl?: string;
}

export function productImageRoleLabel(role: string | undefined): string {
  if (!role) return "未分类";
  return PRODUCT_IMAGE_ROLE_LABELS[role as ProductImageRole] || "未分类";
}

export function isProductImageRole(value: unknown): value is ProductImageRole {
  return typeof value === "string" && (PRODUCT_IMAGE_ROLES as readonly string[]).includes(value);
}

export function normalizeProductImageRole(value: unknown): ProductImageRole | "" {
  return isProductImageRole(value) ? value : "";
}

export function productAssetUrl(productId: string, assetId: string, variant: "full" | "thumb" = "full") {
  return `/api/products/assets?productId=${encodeURIComponent(productId)}&assetId=${encodeURIComponent(assetId)}&variant=${variant}`;
}

export function productDocumentDownloadUrl(productId: string, documentId: string) {
  return `/api/products/documents?productId=${encodeURIComponent(productId)}&documentId=${encodeURIComponent(documentId)}`;
}

export function formatFileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 KB";
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
