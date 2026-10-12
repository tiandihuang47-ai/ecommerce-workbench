import { denyIfUnauthenticated } from "@/lib/auth/guard";
import { NextResponse } from "next/server";
import { createPerformanceRecord, marketingLearningStore } from "@/lib/marketing-learning";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const deny = await denyIfUnauthenticated(request);
  if (deny) return deny;
  const url = new URL(request.url);
  const creativeId = url.searchParams.get("creativeId") || undefined;
  const records = await marketingLearningStore.listPerformance(creativeId ? { creativeId } : undefined);
  return NextResponse.json({ success: true, records });
}

export async function POST(request: Request) {
  const deny = await denyIfUnauthenticated(request);
  if (deny) return deny;
  let body: Record<string, unknown>;
  try {
    body = await request.json() as Record<string, unknown>;
  } catch {
    return failure("请求体必须是 JSON。");
  }
  const creativeId = text(body.creativeId, 120);
  if (!creativeId) return failure("请先选择要关联的创意记录。");
  try {
    const record = await createPerformanceRecord({
      creativeId,
      platform: text(body.platform, 60),
      postId: text(body.postId, 200),
      postUrl: text(body.postUrl, 500),
      publishedAt: text(body.publishedAt, 40),
      dataCapturedAt: text(body.dataCapturedAt, 40),
      metrics: (body.metrics && typeof body.metrics === "object" ? body.metrics : {}) as Record<string, unknown>,
      rawMetrics: (body.rawMetrics && typeof body.rawMetrics === "object" ? body.rawMetrics : {}) as Record<string, string | number>,
      notes: text(body.notes, 500)
    });
    return NextResponse.json({ success: true, record, message: "数据已记录并关联到该创意。" });
  } catch (error) {
    return failure(error instanceof Error ? error.message : "数据记录失败。");
  }
}

function text(value: unknown, max: number) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function failure(message: string) {
  return NextResponse.json({ success: false, message }, { status: 400 });
}
