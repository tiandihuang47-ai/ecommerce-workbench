import { NextResponse, type NextRequest } from "next/server";
import { isAuthDisabled, sessionCookieOptions, SESSION_COOKIE_NAME, createSessionToken } from "@/lib/auth/session";
import { createFirstAdmin, hasAnyUser, toPublicUser, validatePassword, validateUsername } from "@/lib/auth/users";

export const runtime = "nodejs";

/** 首次初始化：仅在系统中还没有任何账号时允许创建管理员 */
export async function POST(request: NextRequest) {
  if (isAuthDisabled()) {
    return NextResponse.json({ error: "桌面模式无需初始化" }, { status: 400 });
  }
  let body: { username?: string; password?: string; nickname?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "请求格式错误" }, { status: 400 });
  }

  const username = (body.username || "").trim();
  const password = body.password || "";
  const nickname = (body.nickname || "").trim();

  if (await hasAnyUser()) {
    return NextResponse.json({ error: "系统已初始化，请直接登录" }, { status: 409 });
  }
  const usernameError = validateUsername(username);
  if (usernameError) return NextResponse.json({ error: usernameError }, { status: 400 });
  const passwordError = validatePassword(password);
  if (passwordError) return NextResponse.json({ error: passwordError }, { status: 400 });

  try {
    // createFirstAdmin 把“还没有账号”的判断放进写入队列内，并发初始化只会成功一次
    const admin = await createFirstAdmin({ username, password, nickname: nickname || "管理员", role: "admin" });
    const response = NextResponse.json({ user: toPublicUser(admin) });
    response.cookies.set(SESSION_COOKIE_NAME, await createSessionToken(admin), sessionCookieOptions());
    return response;
  } catch (error) {
    if ((error as Error).message === "USERNAME_TAKEN") {
      return NextResponse.json({ error: "用户名已被占用" }, { status: 409 });
    }
    if ((error as Error).message === "ALREADY_INITIALIZED") {
      return NextResponse.json({ error: "系统已初始化，请直接登录" }, { status: 409 });
    }
    console.error("[auth/setup] 初始化失败:", error);
    return NextResponse.json({ error: "初始化失败，请重试" }, { status: 500 });
  }
}
