import { denyIfUnauthenticated } from "@/lib/auth/guard";
import { NextResponse } from "next/server";
import { getSkillManifest } from "@/lib/skills/registry";
import { executeSkillTool } from "@/lib/skills/tool-executor";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * 手动运行一个 Skill（也供 Integration Test 使用）。
 * AI 对话走的是 function calling → tool-executor，这个接口是它的同源入口。
 */
export async function POST(request: Request, context: { params: Promise<{ skillId: string }> }) {
  const deny = await denyIfUnauthenticated(request);
  if (deny) return deny;
  const { skillId } = await context.params;
  const manifest = await getSkillManifest(skillId);
  if (!manifest) return NextResponse.json({ success: false, message: "没有找到这个 Skill。" }, { status: 404 });
  if (manifest.installStatus !== "ready") {
    return NextResponse.json({ success: false, message: "这个 Skill 当前不可用。", installStatus: manifest.installStatus }, { status: 409 });
  }

  const body = await request.json().catch(() => ({}));
  const result = await executeSkillTool(skillId, body?.input ?? body ?? {});
  return NextResponse.json({ success: result.ok, output: result.content, message: result.ok ? "执行完成" : result.content }, { status: result.ok ? 200 : 422 });
}
