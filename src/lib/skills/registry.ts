import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { skillDataRoot, skillRegistryFile } from "@/lib/skills/paths";
import { toPublicStatus } from "@/lib/skills/config";
import type { SkillManifest, SkillRecord } from "@/lib/skills/types";

/**
 * Skill Registry（§10）：所有 Skill 数据只从这里进出。
 * UI / AI 对话一律通过 Skill Service / Registry 访问，不直接碰 localStorage 或散落的文件。
 */

let writeChain: Promise<unknown> = Promise.resolve();

async function readAll(): Promise<SkillManifest[]> {
  try {
    const raw = await readFile(skillRegistryFile(), "utf8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as SkillManifest[]) : [];
  } catch {
    return [];
  }
}

/** 串行化写入，避免并发导入互相覆盖（§58）。 */
function queueWrite<T>(task: () => Promise<T>): Promise<T> {
  const run = writeChain.then(task, task);
  writeChain = run.catch(() => undefined);
  return run;
}

async function writeAll(manifests: SkillManifest[]) {
  await mkdir(skillDataRoot(), { recursive: true });
  const target = skillRegistryFile();
  const temporary = path.join(skillDataRoot(), "registry.json.tmp");
  await writeFile(temporary, JSON.stringify(manifests, null, 2), "utf8");
  await rename(temporary, target);
}

export function toSkillRecord(manifest: SkillManifest): SkillRecord {
  const publicStatus = toPublicStatus(manifest);
  return {
    manifest,
    publicStatus,
    usable: manifest.enabled && publicStatus === "ready"
  };
}

export async function listSkillManifests(): Promise<SkillManifest[]> {
  const manifests = await readAll();
  return manifests.sort((a, b) => (b.importedAt || "").localeCompare(a.importedAt || ""));
}

export async function listSkillRecords(): Promise<SkillRecord[]> {
  return (await listSkillManifests()).map(toSkillRecord);
}

export async function getSkillManifest(skillId: string): Promise<SkillManifest | null> {
  const manifests = await readAll();
  return manifests.find((item) => item.skillId === skillId) || null;
}

export async function getSkillRecord(skillId: string): Promise<SkillRecord | null> {
  const manifest = await getSkillManifest(skillId);
  return manifest ? toSkillRecord(manifest) : null;
}

export async function upsertSkillManifest(manifest: SkillManifest): Promise<SkillManifest> {
  return queueWrite(async () => {
    const manifests = await readAll();
    const index = manifests.findIndex((item) => item.skillId === manifest.skillId);
    const next = index >= 0
      ? manifests.map((item) => (item.skillId === manifest.skillId ? manifest : item))
      : [...manifests, manifest];
    await writeAll(next);
    return manifest;
  });
}

export async function patchSkillManifest(skillId: string, patch: Partial<SkillManifest>): Promise<SkillManifest | null> {
  return queueWrite(async () => {
    const manifests = await readAll();
    let updated: SkillManifest | null = null;
    const next = manifests.map((item) => {
      if (item.skillId !== skillId) return item;
      updated = { ...item, ...patch, updatedAt: patch.updatedAt || new Date().toISOString() };
      return updated;
    });
    if (!updated) return null;
    await writeAll(next);
    return updated;
  });
}

export async function removeSkillManifest(skillId: string): Promise<boolean> {
  return queueWrite(async () => {
    const manifests = await readAll();
    const next = manifests.filter((item) => item.skillId !== skillId);
    if (next.length === manifests.length) return false;
    await writeAll(next);
    return true;
  });
}

export async function findSkillByImportHash(importHash: string): Promise<SkillManifest | null> {
  const manifests = await readAll();
  return manifests.find((item) => item.importHash === importHash) || null;
}

export async function listUsableSkillManifests(): Promise<SkillManifest[]> {
  const manifests = await readAll();
  return manifests.filter((item) => item.enabled && item.installStatus === "ready");
}

export async function getSkillsByIds(skillIds: string[]): Promise<SkillManifest[]> {
  const wanted = new Set(skillIds.filter(Boolean));
  if (wanted.size === 0) return [];
  const manifests = await readAll();
  return manifests.filter((item) => wanted.has(item.skillId));
}
