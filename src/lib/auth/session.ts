import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { authDataDir } from "@/lib/auth/runtime";
import { findUserById, type AuthUserRecord } from "@/lib/auth/users";

export const SESSION_COOKIE_NAME = "director_session";
export const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30; // 30 天

export type SessionPayload = {
  uid: string;
  username: string;
  role: string;
  exp: number;
};

let cachedSecret: Buffer | null = null;

/** 会话签名密钥：首次调用时自动生成并保存到 auth/secret（0600 权限） */
export async function getAuthSecret(): Promise<Buffer> {
  if (cachedSecret) return cachedSecret;
  const file = path.join(authDataDir(), "secret");
  try {
    const raw = (await readFile(file, "utf8")).trim();
    if (/^[0-9a-f]{64}$/i.test(raw)) {
      cachedSecret = Buffer.from(raw, "hex");
      return cachedSecret;
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  const secret = randomBytes(32);
  await mkdir(authDataDir(), { recursive: true });
  await writeFile(file, secret.toString("hex") + "\n", { encoding: "utf8", mode: 0o600 });
  cachedSecret = secret;
  return secret;
}

function base64urlEncode(input: string | Buffer) {
  return Buffer.from(input).toString("base64url");
}

function sign(payloadB64: string, secret: Buffer) {
  return createHmac("sha256", secret).update(payloadB64).digest("base64url");
}

export async function createSessionToken(user: Pick<AuthUserRecord, "id" | "username" | "role">): Promise<string> {
  const secret = await getAuthSecret();
  const payload: SessionPayload = {
    uid: user.id,
    username: user.username,
    role: user.role,
    exp: Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS
  };
  const payloadB64 = base64urlEncode(JSON.stringify(payload));
  return `${payloadB64}.${sign(payloadB64, secret)}`;
}

export async function verifySessionToken(token: string | undefined | null): Promise<SessionPayload | null> {
  if (!token || typeof token !== "string") return null;
  const dotIndex = token.indexOf(".");
  if (dotIndex <= 0) return null;
  const payloadB64 = token.slice(0, dotIndex);
  const signature = token.slice(dotIndex + 1);
  let payload: SessionPayload;
  try {
    payload = JSON.parse(Buffer.from(payloadB64, "base64url").toString("utf8")) as SessionPayload;
  } catch {
    return null;
  }
  if (!payload || typeof payload.uid !== "string" || typeof payload.exp !== "number") return null;
  if (payload.exp * 1000 < Date.now()) return null;
  const secret = await getAuthSecret();
  const expected = sign(payloadB64, secret);
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  return payload;
}

/** 校验会话并回查账号状态（停用/删除立即失效） */
export async function getSessionUser(token: string | undefined | null): Promise<AuthUserRecord | null> {
  const payload = await verifySessionToken(token);
  if (!payload) return null;
  const user = await findUserById(payload.uid);
  if (!user || user.status !== "active") return null;
  return user;
}

export function sessionCookieOptions() {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    path: "/",
    maxAge: SESSION_TTL_SECONDS,
    secure: false // 内网 HTTP 访问，不强制 secure
  };
}

/** 网页鉴权总开关：桌面端注入该环境变量后跳过登录 */
export function isAuthDisabled() {
  return process.env.DIRECTOR_WEB_AUTH_DISABLED === "1";
}
