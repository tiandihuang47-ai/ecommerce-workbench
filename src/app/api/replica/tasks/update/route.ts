import { denyIfUnauthenticated } from "@/lib/auth/guard";
import { NextResponse } from "next/server";
import { getReplicaTaskRecord, patchReplicaTaskRecord, toPublicReplicaTask } from "@/lib/replica-task-store";

export const runtime = "nodejs";

export async function PATCH(request: Request) {
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
  const prompt = typeof body.prompt === "string" ? body.prompt : task.prompt;
  let versions = task.versions;
  if (body.appendVersion && typeof body.appendVersion === "object") {
    const version = body.appendVersion as { prompt?: string; note?: string };
    versions = [...task.versions, {
      id: `replica_version_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      version: task.versions.length + 1,
      prompt: typeof version.prompt === "string" ? version.prompt : prompt,
      note: typeof version.note === "string" ? version.note : "手动保存",
      createdAt: new Date().toISOString()
    }];
  }
  const messages = Array.isArray(body.messages) ? body.messages : task.messages;
  const updated = await patchReplicaTaskRecord(taskId, {
    prompt,
    versions,
    messages,
    referenceCopy: typeof body.referenceCopy === "string" ? body.referenceCopy : task.referenceCopy,
    requirements: typeof body.requirements === "string" ? body.requirements : task.requirements
  });
  if (!updated) return NextResponse.json({ success: false, message: "任务不存在。" }, { status: 404 });
  return NextResponse.json({ success: true, task: toPublicReplicaTask(updated) });
}
