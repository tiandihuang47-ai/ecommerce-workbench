import { denyIfUnauthenticated } from "@/lib/auth/guard";
import { NextResponse } from "next/server";
import { cancelCommerceImageTask } from "@/lib/commerce-image-runner";

export const runtime = "nodejs";

export async function POST(request: Request, context: { params: Promise<{ taskId: string }> }) {
  const deny = await denyIfUnauthenticated(request);
  if (deny) return deny;
  const { taskId } = await context.params;
  const cancelled = cancelCommerceImageTask(taskId);
  return NextResponse.json({ success: true, cancelled, message: cancelled ? "已请求取消，当前模型请求结束后会停止后续图片。" : "当前没有正在运行的生成任务。" });
}
