import { skillRuntimeConfig } from "@/lib/skills/config";
import { getSkillsByIds } from "@/lib/skills/registry";
import { primaryEntrypoint } from "@/lib/skills/runtime";
import type { SkillManifest } from "@/lib/skills/types";

/**
 * Active Skill → AI 对话的桥（§36 / §38）。
 * AI 对话只调用这里的函数，不需要知道 Python 怎么装、Node 怎么跑。
 */

export const skillToolPrefix = "skill__";
const NL = String.fromCharCode(10);

export interface SkillToolDefinition {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export interface ActiveSkillContext {
  skillIds: string[];
  systemPrompt: string;
  tools: SkillToolDefinition[];
  toolRoutes: Record<string, string>;
  notes: string[];
}

export function skillToolName(manifest: SkillManifest) {
  const base = manifest.identityKey.replace(/[^a-z0-9_]/gi, "_").slice(0, 40) || "skill";
  return (skillToolPrefix + base).slice(0, 60);
}

/**
 * 只加载**当前会话启用的** Skill，避免把整个 Skill 库塞进 Context（§34 / §55）。
 */
export async function buildActiveSkillContext(skillIds: string[]): Promise<ActiveSkillContext> {
  const unique = Array.from(new Set(skillIds.filter(Boolean))).slice(0, skillRuntimeConfig.maxActiveSkillsPerSession);
  const empty: ActiveSkillContext = { skillIds: [], systemPrompt: "", tools: [], toolRoutes: {}, notes: [] };
  if (unique.length === 0) return empty;

  const manifests = await getSkillsByIds(unique);
  const notes: string[] = [];
  const ordered = unique
    .map((id) => manifests.find((item) => item.skillId === id))
    .filter((item): item is SkillManifest => Boolean(item));

  const usable = ordered.filter((manifest) => {
    if (manifest.enabled && manifest.installStatus === "ready") return true;
    notes.push(manifest.name + " 当前不可用，已跳过");
    return false;
  });

  if (usable.length === 0) return { ...empty, skillIds: unique, notes };

  let budget = skillRuntimeConfig.maxSkillContextChars;
  const sections: string[] = [];

  for (const manifest of usable) {
    const header = "### Skill：" + manifest.name;
    const schemaText = [
      manifest.inputSchema ? NL + "输入结构（JSON Schema）：" + JSON.stringify(manifest.inputSchema).slice(0, skillRuntimeConfig.maxRulesChars) : "",
      manifest.outputSchema ? NL + "输出结构（JSON Schema）：" + JSON.stringify(manifest.outputSchema).slice(0, skillRuntimeConfig.maxRulesChars) : ""
    ].filter(Boolean).join(NL);

    const section = [
      header,
      manifest.description,
      "",
      (manifest.systemPrompt || manifest.instructions || "").slice(0, skillRuntimeConfig.maxInstructionsChars),
      schemaText
    ].filter(Boolean).join(NL);

    const sliced = section.slice(0, budget);
    if (!sliced.trim()) break;
    budget -= sliced.length;
    sections.push(sliced);
    if (budget <= 0) {
      notes.push("Skill 上下文已达上限，其余 Skill 未注入");
      break;
    }
  }

  const tools: SkillToolDefinition[] = [];
  const toolRoutes: Record<string, string> = {};

  for (const manifest of usable) {
    const entry = primaryEntrypoint(manifest);
    const isCodeSkill = manifest.runtimeType === "python" || manifest.runtimeType === "node" || manifest.runtimeType === "hybrid";
    if (!isCodeSkill || !entry) continue;

    const name = skillToolName(manifest);
    if (toolRoutes[name]) continue;
    tools.push({
      type: "function",
      function: {
        name,
        description: (manifest.description + "（Skill：" + manifest.name + "）").slice(0, 900),
        parameters: normalizeParameters(manifest)
      }
    });
    toolRoutes[name] = manifest.skillId;
  }

  const systemPrompt = [
    "【本轮已启用的 Skill】",
    "以下 Skill 由用户显式启用。请严格按照对应 Skill 的指令与规则完成任务；",
    "如果 Skill 提供了工具（function），需要执行其中逻辑时请调用对应工具，不要凭空编造执行结果。",
    "",
    ...sections
  ].join(NL);

  return { skillIds: usable.map((item) => item.skillId), systemPrompt, tools, toolRoutes, notes };
}

function normalizeParameters(manifest: SkillManifest): Record<string, unknown> {
  const schema = manifest.inputSchema;
  if (schema && typeof schema === "object" && (schema as { type?: string }).type === "object" && (schema as { properties?: unknown }).properties) {
    return schema;
  }
  return {
    type: "object",
    properties: {
      input: {
        type: "string",
        description: "交给这个 Skill 的原始输入（自然语言或 JSON 字符串）"
      }
    },
    required: ["input"]
  };
}
