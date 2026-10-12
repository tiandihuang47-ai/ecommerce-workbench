import type { SkillRuntimeType } from "@/lib/skills/types";

/**
 * Skill Runtime 的可配置项集中在这里（§67），不要在业务代码里散落 magic number。
 */
export const skillRuntimeConfig = {
  /** 规范化 Manifest 版本，未来结构变更时递增。 */
  normalizedManifestVersion: 1,
  /** Director 内部 Runtime 版本。 */
  directorRuntimeVersion: "1.0.0",

  /** 静默验证超时（毫秒）。 */
  verificationTimeoutMs: Number(process.env.SKILL_VERIFY_TIMEOUT_MS || 60_000),
  /** 单次 Skill 代码执行超时。 */
  executionTimeoutMs: Number(process.env.SKILL_EXEC_TIMEOUT_MS || 45_000),
  /** 依赖安装超时。 */
  installTimeoutMs: Number(process.env.SKILL_INSTALL_TIMEOUT_MS || 180_000),
  /** 自动修复最大尝试次数（§21）。 */
  maxRepairAttempts: Number(process.env.SKILL_MAX_REPAIR_ATTEMPTS || 3),

  /** 允许的 Runtime 类型。 */
  allowedRuntimeTypes: ["prompt", "python", "node", "hybrid"] as SkillRuntimeType[],

  /** 单次执行的输出上限（字符），防止外部代码刷爆内存。 */
  maxOutputChars: 40_000,
  /** 单个导入包解压后的总大小上限。 */
  maxImportBytes: 40 * 1024 * 1024,
  /** 单个文件大小上限。 */
  maxFileBytes: 8 * 1024 * 1024,
  /** 解压文件数量上限。 */
  maxImportFiles: 800,

  /** 注入 AI 对话的 Skill 上下文字符预算（§36 / §55）。 */
  maxSkillContextChars: 12_000,
  /** 单个 Skill 的 instructions 注入上限。 */
  maxInstructionsChars: 6_000,
  /** 单个 Skill 的 rules 注入上限。 */
  maxRulesChars: 2_500,
  /** 单个示例注入上限。 */
  maxExampleChars: 1_200,
  /** 最多注入的示例条数。 */
  maxExamples: 3,
  /** 一个会话最多同时启用多少个 Skill（§34）。 */
  maxActiveSkillsPerSession: 3,

  /** 执行时禁止出现的危险命令片段（§27）。 */
  blockedCommandPatterns: [
    "rm -rf /",
    "sudo ",
    "mkfs",
    "shutdown",
    "reboot",
    ":(){",
    "chmod 777 /",
    "> /dev/sda",
    "diskutil erase",
    "launchctl unload /System",
    "dscl . -delete",
    "curl | sh",
    "curl | bash",
    "wget | sh",
    "wget | bash"
  ]
} as const;

export const skillPublicStatusLabels: Record<string, string> = {
  preparing: "正在准备",
  ready: "可使用",
  requires_authorization: "需要授权",
  unavailable: "暂时无法使用",
  disabled: "已停用"
};

export function toPublicStatus(manifest: { installStatus: string; enabled: boolean }): "preparing" | "ready" | "requires_authorization" | "unavailable" | "disabled" {
  if (!manifest.enabled || manifest.installStatus === "disabled") return "disabled";
  if (manifest.installStatus === "ready") return "ready";
  if (manifest.installStatus === "requires_authorization") return "requires_authorization";
  if (manifest.installStatus === "requires_external_capability" || manifest.installStatus === "failed") return "unavailable";
  return "preparing";
}
