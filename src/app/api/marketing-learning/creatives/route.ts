import { denyIfUnauthenticated } from "@/lib/auth/guard";
import { NextResponse } from "next/server";
import { getCreativeHistory, learningOverview } from "@/lib/marketing-learning";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const deny = await denyIfUnauthenticated(request);
  if (deny) return deny;
  const url = new URL(request.url);
  if (url.searchParams.get("overview") === "1") {
    return NextResponse.json({ success: true, overview: await learningOverview() });
  }
  const limit = Number(url.searchParams.get("limit") || "");
  const history = await getCreativeHistory({
    platform: url.searchParams.get("platform") || undefined,
    productId: url.searchParams.get("productId") || undefined,
    strategyKey: url.searchParams.get("strategyKey") || undefined,
    taskId: url.searchParams.get("taskId") || undefined,
    limit: Number.isFinite(limit) && limit > 0 ? limit : undefined
  });
  return NextResponse.json({ success: true, history });
}
