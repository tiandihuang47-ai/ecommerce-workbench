import path from "node:path";
import { runtimeRoot } from "@/lib/product-asset-store";

/**
 * Skill Runtime 的磁盘布局（§59：不硬编码用户目录，复用项目已有 runtimeRoot）。
 *
 *   <runtimeRoot>/skills/
 *     registry.json
 *     <skillId>/
 *       original/    原始 Skill 完整保留（不改写、不覆盖）
 *       manifest.json
 *       logs/
 *       runtime/     python venv / node_modules / work 工作目录
 */
export function skillDataRoot() {
  return path.join(runtimeRoot, "skills");
}

export function skillRegistryFile() {
  return path.join(skillDataRoot(), "registry.json");
}

const skillIdPattern = /^skill_[a-z0-9][a-z0-9_-]{2,110}$/;

export function isSkillId(value: string) {
  return skillIdPattern.test(value);
}

export function skillDirectory(skillId: string) {
  if (!isSkillId(skillId)) throw new Error("Skill ID 不合法。");
  return path.join(skillDataRoot(), skillId);
}

export function skillOriginalDirectory(skillId: string) {
  return path.join(skillDirectory(skillId), "original");
}

export function skillImportMetaDirectory(skillId: string) {
  return path.join(skillOriginalDirectory(skillId), "_import");
}

export function skillManifestFile(skillId: string) {
  return path.join(skillDirectory(skillId), "manifest.json");
}

export function skillLogDirectory(skillId: string) {
  return path.join(skillDirectory(skillId), "logs");
}

export function skillRuntimeDirectory(skillId: string) {
  return path.join(skillDirectory(skillId), "runtime");
}

export function skillPythonDirectory(skillId: string) {
  return path.join(skillRuntimeDirectory(skillId), "python");
}

export function skillNodeDirectory(skillId: string) {
  return path.join(skillRuntimeDirectory(skillId), "node");
}

export function skillWorkDirectory(skillId: string) {
  return path.join(skillRuntimeDirectory(skillId), "work");
}

/** 解析并校验「原始目录内的相对路径」，防止路径穿越。 */
export function resolveInside(root: string, relative: string) {
  const normalized = relative.replace(/\\/g, "/").replace(/^\.\//, "");
  const target = path.resolve(root, normalized);
  const rootResolved = path.resolve(root);
  if (target !== rootResolved && !target.startsWith(rootResolved + path.sep)) {
    throw new Error("路径越界，已阻止。");
  }
  return target;
}

export function slugify(value: string) {
  const ascii = value
    .normalize("NFKD")
    .replace(/[^\w\s-]/g, " ")
    .trim()
    .replace(/[\s_]+/g, "-")
    .replace(/-+/g, "-")
    .toLowerCase()
    .slice(0, 40)
    .replace(/^-|-$/g, "");
  return ascii || "unnamed";
}
