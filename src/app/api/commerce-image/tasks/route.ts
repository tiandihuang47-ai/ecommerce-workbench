import { denyIfUnauthenticated } from "@/lib/auth/guard";
import { NextResponse } from "next/server";
import { DEFAULT_COMMERCE_IMAGE_MODEL, commerceImageTaskLabels, isCommerceImageModel, isCommerceImageOutputRatio } from "@/lib/commerce-image-models";
import { recoverStalledCommerceImageTask } from "@/lib/commerce-image-runner";
import { createCommerceImageTask, getCommerceImageTask, listCommerceImageTasks, toPublicCommerceImageTask } from "@/lib/commerce-image-store";
import type { CommerceImageTaskKind } from "@/lib/commerce-image-types";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const deny = await denyIfUnauthenticated(request);
  if (deny) return deny;
  const taskId = new URL(request.url).searchParams.get("taskId");
  if (taskId) {
    const task = await getCommerceImageTask(taskId);
    if (!task) return failure("生图项目不存在。", 404);
    const recovered = await recoverStalledCommerceImageTask(task);
    return NextResponse.json({ success: true, task: toPublicCommerceImageTask(recovered) });
  }
  const tasks = await listCommerceImageTasks();
  const recovered = await Promise.all(tasks.map((task) => recoverStalledCommerceImageTask(task)));
  return NextResponse.json({ success: true, tasks: recovered.map(toPublicCommerceImageTask) });
}

export async function POST(request: Request) {
  const deny = await denyIfUnauthenticated(request);
  if (deny) return deny;
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return failure("请求体必须是合法 JSON。 ");
  }
  const kind = normalizeKind(body.kind);
  if (!kind) return failure("请选择有效的生图任务类型。 ");
  const requestedRatio = isCommerceImageOutputRatio(body.ratio) ? body.ratio : commerceImageTaskLabels[kind].defaultRatio;
  if (requestedRatio === "original" && kind !== "retouch") return failure("仅商品修图支持保持原尺寸。 ");
  const task = await createCommerceImageTask({
    kind,
    title: stringValue(body.title),
    model: isCommerceImageModel(body.model) ? body.model : DEFAULT_COMMERCE_IMAGE_MODEL,
    ratio: requestedRatio,
    productId: stringValue(body.productId),
    productName: stringValue(body.productName),
    productSnapshot: isRecord(body.productSnapshot) ? body.productSnapshot as never : undefined,
    brief: isRecord(body.brief) ? body.brief as never : undefined,
    brandProfile: isRecord(body.brandProfile) ? body.brandProfile as never : undefined,
    generationSetCount: generationSetCountValue(body.generationSetCount),
    quality: typeof body.quality === "string" && ["standard", "high", "ultra"].includes(body.quality) ? body.quality as never : "high"
  });
  return NextResponse.json({ success: true, task: toPublicCommerceImageTask(task) }, { status: 201 });
}

function normalizeKind(value: unknown): CommerceImageTaskKind | null {
  return value === "detail_page" || value === "douyin_post" || value === "xiaohongshu_post" || value === "retouch" || value === "free_chat" ? value : null;
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value.trim().slice(0, 2000) : "";
}

function generationSetCountValue(value: unknown): 1 | 2 | 4 {
  return value === 2 || value === 4 ? value : 1;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function failure(message: string, status = 400) {
  return NextResponse.json({ success: false, code: "TASK_ERROR", category: "validation", retryable: false, message }, { status });
}
