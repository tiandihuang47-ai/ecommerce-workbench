import { skillRuntimeConfig } from "@/lib/skills/config";
import { installDeclaredDependencies } from "@/lib/skills/dependency-resolver";
import { appendSkillLog } from "@/lib/skills/logs";
import { getSkillManifest, patchSkillManifest } from "@/lib/skills/registry";
import { attemptRepair } from "@/lib/skills/repair";
import { verifySkill } from "@/lib/skills/verifier";
import type { SkillInstallStatus, SkillManifest } from "@/lib/skills/types";

/**
 * 安装流水线（§3 完整闭环的后半段）。
 *
 * 导入 → 分析 → 准备隔离环境 → 安装依赖 → 映射工具 → 静默验证 →（失败则自动修复重试）→ ready
 * 只有验证 PASS 才会被标记为「可使用」；前台始终只显示「正在准备 / 可使用 / 需要授权 / 暂时无法使用」。
 */

const runningPipelines = new Set<string>();

export function isSkillPipelineRunning(skillId: string) {
  return runningPipelines.has(skillId);
}

export function runSkillPipelineInBackground(skillId: string) {
  void runSkillPipeline(skillId).catch(() => undefined);
}

export async function runSkillPipeline(skillId: string, options: { reverify?: boolean } = {}) {
  if (runningPipelines.has(skillId)) return getSkillManifest(skillId);
  runningPipelines.add(skillId);

  try {
    let manifest = await getSkillManifest(skillId);
    if (!manifest) return null;

    manifest = (await patchSkillManifest(skillId, {
      installStatus: "preparing",
      verificationStatus: "running",
      errorState: "",
      failureCategory: ""
    })) || manifest;

    await appendSkillLog(skillId, "prepare", "info", options.reverify ? "开始重新验证" : "开始准备隔离运行环境");

    if (manifest.requiredPackages.length > 0) {
      const resolution = await installDeclaredDependencies(manifest);
      const detail = resolution.message + (resolution.output ? String.fromCharCode(10) + resolution.output.slice(-800) : "");
      await appendSkillLog(skillId, "dependency", resolution.ok ? "info" : "warn", detail);
    } else {
      await appendSkillLog(skillId, "dependency", "info", "没有声明额外依赖");
    }

    manifest = (await patchSkillManifest(skillId, { installStatus: "verifying" })) || manifest;
    let verification = await verifySkill(manifest);
    await appendSkillLog(skillId, "verification", verification.passed ? "info" : "warn", verification.summary + (verification.output ? String.fromCharCode(10) + verification.output.slice(-800) : ""));

    let attempts = 0;
    const maxAttempts = Math.max(0, skillRuntimeConfig.maxRepairAttempts);

    while (!verification.passed && isRepairable(verification.failureCategory) && attempts < maxAttempts) {
      attempts += 1;
      manifest = (await patchSkillManifest(skillId, { installStatus: "repairing" })) || manifest;
      const repair = await attemptRepair(manifest, verification, attempts);
      const repairDetail = "第 " + attempts + "/" + maxAttempts + " 次自动修复：" + repair.strategy + " — " + repair.detail;
      await appendSkillLog(skillId, "repair", repair.repaired ? "info" : "warn", repairDetail);

      if (!repair.repaired) {
        verification = { ...verification, summary: verification.summary + "（自动修复未能解决：" + repair.detail + "）" };
        break;
      }

      manifest = (await patchSkillManifest(skillId, { ...repair.patch, installStatus: "verifying" })) || manifest;
      if (repair.patch.entrypoints) {
        const runtimeModule = await import("@/lib/skills/runtime");
        await runtimeModule.prepareSkillRuntime(manifest).catch(() => undefined);
      }
      verification = await verifySkill(manifest);
      await appendSkillLog(skillId, "verification", verification.passed ? "info" : "warn", "修复后第 " + attempts + " 次验证：" + verification.summary);
    }

    const finalStatus = resolveFinalStatus(verification.passed, verification.failureCategory);
    const patched = await patchSkillManifest(skillId, {
      installStatus: finalStatus,
      verificationStatus: verification.passed ? "passed" : "failed",
      lastVerifiedAt: new Date().toISOString(),
      lastVerificationSummary: verification.summary,
      errorState: verification.passed ? "" : verification.summary,
      failureCategory: verification.failureCategory,
      runtimeVersion: skillRuntimeConfig.directorRuntimeVersion,
      metadata: { ...(manifest.metadata || {}), repairAttempts: attempts, lastVerificationStage: verification.stage }
    });

    await appendSkillLog(skillId, "verification", "info", verification.passed ? "最终状态：ready（自动修复 " + attempts + " 次）" : "最终状态：" + finalStatus);
    return patched;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Skill 准备失败";
    await appendSkillLog(skillId, "verification", "error", message);
    return patchSkillManifest(skillId, {
      installStatus: "failed",
      verificationStatus: "failed",
      errorState: message,
      failureCategory: "unknown",
      lastVerifiedAt: new Date().toISOString()
    });
  } finally {
    runningPipelines.delete(skillId);
  }
}

function isRepairable(category: string) {
  return category === "missing_python_package"
    || category === "missing_node_package"
    || category === "entrypoint_not_found"
    || category === "workdir"
    || category === "tool_alias_unmapped";
}

function resolveFinalStatus(passed: boolean, category: string): SkillInstallStatus {
  if (passed) return "ready";
  if (category === "requires_authorization") return "requires_authorization";
  if (category === "requires_external_capability") return "requires_external_capability";
  return "failed";
}

/** 允许用户手动重新验证一个失败过的 Skill（§41）。 */
export async function reverifySkill(skillId: string) {
  return runSkillPipeline(skillId, { reverify: true });
}

export async function assertSkillReady(skillId: string): Promise<SkillManifest> {
  const manifest = await getSkillManifest(skillId);
  if (!manifest) throw new Error("没有找到这个 Skill。");
  if (manifest.installStatus !== "ready") throw new Error("这个 Skill 当前不可用。");
  return manifest;
}
