import { denyIfUnauthenticated } from "@/lib/auth/guard";
import { NextResponse } from "next/server";
import {
  DocumentImportError,
  PRODUCT_DOCUMENT_MAX_STORED_TEXT,
  extractProductDocument,
  structureProductDocument
} from "@/lib/product-document";

export const runtime = "nodejs";

/** 导入一份产品资料并结构化。产品资产中心「新建产品 / 更新资料」也走这里。 */
export async function POST(request: Request) {
  const deny = await denyIfUnauthenticated(request);
  if (deny) return deny;
  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return failure("上传请求格式不正确，请重新选择产品资料文件。");
  }

  const file = formData.get("file");
  if (!(file instanceof File)) {
    return failure("请先选择要导入的产品资料文件。");
  }

  let extraction;
  try {
    extraction = await extractProductDocument(file.name, new Uint8Array(await file.arrayBuffer()));
  } catch (error) {
    if (error instanceof DocumentImportError) {
      return failure(error.message, 422, { errorCode: error.code, suggestion: error.suggestion });
    }
    return failure("产品资料解析失败，请确认文件可以在 Word 或 WPS 中正常打开。", 422, {
      errorCode: "DOCUMENT_PARSE_FAILED",
      suggestion: "请重新打开文档并另存为标准 Word 文档（.docx），然后再上传。"
    });
  }

  const importedAt = new Date().toISOString();
  const result = await structureProductDocument(file.name, extraction.text, importedAt);

  return NextResponse.json({
    success: true,
    source: result.source,
    documentFormat: extraction.format,
    message: result.message,
    warnings: extraction.warnings,
    truncated: extraction.text.length > PRODUCT_DOCUMENT_MAX_STORED_TEXT,
    documentText: extraction.text.slice(0, PRODUCT_DOCUMENT_MAX_STORED_TEXT),
    product: result.product
  });
}

function failure(message: string, status = 400, details?: { errorCode?: string; suggestion?: string }) {
  return NextResponse.json({ success: false, message, ...details }, { status });
}
