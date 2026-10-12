import { randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, rm, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { readImageMetadata } from "@/lib/commerce-image-file";
import { OwnershipError, ownershipScope } from "@/lib/server/request-scope";
import {
  PRODUCT_DOCUMENT_FORMATS,
  PRODUCT_IMAGE_LIMIT,
  type ProductDocumentAsset,
  type ProductDocumentFormat,
  type ProductImageAsset,
  type ProductImageRole
} from "@/lib/product-assets-types";

export const runtimeRoot = process.env.DIRECTOR_RUNTIME_DIR
  ? process.env.DIRECTOR_RUNTIME_DIR
  : path.join(process.cwd(), ".director-platform-data");

export function productAssetRoot() {
  return path.join(runtimeRoot, "products");
}

const productIdPattern = /^[a-z0-9_-]{4,120}$/i;
const assetIdPattern = /^product_image_[a-z0-9_-]{4,80}$/i;
const documentIdPattern = /^product_document_[a-z0-9_-]{4,80}$/i;

export function isProductId(value: string) {
  return productIdPattern.test(value);
}

function productDirectory(productId: string) {
  if (!isProductId(productId)) throw new Error("产品 ID 不合法。");
  return path.join(productAssetRoot(), productId);
}

export function productImageDirectory(productId: string) {
  return path.join(productDirectory(productId), "images");
}

export function productDocumentDirectory(productId: string) {
  return path.join(productDirectory(productId), "documents");
}

/* ------------------------------------------------------------------ 账号归属 */

function ownerFile(productId: string) {
  return path.join(productDirectory(productId), "owner.json");
}

async function readProductOwner(productId: string): Promise<string | undefined> {
  try {
    const raw = JSON.parse(await readFile(ownerFile(productId), "utf8")) as { userId?: unknown };
    return typeof raw.userId === "string" && raw.userId ? raw.userId : undefined;
  } catch {
    return undefined;
  }
}

async function claimProductOwner(productId: string, userId: string) {
  const dir = productDirectory(productId);
  await mkdir(dir, { recursive: true, mode: 0o700 });
  await writeFile(
    ownerFile(productId),
    JSON.stringify({ userId, claimedAt: new Date().toISOString() }, null, 2),
    { encoding: "utf8", mode: 0o600 }
  );
}

async function productDirectoryExists(productId: string): Promise<boolean> {
  try {
    await readdir(productDirectory(productId));
    return true;
  } catch {
    return false;
  }
}

/**
 * 产品资产的账号归属检查（网页模式生效；桌面端/后台任务上下文直接放行）。
 * - 目录不存在：视为新资产，写入时把归属 claim 给当前用户；
 * - 目录存在但没有归属标记：历史数据，仅管理员可访问（写入时会补 claim）；
 * - 已有归属且不是当前用户：拒绝。
 */
async function ensureProductAccess(productId: string, mode: "read" | "write") {
  const scope = await ownershipScope();
  if (scope.kind !== "web") return;
  const owner = await readProductOwner(productId);
  if (!owner) {
    const exists = await productDirectoryExists(productId);
    if (!exists) {
      if (mode === "write") await claimProductOwner(productId, scope.userId);
      return;
    }
    if (scope.role !== "admin") throw new OwnershipError("该产品资料属于历史数据，请联系管理员。");
    if (mode === "write") await claimProductOwner(productId, scope.userId);
    return;
  }
  if (owner !== scope.userId) throw new OwnershipError();
}

/* ------------------------------------------------------------------ 商品图片 */

export async function countProductImages(productId: string) {
  try {
    await ensureProductAccess(productId, "read");
    const entries = await readdir(productImageDirectory(productId));
    return entries.filter((name) => !name.endsWith(".thumb.webp") && !name.endsWith(".tmp")).length;
  } catch {
    return 0;
  }
}

export async function listProductImageIds(productId: string) {
  try {
    await ensureProductAccess(productId, "read");
    const entries = await readdir(productImageDirectory(productId));
    return entries
      .filter((name) => !name.endsWith(".thumb.webp") && !name.endsWith(".tmp"))
      .map((name) => name.replace(/\.[a-z0-9]+$/i, ""))
      .filter((id) => assetIdPattern.test(id));
  } catch {
    return [];
  }
}

export type SavedProductImage = Omit<ProductImageAsset, "url" | "thumbUrl">;

/** 写入一张商品图，并同步生成列表用缩略图。返回档案里要保存的元数据。 */
export async function saveProductImage(options: {
  productId: string;
  bytes: Uint8Array;
  name: string;
  role?: ProductImageRole | "";
}): Promise<SavedProductImage> {
  await ensureProductAccess(options.productId, "write");
  const metadata = readImageMetadata(options.bytes);
  const id = `product_image_${randomUUID()}`;
  const directory = productImageDirectory(options.productId);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const storagePath = path.join(directory, `${id}${metadata.extension}`);
  await writeFile(storagePath, options.bytes, { mode: 0o600 });
  await writeProductThumbnail(storagePath, path.join(directory, `${id}.thumb.webp`), options.bytes);
  return {
    id,
    name: safeFileName(options.name || `商品图${metadata.extension}`),
    role: options.role || "",
    mimeType: metadata.mimeType,
    width: metadata.width,
    height: metadata.height,
    size: options.bytes.byteLength,
    addedAt: new Date().toISOString()
  };
}

async function writeProductThumbnail(storagePath: string, thumbPath: string, bytes: Uint8Array) {
  try {
    const sharpModule = await import("sharp");
    const sharp = sharpModule.default;
    const buffer = await sharp(Buffer.from(bytes))
      .rotate()
      .resize(480, 480, { fit: "inside", withoutEnlargement: true })
      .webp({ quality: 78 })
      .toBuffer();
    await writeFile(thumbPath, buffer, { mode: 0o600 });
  } catch {
    /* 缩略图失败不阻塞上传：读取时回退到原图。 */
  }
}

export async function readProductImage(productId: string, assetId: string, variant: "full" | "thumb") {
  if (!isProductId(productId) || !assetIdPattern.test(assetId)) return null;
  try {
    await ensureProductAccess(productId, "read");
  } catch {
    return null; // 他人资产视同不存在
  }
  const directory = productImageDirectory(productId);
  const entries = await readdir(directory).catch(() => [] as string[]);
  const found = entries.find((name) => !name.endsWith(".thumb.webp") && name.startsWith(`${assetId}.`));
  if (!found) return null;
  const fullPath = path.join(directory, found);
  if (variant === "thumb") {
    const thumbName = `${found.replace(/\.[a-z0-9]+$/i, "")}.thumb.webp`;
    const thumbPath = path.join(directory, thumbName);
    try {
      const bytes = await readFile(thumbPath);
      return { bytes, mimeType: "image/webp", name: `${found.replace(/\.[a-z0-9]+$/i, "")}.webp` };
    } catch {
      /* 没有缩略图时回退原图。 */
    }
  }
  const bytes = await readFile(fullPath);
  const mimeType = mimeForExtension(path.extname(found));
  return { bytes, mimeType, name: found };
}

/** 读取商品图的原始字节，供生图任务复制到自己的任务目录（历史任务永久可看）。 */
export async function readProductImageBytes(productId: string, assetId: string) {
  const resolved = await readProductImage(productId, assetId, "full");
  if (!resolved) return null;
  return { bytes: new Uint8Array(resolved.bytes), mimeType: resolved.mimeType, name: resolved.name };
}

export async function deleteProductImage(productId: string, assetId: string) {
  if (!isProductId(productId) || !assetIdPattern.test(assetId)) return false;
  try {
    await ensureProductAccess(productId, "write");
  } catch {
    return false;
  }
  const directory = productImageDirectory(productId);
  const entries = await readdir(directory).catch(() => [] as string[]);
  const targets = entries.filter((name) => name.startsWith(assetId));
  if (!targets.length) return false;
  for (const name of targets) {
    await unlink(path.join(directory, name)).catch(() => undefined);
  }
  return true;
}

/* ------------------------------------------------------------------ 产品文档 */

export type SavedProductDocument = Omit<ProductDocumentAsset, "downloadUrl">;

export async function saveProductDocumentFile(options: {
  productId: string;
  bytes: Uint8Array;
  name: string;
  format: ProductDocumentFormat;
}): Promise<{ id: string; storagePath: string; size: number }> {
  await ensureProductAccess(options.productId, "write");
  const id = `product_document_${randomUUID()}`;
  const directory = productDocumentDirectory(options.productId);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const storagePath = path.join(directory, `${id}.${options.format}`);
  await writeFile(storagePath, options.bytes, { mode: 0o600 });
  return { id, storagePath, size: options.bytes.byteLength };
}

/** 一个产品只保留一份文档：写入新文档时清掉旧文件。 */
export async function clearProductDocuments(productId: string) {
  try {
    await ensureProductAccess(productId, "write");
  } catch {
    return;
  }
  const directory = productDocumentDirectory(productId);
  const entries = await readdir(directory).catch(() => [] as string[]);
  for (const name of entries) {
    await unlink(path.join(directory, name)).catch(() => undefined);
  }
}

export async function readProductDocumentFile(productId: string, documentId: string) {
  if (!isProductId(productId) || !documentIdPattern.test(documentId)) return null;
  try {
    await ensureProductAccess(productId, "read");
  } catch {
    return null; // 他人资产视同不存在
  }
  const directory = productDocumentDirectory(productId);
  const entries = await readdir(directory).catch(() => [] as string[]);
  const found = entries.find((name) => name.startsWith(documentId));
  if (!found) return null;
  const bytes = await readFile(path.join(directory, found));
  return { bytes, name: found, format: extensionToFormat(path.extname(found)) };
}

/* ------------------------------------------------------------------ 产品整体 */

/** 软删除产品时保留文件；只有显式清理才删除目录。 */
export async function purgeProductAssets(productId: string) {
  try {
    await ensureProductAccess(productId, "write");
  } catch {
    return; // 无权清理时跳过，不删除他人资产
  }
  await rm(productDirectory(productId), { recursive: true, force: true }).catch(() => undefined);
}

/* ------------------------------------------------------------------ 工具 */

export function formatFromFileName(fileName: string): ProductDocumentFormat | null {
  const extension = path.extname(fileName).toLowerCase().replace(".", "");
  if (extension === "markdown") return "md";
  return (PRODUCT_DOCUMENT_FORMATS as string[]).includes(extension) ? extension as ProductDocumentFormat : null;
}

function extensionToFormat(extension: string): ProductDocumentFormat {
  const value = extension.toLowerCase().replace(".", "");
  if (value === "markdown") return "md";
  return (PRODUCT_DOCUMENT_FORMATS as string[]).includes(value) ? value as ProductDocumentFormat : "txt";
}

function mimeForExtension(extension: string) {
  const value = extension.toLowerCase();
  if (value === ".png") return "image/png";
  if (value === ".jpg" || value === ".jpeg") return "image/jpeg";
  if (value === ".webp") return "image/webp";
  return "application/octet-stream";
}

function safeFileName(value: string) {
  return value.replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_").slice(0, 160) || "file";
}

export { PRODUCT_IMAGE_LIMIT };
