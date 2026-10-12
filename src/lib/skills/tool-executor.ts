import { appendSkillLog } from "@/lib/skills/logs";
import { getSkillManifest } from "@/lib/skills/registry";
import { executeSkillEntry, primaryEntrypoint } from "@/lib/skills/runtime";
import { skillRuntimeConfig } from "@/lib/skills/config";

/**
 * 模型调用 Skill 工具时的执行入口（§14 / §36）。
 * 外部 Skill 用什么工具名不重要，这里统一落到它自己的隔离 Runtime。
 */

export interface SkillToolExecution {
  ok: boolean;
  skillId: string;
  content: string;
}

export async function executeSkillTool(skillId: string, args: unknown): Promise<SkillToolExecution> {
  const manifest = await getSkillManifest(skillId);
  if (!manifest) return { ok: false, skillId, content: "没有找到这个 Skill。" };
  if (manifest.installStatus !== "ready" || !manifest.enabled) {
    return { ok: false, skillId, content: "这个 Skill 当前不可用。" };
  }

  const entry = primaryEntrypoint(manifest);
  if (!entry) return { ok: false, skillId, content: "这个 Skill 没有可执行入口。" };

  const started = Date.now();
  const result = await executeSkillEntry(manifest, entry, args, { mode: "run" });
  const duration = Date.now() - started;

  await appendSkillLog(
    skillId,
    "execution",
    result.ok ? "info" : "warn",
    "调用 " + entry.path + "（" + duration + "ms）" + (result.ok ? "" : "：" + (result.stderr || result.message).slice(0, 600))
  );

  if (!result.ok) {
    return {
      ok: false,
      skillId,
      content: "Skill 执行失败：" + (result.timedOut ? "超时" : (result.stderr || result.message).slice(0, 600))
    };
  }

  const raw = (result.stdout || "").trim();
  return { ok: true, skillId, content: raw.slice(0, skillRuntimeConfig.maxOutputChars) || "（Skill 执行完成，没有输出）" };
}
