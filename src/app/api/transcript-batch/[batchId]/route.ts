import { NextResponse, type NextRequest } from "next/server";
import { unauthorized, denyIfUnauthenticated } from "@/lib/auth/guard";
import { resolveScopedUserId } from "@/lib/server/user-data";
import { applyBatchAction, getBatch, type BatchAction } from "@/lib/transcript-batch/service";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ batchId: string }> };

/** 批次详情（网页端只能读自己的批次；他人的批次一律 404）。 */
export async function GET(request: NextRequest, context: RouteContext) {
  const deny = await denyIfUnauthenticated(request);
  if (deny) return deny;
  const userScope = await resolveBatchScope(request);
  if (userScope === null) return unauthorized();
  const { batchId } = await context.params;
  const batch = await getBatch(userScope, batchId);
  if (!batch) {
    return NextResponse.json({ success: false, message: "没有找到该批量任务。" }, { status: 404 });
  }
  return NextResponse.json({ success: true, batch });
}

/** 批次操作：stop（停止派发）/ resume（继续）/ retry-item（单条重试，走全局队列）。 */
export async function POST(request: NextRequest, context: RouteContext) {
  const deny = await denyIfUnauthenticated(request);
  if (deny) return deny;
  const userScope = await resolveBatchScope(request);
  if (userScope === null) return unauthorized();
  const { batchId } = await context.params;

  let body: { action?: unknown; itemId?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ success: false, message: "请求体必须是合法 JSON。" }, { status: 400 });
  }

  const action = String(body.action || "");
  if (!["stop", "resume", "retry-item"].includes(action)) {
    return NextResponse.json({ success: false, message: "不支持的操作。" }, { status: 400 });
  }
  if (action === "retry-item" && typeof body.itemId !== "string") {
    return NextResponse.json({ success: false, message: "缺少 itemId。" }, { status: 400 });
  }

  const batch = await applyBatchAction(userScope, batchId, {
    action: action as BatchAction["action"],
    itemId: typeof body.itemId === "string" ? body.itemId : ""
  } as BatchAction);
  if (!batch) {
    return NextResponse.json({ success: false, message: "没有找到该批量任务。" }, { status: 404 });
  }
  return NextResponse.json({ success: true, batch });
}

async function resolveBatchScope(request: NextRequest): Promise<string | null> {
  const scoped = await resolveScopedUserId(request);
  return scoped ?? (process.env.DIRECTOR_WEB_AUTH_DISABLED === "1" ? "desktop" : null);
}
