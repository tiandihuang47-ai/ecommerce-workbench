import { denyIfUnauthenticated } from "@/lib/auth/guard";
import path from "node:path";
import { NextResponse } from "next/server";
import { hashBytes, persistReplicaProductDocument, persistReplicaProductImage } from "@/lib/replica-cache";
import { extractReplicaDocumentText } from "@/lib/replica-product-analysis";
import { getReplicaTaskRecord, patchReplicaTaskRecord, saveReplicaTaskRecord, toPublicReplicaTask } from "@/lib/replica-task-store";
import { startReplicaTask } from "@/lib/replica-task-runner";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const deny = await denyIfUnauthenticated(request);
  if (deny) return deny;
  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json({ success: false, message: "上传请求格式不正确。" }, { status: 400 });
  }
  const taskId = String(formData.get("taskId") || "");
  const task = await getReplicaTaskRecord(taskId);
  if (!task) return NextResponse.json({ success: false, message: "任务不存在。" }, { status: 404 });

  const files = formData.getAll("images").filter((item): item is File => item instanceof File).slice(0, 8);
  const removeAssetId = String(formData.get("removeAssetId") || "");
  const keepAssetIds = formData.getAll("keepAssetIds").map((item) => String(item)).filter(Boolean);
  const removeDocument = formData.has("removeDocument");
  if (removeAssetId && !keepAssetIds.length && task.products.filter((item) => item.assetId !== removeAssetId).length === 0) {
    const updated = await saveReplicaTaskRecord({ ...task, products: [], productCacheKey: "", status: "draft", error: "", promptRequested: false });
    return NextResponse.json({ success: true, task: toPublicReplicaTask(updated), message: "已删除最后一张产品图" });
  }
  if (!files.length && !task.products.length) return NextResponse.json({ success: false, message: "请至少保留一张产品图片。" }, { status: 400 });

  try {
    const inputs: Array<{ assetId: string; name: string; size: number; type: string; path: string; hash: string }> = [];
    if (files.length) for (const [index, file] of files.entries()) {
      const extension = path.extname(file.name).toLowerCase();
      if (![".jpg", ".jpeg", ".png", ".webp"].includes(extension)) throw new Error("产品图片只支持 JPG、PNG 或 WEBP。");
      if (file.size > 20 * 1024 * 1024) throw new Error("单张产品图片不能超过 20MB。");
      const buffer = new Uint8Array(await file.arrayBuffer());
      const hash = hashBytes(buffer);
      const filePath = await persistReplicaProductImage({ buffer, hash, index, extension });
      inputs.push({ assetId: `${taskId}_product_${inputs.length}_${hash}`, name: file.name, size: file.size, type: file.type, path: filePath, hash });
    }
    inputs.push(...task.products.filter((item) => keepAssetIds.includes(item.assetId) && item.assetId !== removeAssetId));

    const documentFile = formData.get("document");
    let document = task.document;
    let documentText = task.document?.text || "";
    if (documentFile instanceof File && documentFile.size) {
      const extension = path.extname(documentFile.name).toLowerCase();
      if (![".pdf", ".docx", ".txt", ".md"].includes(extension)) throw new Error("产品文档只支持 PDF、DOCX 或 TXT。");
      const buffer = new Uint8Array(await documentFile.arrayBuffer());
      const documentHash = hashBytes(buffer);
      const documentPath = await persistReplicaProductDocument({ buffer, hash: documentHash, name: documentFile.name });
      documentText = await extractReplicaDocumentText({ name: documentFile.name, type: documentFile.type, buffer });
      document = { assetId: `${taskId}_document_${documentHash}`, name: documentFile.name, size: documentFile.size, type: documentFile.type, path: documentPath, hash: documentHash, text: documentText };
    } else if (removeDocument) {
      document = null;
      documentText = "";
    }

    const productHash = hashBytes(JSON.stringify({
      images: inputs.map((item) => item.hash),
      documentHash: document?.hash || "",
      documentText
    }));
    const updated = await saveReplicaTaskRecord({
      ...task,
      products: inputs,
      document,
      productCacheKey: "",
      productHashForAnalysis: productHash,
      status: "analyzing_product",
      error: "",
      promptRequested: false
    });
    startReplicaTask(updated.id);
    return NextResponse.json({ success: true, task: toPublicReplicaTask(updated), message: "产品已开始后台理解" });
  } catch (error) {
    await patchReplicaTaskRecord(taskId, { status: "failed", error: error instanceof Error ? error.message : "产品图片理解失败，请重试。" });
    return NextResponse.json({ success: false, message: error instanceof Error ? error.message : "产品图片理解失败，请重试。" }, { status: 502 });
  }
}
