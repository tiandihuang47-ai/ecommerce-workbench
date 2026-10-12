import { denyIfUnauthenticated } from "@/lib/auth/guard";
import { NextResponse } from "next/server";
import { isCommerceImageAnalysisRunning, startCommerceImageAnalysis } from "@/lib/commerce-image-analysis";
import { getCommerceImageTask, toPublicCommerceImageTask } from "@/lib/commerce-image-store";
import { isCommerceImageTaskRunning } from "@/lib/commerce-image-runner";

export const runtime = "nodejs";

export async function POST(request: Request, context: { params: Promise<{ taskId: string }> }) {
  const deny = await denyIfUnauthenticated(request);
  if (deny) return deny;
  const { taskId } = await context.params;
  const task = await getCommerceImageTask(taskId);
  if (!task) return NextResponse.json({ success: false, code: "TASK_NOT_FOUND", category: "validation", retryable: false, message: "生图项目不存在。" }, { status: 404 });
  if (isCommerceImageTaskRunning(taskId)) return NextResponse.json({ success: true, task: toPublicCommerceImageTask(task), message: "一键生图任务正在处理中。" }, { status: 202 });
  if (isCommerceImageAnalysisRunning(taskId)) return NextResponse.json({ success: true, task: toPublicCommerceImageTask(task), message: "AI 正在分析，请稍候。" }, { status: 202 });
  startCommerceImageAnalysis(taskId);
  return NextResponse.json({ success: true, task: toPublicCommerceImageTask(task), message: "AI 分析已开始。" }, { status: 202 });
}
