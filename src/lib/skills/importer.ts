import { createHash } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { analyzeSkillFiles, type SkillFileInput } from "@/lib/skills/analyzer";
import { extractZipArchive, isSafeRelativePath, stripCommonRootPrefix, type ExtractedFile } from "@/lib/skills/archive";
import { skillRuntimeConfig } from "@/lib/skills/config";
import { appendSkillLog } from "@/lib/skills/logs";
import {
  skillDirectory,
  skillImportMetaDirectory,
  skillOriginalDirectory,
  slugify
} from "@/lib/skills/paths";
import { findSkillByImportHash, getSkillManifest, upsertSkillManifest } from "@/lib/skills/registry";
import type { SkillManifest, SkillSourceType } from "@/lib/skills/types";

/**
 * Skill Importer（§11）。
 * 负责：接收文件 / 文件夹 / zip → 解压 → 扫描 → 调用 Analyzer → 落盘原始文件 → 生成内部 Manifest。
 * 不负责执行、不负责装依赖、不负责验证。
 */

export interface SkillImportInput {
  sourceType: SkillSourceType;
  sourceName: string;
  files?: ExtractedFile[];
  archiveBytes?: Uint8Array;
  archiveName?: string;
}

export interface SkillImportResult {
  manifest: SkillManifest;
  isUpdate: boolean;
  alreadyInstalled: boolean;
  skipped: string[];
}

export function hashBytes(value: Uint8Array | string) {
  return createHash("sha256").update(value).digest("hex");
}

export function computeImportHash(files: ExtractedFile[]) {
  const sorted = [...files].sort((a, b) => a.relativePath.localeCompare(b.relativePath));
  const hash = createHash("sha256");
  for (const file of sorted) {
    hash.update(file.relativePath);
    hash.update(String.fromCharCode(0));
    hash.update(file.bytes);
    hash.update(String.fromCharCode(1));
  }
  return hash.digest("hex");
}

export async function importSkillPackage(input: SkillImportInput): Promise<SkillImportResult> {
  const skipped: string[] = [];
  let files = input.files ? [...input.files] : [];

  if (input.archiveBytes && input.archiveBytes.byteLength > 0) {
    const extracted = await extractZipArchive(input.archiveBytes);
    files = [...files, ...extracted.files];
    skipped.push(...extracted.skipped);
  }

  files = stripCommonRootPrefix(
    files.filter((file) => isSafeRelativePath(file.relativePath) && !file.relativePath.endsWith("/"))
  );

  if (files.length === 0) {
    throw new Error("没有读到任何可用的 Skill 文件。请确认选择的是 Skill 文件夹或 zip 包。");
  }
  if (files.length > skillRuntimeConfig.maxImportFiles) {
    throw new Error("Skill 文件数量过多，已超过上限。");
  }

  const cleanSourceName = input.sourceName.replace(/\\/g, "/").replace(/\/+$/, "");
  const baseName = (cleanSourceName.split("/").pop() || "skill").replace(/\.(zip|md|txt|json|ya?ml)$/i, "");
  const identityKey = slugify(baseName);
  const skillId = `skill_${identityKey}_${createHash("sha256").update(identityKey).digest("hex").slice(0, 8)}`;

  const importHash = computeImportHash(files);
  const duplicate = await findSkillByImportHash(importHash);
  if (duplicate) {
    return { manifest: duplicate, isUpdate: false, alreadyInstalled: true, skipped };
  }

  const analyzed = analyzeSkillFiles(files as SkillFileInput[], baseName);
  const now = new Date().toISOString();
  const existing = await getSkillManifest(skillId);

  await writeOriginalPackage(skillId, files, input);

  const manifest: SkillManifest = {
    skillId,
    name: analyzed.name,
    description: analyzed.description,
    version: analyzed.version || existing?.version || "",

    sourceType: input.sourceType,
    sourceName: cleanSourceName || baseName,

    originalFormat: detectOriginalFormat(input, files),

    createdAt: existing?.createdAt || now,
    updatedAt: now,
    importedAt: now,

    originalAssetPath: path.relative(skillDirectory(skillId), skillOriginalDirectory(skillId)) || "original",
    originalPackageReference: input.archiveName || cleanSourceName || baseName,

    normalizedManifestVersion: skillRuntimeConfig.normalizedManifestVersion,

    skillType: analyzed.skillType,

    instructions: analyzed.instructions,
    systemPrompt: analyzed.systemPrompt,
    examples: analyzed.examples,

    inputSchema: analyzed.inputSchema,
    outputSchema: analyzed.outputSchema,

    entrypoints: analyzed.entrypoints,

    runtimeType: analyzed.runtimeType,

    requiredCapabilities: analyzed.requiredCapabilities,
    requiredTools: analyzed.requiredTools,
    requiredPackages: analyzed.requiredPackages,
    requiredFiles: analyzed.requiredFiles,
    environmentRequirements: analyzed.environmentRequirements,

    toolMappings: analyzed.toolMappings,

    permissions: analyzed.permissions,

    requiresAuthorization: analyzed.requiresAuthorization,
    authorization: analyzed.authorization,

    enabled: existing ? existing.enabled : true,
    installStatus: "importing",
    verificationStatus: "pending",
    lastVerifiedAt: "",
    runtimeVersion: skillRuntimeConfig.directorRuntimeVersion,
    errorState: "",

    metadata: {
      ...analyzed.metadata,
      skippedFiles: skipped.slice(0, 20),
      previousImportHash: existing?.importHash || ""
    },

    externalVersion: analyzed.version || "",
    directorRuntimeVersion: skillRuntimeConfig.directorRuntimeVersion,
    importHash,
    identityKey,
    lastVerificationSummary: "",
    failureCategory: ""
  };

  await upsertSkillManifest(manifest);
  await appendSkillLog(skillId, "import", "info", `导入 ${input.sourceType}：${manifest.name}（${files.length} 个文件，识别为 ${analyzed.skillType}）`);
  if (skipped.length) await appendSkillLog(skillId, "import", "warn", `跳过 ${skipped.length} 个文件：${skipped.slice(0, 5).join(" | ")}`);
  await appendSkillLog(skillId, "analyze", "info", `能力：${manifest.requiredCapabilities.join(", ") || "无"}｜依赖：${manifest.requiredPackages.map((item) => item.name).join(", ") || "无"}`);

  return { manifest, isUpdate: Boolean(existing && existing.importHash !== importHash), alreadyInstalled: false, skipped };
}

function detectOriginalFormat(input: SkillImportInput, files: ExtractedFile[]) {
  if (input.sourceType === "zip") return "zip";
  if (input.sourceType === "folder") return "folder";
  const first = files[0]?.relativePath || "";
  const extension = first.includes(".") ? first.slice(first.lastIndexOf(".") + 1).toLowerCase() : "text";
  return extension;
}

async function writeOriginalPackage(skillId: string, files: ExtractedFile[], input: SkillImportInput) {
  const originalRoot = skillOriginalDirectory(skillId);
  // 只清理本 Skill 自己的 original 目录，绝不触碰项目文件或其他 Skill（§43）。
  await rm(originalRoot, { recursive: true, force: true });
  await mkdir(originalRoot, { recursive: true });

  for (const file of files) {
    const target = path.resolve(originalRoot, file.relativePath);
    if (!target.startsWith(path.resolve(originalRoot) + path.sep)) continue;
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, file.bytes);
  }

  const metaDirectory = skillImportMetaDirectory(skillId);
  await mkdir(metaDirectory, { recursive: true });
  await writeFile(
    path.join(metaDirectory, "source.json"),
    JSON.stringify(
      {
        sourceType: input.sourceType,
        sourceName: input.sourceName,
        archiveName: input.archiveName || "",
        fileCount: files.length,
        importedAt: new Date().toISOString(),
        files: files.map((file) => file.relativePath).slice(0, 500)
      },
      null,
      2
    ),
    "utf8"
  );

  if (input.archiveBytes && input.archiveBytes.byteLength > 0) {
    await writeFile(path.join(metaDirectory, input.archiveName || "original-package.zip"), input.archiveBytes);
  }
}
