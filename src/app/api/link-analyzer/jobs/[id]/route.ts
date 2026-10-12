import { denyIfUnauthenticated } from "@/lib/auth/guard";
import { NextResponse } from "next/server";
import { ownershipScope, recordBelongsToScope } from "@/lib/server/request-scope";
import { getLinkAnalyzeJob } from "@/services/link-analyzer/job-store";

export const runtime = "nodejs";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const deny = await denyIfUnauthenticated(request);
  if (deny) return deny;
  const { id } = await context.params;
  const job = getLinkAnalyzeJob(id);

  if (!job) {
    return NextResponse.json({ success: false, message: "没有找到该链接分析任务，可能是服务重启导致内存任务丢失。" }, { status: 404 });
  }

  // 资源归属：网页模式下只能读取自己创建的分析任务
  const scope = await ownershipScope();
  if (!recordBelongsToScope(job.userId, scope)) {
    return NextResponse.json({ success: false, message: "没有找到该链接分析任务。" }, { status: 404 });
  }

  return NextResponse.json({ success: true, job });
}
