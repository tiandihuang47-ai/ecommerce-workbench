import { generateCopywritingText, isRouteConfigured } from "@/lib/copywriting-service";
import { isCapabilityAvailable, getSkillCapability } from "@/lib/skills/capability-registry";
import {
  assessSideEffectRisk,
  compileCheck,
  executeSkillEntry,
  nodeDependencyCheck,
  prepareSkillRuntime,
  primaryEntrypoint,
  pythonDependencyCheck,
  readOriginalText
} from "@/lib/skills/runtime";
import type { SkillManifest, SkillVerificationResult } from "@/lib/skills/types";

/**
 * Silent Verification（§22 / §24）。
 * 导入完成 ≠ 安装完成。必须后台跑一次最小验证，只有 PASS 才允许在 UI 显示「可使用」。
 * 全部静默执行，用户只看得到「正在准备」。
 */
export async function verifySkill(manifest: SkillManifest): Promise<SkillVerificationResult> {
  const evidence: Record<string, unknown> = {};

  /* 1) 能力可用性：Director 现在有没有这个能力 */
  const unavailable = manifest.requiredCapabilities.filter((id) => !isCapabilityAvailable(id));
  evidence.capabilities = manifest.requiredCapabilities;
  evidence.unavailableCapabilities = unavailable;
  if (unavailable.length > 0) {
    const labels = unavailable.map((id) => getSkillCapability(id)?.label || id);
    return {
      passed: false,
      stage: "capability",
      summary: "需要本平台暂未提供的能力：" + labels.join("、"),
      failureCategory: "requires_external_capability",
      evidence
    };
  }

  /* 2) 第三方授权：本轮不做自动化，只准确标记（§28 / §29） */
  if (manifest.requiresAuthorization) {
    return {
      passed: false,
      stage: "authorization",
      summary: manifest.authorization.reason || "需要第三方账号或 API Key 授权",
      failureCategory: "requires_authorization",
      evidence: { ...evidence, authorization: manifest.authorization }
    };
  }

  /* 3) 纯 Prompt / 结构化 Skill：真实调用一次模型，确认提示词能组装、模型能返回 */
  if (manifest.runtimeType === "prompt" || manifest.skillType === "structured_skill") {
    const modelResult = await verifyPromptSkill(manifest);
    return { ...modelResult, evidence: { ...evidence, ...modelResult.evidence } };
  }

  /* 4) 带代码的 Skill：准备隔离环境 → 语法 → 依赖可加载 → 真实执行一层 */
  const runtime = await prepareSkillRuntime(manifest);
  evidence.runtime = { needsPython: runtime.needsPython, needsNode: runtime.needsNode };

  const entry = primaryEntrypoint(manifest);
  if (!entry) {
    return {
      passed: false,
      stage: "entrypoint",
      summary: "没有识别到可执行的入口文件",
      failureCategory: "entrypoint_not_found",
      evidence
    };
  }
  evidence.entrypoint = entry;

  const compiled = await compileCheck(manifest, entry);
  evidence.compile = compiled.output.slice(0, 800);
  if (!compiled.ok) {
    return {
      passed: false,
      stage: "compile",
      summary: "入口文件无法通过语法检查",
      failureCategory: "execution_error",
      evidence,
      output: compiled.output.slice(0, 2000)
    };
  }

  if (entry.runtime === "python") {
    const deps = await pythonDependencyCheck(manifest, entry.path);
    evidence.pythonDependencies = deps;
    if (!deps.ok) {
      const first = deps.missing[0] || "";
      return {
        passed: false,
        stage: "dependency",
        summary: first ? "缺少 Python 依赖：" + first.split("::")[0] : "Python 依赖加载失败",
        failureCategory: "missing_python_package",
        evidence,
        output: (deps.output + "\n" + deps.missing.join("\n")).slice(0, 2000)
      };
    }
  } else {
    const deps = await nodeDependencyCheck(manifest, entry.path);
    evidence.nodeDependencies = deps;
    if (!deps.ok) {
      return {
        passed: false,
        stage: "dependency",
        summary: deps.missing.length ? "缺少 Node 依赖：" + deps.missing.join("、") : "Node 依赖解析失败",
        failureCategory: "missing_node_package",
        evidence,
        output: deps.output.slice(0, 2000)
      };
    }
  }

  /* 真实执行一层（§24.5）。有明显副作用风险时只做前面的加载检查，不真的跑（§25）。*/
  const source = await readOriginalText(manifest, entry.path);
  const risk = assessSideEffectRisk(source + "\n" + manifest.instructions);
  evidence.sideEffectRisk = risk;

  if (risk.risky) {
    return {
      passed: true,
      stage: "execution-skipped",
      summary: "依赖与语法检查通过；检测到可能的真实副作用操作，已跳过自动执行",
      failureCategory: "",
      evidence
    };
  }

  const execution = await executeSkillEntry(manifest, entry, buildVerificationInput(manifest), { mode: "verify" });
  evidence.execution = { ok: execution.ok, exitCode: execution.exitCode, timedOut: execution.timedOut, stderr: execution.stderr.slice(0, 800) };

  if (!execution.ok) {
    return {
      passed: false,
      stage: "execution",
      summary: execution.timedOut ? "执行超时" : "入口执行失败",
      failureCategory: execution.timedOut ? "timeout" : "execution_error",
      evidence,
      output: (execution.stderr || execution.stdout).slice(0, 2000)
    };
  }

  return {
    passed: true,
    stage: "execution",
    summary: "隔离环境可启动、依赖可加载、入口可执行",
    failureCategory: "",
    evidence,
    output: execution.stdout.slice(0, 2000)
  };
}

async function verifyPromptSkill(manifest: SkillManifest): Promise<SkillVerificationResult> {
  const evidence: Record<string, unknown> = {};
  if (!isRouteConfigured("skill_verify")) {
    return {
      passed: false,
      stage: "capability",
      summary: "当前没有配置文本模型",
      failureCategory: "requires_external_capability",
      evidence
    };
  }

  if (!manifest.instructions.trim()) {
    return {
      passed: false,
      stage: "prompt",
      summary: "没有读到 Skill 的指令内容",
      failureCategory: "execution_error",
      evidence
    };
  }

  try {
    const copy = await generateCopywritingText({
      purpose: "skill_verify",
      system: manifest.systemPrompt.slice(0, 6000),
      user: "这是一次安装自检。请用一句话说明你已经就绪，并列出你主要能产出什么。不要执行任何实际操作。",
      temperature: 0,
      maxTokens: 200
    });
    const content = copy.text;
    evidence.replyPreview = content.slice(0, 200);
    if (!content) {
      return { passed: false, stage: "prompt", summary: "模型没有返回内容", failureCategory: "execution_error", evidence };
    }
    return { passed: true, stage: "prompt", summary: "Skill 指令可以正常组装，模型已按 Skill 回应", failureCategory: "", evidence, output: content.slice(0, 500) };
  } catch (error) {
    return {
      passed: false,
      stage: "prompt",
      summary: error instanceof Error ? error.message : "模型调用失败",
      failureCategory: "requires_external_capability",
      evidence
    };
  }
}

/** 给 Skill 的最小验证输入：优先用声明过的 schema，否则给一个通用占位。 */
export function buildVerificationInput(manifest: SkillManifest) {
  const schema = manifest.inputSchema;
  const properties = schema && typeof schema === "object" ? (schema as { properties?: Record<string, unknown> }).properties : undefined;
  if (properties && typeof properties === "object") {
    const input: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(properties)) {
      const type = value && typeof value === "object" ? (value as { type?: string }).type : "string";
      input[key] = type === "number" || type === "integer" ? 0 : type === "boolean" ? false : type === "array" ? [] : type === "object" ? {} : "";
    }
    return { ...input, __directorVerification: true };
  }
  return { __directorVerification: true, input: "", note: "安装自检的最小输入" };
}
