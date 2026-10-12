import { denyIfUnauthenticated } from "@/lib/auth/guard";
import { NextResponse } from "next/server";
import { ownershipStamp } from "@/lib/server/request-scope";
import { createLinkAnalyzeJob } from "@/services/link-analyzer/job-store";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function POST(request: Request) {
  const deny = await denyIfUnauthenticated(request);
  if (deny) return deny;
  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ success: false, message: "请求体必须是合法 JSON。" }, { status: 400 });
  }

  const record = body && typeof body === "object" ? body as Record<string, unknown> : {};
  const url = stringValue(record.url);

  if (!url) {
    return NextResponse.json({ success: false, message: "链接不能为空，请粘贴平台视频或笔记链接。" }, { status: 400 });
  }

  const job = createLinkAnalyzeJob({
    url,
    targetProduct: stringValue(record.targetProduct),
    targetAudience: stringValue(record.targetAudience),
    rewriteGoal: stringValue(record.rewriteGoal),
    rewriteStyle: stringValue(record.rewriteStyle),
    extraRequirement: stringValue(record.extraRequirement),
    useBrowserCookies: record.useBrowserCookies === true
  }, await ownershipStamp());

  return NextResponse.json({ success: true, job });
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}
