import { denyIfUnauthenticated } from "@/lib/auth/guard";
import { NextResponse } from "next/server";
import { getReplicaTaskRecord, patchReplicaTaskRecord, toPublicReplicaTask } from "@/lib/replica-task-store";
import { startReplicaTask } from "@/lib/replica-task-runner";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const deny = await denyIfUnauthenticated(request);
  if (deny) return deny;
  let body: Record<string, unknown> = {};
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ success: false, message: "请求体必须是合法 JSON。" }, { status: 400 });
  }
  const taskId = String(body.taskId || "");
  const task = await getReplicaTaskRecord(taskId);
  if (!task) return NextResponse.json({ success: false, message: "任务不存在。" }, { status: 404 });
  if (!task.video.path) return NextResponse.json({ success: false, message: "没有可重试的视频资产。" }, { status: 409 });
  const updated = await patchReplicaTaskRecord(taskId, {
    status: task.products.length && !task.productCacheKey ? "analyzing_product" : "analyzing_video",
    error: ""
  });
  if (!updated) return NextResponse.json({ success: false, message: "任务不存在。" }, { status: 404 });
  startReplicaTask(taskId);
  return NextResponse.json({ success: true, task: toPublicReplicaTask(updated), message: "已复用原视频继续处理" });
}
