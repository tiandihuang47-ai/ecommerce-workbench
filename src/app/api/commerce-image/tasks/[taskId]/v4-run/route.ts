import { denyIfUnauthenticated } from "@/lib/auth/guard";
import { NextResponse } from "next/server";
import { getCommerceImageTask, toPublicCommerceImageTask } from "@/lib/commerce-image-store";
import { isV4Running } from "@/lib/commerce-image-v4-runner";

export const runtime = "nodejs";

export async function GET(request: Request, context: { params: Promise<{ taskId: string }> }) {
  const deny = await denyIfUnauthenticated(request);
  if (deny) return deny;
  const { taskId } = await context.params;
  const task = await getCommerceImageTask(taskId);
  if (!task) return NextResponse.json({ success: false, message: "生图项目不存在。" }, { status: 404 });
  const creative = task.creative;
  const runId = new URL(request.url).searchParams.get("runId") || creative?.activeRunId || creative?.runs[creative.runs.length - 1]?.id;
  const run = runId ? creative?.runs.find((r) => r.id === runId) : undefined;
  return NextResponse.json({
    success: true,
    task: toPublicCommerceImageTask(task),
    running: isV4Running(taskId),
    run: run ? {
      id: run.id,
      status: run.status,
      phase: run.phase,
      completedPanelIds: run.completedPanelIds,
      error: run.error,
      attempts: run.attempts
    } : null
  });
}
