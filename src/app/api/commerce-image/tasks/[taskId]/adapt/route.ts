import { denyIfUnauthenticated } from "@/lib/auth/guard";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { NextResponse } from "next/server";
import { startCommerceImageAnalysis } from "@/lib/commerce-image-analysis";
import {
  createCommerceImageTask,
  getCommerceImageTask,
  persistCommerceImageDerivedSource,
  persistCommerceImageDocument,
  persistCommerceImageSource,
  readCommerceImageAssetBytes,
  saveCommerceImageTask,
  toPublicCommerceImageTask
} from "@/lib/commerce-image-store";

export const runtime = "nodejs";

export async function POST(request: Request, context: { params: Promise<{ taskId: string }> }) {
  const deny = await denyIfUnauthenticated(request);
  if (deny) return deny;
  const { taskId } = await context.params;
  const source = await getCommerceImageTask(taskId);
  if (!source) return failure("生图项目不存在。", 404);
  if (source.kind !== "douyin_post" && source.kind !== "xiaohongshu_post") return failure("只有电商图文项目支持跨平台适配。");
  const targetKind = source.kind === "xiaohongshu_post" ? "douyin_post" : "xiaohongshu_post";
  let target = await createCommerceImageTask({
    kind: targetKind,
    title: `${source.productName || "未命名商品"} · ${targetKind === "douyin_post" ? "抖音图文" : "小红书图文"}`,
    productId: "",
    productName: source.productName,
    productSnapshot: source.productSnapshot,
    model: source.model,
    ratio: "3:4",
    generationSetCount: source.generationSetCount,
    brandProfile: source.brandProfile,
    brief: {
      ...source.brief,
      extra: [source.brief.extra, `从${source.kind === "xiaohongshu_post" ? "小红书" : "抖音"}版本适配；重新规划平台节奏、标题和文案，不直接照搬原项目。`].filter(Boolean).join("\n")
    }
  });
  const assetMap = new Map<string, string>();
  try {
    for (const asset of source.sourceAssets) {
      if (asset.role === "benchmark_reference" || asset.role === "reference_segment") continue;
      const input = await readCommerceImageAssetBytes(source.id, asset.id);
      if (!input) continue;
      const stored = asset.role === "skill_reference"
        ? await persistCommerceImageDerivedSource({ taskId: target.id, bytes: input.bytes, name: asset.name, role: "skill_reference" })
        : await persistCommerceImageSource({ taskId: target.id, bytes: input.bytes, name: asset.name, role: asset.role, saveToProductProfile: false });
      assetMap.set(asset.id, stored.asset.id);
      target = stored.task;
    }
    for (const document of source.documents) {
      if (!document.storagePath) continue;
      target = await persistCommerceImageDocument({
        taskId: target.id,
        bytes: new Uint8Array(await readFile(document.storagePath)),
        name: document.name,
        mimeType: document.mimeType,
        extractedText: document.extractedText || document.excerpt
      });
    }
    target = await saveCommerceImageTask({
      ...target,
      productId: source.productId,
      strategySnapshot: source.strategySnapshot ? {
        ...source.strategySnapshot,
        referenceAssetIds: source.strategySnapshot.referenceAssetIds.map((id) => assetMap.get(id)).filter((id): id is string => Boolean(id))
      } : undefined,
      chatMessages: [{
        id: `commerce_image_message_${randomUUID()}`,
        role: "assistant",
        content: `已从原项目复制商品素材、产品资料和营销策略。接下来会按${targetKind === "douyin_post" ? "抖音" : "小红书"}重新规划比例、节奏与文案，原项目不会被覆盖。`,
        createdAt: new Date().toISOString()
      }],
      approvedAt: "",
      approvedPlanRevision: 0,
      status: "draft"
    });
    startCommerceImageAnalysis(target.id);
    return NextResponse.json({ success: true, task: toPublicCommerceImageTask(target), message: "另一平台项目已创建，AI 正在重新规划。" }, { status: 202 });
  } catch (error) {
    return failure(error instanceof Error ? error.message : "跨平台项目创建失败。", 422);
  }
}

function failure(message: string, status = 400) {
  return NextResponse.json({ success: false, code: "ADAPT_ERROR", category: "validation", retryable: false, message }, { status });
}
