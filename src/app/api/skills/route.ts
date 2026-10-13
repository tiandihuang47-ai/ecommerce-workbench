import { NextResponse } from "next/server";
import { rm } from "node:fs/promises";
import { adminGuardFailure, denyIfUnauthenticated, requireAdminFromRequest } from "@/lib/auth/guard";
import { isSafeRelativePath, type ExtractedFile } from "@/lib/skills/archive";
import { skillRuntimeConfig } from "@/lib/skills/config";
import { importSkillPackage } from "@/lib/skills/importer";
import { skillDirectory } from "@/lib/skills/paths";
import { runSkillPipelineInBackground } from "@/lib/skills/pipeline";
import { toPublicSkill } from "@/lib/skills/public-skill";
import { listSkillManifests } from "@/lib/skills/registry";
import type { SkillSourceType } from "@/lib/skills/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 列出全部 Skill。前台只拿到口语化的状态。 */
export async function GET(request: Request) {
  const deny = await denyIfUnauthenticated(request);
  if (deny) return deny;
  const manifests = await listSkillManifests();
  return NextResponse.json({ success: true, skills: manifests.map((manifest) => toPublicSkill(manifest)) });
}

/** 导入 Skill：文件 / 文件夹 / zip。立即返回，后台静默准备（§32）。仅管理员可导入。 */
export async function POST(request: Request) {
  const adminFailure = await adminGuardFailure(await requireAdminFromRequest(request));
  if (adminFailure) return adminFailure;

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json({ success: false, message: "导入请求格式不正确。" }, { status: 400 });
  }

  const archive = formData.get("archive");
  const files = formData.getAll("files").filter((item): item is File => item instanceof File);
  const sourceName = String(formData.get("sourceName") || "").trim();
  const declaredType = String(formData.get("sourceType") || "").trim() as SkillSourceType;

  if (!(archive instanceof File) && files.length === 0) {
    return NextResponse.json({ success: false, message: "请选择要导入的 Skill 文件、文件夹或 zip 包。" }, { status: 400 });
  }

  const paths = parsePaths(formData.get("paths"));
  const extracted: ExtractedFile[] = [];
  const skipped: string[] = [];

  for (let index = 0; index < files.length; index += 1) {
    const file = files[index];
    const relativePath = sanitizePath(paths[index] || file.name || ("file-" + index));
    if (!isSafeRelativePath(relativePath)) {
      skipped.push(relativePath);
      continue;
    }
    if (file.size > skillRuntimeConfig.maxFileBytes) {
      skipped.push(relativePath + "（单文件过大）");
      continue;
    }
    extracted.push({ relativePath, bytes: new Uint8Array(await file.arrayBuffer()) });
  }

  const archiveFile = archive instanceof File ? archive : null;
  if (archiveFile && archiveFile.size > skillRuntimeConfig.maxImportBytes) {
    return NextResponse.json({ success: false, message: "Skill 包太大，暂时无法导入。" }, { status: 400 });
  }

  const sourceType: SkillSourceType = archiveFile ? "zip" : declaredType === "folder" || extracted.length > 1 ? "folder" : "file";
  const resolvedName = sourceName || archiveFile?.name || extracted[0]?.relativePath || "skill";

  try {
    const result = await importSkillPackage({
      sourceType,
      sourceName: resolvedName,
      files: extracted,
      archiveBytes: archiveFile ? new Uint8Array(await archiveFile.arrayBuffer()) : undefined,
      archiveName: archiveFile?.name
    });

    if (result.alreadyInstalled) {
      return NextResponse.json({
        success: true,
        alreadyInstalled: true,
        skill: toPublicSkill(result.manifest),
        message: "这个 Skill 已经导入过了。"
      });
    }

    // 后台静默准备；前台只看到「正在准备 Skill…」。
    runSkillPipelineInBackground(result.manifest.skillId);

    return NextResponse.json({
      success: true,
      isUpdate: result.isUpdate,
      skippedCount: skipped.length,
      skill: toPublicSkill(result.manifest, "preparing"),
      message: result.isUpdate ? "检测到已安装过这个 Skill，正在更新。" : "正在准备 Skill…"
    });
  } catch (error) {
    return NextResponse.json({ success: false, message: error instanceof Error ? error.message : "Skill 导入失败。" }, { status: 422 });
  }
}

/** 安全清理（§43）：只删除本 Skill 自己的目录。 */
export async function DELETE(request: Request) {
  const adminFailure = await adminGuardFailure(await requireAdminFromRequest(request));
  if (adminFailure) return adminFailure;
  const skillId = new URL(request.url).searchParams.get("skillId") || "";
  if (!skillId) return NextResponse.json({ success: false, message: "缺少 skillId。" }, { status: 400 });
  try {
    await rm(skillDirectory(skillId), { recursive: true, force: true });
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ success: false, message: error instanceof Error ? error.message : "删除失败。" }, { status: 422 });
  }
}

function parsePaths(value: FormDataEntryValue | null) {
  if (typeof value !== "string" || !value.trim()) return [] as string[];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.map((item) => String(item || "")) : [];
  } catch {
    return [] as string[];
  }
}

function sanitizePath(value: string) {
  return value.replace(/\\/g, "/").replace(/^\.\//, "").replace(/^\/+/, "");
}
