import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import type { NextRequest } from "next/server";
import { userScopedDataDir } from "@/lib/auth/runtime";
import { getSessionUserFromRequest, isAuthDisabled } from "@/lib/auth/guard";

/** 存储键白名单：仅允许安全字符，防路径穿越 */
export const WEB_STORAGE_KEY_PATTERN = /^[A-Za-z0-9._:-]{1,120}$/;

/** 单键大小上限（与浏览器 localStorage 同量级） */
export const WEB_STORAGE_VALUE_LIMIT = 8 * 1024 * 1024;

/**
 * 解析当前请求归属的用户 ID。
 * - 桌面端（鉴权关闭）返回 null：桌面数据保持原有本地路径/localStorage，不进入按用户隔离。
 * - 网页端返回登录用户 ID；未登录返回 null。
 */
export async function resolveScopedUserId(request: NextRequest): Promise<string | null> {
  if (isAuthDisabled()) return null;
  const user = await getSessionUserFromRequest(request);
  return user ? user.id : null;
}

/* ------------------------------------------------------------------ 版本化 KV */

export type StoredEntry = {
  value: string;
  version: number;
  updatedAt: string;
};

export class VersionConflictError extends Error {
  current: StoredEntry;
  constructor(current: StoredEntry) {
    super("版本冲突：服务器上的数据已被其他窗口或设备更新");
    this.name = "VersionConflictError";
    this.current = current;
  }
}

type Envelope = { v: 1; version: number; updatedAt: string; value: string };

function storageDir(userId: string) {
  return path.join(userScopedDataDir(userId), "storage");
}

function storageFile(userId: string, key: string) {
  return path.join(storageDir(userId), `${key}.json`);
}

/** 解析文件内容：新版是带版本号的信封；历史文件是原始字符串（视为 version 1）。 */
function parseStoredEntry(raw: string): StoredEntry {
  try {
    if (raw.startsWith("{")) {
      const parsed = JSON.parse(raw) as Partial<Envelope>;
      if (parsed && parsed.v === 1 && typeof parsed.value === "string" && typeof parsed.version === "number") {
        return { value: parsed.value, version: parsed.version, updatedAt: parsed.updatedAt || "" };
      }
    }
  } catch {
    /* 不是合法 JSON，按历史原始字符串处理 */
  }
  return { value: raw, version: 1, updatedAt: "" };
}

export async function readUserStorageEntry(userId: string, key: string): Promise<StoredEntry | null> {
  let raw: string;
  try {
    raw = await readFile(storageFile(userId, key), "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
  return parseStoredEntry(raw);
}

/** 兼容旧调用：只取值 */
export async function readUserStorageValue(userId: string, key: string): Promise<string | null> {
  const entry = await readUserStorageEntry(userId, key);
  return entry ? entry.value : null;
}

/* 每键串行化写入：同键操作按提交顺序执行，避免并发的“读-改-写”交错 */
const keyWriteChains = new Map<string, Promise<unknown>>();

function enqueueKeyWrite<T>(userId: string, key: string, task: () => Promise<T>): Promise<T> {
  const chainKey = `${userId}::${key}`;
  const prev = keyWriteChains.get(chainKey) || Promise.resolve();
  const next = prev.then(task, task);
  keyWriteChains.set(chainKey, next.catch(() => undefined));
  return next;
}

export async function writeUserStorageValue(
  userId: string,
  key: string,
  value: string,
  options: { expectedVersion?: number | null } = {}
): Promise<StoredEntry> {
  return enqueueKeyWrite(userId, key, async () => {
    const dir = storageDir(userId);
    await mkdir(dir, { recursive: true });
    const current = await readUserStorageEntry(userId, key);
    if (typeof options.expectedVersion === "number" && current && current.version !== options.expectedVersion) {
      throw new VersionConflictError(current);
    }
    if (typeof options.expectedVersion === "number" && !current && options.expectedVersion > 0) {
      // 客户端以为存在但服务器已没有该记录（例如被另一端删除）
      throw new VersionConflictError({ value: "", version: 0, updatedAt: "" });
    }
    const entry: StoredEntry = {
      value,
      version: (current?.version ?? 0) + 1,
      updatedAt: new Date().toISOString()
    };
    const target = storageFile(userId, key);
    const temp = path.join(dir, `.${key}.${randomUUID()}.tmp`);
    await writeFile(temp, JSON.stringify({ v: 1, ...entry }), "utf8");
    await rename(temp, target);
    return entry;
  });
}

export async function deleteUserStorageValue(userId: string, key: string): Promise<void> {
  return enqueueKeyWrite(userId, key, async () => {
    await rm(storageFile(userId, key), { force: true });
  });
}
