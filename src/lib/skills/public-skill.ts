import type { SkillManifest, SkillPublicStatus } from "@/lib/skills/types";

/**
 * 前台投影：普通用户只看这几项，Python / Node / 依赖 / Tool Mapping 一律不出现（§31 / §68）。
 */
export interface PublicSkill {
  skillId: string;
  name: string;
  description: string;
  sourceType: string;
  sourceName: string;
  version: string;
  importedAt: string;
  updatedAt: string;
  enabled: boolean;
  publicStatus: SkillPublicStatus;
  usable: boolean;
  skillType: string;
  statusDetail: string;
  requiresAuthorization: boolean;
  authorizationProvider: string;
  detail: {
    whatItDoes: string;
    whatItNeeds: string[];
    capabilityCount: number;
    hasTools: boolean;
  };
}

export function toPublicSkill(manifest: SkillManifest, publicStatusOverride?: SkillPublicStatus): PublicSkill {
  return {
    skillId: manifest.skillId,
    name: manifest.name,
    description: manifest.description,
    sourceType: manifest.sourceType,
    sourceName: manifest.sourceName,
    version: manifest.version || manifest.externalVersion || "未标注版本",
    importedAt: manifest.importedAt,
    updatedAt: manifest.updatedAt,
    enabled: manifest.enabled,
    publicStatus: publicStatusOverride || derivePublicStatus(manifest),
    usable: manifest.enabled && (publicStatusOverride ? publicStatusOverride === "ready" : manifest.installStatus === "ready"),
    skillType: manifest.skillType,
    statusDetail: statusDetailOf(manifest),
    requiresAuthorization: manifest.requiresAuthorization,
    authorizationProvider: manifest.authorization.provider || "",
    detail: {
      whatItDoes: manifest.description,
      whatItNeeds: describeNeeds(manifest),
      capabilityCount: manifest.requiredCapabilities.length,
      hasTools: manifest.entrypoints.length > 0
    }
  };
}

function derivePublicStatus(manifest: SkillManifest): SkillPublicStatus {
  if (!manifest.enabled) return "disabled";
  if (manifest.installStatus === "ready") return "ready";
  if (manifest.installStatus === "requires_authorization") return "requires_authorization";
  if (manifest.installStatus === "requires_external_capability" || manifest.installStatus === "failed") return "unavailable";
  return "preparing";
}

/** 用户能看懂的一句话，绝不包含技术栈信息。 */
function statusDetailOf(manifest: SkillManifest) {
  if (!manifest.enabled) return "已停用";
  switch (manifest.installStatus) {
    case "ready":
      return manifest.lastVerifiedAt ? "已通过自检，可直接使用" : "可使用";
    case "requires_authorization":
      return manifest.authorization.reason || "需要你提供账号或 API Key 后才能使用";
    case "requires_external_capability":
      return "这个 Skill 依赖本平台暂未提供的能力";
    case "failed":
      return "自检没有通过，暂时无法使用";
    default:
      return "正在准备 Skill…";
  }
}

function describeNeeds(manifest: SkillManifest) {
  const needs: string[] = [];
  if (manifest.requiresAuthorization) needs.push("需要你提供账号或 API Key 授权");
  if (manifest.entrypoints.length > 0) needs.push("包含可执行脚本（系统已准备好隔离环境）");
  if (manifest.permissions.network) needs.push("使用时会联网");
  if (needs.length === 0) needs.push("开箱即用");
  return needs;
}
