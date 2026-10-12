import { randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import sharp from "sharp";
import {
  CommerceImageProviderError,
  generateCommerceImage,
  isTransientCommerceImageError,
  TRANSIENT_RETRY_DELAYS_MS,
  type CommerceImageReferenceInput
} from "@/lib/commerce-image-provider";
import { resolveCommerceImageSize } from "@/lib/commerce-image-models";
import { readImageMetadata } from "@/lib/commerce-image-file";
import { getCommerceImageTask, persistCommerceChatAsset, saveCommerceImageTask } from "@/lib/commerce-image-store";
import type {
  CommerceImageAsset,
  CommerceImageChatMessage,
  CommerceImageQuality,
  CommerceImageRatio,
  CommerceImageSize,
  ResolvedCommerceImageModel
} from "@/lib/commerce-image-types";

/** 自然对话生图固定使用的模型：文字原样直传，不经过任何流程加工。 */
export const FREE_CHAT_MODEL_ID: ResolvedCommerceImageModel = "gpt-image-2.5";

/** 同一条消息最多生成次数：首次 + 最多 2 次降档自动重试。 */
const MAX_QUALITY_ATTEMPTS = 3;
/** 实际输出长边低于请求的 75% 视为被上游降档。 */
const DOWNGRADE_RATIO = 0.75;

type ChatRunEntry = { controller: AbortController; promise: Promise<void> };

export interface CommerceChatGenerationInput {
  prompt: string;
  referenceAssetIds: string[];
  ratio: CommerceImageRatio;
  quality: CommerceImageQuality;
}

const globalChatState = globalThis as typeof globalThis & {
  __commerceImageChatRuns?: Map<string, ChatRunEntry>;
};
const chatRuns = globalChatState.__commerceImageChatRuns || new Map<string, ChatRunEntry>();
globalChatState.__commerceImageChatRuns = chatRuns;

export function isCommerceChatGenerationRunning(taskId: string) {
  return chatRuns.has(taskId);
}

export function cancelCommerceChatGeneration(taskId: string) {
  const run = chatRuns.get(taskId);
  if (!run) return false;
  run.controller.abort();
  return true;
}

export function startCommerceChatGeneration(taskId: string, input: CommerceChatGenerationInput) {
  if (chatRuns.has(taskId)) return false;
  const controller = new AbortController();
  const promise = executeCommerceChatGeneration(taskId, input, controller.signal).finally(() => chatRuns.delete(taskId));
  chatRuns.set(taskId, { controller, promise });
  return true;
}

/** 对话生图清晰度分档：按画面长边的目标像素。 */
const CHAT_QUALITY_LONG_EDGE: Record<CommerceImageQuality, number> = {
  standard: 1024,
  high: 2048,
  ultra: 4096
};

/** 按比例和清晰度分档计算真实像素：保持比例，长边对齐分档，边长取 16 的倍数。 */
function chatSizeFor(ratio: CommerceImageRatio, quality: CommerceImageQuality) {
  const base = resolveCommerceImageSize(ratio);
  const target = CHAT_QUALITY_LONG_EDGE[quality] || CHAT_QUALITY_LONG_EDGE.high;
  const scale = target / Math.max(base.width, base.height);
  const width = Math.min(4096, Math.max(512, Math.round((base.width * scale) / 16) * 16));
  const height = Math.min(4096, Math.max(512, Math.round((base.height * scale) / 16) * 16));
  return { width, height, label: `${width} × ${height}` };
}

async function executeCommerceChatGeneration(taskId: string, input: CommerceChatGenerationInput, signal: AbortSignal) {
  try {
    let task = await getCommerceImageTask(taskId);
    if (!task) throw new Error("生图任务不存在。");
    const references: CommerceImageReferenceInput[] = [];
    for (const assetId of input.referenceAssetIds.slice(0, 8)) {
      const asset = task.sourceAssets.find((item) => item.id === assetId);
      if (!asset?.storagePath) continue;
      try {
        references.push({ bytes: new Uint8Array(await readFile(asset.storagePath)), mimeType: asset.mimeType, name: asset.name || "reference.png" });
      } catch { /* 单张参考图缺失不阻塞生成 */ }
    }

    const requested = chatSizeFor(input.ratio, input.quality);
    const requestedLong = Math.max(requested.width, requested.height);
    const qualityLabel = input.quality === "ultra" ? "4K" : input.quality === "standard" ? "1K" : "2K";
    const notes: string[] = [];
    let finalAsset: CommerceImageAsset | null = null;

    // image2.5 原生输出上限约 2K：4K 档不做无效重试，一次生成后直接本地放大补齐。
    const allowQualityRetry = input.quality !== "ultra";
    const maxAttempts = allowQualityRetry ? MAX_QUALITY_ATTEMPTS : 1;

    for (let qualityAttempt = 1; qualityAttempt <= maxAttempts; qualityAttempt += 1) {
      const result = await generateOnce(input, references, requested, signal);
      let attemptAsset = await persistCommerceChatAsset({ taskId, bytes: result.bytes, name: `对话生图_${Date.now()}.png`, role: "chat_generated" });
      const actualLong = Math.max(attemptAsset.width || 0, attemptAsset.height || 0);
      const downgraded = actualLong > 0 && actualLong < requestedLong * DOWNGRADE_RATIO;
      if (!downgraded) {
        finalAsset = attemptAsset;
        break;
      }
      if (qualityAttempt < maxAttempts) {
        notes.push(`第 ${qualityAttempt} 次被上游降档为 ${attemptAsset.width} × ${attemptAsset.height}，已自动重试（第 ${qualityAttempt + 1}/${maxAttempts} 次）。\n`);
        continue;
      }
      // 仍被降档：本地 lanczos3 放大补齐到所选档位的精确像素，保证输出尺寸与所选清晰度一致。
      const upBytes = await upscaleToSize(result.bytes, requested.width, requested.height);
      attemptAsset = await replaceCommerceChatAssetBytes(taskId, attemptAsset.id, upBytes);
      notes.push(input.quality === "ultra"
        ? `image2.5 原生输出上限约 2K（本次原生 ${actualLong}px 长边），已按 4K 规格本地放大补齐到 ${requested.width} × ${requested.height}。放大不增加细节，是当前通道 4K 的固定实现方式。`
        : `连续 ${maxAttempts} 次被上游降档（最后一次长边 ${actualLong}px），已本地放大补齐到 ${requested.width} × ${requested.height}。放大不增加细节，如需原生 ${qualityLabel} 可稍后重发。`);
      finalAsset = attemptAsset;
    }

    if (!finalAsset) return;
    const latest = await getCommerceImageTask(taskId);
    if (!latest) return;
    await saveCommerceImageTask({
      ...latest,
      status: "completed",
      error: "",
      lastError: undefined,
      progress: undefined,
      resolvedModelId: FREE_CHAT_MODEL_ID,
      chatMessages: [...latest.chatMessages, {
        id: `commerce_image_chat_${randomUUID()}`,
        role: "assistant" as const,
        content: notes.join(""),
        createdAt: new Date().toISOString(),
        imageAssetIds: [finalAsset.id],
        status: "ok" as const
      }]
    });
    return;
  } catch (error) {
    const aborted = signal.aborted || error instanceof CommerceChatAbortedError;
    const task = await getCommerceImageTask(taskId);
    if (!task) return;
    const detail = error instanceof CommerceImageProviderError ? error.detail : null;
    const content = aborted
      ? "本次生成已停止。"
      : detail?.message || (error instanceof Error && error.message ? error.message : "生成失败，请重试。");
    await saveCommerceImageTask({
      ...task,
      status: "completed",
      error: "",
      lastError: aborted ? undefined : detail || undefined,
      progress: undefined,
      chatMessages: [...task.chatMessages, {
        id: `commerce_image_chat_${randomUUID()}`,
        role: "assistant" as const,
        content,
        createdAt: new Date().toISOString(),
        status: "error" as const
      }]
    });
  }
}

/** 单次生成：带瞬时错误退避重试（2s/8s/20s）。 */
async function generateOnce(
  input: CommerceChatGenerationInput,
  references: CommerceImageReferenceInput[],
  size: CommerceImageSize,
  signal: AbortSignal
) {
  const generationTimeoutMs = input.quality === "ultra" ? 480_000 : 300_000;
  let lastError: unknown = new Error("生成失败，请重试。");
  for (let attempt = 0; attempt <= TRANSIENT_RETRY_DELAYS_MS.length; attempt += 1) {
    if (signal.aborted) throw new CommerceChatAbortedError();
    try {
      return await generateCommerceImage({
        modelId: FREE_CHAT_MODEL_ID,
        prompt: input.prompt,
        size,
        quality: input.quality,
        references,
        signal,
        timeoutMs: generationTimeoutMs
      });
    } catch (error) {
      lastError = error;
      if (signal.aborted) throw new CommerceChatAbortedError();
      if (attempt < TRANSIENT_RETRY_DELAYS_MS.length && isTransientCommerceImageError(error)) {
        await sleep(TRANSIENT_RETRY_DELAYS_MS[attempt], signal);
        continue;
      }
      break;
    }
  }
  throw lastError;
}

/**
 * 本地 lanczos3 放大到目标像素。
 *
 * 必须用 cover（等比缩放 + 居中裁剪），绝不能用 fill：
 * fill 会把非目标比例的图直接拉伸成目标尺寸（人物变长、脸型变形、商品失真）。
 * 源图比例已经等于目标比例时，cover 与 fill 结果一致，不会有额外裁剪。
 */
async function upscaleToSize(bytes: Uint8Array, width: number, height: number): Promise<Uint8Array> {
  const buffer = await sharp(Buffer.from(bytes), { limitInputPixels: false })
    .resize(width, height, { kernel: "lanczos3", fit: "cover", position: "attention" })
    .png({ compressionLevel: 6 })
    .toBuffer();
  return new Uint8Array(buffer);
}

/** 用放大后的字节替换已落盘素材，并同步素材尺寸元数据。 */
async function replaceCommerceChatAssetBytes(taskId: string, assetId: string, bytes: Uint8Array): Promise<CommerceImageAsset> {
  const task = await getCommerceImageTask(taskId);
  if (!task) throw new Error("生图任务不存在。");
  const asset = task.sourceAssets.find((item) => item.id === assetId);
  if (!asset?.storagePath) throw new Error("生成图素材不存在，无法本地补齐分辨率。");
  await writeFile(asset.storagePath, bytes, { mode: 0o600 });
  const metadata = readImageMetadata(bytes);
  const updated: CommerceImageAsset = { ...asset, width: metadata.width, height: metadata.height, size: bytes.byteLength };
  await saveCommerceImageTask({
    ...task,
    sourceAssets: task.sourceAssets.map((item) => item.id === assetId ? updated : item)
  });
  return updated;
}

class CommerceChatAbortedError extends Error {
  constructor() {
    super("CHAT_ABORTED");
    this.name = "CommerceChatAbortedError";
  }
}

async function sleep(ms: number, signal?: AbortSignal) {
  await new Promise((resolve) => setTimeout(resolve, ms));
  if (signal?.aborted) throw new CommerceChatAbortedError();
}
