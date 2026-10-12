import { denyIfUnauthenticated } from "@/lib/auth/guard";
import { NextResponse } from "next/server";
import { debugDouyinLink } from "@/lib/douyin-debug";

export const runtime = "nodejs";
export const maxDuration = 900;

export async function POST(request: Request) {
  const deny = await denyIfUnauthenticated(request);
  if (deny) return deny;
  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ success: false, message: "请求体必须是合法 JSON。" }, { status: 400 });
  }

  const input = typeof (body as Record<string, unknown>)?.url === "string"
    ? String((body as Record<string, unknown>).url)
    : "";

  if (!input.trim()) {
    return NextResponse.json({ success: false, message: "请先输入抖音链接或分享文案。" }, { status: 400 });
  }

  const report = await debugDouyinLink(input);
  return NextResponse.json(report, { status: report.success ? 200 : 502 });
}
