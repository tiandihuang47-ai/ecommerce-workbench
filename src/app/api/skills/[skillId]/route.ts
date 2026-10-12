import { NextResponse } from "next/server";
import { rm } from "node:fs/promises";
import { adminGuardFailure, requireAdminFromRequest } from "@/lib/auth/guard";
import { skillDirectory } from "@/lib/skills/paths";
import { toPublicSkill } from "@/lib/skills/public-skill";
import { getSkillManifest, patchSkillManifest, removeSkillManifest } from "@/lib/skills/registry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_request: Request, context: { params: Promise<{ skillId: string }> }) {
  const { skillId } = await context.params;
  const manifest = await getSkillManifest(skillId);
  if (!manifest) return NextResponse.json({ success: false, message: "没有找到这个 Skill。" }, { status: 404 });

  return NextResponse.json({
    success: true,
    skill: {
      ...toPublicSkill(manifest),
      environmentRequirements: manifest.environmentRequirements,
      permissions: manifest.permissions,
      runtimeType: manifest.runtimeType,
      entrypointCount: manifest.entrypoints.length,
      toolCount: manifest.requiredTools.length,
      toolMappings: manifest.toolMappings.map((item) => ({
        externalName: item.externalName,
        matched: Boolean(item.capability),
        capabilityLabel: item.capability || "未识别"
      })),
      // 开发者视角的摘要（详情页默认折叠，不占用户注意力）
      developerSummary: {
        installStatus: manifest.installStatus,
        verificationStatus: manifest.verificationStatus,
        lastVerifiedAt: manifest.lastVerifiedAt,
        summary: manifest.lastVerificationSummary,
        skillType: manifest.skillType,
        runtimeType: manifest.runtimeType,
        requiredPackages: manifest.requiredPackages.map((item) => item.name + " (" + item.manager + ")"),
        requiredCapabilities: manifest.requiredCapabilities
      }
    }
  });
}

/** 启用 / 停用。停用不影响安装状态与其他 Skill（§34 / §54）。更新类操作仅管理员。 */
export async function PATCH(request: Request, context: { params: Promise<{ skillId: string }> }) {
  const adminFailure = await adminGuardFailure(await requireAdminFromRequest(request));
  if (adminFailure) return adminFailure;
  const { skillId } = await context.params;
  const body = (await request.json().catch(() => ({}))) as { enabled?: boolean };
  if (typeof body.enabled !== "boolean") {
    return NextResponse.json({ success: false, message: "缺少 enabled 参数。" }, { status: 400 });
  }
  const patched = await patchSkillManifest(skillId, { enabled: body.enabled });
  if (!patched) return NextResponse.json({ success: false, message: "没有找到这个 Skill。" }, { status: 404 });
  return NextResponse.json({ success: true, skill: toPublicSkill(patched) });
}

/** 删除 Skill 仅管理员。 */
export async function DELETE(request: Request, context: { params: Promise<{ skillId: string }> }) {
  const adminFailure = await adminGuardFailure(await requireAdminFromRequest(request));
  if (adminFailure) return adminFailure;
  const { skillId } = await context.params;
  const removed = await removeSkillManifest(skillId);
  if (!removed) return NextResponse.json({ success: false, message: "没有找到这个 Skill。" }, { status: 404 });
  try {
    await rm(skillDirectory(skillId), { recursive: true, force: true });
  } catch {
    // 注册表已删除；残留目录下次导入会复用，不影响使用。
  }
  return NextResponse.json({ success: true });
}
