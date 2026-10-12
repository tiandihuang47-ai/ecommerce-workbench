import { denyIfUnauthenticated } from "@/lib/auth/guard";
import { NextResponse } from "next/server";
import { importPerformanceCsv, previewCsv } from "@/lib/marketing-learning";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const deny = await denyIfUnauthenticated(request);
  if (deny) return deny;
  let body: Record<string, unknown>;
  try {
    body = await request.json() as Record<string, unknown>;
  } catch {
    return failure("请求体必须是 JSON。");
  }
  const csvText = typeof body.text === "string" ? body.text.slice(0, 2_000_000) : "";
  if (!csvText.trim()) return failure("CSV 内容为空。");
  const action = body.action === "import" ? "import" : "preview";
  if (action === "preview") {
    return NextResponse.json({ success: true, preview: previewCsv(csvText) });
  }
  const mapping = (body.mapping && typeof body.mapping === "object" ? body.mapping : {}) as Record<string, string>;
  const result = await importPerformanceCsv({
    text: csvText,
    mapping,
    defaultCreativeId: typeof body.defaultCreativeId === "string" ? body.defaultCreativeId : undefined,
    platform: typeof body.platform === "string" ? body.platform : undefined
  });
  return NextResponse.json({ success: true, result, message: "已导入 " + result.imported + " 条数据。" });
}

function failure(message: string) {
  return NextResponse.json({ success: false, message }, { status: 400 });
}
