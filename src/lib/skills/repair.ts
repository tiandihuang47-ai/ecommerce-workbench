import { analyzeSkillFiles } from "@/lib/skills/analyzer";
import { skillRuntimeConfig } from "@/lib/skills/config";
import { inferMissingNodePackage, inferMissingPythonPackage, npmInstall, pipInstall, pythonExecutable, ensurePythonEnvironment } from "@/lib/skills/dependency-resolver";
import { appendSkillLog } from "@/lib/skills/logs";
import { skillOriginalDirectory } from "@/lib/skills/paths";
import { mapToolsToCapabilities } from "@/lib/skills/tool-mapping";
import { prepareSkillRuntime } from "@/lib/skills/runtime";
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import type { SkillManifest, SkillVerificationResult } from "@/lib/skills/types";

/**
 * Skill Repair Loop（§21）。
 * 第一次验证失败不等于 Skill 不可用：先按失败分类自动修复，再重新验证。
 * 有上限，不无限重试。
 */

export interface SkillRepairOutcome {
  repaired: boolean;
  strategy: string;
  detail: string;
  patch: Partial<SkillManifest>;
}

export async function attemptRepair(
  manifest: SkillManifest,
  failure: SkillVerificationResult,
  attempt: number
): Promise<SkillRepairOutcome> {
  switch (failure.failureCategory) {
    case "missing_python_package":
      return repairMissingPythonPackage(manifest, failure);
    case "missing_node_package":
      return repairMissingNodePackage(manifest, failure);
    case "entrypoint_not_found":
      return repairEntrypoint(manifest);
    case "workdir":
      return repairWorkdir(manifest);
    case "tool_alias_unmapped":
      return repairToolMapping(manifest);
    default:
      return { repaired: false, strategy: "none", detail: `第 ${attempt} 次修复：该失败类型没有可用的自动修复策略`, patch: {} };
  }
}

async function repairMissingPythonPackage(manifest: SkillManifest, failure: SkillVerificationResult): Promise<SkillRepairOutcome> {
  const raw = String(failure.evidence?.pythonDependencies ? JSON.stringify(failure.evidence.pythonDependencies) : failure.output || "");
  const inferred = inferMissingPythonPackage(raw);
  const candidates = inferred ? [inferred] : [];
  if (candidates.length === 0) {
    return { repaired: false, strategy: "pip-install", detail: "没能从报错里判断出缺失的 Python 包", patch: {} };
  }

  const { python } = await ensurePythonEnvironment(manifest.skillId);
  const result = await pipInstall(manifest.skillId, python, candidates);
  const ok = result.code === 0 && !result.timedOut;
  await appendSkillLog(manifest.skillId, "repair", ok ? "info" : "warn", `自动安装 Python 依赖 ${candidates.join(", ")} -> ${ok ? "成功" : "失败"}`);

  return {
    repaired: ok,
    strategy: "pip-install",
    detail: ok ? `已自动安装缺失依赖：${candidates.join("、")}` : "自动安装 Python 依赖失败",
    patch: ok
      ? {
          requiredPackages: [
            ...manifest.requiredPackages.filter((item) => !candidates.includes(item.name)),
            ...candidates.map((name) => ({ name, manager: "pip" as const, origin: "inferred" as const }))
          ]
        }
      : {}
  };
}

async function repairMissingNodePackage(manifest: SkillManifest, failure: SkillVerificationResult): Promise<SkillRepairOutcome> {
  const raw = String(failure.evidence?.nodeDependencies ? JSON.stringify(failure.evidence.nodeDependencies) : failure.output || "");
  const inferred = inferMissingNodePackage(raw);
  const candidates = inferred ? [inferred] : [];
  if (candidates.length === 0) {
    return { repaired: false, strategy: "npm-install", detail: "没能从报错里判断出缺失的 Node 包", patch: {} };
  }

  const result = await npmInstall(manifest.skillId, candidates);
  const ok = result.code === 0 && !result.timedOut;
  await appendSkillLog(manifest.skillId, "repair", ok ? "info" : "warn", `自动安装 Node 依赖 ${candidates.join(", ")} -> ${ok ? "成功" : "失败"}`);

  return {
    repaired: ok,
    strategy: "npm-install",
    detail: ok ? `已自动安装缺失依赖：${candidates.join("、")}` : "自动安装 Node 依赖失败",
    patch: ok
      ? {
          requiredPackages: [
            ...manifest.requiredPackages.filter((item) => !candidates.includes(item.name)),
            ...candidates.map((name) => ({ name, manager: "npm" as const, origin: "inferred" as const }))
          ]
        }
      : {}
  };
}

/** 重新扫描原始目录，重新识别入口（§21 第 4 类失败）。 */
async function repairEntrypoint(manifest: SkillManifest): Promise<SkillRepairOutcome> {
  const files = await readOriginalFiles(manifest.skillId);
  if (files.length === 0) {
    return { repaired: false, strategy: "redetect-entrypoint", detail: "原始目录为空，无法重新识别入口", patch: {} };
  }
  const analyzed = analyzeSkillFiles(files, manifest.identityKey);
  await appendSkillLog(manifest.skillId, "repair", "info", `重新识别入口：${analyzed.entrypoints.map((item) => item.path).join(", ") || "仍然没有找到"}`);
  if (analyzed.entrypoints.length === 0) {
    return { repaired: false, strategy: "redetect-entrypoint", detail: "重新扫描后仍未找到可执行入口", patch: {} };
  }
  return {
    repaired: true,
    strategy: "redetect-entrypoint",
    detail: `已重新识别入口：${analyzed.entrypoints.map((item) => item.path).join("、")}`,
    patch: { entrypoints: analyzed.entrypoints, runtimeType: analyzed.runtimeType }
  };
}

/** 工作目录被外部破坏时，重建隔离运行目录。 */
async function repairWorkdir(manifest: SkillManifest): Promise<SkillRepairOutcome> {
  try {
    await prepareSkillRuntime(manifest);
    return { repaired: true, strategy: "rebuild-workdir", detail: "已重建 Skill 隔离工作目录", patch: {} };
  } catch (error) {
    return { repaired: false, strategy: "rebuild-workdir", detail: error instanceof Error ? error.message : "重建工作目录失败", patch: {} };
  }
}

/** 工具别名没认出来时，用注册表重新映射一次（§21 第 3 类失败）。 */
async function repairToolMapping(manifest: SkillManifest): Promise<SkillRepairOutcome> {
  const remapped = mapToolsToCapabilities(manifest.requiredTools);
  const capabilities = new Set([...manifest.requiredCapabilities, ...remapped.capabilities]);
  const unresolved = remapped.mappings.filter((item) => !item.capability).length;
  await appendSkillLog(manifest.skillId, "repair", "info", `重新映射工具别名：${remapped.mappings.map((item) => item.externalName + "->" + (item.capability || "未识别")).join(", ")}`);
  return {
    repaired: unresolved < manifest.requiredTools.length,
    strategy: "remap-tools",
    detail: unresolved ? `仍有 ${unresolved} 个工具名无法映射` : "工具别名已全部映射到内部能力",
    patch: { toolMappings: remapped.mappings, requiredCapabilities: Array.from(capabilities).sort() }
  };
}

export async function readOriginalFiles(skillId: string) {
  const root = skillOriginalDirectory(skillId);
  const files: Array<{ relativePath: string; bytes: Uint8Array }> = [];
  await collect(root, root, files);
  return files;
}

async function collect(root: string, current: string, out: Array<{ relativePath: string; bytes: Uint8Array }>) {
  let entries: string[] = [];
  try {
    entries = await readdir(current);
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry === "_import" || entry === "node_modules" || entry === "__pycache__") continue;
    const absolute = path.join(current, entry);
    const info = await stat(absolute).catch(() => null);
    if (!info) continue;
    if (info.isDirectory()) {
      await collect(root, absolute, out);
      continue;
    }
    if (info.size > skillRuntimeConfig.maxFileBytes) continue;
    out.push({ relativePath: path.relative(root, absolute).split(path.sep).join("/"), bytes: new Uint8Array(await readFile(absolute)) });
  }
}
