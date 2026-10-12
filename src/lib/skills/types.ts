/**
 * Universal Skill Runtime V1 —— 内部统一 Skill Manifest。
 *
 * 设计原则：外部 Skill（Harness / Codex / Claude / GitHub / 其他 Agent）保持原样不动，
 * 一律先转换成这里的内部抽象，Runtime 只认这一套结构。
 * 任何字段都允许为空，不要求所有 Skill 都具备全部字段。
 */

export type SkillType = "prompt_skill" | "structured_skill" | "python_skill" | "node_skill" | "hybrid_skill";

export type SkillRuntimeType = "prompt" | "python" | "node" | "hybrid";

/** 内部安装状态机（§57）。前台只映射成 4 种说法。 */
export type SkillInstallStatus =
  | "importing"
  | "analyzing"
  | "preparing"
  | "verifying"
  | "repairing"
  | "ready"
  | "requires_authorization"
  | "requires_external_capability"
  | "failed"
  | "disabled";

/** 前台可见状态，普通用户只需要看懂这几种。 */
export type SkillPublicStatus = "preparing" | "ready" | "requires_authorization" | "unavailable" | "disabled";

export type SkillVerificationStatus = "pending" | "running" | "passed" | "failed";

export type SkillSourceType = "file" | "folder" | "zip" | "unknown";

export interface SkillEntrypoint {
  /** 相对 original 目录的路径。 */
  path: string;
  runtime: SkillRuntimeType;
  /** 是否判定为可直接执行的入口。 */
  primary: boolean;
}

export interface SkillToolMapping {
  /** 外部 Skill 里出现的工具名（原样保留）。 */
  externalName: string;
  /** 映射到的 Director 内部能力 ID。 */
  capability: string;
  /** 使用的适配器 ID。 */
  adapter: string;
  matchedBy: "exact" | "alias" | "pattern" | "unmapped";
}

export interface SkillPermissionSet {
  network: boolean;
  filesystem: boolean;
  shell: boolean;
  externalAuthorization: boolean;
  paidApi: boolean;
}

export interface SkillRequiredPackage {
  name: string;
  version?: string;
  manager: "pip" | "npm";
  /** 来自声明（requirements/package.json）还是运行期报错推断。 */
  origin: "declared" | "inferred";
}

export interface SkillAuthorizationRequirement {
  required: boolean;
  reason: string;
  /** 需要用户提供的东西，例如 "Notion API Token"。 */
  provider?: string;
  envKeys?: string[];
}

export interface SkillManifest {
  skillId: string;
  name: string;
  description: string;
  version: string;

  sourceType: SkillSourceType;
  sourceName: string;

  originalFormat: string;

  createdAt: string;
  updatedAt: string;
  importedAt: string;

  /** 原始 Skill 在 data 目录下的相对路径。 */
  originalAssetPath: string;
  /** 原始包的引用（zip 文件名或来源标识）。 */
  originalPackageReference: string;

  normalizedManifestVersion: number;

  skillType: SkillType;

  /** 主要说明文件正文（已去掉 frontmatter）。 */
  instructions: string;
  /** 组装后的系统提示词片段。 */
  systemPrompt: string;
  /** 示例：名称 + 内容（已截断）。 */
  examples: Array<{ name: string; content: string }>;

  inputSchema: Record<string, unknown> | null;
  outputSchema: Record<string, unknown> | null;

  entrypoints: SkillEntrypoint[];

  runtimeType: SkillRuntimeType;

  requiredCapabilities: string[];
  requiredTools: string[];
  requiredPackages: SkillRequiredPackage[];
  requiredFiles: string[];
  environmentRequirements: string[];

  toolMappings: SkillToolMapping[];

  permissions: SkillPermissionSet;

  /** 普通用户是否需要参与（第三方账号 / API Key / OAuth）。 */
  requiresAuthorization: boolean;
  authorization: SkillAuthorizationRequirement;

  enabled: boolean;
  installStatus: SkillInstallStatus;
  verificationStatus: SkillVerificationStatus;
  lastVerifiedAt: string;
  runtimeVersion: string;
  errorState: string;

  metadata: Record<string, unknown>;

  /* ---- 版本与识别 ---- */
  externalVersion: string;
  directorRuntimeVersion: string;
  /** 原始文件内容哈希，用于识别重复导入 / 新版本。 */
  importHash: string;
  /** 不含哈希的稳定标识（同名 Skill 会被认为是同一个 Skill 的更新）。 */
  identityKey: string;
  /** 最近一次验证/修复的摘要，给开发者看。 */
  lastVerificationSummary: string;
  /** 安装阶段用于排查的失败分类。 */
  failureCategory: SkillFailureCategory;
}

export type SkillFailureCategory =
  | ""
  | "missing_python_package"
  | "missing_node_package"
  | "entrypoint_not_found"
  | "workdir"
  | "tool_alias_unmapped"
  | "requires_authorization"
  | "requires_external_capability"
  | "timeout"
  | "runtime_unavailable"
  | "execution_error"
  | "unknown";

export interface SkillRecord {
  manifest: SkillManifest;
  /** 前台可见状态（由 installStatus 映射）。 */
  publicStatus: SkillPublicStatus;
  /** 已安装 Skill 是否可被 AI 对话使用。 */
  usable: boolean;
}

export interface SkillLogEntry {
  at: string;
  level: "info" | "warn" | "error";
  stage: string;
  message: string;
}

export interface SkillVerificationResult {
  passed: boolean;
  stage: string;
  summary: string;
  failureCategory: SkillFailureCategory;
  /** 结构化证据，写进日志供开发者排查。 */
  evidence: Record<string, unknown>;
  /** 真实执行产生的输出（截断）。 */
  output?: string;
}
