import { denyIfUnauthenticated } from "@/lib/auth/guard";
import { NextResponse } from "next/server";
import { applyCommerceImageStyleSkill } from "@/lib/commerce-image-style-skills";
import { toPublicCommerceImageTask } from "@/lib/commerce-image-store";

export const runtime = "nodejs";

export async function POST(request: Request, context: { params: Promise<{ taskId: string }> }) {
  const deny = await denyIfUnauthenticated(request);
  if (deny) return deny;
  const { taskId } = await context.params;
  let body: Record<string, unknown> = {};
  try { body = await request.json() as Record<string, unknown>; } catch { /* 下面返回明确错误 */ }
  const skillId = typeof body.skillId === "string" ? body.skillId : "";
  if (!skillId) return failure("请选择风格 Skill。");
  try {
    const task = await applyCommerceImageStyleSkill(taskId, skillId);
    return NextResponse.json({ success: true, task: toPublicCommerceImageTask(task), message: "风格 Skill 已应用，重新生成方案后生效。" });
  } catch (error) {
    return failure(error instanceof Error ? error.message : "Skill 应用失败。", 422);
  }
}

function failure(message: string, status = 400) {
  return NextResponse.json({ success: false, code: "STYLE_SKILL_ERROR", category: "validation", retryable: false, message }, { status });
}
