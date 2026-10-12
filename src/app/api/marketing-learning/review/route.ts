import { denyIfUnauthenticated } from "@/lib/auth/guard";
import { NextResponse } from "next/server";
import { marketingLearningStore, runMarketingReview } from "@/lib/marketing-learning";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const deny = await denyIfUnauthenticated(request);
  if (deny) return deny;
  const url = new URL(request.url);
  const reviews = await marketingLearningStore.listReviews({
    experimentId: url.searchParams.get("experimentId") || undefined,
    creativeId: url.searchParams.get("creativeId") || undefined
  });
  return NextResponse.json({ success: true, reviews });
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
  try {
    const goal = body.goal === "engagement" || body.goal === "product_click" || body.goal === "conversion" ? body.goal : "traffic";
    const review = await runMarketingReview({
      experimentId: typeof body.experimentId === "string" ? body.experimentId : undefined,
      creativeIds: Array.isArray(body.creativeIds) ? body.creativeIds.filter((item): item is string => typeof item === "string") : undefined,
      productId: typeof body.productId === "string" ? body.productId : undefined,
      goal
    });
    return NextResponse.json({ success: true, review });
  } catch (error) {
    return failure(error instanceof Error ? error.message : "营销复盘失败。");
  }
}

function failure(message: string) {
  return NextResponse.json({ success: false, message }, { status: 400 });
}
