import { denyIfUnauthenticated } from "@/lib/auth/guard";
import { NextResponse } from "next/server";
import { structureProductDocument } from "@/lib/product-document";

export const runtime = "nodejs";

/**
 * 产品资料的 AI 结构化（后台任务）。
 *
 * 单独成一个接口的原因：保存产品的请求只做本地解析与落盘，
 * 这里的 LLM 调用由前端在保存成功之后异步发起，用户不需要等它。
 * 返回结果由前端写回产品档案；写入前必须确认文档 id 仍然是最新那份（见前端逻辑）。
 */
export async function POST(request: Request) {
  const deny = await denyIfUnauthenticated(request);
  if (deny) return deny;
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return failure("请求体必须是合法 JSON。");
  }

  const fileName = typeof body.fileName === "string" ? body.fileName.slice(0, 200) : "";
  const text = typeof body.text === "string" ? body.text : "";
  const importedAt = typeof body.importedAt === "string" && body.importedAt ? body.importedAt : new Date().toISOString();
  if (!text.trim()) return failure("没有可解析的产品资料正文。");

  try {
    const result = await structureProductDocument(fileName || "产品资料", text, importedAt, { strict: true });
    return NextResponse.json({ success: true, source: result.source, message: result.message, product: result.product });
  } catch (error) {
    /* 只把「人话」返回给前端；具体原因写日志，不把 provider 原始报文抛到界面。 */
    console.warn("[PRODUCT_ANALYSIS] failed:", error instanceof Error ? error.message : error);
    return failure("产品资料解析失败，可以稍后重试。", 502);
  }
}

function failure(message: string, status = 400) {
  return NextResponse.json({ success: false, code: "PRODUCT_ANALYSIS_ERROR", message }, { status });
}
