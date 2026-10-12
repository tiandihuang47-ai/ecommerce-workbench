import { denyIfUnauthenticated } from "@/lib/auth/guard";
import { NextResponse } from "next/server";
import { now, since, trace } from "@/lib/perf-trace";
import { clearProductDocuments, isProductId, saveProductDocumentFile } from "@/lib/product-asset-store";
import { PRODUCT_DOCUMENT_MAX_STORED_TEXT, DocumentImportError, buildFallbackProduct, extractProductDocument } from "@/lib/product-document";
import { productDocumentDownloadUrl, type ProductDocumentAsset } from "@/lib/product-assets-types";

export const runtime = "nodejs";

/**
 * 绑定产品的唯一一份资料文档。
 *
 * 这里**只做本地能立刻做完的事**：解析文本（mammoth / 纯文本）、落盘、返回。
 * 不调用任何 LLM —— AI 理解改由 /api/products/analyze-document 在保存完成之后后台执行，
 * 这样「保存产品」不会被模型延迟拖到 20-30 秒。
 *
 * 产品已有文档时这里是「替换」：解析成功后才清掉旧文件，避免解析失败把旧资料弄丢。
 */
export async function POST(request: Request, context: { params: Promise<{ productId: string }> }) {
  const deny = await denyIfUnauthenticated(request);
  if (deny) return deny;
  const uploadStartedAt = now();
  const { productId } = await context.params;
  if (!isProductId(productId)) return failure("产品不存在。", 404);

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return failure("上传请求格式不正确，请重新选择文件。");
  }

  const file = formData.get("file");
  if (!(file instanceof File)) return failure("请先选择产品资料文件。");
  const previousRevision = Number(formData.get("revision") || "0");
  const previousId = String(formData.get("previousDocumentId") || "");

  const bytes = new Uint8Array(await file.arrayBuffer());
  let extraction;
  const parseStartedAt = now();
  try {
    extraction = await extractProductDocument(file.name, bytes);
  } catch (error) {
    if (error instanceof DocumentImportError) {
      return failure(error.message, 422, error.code, error.suggestion);
    }
    return failure("产品资料解析失败，请确认文件可以正常打开。", 422, "DOCUMENT_PARSE_FAILED");
  }
  trace("document_upload", { name: file.name.slice(0, 40), bytes: bytes.byteLength, parseMs: Math.round(since(parseStartedAt)), totalMs: Math.round(since(uploadStartedAt)) });

  const importedAt = new Date().toISOString();
  /* 用本地规则先产出一份可用的基础资料（含原文），保证即使 AI 还没跑，
   * 产品也已经带着真实资料可用；AI 结果稍后异步覆盖结构化字段。 */
  const baseline = buildFallbackProduct(file.name, extraction.text, importedAt);
  // 解析成功之后才替换：一个产品永远只有一份资料，旧文件在这里被清掉。
  await clearProductDocuments(productId);
  const stored = await saveProductDocumentFile({ productId, bytes, name: file.name, format: extraction.format });

  const document: ProductDocumentAsset = {
    id: stored.id,
    name: file.name,
    format: extraction.format,
    size: stored.size,
    text: extraction.text.slice(0, PRODUCT_DOCUMENT_MAX_STORED_TEXT),
    uploadedAt: importedAt,
    updatedAt: importedAt,
    revision: Number.isFinite(previousRevision) && previousRevision > 0 ? previousRevision + 1 : 1,
    downloadUrl: productDocumentDownloadUrl(productId, stored.id)
  };

  return NextResponse.json({
    success: true,
    replaced: Boolean(previousId),
    source: "local",
    /** 让调用方立刻知道 AI 理解还没做，状态由前端记录并驱动后台解析。 */
    analysisStatus: "processing",
    message: previousId ? "产品资料已替换。" : "产品资料已保存。",
    warnings: extraction.warnings,
    document,
    product: baseline
  });
}

export async function DELETE(request: Request, context: { params: Promise<{ productId: string }> }) {
  const deny = await denyIfUnauthenticated(request);
  if (deny) return deny;
  const { productId } = await context.params;
  if (!isProductId(productId)) return failure("产品不存在。", 404);
  await clearProductDocuments(productId);
  return NextResponse.json({ success: true, message: "产品资料已移除。" });
}

function failure(message: string, status = 400, code = "PRODUCT_DOCUMENT_ERROR", suggestion = "") {
  return NextResponse.json({ success: false, code, message, suggestion }, { status });
}
