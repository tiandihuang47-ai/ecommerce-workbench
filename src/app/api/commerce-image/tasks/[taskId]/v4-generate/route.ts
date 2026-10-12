import { denyIfUnauthenticated } from "@/lib/auth/guard";
import { NextResponse } from "next/server";
import { getCommerceImageTask, toPublicCommerceImageTask } from "@/lib/commerce-image-store";
import { isV4Running, startV4Generation } from "@/lib/commerce-image-v4-runner";

export const runtime = "nodejs";

export async function POST(request: Request, context: { params: Promise<{ taskId: string }> }) {
  const deny = await denyIfUnauthenticated(request);
  if (deny) return deny;
  const { taskId } = await context.params;
  const task = await getCommerceImageTask(taskId);
  if (!task) return NextResponse.json({ success: false, message: "生图项目不存在。" }, { status: 404 });
  if (task.workflowVersion !== "conversation-v4" || !task.creative?.activePlanId) {
    return NextResponse.json({ success: false, message: "没有活跃的 V4 创作方案，请先在对话中描述需求。" }, { status: 400 });
  }
  if (isV4Running(taskId)) {
    return NextResponse.json({ success: true, started: false, task: toPublicCommerceImageTask(task), message: "正在生成中，请稍候。" }, { status: 202 });
  }
  let targetPanelIds: string[] | undefined;
  try {
    const body = await request.json() as Record<string, unknown>;
    if (Array.isArray(body.targetPanelIds)) targetPanelIds = body.targetPanelIds.filter((item): item is string => typeof item === "string");
  } catch { /* allow empty */ }
  const started = startV4Generation(taskId, { targetPanelIds });
  return NextResponse.json({ success: true, started, task: toPublicCommerceImageTask(task), message: started ? "已开始生成。" : "正在处理中。" }, { status: 202 });
}
