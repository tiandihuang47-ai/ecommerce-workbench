import { denyIfUnauthenticated } from "@/lib/auth/guard";
import { NextResponse } from "next/server";
import { analyzeReplicaProduct, extractReplicaDocumentText, type ReplicaProductImageInput } from "@/lib/replica-product-analysis";
import { getCachedProductUnderstanding, hashBytes, saveCachedProductUnderstanding } from "@/lib/replica-cache";
import { replicaSchemaVersion } from "@/lib/replica-types";

export const runtime = "nodejs";
export const maxDuration = 300;

const allowedImageExtensions = new Set([".jpg", ".jpeg", ".png", ".webp"]);

export async function POST(request: Request) {
  const deny = await denyIfUnauthenticated(request);
  if (deny) return deny;
  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return failure("upload", "产品图片上传格式不正确，请重试。");
  }

  const imageFiles = formData.getAll("images").filter((item): item is File => item instanceof File);
  if (!imageFiles.length) return failure("upload", "请至少上传一张产品图片。");
  if (imageFiles.length > 8) return failure("upload", "最多支持 8 张产品参考图。");

  const inputs: ReplicaProductImageInput[] = [];
  for (const file of imageFiles) {
    const extension = `.${file.name.split(".").pop()?.toLowerCase() || ""}`;
    if (!allowedImageExtensions.has(extension)) return failure("upload", "产品图片只支持 JPG、PNG 或 WEBP。");
    if (file.size > 20 * 1024 * 1024) return failure("upload", "单张产品图片不能超过 20MB。");
    inputs.push({ name: file.name, type: file.type || imageMime(extension), buffer: new Uint8Array(await file.arrayBuffer()) });
  }

  try {
    const documentFile = formData.get("document");
    const documentText = documentFile instanceof File && documentFile.size
      ? await extractReplicaDocumentText({ name: documentFile.name, type: documentFile.type, buffer: new Uint8Array(await documentFile.arrayBuffer()) })
      : stringValue(formData.get("documentText"));
    const productText = stringValue(formData.get("productText"));
    const hashInput = JSON.stringify({
      images: inputs.map((item) => ({ name: item.name, type: item.type, hash: hashBytes(item.buffer) })),
      documentText,
      productText
    });
    const productHash = hashBytes(hashInput);
    const cached = await getCachedProductUnderstanding(productHash);
    if (cached?.schemaVersion === replicaSchemaVersion) return NextResponse.json({ success: true, status: "ready", cacheKey: productHash, imageCount: cached.imageCount, message: "产品已准备" });

    const understanding = await analyzeReplicaProduct({ images: inputs, documentText: [productText, documentText].filter(Boolean).join("\n\n") });
    const saved = { ...understanding, productHash };
    await saveCachedProductUnderstanding(productHash, saved);
    return NextResponse.json({ success: true, status: "ready", cacheKey: productHash, imageCount: inputs.length, message: "产品已准备" });
  } catch (error) {
    return failure("analysis", error instanceof Error ? error.message : "产品图片理解失败，请重试。", 502);
  }
}

function imageMime(extension: string) {
  return extension === ".png" ? "image/png" : extension === ".webp" ? "image/webp" : "image/jpeg";
}

function stringValue(value: FormDataEntryValue | null) {
  return typeof value === "string" ? value.trim() : "";
}

function failure(stage: string, message: string, status = 400) {
  return NextResponse.json({ success: false, stage, message, retryable: true }, { status });
}
