"use client";

/**
 * Skill 中心的前端访问层。UI 只通过这些函数与 Skill Service 交互（§10）。
 */

export interface SkillListItem {
  skillId: string;
  name: string;
  description: string;
  sourceType: string;
  sourceName: string;
  version: string;
  importedAt: string;
  updatedAt: string;
  enabled: boolean;
  publicStatus: "preparing" | "ready" | "requires_authorization" | "unavailable" | "disabled";
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

export interface SkillDetail extends SkillListItem {
  environmentRequirements: string[];
  permissions: { network: boolean; filesystem: boolean; shell: boolean };
  runtimeType: string;
  entrypointCount: number;
  toolCount: number;
  toolMappings: Array<{ externalName: string; matched: boolean; capabilityLabel: string }>;
  developerSummary: {
    installStatus: string;
    verificationStatus: string;
    lastVerifiedAt: string;
    summary: string;
    skillType: string;
    runtimeType: string;
    requiredPackages: string[];
    requiredCapabilities: string[];
  };
}

export async function fetchSkills(): Promise<SkillListItem[]> {
  const response = await fetch("/api/skills", { cache: "no-store" });
  const data = (await response.json()) as { success?: boolean; skills?: SkillListItem[] };
  return data.skills || [];
}

export async function fetchSkillDetail(skillId: string): Promise<SkillDetail | null> {
  const response = await fetch(`/api/skills/${encodeURIComponent(skillId)}`, { cache: "no-store" });
  if (!response.ok) return null;
  const data = (await response.json()) as { success?: boolean; skill?: SkillDetail };
  return data.skill || null;
}

export interface ImportPayload {
  sourceName: string;
  sourceType: "file" | "folder" | "zip";
  files: File[];
  paths: string[];
  archive?: File | null;
}

export async function importSkill(payload: ImportPayload) {
  const form = new FormData();
  form.set("sourceName", payload.sourceName);
  form.set("sourceType", payload.sourceType);
  form.set("paths", JSON.stringify(payload.paths));
  payload.files.forEach((file) => form.append("files", file));
  if (payload.archive) form.set("archive", payload.archive);

  const response = await fetch("/api/skills", { method: "POST", body: form });
  const data = (await response.json()) as { success?: boolean; message?: string; skill?: SkillListItem };
  return { ok: response.ok && Boolean(data.success), message: data.message || "", skill: data.skill || null };
}

export async function setSkillEnabled(skillId: string, enabled: boolean) {
  const response = await fetch(`/api/skills/${encodeURIComponent(skillId)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ enabled })
  });
  return response.ok;
}

export async function deleteSkill(skillId: string) {
  const response = await fetch(`/api/skills/${encodeURIComponent(skillId)}`, { method: "DELETE" });
  return response.ok;
}

export async function reverifySkill(skillId: string) {
  const response = await fetch(`/api/skills/${encodeURIComponent(skillId)}/reverify`, { method: "POST" });
  return response.ok;
}
