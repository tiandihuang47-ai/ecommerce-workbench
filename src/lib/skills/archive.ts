import JSZip from "jszip";
import { skillRuntimeConfig } from "@/lib/skills/config";

/**
 * zip 解压（§7）。只做安全解压与文件清单归一化，不落盘。
 */

const blockedSegments = ["..", "__MACOSX", ".DS_Store"];

export interface ExtractedFile {
  relativePath: string;
  bytes: Uint8Array;
}

export function isSafeRelativePath(value: string) {
  const normalized = value.replace(/\\/g, "/");
  if (!normalized || normalized.startsWith("/") || /^[a-zA-Z]:/.test(normalized)) return false;
  if (blockedSegments.some((segment) => normalized.split("/").includes(segment))) return false;
  return true;
}

export function stripCommonRootPrefix(files: ExtractedFile[]): ExtractedFile[] {
  if (files.length === 0) return files;
  const firstSegments = files.map((file) => file.relativePath.split("/")[0]);
  const unique = new Set(firstSegments);
  // zip 里常见的「整个 Skill 包被套了一层文件夹」的情况自动剥掉
  if (unique.size === 1 && files.every((file) => file.relativePath.includes("/"))) {
    return files.map((file) => ({ ...file, relativePath: file.relativePath.slice(file.relativePath.indexOf("/") + 1) }));
  }
  return files;
}

export async function extractZipArchive(bytes: Uint8Array): Promise<{ files: ExtractedFile[]; skipped: string[] }> {
  const zip = await JSZip.loadAsync(bytes);
  const files: ExtractedFile[] = [];
  const skipped: string[] = [];
  let total = 0;

  const entries = Object.values(zip.files);
  for (const entry of entries) {
    if (entry.dir) continue;
    const relativePath = entry.name;
    if (!isSafeRelativePath(relativePath)) {
      skipped.push(relativePath);
      continue;
    }
    if (files.length >= skillRuntimeConfig.maxImportFiles) {
      skipped.push(relativePath + "（超出文件数量上限）");
      continue;
    }
    const content = await entry.async("uint8array");
    if (content.byteLength > skillRuntimeConfig.maxFileBytes) {
      skipped.push(relativePath + "（单文件过大）");
      continue;
    }
    total += content.byteLength;
    if (total > skillRuntimeConfig.maxImportBytes) {
      skipped.push(relativePath + "（超出总大小上限）");
      continue;
    }
    files.push({ relativePath, bytes: content });
  }

  return { files: stripCommonRootPrefix(files), skipped };
}
