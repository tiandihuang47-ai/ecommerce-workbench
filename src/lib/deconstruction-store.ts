"use client";

import {
  createId,
  deleteSimpleDeconstructionRecord,
  getSimpleDeconstructionRecords,
  nowIso,
  saveSimpleDeconstructionRecord
} from "@/lib/pipeline-storage";
import type { SimpleDeconstructionRecord } from "@/lib/pipeline-types";

export type DeconstructionRecord = SimpleDeconstructionRecord;

export function getDeconstructionRecords() {
  try {
    return getSimpleDeconstructionRecords();
  } catch {
    return [];
  }
}

export function getDeconstructionRecordById(id: string) {
  return getDeconstructionRecords().find((record) => record.id === id) || null;
}

export function saveDeconstructionRecord(record: SimpleDeconstructionRecord) {
  const now = nowIso();
  const saved = {
    ...record,
    id: record.id || createId("deconstruction"),
    createdAt: record.createdAt || now,
    updatedAt: now
  };
  saveSimpleDeconstructionRecord(saved);
  return saved;
}

export function updateDeconstructionRecord(id: string, patch: Partial<SimpleDeconstructionRecord>) {
  const existing = getDeconstructionRecordById(id);
  if (!existing) return null;
  return saveDeconstructionRecord({
    ...existing,
    ...patch,
    id,
    createdAt: existing.createdAt || patch.createdAt || nowIso()
  });
}

export function deleteDeconstructionRecord(id: string) {
  try {
    deleteSimpleDeconstructionRecord(id);
    return true;
  } catch {
    return false;
  }
}

export function clearDeconstructionRecords() {
  getDeconstructionRecords().forEach((record) => {
    deleteSimpleDeconstructionRecord(record.id);
  });
}

export function getLatestDeconstructionRecord() {
  return getDeconstructionRecords()[0] || null;
}

export function toggleFavoriteDeconstructionRecord(id: string) {
  const existing = getDeconstructionRecordById(id);
  if (!existing) return null;
  return updateDeconstructionRecord(id, { favorite: !existing.favorite });
}

