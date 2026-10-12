import { NextResponse, type NextRequest } from "next/server";
import { adminGuardFailure, requireAdminFromRequest } from "@/lib/auth/guard";
import { deleteUser, findUserById, toPublicUser, updateUser, validatePassword } from "@/lib/auth/users";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ id: string }> };

export async function PATCH(request: NextRequest, context: RouteContext) {
  const admin = await requireAdminFromRequest(request);
  const adminFailure = await adminGuardFailure(admin);
  if (adminFailure) return adminFailure;

  const { id } = await context.params;
  let body: { nickname?: string; password?: string; status?: string; role?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "请求格式错误" }, { status: 400 });
  }

  if (!(await findUserById(id))) {
    return NextResponse.json({ error: "账号不存在" }, { status: 404 });
  }

  const passwordError = body.password ? validatePassword(body.password) : null;
  if (passwordError) return NextResponse.json({ error: passwordError }, { status: 400 });
  if (body.status && body.status !== "active" && body.status !== "disabled") {
    return NextResponse.json({ error: "状态参数错误" }, { status: 400 });
  }
  if (body.role && body.role !== "admin" && body.role !== "user") {
    return NextResponse.json({ error: "角色参数错误" }, { status: 400 });
  }
  if (id === (admin as { id: string }).id && body.status === "disabled") {
    return NextResponse.json({ error: "不能停用自己的账号" }, { status: 400 });
  }

  try {
    const user = await updateUser(id, {
      nickname: body.nickname,
      password: body.password || undefined,
      status: body.status === "active" || body.status === "disabled" ? body.status : undefined,
      role: body.role === "admin" || body.role === "user" ? body.role : undefined
    });
    return NextResponse.json({ user: toPublicUser(user) });
  } catch (error) {
    if ((error as Error).message === "LAST_ADMIN") {
      return NextResponse.json({ error: "至少需要保留一个可用的管理员账号" }, { status: 400 });
    }
    console.error("[admin/users] 更新账号失败:", error);
    return NextResponse.json({ error: "更新失败，请重试" }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest, context: RouteContext) {
  const admin = await requireAdminFromRequest(request);
  const adminFailure = await adminGuardFailure(admin);
  if (adminFailure) return adminFailure;

  const { id } = await context.params;
  if (id === (admin as { id: string }).id) {
    return NextResponse.json({ error: "不能删除自己的账号" }, { status: 400 });
  }

  try {
    await deleteUser(id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    if ((error as Error).message === "USER_NOT_FOUND") {
      return NextResponse.json({ error: "账号不存在" }, { status: 404 });
    }
    if ((error as Error).message === "LAST_ADMIN") {
      return NextResponse.json({ error: "至少需要保留一个管理员账号" }, { status: 400 });
    }
    console.error("[admin/users] 删除账号失败:", error);
    return NextResponse.json({ error: "删除失败，请重试" }, { status: 500 });
  }
}
