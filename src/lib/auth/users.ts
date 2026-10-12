import { randomBytes, randomUUID, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { authDataDir } from "@/lib/auth/runtime";

export type AuthUserRole = "admin" | "user";
export type AuthUserStatus = "active" | "disabled";

export type AuthUserRecord = {
  id: string;
  username: string;
  nickname: string;
  role: AuthUserRole;
  status: AuthUserStatus;
  passwordHash: string;
  createdAt: string;
  updatedAt: string;
};

const SCRYPT_KEYLEN = 64;
const SCRYPT_PARAMS = { N: 16384, r: 8, p: 1 };

type ScryptOptions = { N: number; r: number; p: number };

function scryptAsync(password: string, salt: Buffer, keylen: number, options?: ScryptOptions): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    if (options) {
      scryptCallback(password, salt, keylen, options, (error, derivedKey) => {
        if (error) reject(error);
        else resolve(derivedKey);
      });
      return;
    }
    scryptCallback(password, salt, keylen, SCRYPT_PARAMS, (error, derivedKey) => {
      if (error) reject(error);
      else resolve(derivedKey);
    });
  });
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const derived = await scryptAsync(password, salt, SCRYPT_KEYLEN);
  return [
    "scrypt",
    SCRYPT_PARAMS.N,
    SCRYPT_PARAMS.r,
    SCRYPT_PARAMS.p,
    salt.toString("hex"),
    derived.toString("hex")
  ].join("$");
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;
  const [, nRaw, rRaw, pRaw, saltHex, hashHex] = parts;
  const salt = Buffer.from(saltHex, "hex");
  const expected = Buffer.from(hashHex, "hex");
  try {
    const derived = await scryptAsync(password, salt, expected.length, {
      N: Number(nRaw),
      r: Number(rRaw),
      p: Number(pRaw)
    });
    return derived.length === expected.length && timingSafeEqual(derived, expected);
  } catch {
    return false;
  }
}

const usersFilePattern = /^[a-z0-9][a-z0-9._-]{1,31}$/i;

export function validateUsername(username: string): string | null {
  if (!usersFilePattern.test(username)) return "用户名只能是 2-32 位字母、数字、点、下划线或短横线";
  return null;
}

export function validatePassword(password: string): string | null {
  if (typeof password !== "string" || password.length < 6 || password.length > 64) {
    return "密码长度需要 6-64 位";
  }
  return null;
}

let writeQueue: Promise<unknown> = Promise.resolve();

function usersFilePath() {
  return path.join(authDataDir(), "users.json");
}

function serializeUsers(users: AuthUserRecord[]) {
  return JSON.stringify(users, null, 2);
}

function normalizeUser(raw: unknown): AuthUserRecord | null {
  if (!raw || typeof raw !== "object") return null;
  const record = raw as Record<string, unknown>;
  if (typeof record.id !== "string" || typeof record.username !== "string") return null;
  return {
    id: record.id,
    username: record.username,
    nickname: typeof record.nickname === "string" && record.nickname ? record.nickname : record.username,
    role: record.role === "admin" ? "admin" : "user",
    status: record.status === "disabled" ? "disabled" : "active",
    passwordHash: typeof record.passwordHash === "string" ? record.passwordHash : "",
    createdAt: typeof record.createdAt === "string" ? record.createdAt : "",
    updatedAt: typeof record.updatedAt === "string" ? record.updatedAt : ""
  };
}

export async function listUsers(): Promise<AuthUserRecord[]> {
  try {
    const raw = await readFile(usersFilePath(), "utf8");
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.map(normalizeUser).filter((user): user is AuthUserRecord => Boolean(user));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

export async function hasAnyUser(): Promise<boolean> {
  return (await listUsers()).length > 0;
}

export async function findUserById(id: string): Promise<AuthUserRecord | null> {
  return (await listUsers()).find((user) => user.id === id) ?? null;
}

export async function findUserByUsername(username: string): Promise<AuthUserRecord | null> {
  const target = username.trim().toLowerCase();
  return (await listUsers()).find((user) => user.username.toLowerCase() === target) ?? null;
}

async function persistUsers(users: AuthUserRecord[]) {
  const dir = authDataDir();
  await mkdir(dir, { recursive: true });
  const target = usersFilePath();
  const temp = `${target}.${randomUUID()}.tmp`;
  await writeFile(temp, serializeUsers(users), { encoding: "utf8", mode: 0o600 });
  await rename(temp, target);
}

/** 串行化写入，避免并发请求互相覆盖 */
function enqueueWrite<T>(task: () => Promise<T>): Promise<T> {
  const next = writeQueue.then(task, task);
  writeQueue = next.catch(() => undefined);
  return next;
}

export type CreateUserInput = {
  username: string;
  password: string;
  nickname?: string;
  role?: AuthUserRole;
};

export async function createUser(input: CreateUserInput): Promise<AuthUserRecord> {
  return enqueueWrite(async () => createUserInternal(input));
}

export type UpdateUserInput = {
  nickname?: string;
  password?: string;
  status?: AuthUserStatus;
  role?: AuthUserRole;
};

export async function updateUser(id: string, patch: UpdateUserInput): Promise<AuthUserRecord> {
  return enqueueWrite(async () => {
    const users = await listUsers();
    const index = users.findIndex((user) => user.id === id);
    if (index === -1) throw new Error("USER_NOT_FOUND");
    const current = users[index];

    if (patch.role && patch.role !== current.role && current.role === "admin") {
      const adminCount = users.filter((user) => user.role === "admin" && user.status === "active").length;
      if (adminCount <= 1) throw new Error("LAST_ADMIN");
    }
    if (patch.status === "disabled" && current.role === "admin") {
      const activeAdmins = users.filter((user) => user.role === "admin" && user.status === "active" && user.id !== id).length;
      if (activeAdmins === 0) throw new Error("LAST_ADMIN");
    }

    const next: AuthUserRecord = {
      ...current,
      nickname: patch.nickname?.trim() || current.nickname,
      status: patch.status ?? current.status,
      role: patch.role ?? current.role,
      updatedAt: new Date().toISOString()
    };
    if (patch.password) {
      next.passwordHash = await hashPassword(patch.password);
    }
    users[index] = next;
    await persistUsers(users);
    return next;
  });
}

export async function deleteUser(id: string): Promise<void> {
  await enqueueWrite(async () => {
    const users = await listUsers();
    const target = users.find((user) => user.id === id);
    if (!target) throw new Error("USER_NOT_FOUND");
    if (target.role === "admin") {
      const otherAdmins = users.filter((user) => user.role === "admin" && user.id !== id).length;
      if (otherAdmins === 0) throw new Error("LAST_ADMIN");
    }
    await persistUsers(users.filter((user) => user.id !== id));
  });
}

export async function authenticate(username: string, password: string): Promise<AuthUserRecord | null> {
  const user = await findUserByUsername(username);
  if (!user || user.status !== "active" || !user.passwordHash) return null;
  const ok = await verifyPassword(password, user.passwordHash);
  return ok ? user : null;
}

/**
 * 初始化管理员：原子版本。
 * “系统还没有任何账号”的判断放进写入队列内执行，
 * 并发调用只有一个能真正创建，其余得到 INITIALIZED 冲突，避免竞态重复建号。
 */
export async function createFirstAdmin(input: CreateUserInput): Promise<AuthUserRecord> {
  return enqueueWrite(async () => {
    if ((await listUsers()).length > 0) throw new Error("ALREADY_INITIALIZED");
    return createUserInternal(input);
  });
}

/** 仅供 createFirstAdmin / createUser 复用的内部创建逻辑（调用方负责串行化） */
async function createUserInternal(input: CreateUserInput): Promise<AuthUserRecord> {
  const username = input.username.trim();
  const users = await listUsers();
  const conflict = users.find((user) => user.username.toLowerCase() === username.toLowerCase());
  if (conflict) throw new Error("USERNAME_TAKEN");
  const now = new Date().toISOString();
  const record: AuthUserRecord = {
    id: `u_${randomUUID().replace(/-/g, "").slice(0, 20)}`,
    username,
    nickname: input.nickname?.trim() || username,
    role: input.role ?? "user",
    status: "active",
    passwordHash: await hashPassword(input.password),
    createdAt: now,
    updatedAt: now
  };
  users.push(record);
  await persistUsers(users);
  return record;
}

export function toPublicUser(user: AuthUserRecord) {
  return { id: user.id, username: user.username, nickname: user.nickname, role: user.role, status: user.status };
}
