import { denyIfUnauthenticated } from "@/lib/auth/guard";
import { NextResponse } from "next/server";
import { analyzePerformance, compareExperiment } from "@/lib/marketing-learning";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const deny = await denyIfUnauthenticated(request);
  if (deny) return deny;
  const url = new URL(request.url);
  const goal = url.searchParams.get("goal");
  const normalizedGoal = goal === "engagement" || goal === "product_click" || goal === "conversion" ? goal : "traffic";
  const experimentId = url.searchParams.get("experimentId") || "";
  if (experimentId) {
    const result = await compareExperiment(experimentId, normalizedGoal);
    return NextResponse.json({ success: true, ...result });
  }
  const analysis = await analyzePerformance({
    goal: normalizedGoal,
    platform: url.searchParams.get("platform") || undefined,
    productId: url.searchParams.get("productId") || undefined,
    creativeIds: url.searchParams.get("creativeIds")?.split(",").filter(Boolean)
  });
  return NextResponse.json({ success: true, analysis });
}
