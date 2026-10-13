import { getSessionUser, isAuthDisabled, SESSION_COOKIE_NAME } from "@/lib/auth/session";
import type { AuthUserRecord } from "@/lib/auth/users";
import { getLocalAccessUser } from "@/lib/auth/local-access";

export { isAuthDisabled };

function sessionCookieValue(request: Request): string | undefined {
  const header = request.headers.get("cookie");
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() === SESSION_COOKIE_NAME) return part.slice(eq + 1).trim();
  }
  return undefined;
}

/**
 * 从请求中解析当前登录用户。
 * 桌面端（鉴权关闭）返回 null，由调用方决定本地模式行为。
 * 接受任意 Request（含 NextRequest），通过 Cookie 头解析会话。
 */
export async function getSessionUserFromRequest(request: Request): Promise<AuthUserRecord | null> {
  if (isAuthDisabled()) return null;
  const localUser = await getLocalAccessUser(request.headers.get("host"), request.headers.get("origin"));
  if (localUser) return localUser;
  return getSessionUser(sessionCookieValue(request));
}

export function unauthorized() {
  return Response.json({ error: "未登录或会话已过期" }, { status: 401 });
}

export function forbidden() {
  return Response.json({ error: "没有权限执行此操作" }, { status: 403 });
}

/** 拒绝响应前排空请求体：不消费 body 的提前返回会污染 keep-alive 连接（Next 已知问题） */
async function drainRequestBody(request: Request) {
  try {
    await request.arrayBuffer();
  } catch {
    /* body 已不可读：直接返回拒绝响应 */
  }
}

/** 跨站写请求检查：Origin 存在且与请求主机不一致时拒绝（非浏览器客户端没有 Origin，放行） */
export function originMismatchForRequest(request: Request): boolean {
  const method = request.method.toUpperCase();
  if (method === "GET" || method === "HEAD" || method === "OPTIONS") return false;
  const origin = request.headers.get("origin");
  if (!origin) return false;
  try {
    return new URL(origin).host !== (request.headers.get("host") || new URL(request.url).host);
  } catch {
    return true;
  }
}

/**
 * 路由内身份守卫（POST/PUT/PATCH 等带 body 的请求统一使用）：
 * - 桌面端（鉴权关闭）直接放行，由路由保持本地行为；
 * - 未登录/会话无效 → 排空 body 后返回 401；
 * - 跨站 Origin 的写请求 → 排空 body 后返回 403。
 * 返回 null 表示通过。
 */
export async function denyIfUnauthenticated(request: Request): Promise<Response | null> {
  if (isAuthDisabled()) return null;
  if (originMismatchForRequest(request)) {
    await drainRequestBody(request);
    return forbidden();
  }
  const user = await getSessionUserFromRequest(request);
  if (!user) {
    await drainRequestBody(request);
    return unauthorized();
  }
  return null;
}

export type AdminGuard = AuthUserRecord | "unauthorized" | "forbidden" | "desktop";

/**
 * 管理员专用操作的统一守卫：
 * - 桌面端（鉴权关闭）返回 "desktop"，由调用方保持原有本地行为；
 * - 未登录/会话无效 → "unauthorized"（路由返回 401）；
 * - 已登录但不是管理员 → "forbidden"（路由返回 403）。
 */
export async function requireAdminFromRequest(request: Request): Promise<AdminGuard> {
  if (isAuthDisabled()) return "desktop";
  const user = await getSessionUserFromRequest(request);
  if (!user) {
    await drainRequestBody(request);
    return "unauthorized";
  }
  if (originMismatchForRequest(request)) {
    await drainRequestBody(request);
    return "forbidden";
  }
  if (user.role !== "admin") {
    await drainRequestBody(request);
    return "forbidden";
  }
  return user;
}

export function adminGuardFailure(guard: AdminGuard): Response | null {
  if (guard === "unauthorized") return unauthorized();
  if (guard === "forbidden") return forbidden();
  return null;
}
