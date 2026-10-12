import { NextResponse, type NextRequest } from "next/server";
import { isAuthDisabled, sessionCookieOptions, SESSION_COOKIE_NAME, createSessionToken } from "@/lib/auth/session";
import { authenticate, hasAnyUser, toPublicUser } from "@/lib/auth/users";
import { loginRateLimited, pruneLoginRateBuckets, registerLoginFailure, clearLoginFailures, trustedClientIp } from "@/lib/auth/rate-limit";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  if (isAuthDisabled()) {
    return NextResponse.json({ error: "桌面模式无需登录" }, { status: 400 });
  }
  let body: { username?: string; password?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "请求格式错误" }, { status: 400 });
  }

  const username = (body.username || "").trim();
  const password = body.password || "";
  if (!username || !password) {
    return NextResponse.json({ error: "请输入用户名和密码" }, { status: 400 });
  }
  if (!(await hasAnyUser())) {
    return NextResponse.json({ error: "系统尚未初始化", code: "NOT_INITIALIZED" }, { status: 409 });
  }

  // 登录失败限速：按用户名（+ 可信代理时的 IP）。被限速时不进入密码校验。
  pruneLoginRateBuckets();
  const rateKey = { username, ip: trustedClientIp(request) };
  const limited = loginRateLimited(rateKey);
  if (limited.blocked) {
    return NextResponse.json(
      { error: `失败次数过多，请 ${Math.ceil(limited.retryAfterSeconds / 60)} 分钟后再试` },
      { status: 429, headers: { "Retry-After": String(limited.retryAfterSeconds) } }
    );
  }

  const user = await authenticate(username, password);
  if (!user) {
    registerLoginFailure(rateKey);
    return NextResponse.json({ error: "用户名或密码不正确，或账号已被停用" }, { status: 401 });
  }
  clearLoginFailures(rateKey);
  const response = NextResponse.json({ user: toPublicUser(user) });
  response.cookies.set(SESSION_COOKIE_NAME, await createSessionToken(user), sessionCookieOptions());
  return response;
}
