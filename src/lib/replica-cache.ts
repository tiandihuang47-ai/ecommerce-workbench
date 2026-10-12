import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { access, copyFile, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { getReplicaConfig } from "@/lib/replica-config";
import type { ReplicaProductUnderstanding, VideoDNA } from "@/lib/replica-types";

export function hashBytes(value: Uint8Array | string) {
  return createHash("sha256").update(value).digest("hex");
}

export function isSafeCacheKey(value: string) {
  return /^[a-f0-9]{64}$/i.test(value);
}

export async function ensureReplicaCache() {
  const root = getReplicaConfig().cacheRoot;
  await mkdir(root, { recursive: true });
  await mkdir(path.join(root, "videos"), { recursive: true });
  await mkdir(path.join(root, "products"), { recursive: true });
  return root;
}

export async function persistReplicaVideoSource(options: { buffer: Uint8Array; hash: string; extension: string }) {
  const root = await ensureReplicaCache();
  const directory = path.join(root, "videos", options.hash);
  await mkdir(directory, { recursive: true });
  const extension = options.extension.startsWith(".") ? options.extension : `.${options.extension}`;
  const filePath = path.join(directory, `source${extension.toLowerCase()}`);
  try {
    await access(filePath);
  } catch {
    await writeFile(filePath, options.buffer);
  }
  return filePath;
}

export async function persistReplicaVideoFileSource(options: { sourcePath: string; hash: string; extension: string }) {
  const root = await ensureReplicaCache();
  const directory = path.join(root, "videos", options.hash);
  await mkdir(directory, { recursive: true });
  const extension = options.extension.startsWith(".") ? options.extension : `.${options.extension}`;
  const filePath = path.join(directory, `source${extension.toLowerCase()}`);
  try {
    await access(filePath);
  } catch {
    await copyFile(options.sourcePath, filePath);
  }
  return filePath;
}

export async function getCachedVideoDNA(hash: string) {
  if (!isSafeCacheKey(hash)) return null;
  const root = getReplicaConfig().cacheRoot;
  try {
    const value = await readFile(path.join(root, "videos", hash, "dna.json"), "utf8");
    return JSON.parse(value) as VideoDNA;
  } catch {
    return null;
  }
}

export async function saveCachedVideoDNA(hash: string, dna: VideoDNA) {
  const root = await ensureReplicaCache();
  const directory = path.join(root, "videos", hash);
  await mkdir(directory, { recursive: true });
  await writeFile(path.join(directory, "dna.json"), JSON.stringify(dna), "utf8");
}

export async function getCachedProductUnderstanding(hash: string) {
  if (!isSafeCacheKey(hash)) return null;
  const root = getReplicaConfig().cacheRoot;
  try {
    const value = await readFile(path.join(root, "products", hash, "understanding.json"), "utf8");
    return JSON.parse(value) as ReplicaProductUnderstanding;
  } catch {
    return null;
  }
}

export async function saveCachedProductUnderstanding(hash: string, understanding: ReplicaProductUnderstanding) {
  const root = await ensureReplicaCache();
  const directory = path.join(root, "products", hash);
  await mkdir(directory, { recursive: true });
  await writeFile(path.join(directory, "understanding.json"), JSON.stringify(understanding), "utf8");
}

export async function persistReplicaProductImage(options: { buffer: Uint8Array; hash: string; index: number; extension: string }) {
  const root = await ensureReplicaCache();
  const directory = path.join(root, "products", options.hash);
  await mkdir(directory, { recursive: true });
  const extension = options.extension.startsWith(".") ? options.extension : `.${options.extension}`;
  const filePath = path.join(directory, `image-${String(options.index).padStart(2, "0")}${extension.toLowerCase()}`);
  await writeFile(filePath, options.buffer);
  return filePath;
}

export async function persistReplicaProductDocument(options: { buffer: Uint8Array; hash: string; name: string }) {
  const root = await ensureReplicaCache();
  const directory = path.join(root, "products", options.hash);
  await mkdir(directory, { recursive: true });
  const extension = path.extname(options.name).toLowerCase() || ".txt";
  const filePath = path.join(directory, `document${extension}`);
  await writeFile(filePath, options.buffer);
  return filePath;
}

export async function generateReplicaVideoThumbnail(options: { videoPath: string; hash: string }) {
  const root = await ensureReplicaCache();
  const directory = path.join(root, "videos", options.hash);
  await mkdir(directory, { recursive: true });
  const thumbnailPath = path.join(directory, "thumbnail.jpg");
  try {
    await access(thumbnailPath);
    return thumbnailPath;
  } catch { /* 首次生成 */ }

  const execFileAsync = promisify(execFile);
  let duration = 0;
  try {
    const probe = await execFileAsync("ffprobe", [
      "-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", options.videoPath
    ], { timeout: 30000, maxBuffer: 1024 * 1024 });
    duration = Number(probe.stdout.trim()) || 0;
  } catch { /* 后面使用兜底时间点 */ }

  const candidateSeconds = [
    duration > 0 ? Math.min(duration * 0.12, 3) : 0.5,
    duration > 0 ? duration * 0.25 : 2,
    1,
    duration > 0 ? duration * 0.5 : 4,
    0
  ];
  let lastError = "";
  for (const [index, second] of candidateSeconds.entries()) {
    const candidatePath = path.join(directory, `thumbnail-candidate-${index}.jpg`);
    try {
      await execFileAsync("ffmpeg", [
        "-y", "-ss", String(Math.max(0, second)), "-i", options.videoPath,
        "-frames:v", "1", "-vf", "thumbnail=24,scale=480:-2", "-q:v", "2", candidatePath
      ], { timeout: 60000, maxBuffer: 1024 * 1024 * 4 });
      await access(candidatePath);
      await writeFile(thumbnailPath, await readFile(candidatePath));
      return thumbnailPath;
    } catch (error) {
      lastError = error instanceof Error ? error.message : "缩略图生成失败";
    }
  }
  throw new Error(lastError || "视频缩略图生成失败。");
}
