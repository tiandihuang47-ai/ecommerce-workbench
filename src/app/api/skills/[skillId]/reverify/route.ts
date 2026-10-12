import { NextResponse } from "next/server";
import { adminGuardFailure, requireAdminFromRequest } from "@/lib/auth/guard";
import { toPublicSkill } from "@/lib/skills/public-skill";
import { getSkillManifest } from "@/lib/skills/registry";
import { reverifySkill } from "@/lib/skills/pipeline";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 失败过的 Skill 可以重新验证，不需要用户重新找原文件（§41）。更新类操作仅管理员。 */
export async function POST(request: Request, context: { params: Promise<{ skillId: string }> }) {
  const adminFailure = await adminGuardFailure(await requireAdminFromRequest(request));
  if (adminFailure) return adminFailure;
  const { skillId } = await context.params;
  const manifest = await getSkillManifest(skillId);
  if (!manifest) return NextResponse.json({ success: false, message: "没有找到这个 Skill。" }, { status: 404 });

  const result = await reverifySkill(skillId);
  if (!result) return NextResponse.json({ success: false, message: "重新验证失败。" }, { status: 422 });
  return NextResponse.json({ success: true, skill: toPublicSkill(result) });
}
