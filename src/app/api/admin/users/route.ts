import { NextResponse, type NextRequest } from "next/server";
import { adminGuardFailure, requireAdminFromRequest } from "@/lib/auth/guard";
import { createUser, listUsers, toPublicUser, validatePassword, validateUsername } from "@/lib/auth/users";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const adminFailure = await adminGuardFailure(await requireAdminFromRequest(request));
  if (adminFailure) return adminFailure;
  const users = await listUsers();
  return NextResponse.json({ users: users.map(toPublicUser) });
}

export async function POST(request: NextRequest) {
  const adminFailure = await adminGuardFailure(await requireAdminFromRequest(request));
  if (adminFailure) return adminFailure;

  let body: { username?: string; password?: string; nickname?: string; role?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "请求格式错误" }, { status: 400 });
  }

  const username = (body.username || "").trim();
  const password = body.password || "";
  const role = body.role === "admin" ? "admin" : "user";

  const usernameError = validateUsername(username);
  if (usernameError) return NextResponse.json({ error: usernameError }, { status: 400 });
  const passwordError = validatePassword(password);
  if (passwordError) return NextResponse.json({ error: passwordError }, { status: 400 });

  try {
    const user = await createUser({ username, password, nickname: body.nickname, role });
    return NextResponse.json({ user: toPublicUser(user) });
  } catch (error) {
    if ((error as Error).message === "USERNAME_TAKEN") {
      return NextResponse.json({ error: "用户名已被占用" }, { status: 409 });
    }
    console.error("[admin/users] 创建账号失败:", error);
    return NextResponse.json({ error: "创建账号失败，请重试" }, { status: 500 });
  }
}
