import { denyIfUnauthenticated } from "@/lib/auth/guard";
import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { cancelCommerceChatGeneration, FREE_CHAT_MODEL_ID, isCommerceChatGenerationRunning, startCommerceChatGeneration } from "@/lib/commerce-image-chat";
import { isCommerceImageOutputRatio, isCommerceImageRatio } from "@/lib/commerce-image-models";
import { getCommerceImageTask, persistCommerceChatAsset, saveCommerceImageTask, toPublicCommerceImageTask } from "@/lib/commerce-image-store";
import type { CommerceImageChatMessage, CommerceImageQuality } from "@/lib/commerce-image-types";

export const runtime = "nodejs";

const maxImageBytes = 25 * 1024 * 1024;
const allowedTypes = new Set(["image/png", "image/jpeg", "image/webp"]);
const maxImagesPerMessage = 4;
const defaultChatTitle = "自然对话生图";

export async function POST(request: Request, context: { params: Promise<{ taskId: string }> }) {
  const deny = await denyIfUnauthenticated(request);
  if (deny) return deny;
  const { taskId } = await context.params;
  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return failure("请求格式不正确。");
  }
  const task = await getCommerceImageTask(taskId);
  if (!task || task.kind !== "free_chat") return failure("对话生图项目不存在。", 404, "TASK_NOT_FOUND");
  if (isCommerceChatGenerationRunning(taskId)) {
    return NextResponse.json({ success: true, started: false, task: toPublicCommerceImageTask(task), message: "上一条还在生成中，等它完成后再发下一条。" }, { status: 202 });
  }
  const prompt = typeof formData.get("prompt") === "string" ? (formData.get("prompt") as string).trim().slice(0, 4000) : "";
  if (!prompt) return failure("请先输入想要生成的画面描述。");
  const files = formData.getAll("images").filter((item): item is File => item instanceof File);
  if (files.length > maxImagesPerMessage) return failure(`一次最多附带 ${maxImagesPerMessage} 张参考图。`);
  for (const file of files) {
    if (!allowedTypes.has(file.type)) return failure(`${file.name} 不是支持的 PNG、JPG 或 WEBP 图片。`);
    if (file.size <= 0 || file.size > maxImageBytes) return failure(`${file.name} 为空或超过 25MB。`);
  }
  const ratioInput = formData.get("ratio");
  const ratio = typeof ratioInput === "string" && isCommerceImageRatio(ratioInput)
    ? ratioInput
    : task.ratio !== "original" && isCommerceImageOutputRatio(task.ratio) ? task.ratio : "1:1";
  const qualityInput = formData.get("quality");
  const quality: CommerceImageQuality = qualityInput === "standard" || qualityInput === "ultra" ? qualityInput : "high";
  const continueLast = formData.get("continueLast") === "true";
  const explicitReferenceIds = parseReferenceIds(formData.get("referenceAssetIds"));

  const uploadedIds: string[] = [];
  for (const file of files) {
    try {
      const asset = await persistCommerceChatAsset({
        taskId,
        bytes: new Uint8Array(await file.arrayBuffer()),
        name: file.name,
        role: "chat_reference"
      });
      uploadedIds.push(asset.id);
    } catch (error) {
      return failure(error instanceof Error ? error.message : "参考图保存失败。", 422);
    }
  }
  const latest = await getCommerceImageTask(taskId);
  if (!latest) return failure("对话生图项目不存在。", 404, "TASK_NOT_FOUND");
  const referenceAssetIds = [...uploadedIds];
  for (const assetId of explicitReferenceIds) {
    if (assetId === "" || referenceAssetIds.includes(assetId)) continue;
    if (latest.sourceAssets.some((asset) => asset.id === assetId && asset.storagePath)) referenceAssetIds.push(assetId);
  }
  if (continueLast) {
    const lastGenerated = [...latest.sourceAssets].reverse().find((asset) => asset.role === "chat_generated");
    if (lastGenerated?.storagePath && !referenceAssetIds.includes(lastGenerated.id)) referenceAssetIds.push(lastGenerated.id);
  }
  const userMessage: CommerceImageChatMessage = {
    id: `commerce_image_chat_${randomUUID()}`,
    role: "user",
    content: prompt,
    createdAt: new Date().toISOString(),
    imageAssetIds: uploadedIds,
    status: "ok"
  };
  const shouldRenameTitle = !latest.title || latest.title === defaultChatTitle;
  const saved = await saveCommerceImageTask({
    ...latest,
    title: shouldRenameTitle ? `${prompt.slice(0, 24)}${prompt.length > 24 ? "…" : ""}` : latest.title,
    model: FREE_CHAT_MODEL_ID,
    resolvedModelId: FREE_CHAT_MODEL_ID,
    ratio,
    quality,
    status: "generating",
    error: "",
    lastError: undefined,
    progress: { completed: 0, total: 1, currentPanelId: "", message: "GPT Image 2.5 正在生成图片", updatedAt: new Date().toISOString() },
    chatMessages: [...latest.chatMessages, userMessage]
  });
  const started = startCommerceChatGeneration(taskId, { prompt, referenceAssetIds, ratio, quality });
  return NextResponse.json({
    success: true,
    started,
    task: toPublicCommerceImageTask(saved),
    message: started ? "已开始生成图片。" : "正在生成中，请稍候。"
  }, { status: 202 });
}

export async function DELETE(request: Request, context: { params: Promise<{ taskId: string }> }) {
  const deny = await denyIfUnauthenticated(request);
  if (deny) return deny;
  const { taskId } = await context.params;
  const cancelled = cancelCommerceChatGeneration(taskId);
  return NextResponse.json({ success: true, message: cancelled ? "已发送停止请求，正在收尾。" : "当前没有正在进行的生成。" });
}

function failure(message: string, status = 400, code = "CHAT_ERROR") {
  return NextResponse.json({ success: false, code, category: "validation", retryable: false, message }, { status });
}

/** 解析前端传入的「指定参考图」素材 ID（JSON 数组），仅用于图生图。 */
function parseReferenceIds(value: FormDataEntryValue | null): string[] {
  if (typeof value !== "string" || !value.trim()) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string").slice(0, 8) : [];
  } catch {
    return [];
  }
}
