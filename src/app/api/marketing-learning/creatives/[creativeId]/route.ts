import { denyIfUnauthenticated } from "@/lib/auth/guard";
import { NextResponse } from "next/server";
import { getCreativeDetail } from "@/lib/marketing-learning";

export const runtime = "nodejs";

export async function GET(request: Request, context: { params: Promise<{ creativeId: string }> }) {
  const deny = await denyIfUnauthenticated(request);
  if (deny) return deny;
  const { creativeId } = await context.params;
  const detail = await getCreativeDetail(creativeId);
  if (!detail) return NextResponse.json({ success: false, message: "没有找到这个创意记录。" }, { status: 404 });
  return NextResponse.json({ success: true, ...detail });
}
