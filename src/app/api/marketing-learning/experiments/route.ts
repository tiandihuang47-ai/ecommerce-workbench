import { denyIfUnauthenticated } from "@/lib/auth/guard";
import { NextResponse } from "next/server";
import { createExperiment, listExperiments } from "@/lib/marketing-learning";

export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json({ success: true, experiments: await listExperiments() });
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
    const experiment = await createExperiment({
      name: typeof body.name === "string" ? body.name : "",
      productId: typeof body.productId === "string" ? body.productId : undefined,
      platform: typeof body.platform === "string" ? body.platform : undefined,
      goal: (body.goal === "engagement" || body.goal === "product_click" || body.goal === "conversion" ? body.goal : "traffic"),
      creativeIds: Array.isArray(body.creativeIds) ? body.creativeIds.filter((item): item is string => typeof item === "string") : [],
      notes: typeof body.notes === "string" ? body.notes : ""
    });
    return NextResponse.json({ success: true, experiment, message: "营销实验已创建。" });
  } catch (error) {
    return failure(error instanceof Error ? error.message : "创建实验失败。");
  }
}

function failure(message: string) {
  return NextResponse.json({ success: false, message }, { status: 400 });
}
