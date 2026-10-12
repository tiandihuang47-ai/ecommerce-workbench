import { denyIfUnauthenticated } from "@/lib/auth/guard";
import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { compileCommerceImagePanel } from "@/lib/commerce-image-plan";
import { getCommerceImageTask, saveCommerceImageTask, toPublicCommerceImageTask } from "@/lib/commerce-image-store";
import type { CommerceImageGenerationSet } from "@/lib/commerce-image-types";

export const runtime = "nodejs";

export async function POST(request: Request, context: { params: Promise<{ taskId: string }> }) {
  const deny = await denyIfUnauthenticated(request);
  if (deny) return deny;
  const { taskId } = await context.params;
  const task = await getCommerceImageTask(taskId);
  if (!task) return failure("生图项目不存在。", 404);
  if (["planning", "queued", "generating"].includes(task.status)) return failure("项目正在处理中，请完成后再确认方案。", 409);
  if (!task.panels.length) return failure("请先生成视觉方案。");
  const productAssets = task.sourceAssets.filter((asset) => !["benchmark_reference", "reference_segment", "style_reference", "skill_reference"].includes(asset.role));
  if (!productAssets.length) return failure("请至少上传 1 张自己的真实商品图。");
  if (task.kind === "xiaohongshu_post") {
    const hasUsableFacts = task.productFacts.some((fact) => fact.confidence !== "uncertain" && fact.value.trim())
      || Boolean(task.brief.sellingPoints.trim() || task.productSnapshot?.productFacts || task.productSnapshot?.coreSellingPoints);
    if (!task.storyboard?.theme.trim() || !task.storyboard.cards.length) return failure("请先生成并检查小红书故事线。");
    if (!hasUsableFacts) return failure("小红书出图前需要至少一条可用商品事实；请补充产品资料或已知卖点后重新生成故事线。");
  }
  if (task.kind === "detail_page" && !task.sourceAssets.some((asset) => asset.role === "benchmark_reference")) {
    return failure("请先上传一张对标详情长图。");
  }
  const prepared = task.kind === "xiaohongshu_post"
    ? { ...task, panels: task.panels.map((panel) => compileCommerceImagePanel(task, panel)) }
    : task;
  const revisedWithImages = task.kind === "xiaohongshu_post" && task.approvedPlanRevision !== task.planRevision && task.panels.some((panel) => panel.versions.length);
  const generationSets = revisedWithImages
    ? [...prepared.generationSets, ...createGenerationSets(prepared.generationSetCount)]
    : prepared.generationSets.length >= prepared.generationSetCount
    ? prepared.generationSets
    : createGenerationSets(prepared.generationSetCount);
  const selectedSetId = revisedWithImages ? generationSets.at(-prepared.generationSetCount)?.id || "" : generationSets.some((set) => set.id === prepared.selectedSetId) ? prepared.selectedSetId : generationSets[0]?.id || "";
  const now = new Date().toISOString();
  const planRevision = task.planRevision;
  const saved = await saveCommerceImageTask({
    ...prepared,
    generationSets,
    selectedSetId,
    storyboard: prepared.kind === "xiaohongshu_post" && prepared.storyboard
      ? { ...prepared.storyboard, status: "confirmed", confirmedAt: now, updatedAt: now }
      : prepared.storyboard,
    approvedAt: now,
    planRevision,
    approvedPlanRevision: planRevision,
    status: "draft",
    error: "",
    lastError: undefined
  });
  const calls = prepared.panels.length * generationSets.length;
  return NextResponse.json({ success: true, task: toPublicCommerceImageTask(saved), message: `方案已确认：${prepared.panels.length} 个画面 × ${generationSets.length} 套方案，预计 ${calls} 次生图。` });
}

function failure(message: string, status = 400) {
  return NextResponse.json({ success: false, code: "APPROVAL_ERROR", category: "validation", retryable: false, message }, { status });
}

function createGenerationSets(count: 1 | 2 | 4): CommerceImageGenerationSet[] {
  const now = new Date().toISOString();
  return Array.from({ length: count }, (_, index) => ({
    id: `commerce_image_set_${randomUUID()}`,
    index,
    label: `方案 ${String.fromCharCode(65 + index)}`,
    status: "draft",
    createdAt: now
  }));
}
