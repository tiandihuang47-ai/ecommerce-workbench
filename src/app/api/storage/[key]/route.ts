import { NextResponse, type NextRequest } from "next/server";
import { forbidden, unauthorized } from "@/lib/auth/guard";
import {
  deleteUserStorageValue,
  readUserStorageEntry,
  resolveScopedUserId,
  WEB_STORAGE_KEY_PATTERN,
  WEB_STORAGE_VALUE_LIMIT,
  writeUserStorageValue
} from "@/lib/server/user-data";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ key: string }> };

/**
 * 按登录用户隔离的键值存储（网页端 store 数据落在服务器，桌面端不经过这里）。
 *
 * 语义约定（客户端迁移与冲突检测依赖这些状态码）：
 * - GET 200 → { value, version, updatedAt }；服务器没有该记录 → 404（不是空串）；
 * - PUT 原始字符串 body；可选 If-Match 头携带期望版本，不匹配 → 409 { version }；
 *   成功 → { ok, version }；
 * - DELETE 删除该键。
 */
export async function GET(request: NextRequest, context: RouteContext) {
  const userId = await resolveScopedUserId(request);
  if (userId === null) return unauthorized();
  const { key } = await context.params;
  if (!WEB_STORAGE_KEY_PATTERN.test(key)) {
    return NextResponse.json({ error: "非法的存储键" }, { status: 400 });
  }
  const entry = await readUserStorageEntry(userId, key);
  if (!entry) {
    return NextResponse.json({ error: "该记录不存在" }, { status: 404 });
  }
  return NextResponse.json(entry);
}

export async function PUT(request: NextRequest, context: RouteContext) {
  const userId = await resolveScopedUserId(request);
  if (userId === null) {
    // 排空请求体：避免未消费 body 的提前 401 污染 keep-alive 连接
    await request.arrayBuffer().catch(() => undefined);
    return unauthorized();
  }
  const { key } = await context.params;
  if (!WEB_STORAGE_KEY_PATTERN.test(key)) {
    return NextResponse.json({ error: "非法的存储键" }, { status: 400 });
  }
  const raw = await request.text();
  if (raw.length > WEB_STORAGE_VALUE_LIMIT) {
    return NextResponse.json({ error: "内容过大，无法保存" }, { status: 413 });
  }
  const ifMatch = request.headers.get("if-match");
  const expectedVersion = ifMatch !== null && ifMatch.trim() !== "" ? Number(ifMatch) : null;
  if (expectedVersion !== null && !Number.isFinite(expectedVersion)) {
    return NextResponse.json({ error: "If-Match 版本号不合法" }, { status: 400 });
  }
  try {
    const entry = await writeUserStorageValue(userId, key, raw, { expectedVersion });
    return NextResponse.json({ ok: true, version: entry.version, updatedAt: entry.updatedAt });
  } catch (error) {
    if (error instanceof Error && error.name === "VersionConflictError") {
      const conflict = (error as { current?: { version?: number; updatedAt?: string } }).current;
      return NextResponse.json(
        { error: error.message, version: conflict?.version ?? 0, updatedAt: conflict?.updatedAt ?? "" },
        { status: 409 }
      );
    }
    throw error;
  }
}

export async function DELETE(request: NextRequest, context: RouteContext) {
  const userId = await resolveScopedUserId(request);
  if (userId === null) {
    // 桌面端调用（不该发生）：直接拒绝，避免误删本地数据
    return forbidden();
  }
  const { key } = await context.params;
  if (!WEB_STORAGE_KEY_PATTERN.test(key)) {
    return NextResponse.json({ error: "非法的存储键" }, { status: 400 });
  }
  await deleteUserStorageValue(userId, key);
  return NextResponse.json({ ok: true });
}
