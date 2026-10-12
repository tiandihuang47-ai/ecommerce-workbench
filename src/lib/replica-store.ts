"use client";

import { createId } from "@/lib/shared/id";
import { nowIso } from "@/lib/shared/time";
import type { ReplicaTask, ReplicaVersion } from "@/lib/replica-types";
import { storageGet, storageSet } from "@/lib/web-storage";

export const replicaTaskStorageKey = "director-platform.replicaTasks.v1";
export const replicaDraftStorageKey = "director-platform.replicaDraft.v1";

export function getReplicaTasks() {
  const raw = storageGet(replicaTaskStorageKey);
  if (!raw) return [] as ReplicaTask[];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.map(normalizeTask).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)) : [];
  } catch {
    return [] as ReplicaTask[];
  }
}

export function getReplicaTaskById(id: string) {
  return getReplicaTasks().find((item) => item.id === id) || null;
}

export function getLatestReplicaTask() {
  return getReplicaTasks()[0] || null;
}

export function saveReplicaTask(task: ReplicaTask) {
  const next = normalizeTask({ ...task, updatedAt: nowIso() });
  const items = getReplicaTasks();
  const index = items.findIndex((item) => item.id === next.id);
  const merged = index >= 0 ? items.map((item) => item.id === next.id ? next : item) : [next, ...items];
  writeTasks(merged);
  return next;
}

export function appendReplicaVersion(taskId: string, prompt: string, note = "") {
  const task = getReplicaTaskById(taskId);
  if (!task) return null;
  const version: ReplicaVersion = {
    id: createId("replica_version"),
    version: task.versions.length + 1,
    prompt,
    note,
    createdAt: nowIso()
  };
  return saveReplicaTask({ ...task, prompt, versions: [...task.versions, version] });
}

export function saveReplicaDraft(value: unknown) {
  try {
    storageSet(replicaDraftStorageKey, JSON.stringify(value));
  } catch {
    // 草稿过大或存储不可用时，不阻断当前工作。
  }
}

export function getReplicaDraft<T = unknown>() {
  const raw = storageGet(replicaDraftStorageKey);
  if (!raw) return null as T | null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null as T | null;
  }
}

function writeTasks(items: ReplicaTask[]) {
  try {
    storageSet(replicaTaskStorageKey, JSON.stringify(items));
  } catch {
    // 任务正文保存在内存中仍可继续编辑；下次保存时再尝试。
  }
}

function normalizeTask(value: Partial<ReplicaTask>): ReplicaTask {
  const now = nowIso();
  const versions = Array.isArray(value.versions) ? value.versions.map((item, index) => ({
    id: item.id || createId("replica_version"),
    version: Number(item.version || index + 1),
    prompt: item.prompt || "",
    note: item.note || "",
    createdAt: item.createdAt || now
  })) : [];
  return {
    id: value.id || createId("replica_task"),
    title: value.title || "未命名爆款复刻",
    status: value.status || "draft",
    video: {
      assetId: value.video?.assetId || "",
      thumbnailAssetId: value.video?.thumbnailAssetId || "",
      name: value.video?.name || "",
      size: Number(value.video?.size || 0),
      duration: Number(value.video?.duration || 0),
      cacheKey: value.video?.cacheKey || "",
      sourceType: value.video?.sourceType,
      sourceUrl: value.video?.sourceUrl,
      resolvedUrl: value.video?.resolvedUrl,
      authorName: value.video?.authorName,
      importedAt: value.video?.importedAt
    },
    products: Array.isArray(value.products) ? value.products.map((item) => ({ assetId: item.assetId || "", name: item.name || "", size: Number(item.size || 0), type: item.type || "" })) : [],
    productCacheKey: value.productCacheKey || "",
    documentName: value.documentName || "",
    documentAssetId: value.documentAssetId || "",
    requirements: value.requirements || "",
    referenceCopy: value.referenceCopy || "",
    copyMode: value.copyMode,
    customCopy: value.customCopy || "",
    copyPromptRequested: value.copyPromptRequested === true,
    dialogueHandling: value.dialogueHandling,
    messages: Array.isArray(value.messages) ? value.messages.map((item) => ({ id: item.id || createId("replica_message"), role: item.role === "assistant" ? "assistant" as const : "user" as const, content: item.content || "", createdAt: item.createdAt || now })) : [],
    prompt: value.prompt || "",
    versions,
    selfCheck: value.selfCheck,
    warnings: Array.isArray(value.warnings) ? value.warnings.filter(Boolean) : [],
    error: value.error || "",
    analysisProgress: value.analysisProgress,
    createdAt: value.createdAt || now,
    updatedAt: value.updatedAt || value.createdAt || now
  };
}
