import { denyIfUnauthenticated } from "@/lib/auth/guard";
import { NextResponse } from "next/server";
import { now, since, trace } from "@/lib/perf-trace";
import { extractReplicaDocumentText } from "@/lib/replica-product-analysis";
import {
  getCommerceImageTask,
  persistCommerceImageDocument,
  removeCommerceImageDocument,
  toPublicCommerceImageTask
} from "@/lib/commerce-image-store";

export const runtime = "nodejs";

const maxBytes = 10 * 1024 * 1024;
const allowedExtensions = new Set([".docx", ".doc", ".md", ".markdown", ".txt"]);

export async function POST(request: Request, context: { params: Promise<{ taskId: string }> }) {
  const deny = await denyIfUnauthenticated(request);
  if (deny) return deny;
  const uploadStartedAt = now();
  const { taskId } = await context.params;
  if (!await getCommerceImageTask(taskId)) return failure("生图项目不存在。", 404);
  let formData: FormData;
  try { formData = await request.formData(); } catch { return failure("上传请求格式不正确。"); }
  const files = formData.getAll("documents").filter((item): item is File => item instanceof File);
  if (!files.length) return failure("请选择 Word（.docx / .doc）、Markdown 或 TXT 产品资料。");
  let latest = await getCommerceImageTask(taskId);
  for (const file of files) {
    const extension = file.name.slice(file.name.lastIndexOf(".")).toLowerCase();
    if (!allowedExtensions.has(extension)) return failure(`${file.name} 不是支持的 Word（.docx / .doc）、Markdown 或 TXT 文件。`);
    if (file.size <= 0 || file.size > maxBytes) return failure(`${file.name} 为空或超过 10MB。`);
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const readStartedAt = now();
      const extractedText = await extractReplicaDocumentText({ name: file.name, type: file.type, buffer: bytes });
      const extractMs = Math.round(since(readStartedAt));
      if (!extractedText.trim()) return failure(`${file.name} 没有读取到正文，请检查文件内容。`, 422);
      latest = await persistCommerceImageDocument({ taskId, bytes, name: file.name, mimeType: file.type || "application/octet-stream", extractedText });
      trace("document_upload", { name: file.name.slice(0, 40), bytes: bytes.byteLength, extractMs, totalMs: Math.round(since(uploadStartedAt)) });
    } catch (error) {
      return failure(error instanceof Error ? error.message : `${file.name} 读取失败。`, 422);
    }
  }
  return NextResponse.json({ success: true, task: latest ? toPublicCommerceImageTask(latest) : null, message: `已添加 ${files.length} 份产品资料。` });
}

export async function DELETE(request: Request, context: { params: Promise<{ taskId: string }> }) {
  const deny = await denyIfUnauthenticated(request);
  if (deny) return deny;
  const { taskId } = await context.params;
  const documentId = new URL(request.url).searchParams.get("documentId") || "";
  const task = await removeCommerceImageDocument(taskId, documentId);
  if (!task) return failure("没有找到要删除的产品资料。", 404);
  return NextResponse.json({ success: true, task: toPublicCommerceImageTask(task) });
}

function failure(message: string, status = 400) {
  return NextResponse.json({ success: false, code: "DOCUMENT_ERROR", category: "validation", retryable: false, message }, { status });
}
