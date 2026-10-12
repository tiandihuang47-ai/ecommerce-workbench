import { denyIfUnauthenticated } from "@/lib/auth/guard";
import { NextResponse } from "next/server";
import { parseVideoLink } from "@/lib/video-link-parser";

export async function POST(request: Request) {
  const deny = await denyIfUnauthenticated(request);
  if (deny) return deny;
  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "请求体必须是合法 JSON" }, { status: 400 });
  }

  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "请求参数不能为空" }, { status: 400 });
  }

  const url = (body as Record<string, unknown>).url;
  if (typeof url !== "string" || !url.trim()) {
    return NextResponse.json({ error: "请先填写平台视频链接" }, { status: 400 });
  }

  const result = await parseVideoLink(url);
  return NextResponse.json(result, { status: result.success ? 200 : 422 });
}
