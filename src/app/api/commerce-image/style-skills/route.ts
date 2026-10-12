import { NextResponse } from "next/server";
import { adminGuardFailure, requireAdminFromRequest } from "@/lib/auth/guard";
import {
  disableCommerceImageStyleSkill,
  importCommerceImageStyleSkill,
  listCommerceImageStyleSkills,
  toPublicCommerceImageStyleSkill
} from "@/lib/commerce-image-style-skills";

export const runtime = "nodejs";

/** 风格库是全体同事共用的本机资源：读放开给登录用户，导入/停用仅管理员。 */
export async function GET() {
  return NextResponse.json({ success: true, skills: (await listCommerceImageStyleSkills()).map(toPublicCommerceImageStyleSkill) });
}

export async function POST(request: Request) {
  const adminFailure = await adminGuardFailure(await requireAdminFromRequest(request));
  if (adminFailure) return adminFailure;
  let formData: FormData;
  try { formData = await request.formData(); } catch { return failure("导入请求格式不正确。"); }
  const file = formData.get("skill");
  if (!(file instanceof File)) return failure("请选择 Markdown 或 ZIP Skill 文件。");
  try {
    const result = await importCommerceImageStyleSkill({ name: file.name, bytes: new Uint8Array(await file.arrayBuffer()) });
    return NextResponse.json({
      success: true,
      skill: toPublicCommerceImageStyleSkill(result.skill),
      skills: (await listCommerceImageStyleSkills()).map(toPublicCommerceImageStyleSkill),
      message: result.duplicate ? "这份 Skill 已经导入过，未重复创建。" : "风格 Skill 已导入本机风格库。"
    }, { status: result.duplicate ? 200 : 201 });
  } catch (error) {
    return failure(error instanceof Error ? error.message : "Skill 导入失败。", 422);
  }
}

export async function DELETE(request: Request) {
  const adminFailure = await adminGuardFailure(await requireAdminFromRequest(request));
  if (adminFailure) return adminFailure;
  const skillId = new URL(request.url).searchParams.get("skillId") || "";
  const skill = await disableCommerceImageStyleSkill(skillId);
  if (!skill) return failure("没有找到要停用的 Skill。", 404);
  return NextResponse.json({ success: true, skills: (await listCommerceImageStyleSkills()).map(toPublicCommerceImageStyleSkill), message: "Skill 已从可选列表停用；历史项目快照不受影响。" });
}

function failure(message: string, status = 400) {
  return NextResponse.json({ success: false, code: "STYLE_SKILL_ERROR", category: "validation", retryable: false, message }, { status });
}
