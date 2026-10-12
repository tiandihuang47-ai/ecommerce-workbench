import { mkdir, appendFile, readFile } from "node:fs/promises";
import path from "node:path";
import { skillLogDirectory } from "@/lib/skills/paths";
import type { SkillLogEntry } from "@/lib/skills/types";

/**
 * 开发者日志（§39 / §68）：完整保留，但**不暴露到普通 UI**。
 * 普通用户只看 installStatus；日志供 Harness / 开发排错 / 未来管理员模式使用。
 */

export type SkillLogStage =
  | "import"
  | "analyze"
  | "normalize"
  | "prepare"
  | "dependency"
  | "tool-mapping"
  | "verification"
  | "repair"
  | "execution"
  | "registry";

export async function appendSkillLog(
  skillId: string,
  stage: SkillLogStage,
  level: SkillLogEntry["level"],
  message: string
) {
  const entry: SkillLogEntry = {
    at: new Date().toISOString(),
    level,
    stage,
    message: truncate(message, 4000)
  };
  try {
    const directory = skillLogDirectory(skillId);
    await mkdir(directory, { recursive: true });
    await appendFile(path.join(directory, "runtime.log"), JSON.stringify(entry) + String.fromCharCode(10), "utf8");
  } catch {
    // 日志失败绝不能影响安装流程。
  }
  return entry;
}

export async function readSkillLog(skillId: string, limit = 400): Promise<SkillLogEntry[]> {
  try {
    const raw = await readFile(path.join(skillLogDirectory(skillId), "runtime.log"), "utf8");
    return raw
      .split(String.fromCharCode(10))
      .filter(Boolean)
      .slice(-limit)
      .map((line) => {
        try {
          return JSON.parse(line) as SkillLogEntry;
        } catch {
          return { at: "", level: "info" as const, stage: "unknown", message: line };
        }
      });
  } catch {
    return [];
  }
}

export function truncate(value: string, max: number) {
  if (value.length <= max) return value;
  return value.slice(0, max) + String.fromCharCode(10) + "…（已截断，共 " + value.length + " 字）";
}
