import { NextResponse, type NextRequest } from "next/server";
import { unauthorized, denyIfUnauthenticated } from "@/lib/auth/guard";
import { resolveScopedUserId } from "@/lib/server/user-data";
import {
  BATCH_MAX_ITEMS,
  BatchRequestConflictError,
  createBatch,
  hashBatchInput,
  listUserBatches
} from "@/lib/transcript-batch/service";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * 批量逐字稿批次：
 * - POST：创建批次（requestId 幂等；同 requestId 不同内容 → 409）。桌面端（鉴权关闭）落到本机共享目录。
 * - GET：最近批次列表（网页端按账号隔离）。
 */
export async function POST(request: NextRequest) {
  const deny = await denyIfUnauthenticated(request);
  if (deny) return deny;
  const userScope = await resolveBatchScope(request);
  if (userScope === null) return unauthorized();

  let body: { requestId?: unknown; links?: unknown; rawInput?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ success: false, message: "请求体必须是合法 JSON。" }, { status: 400 });
  }

  const links = Array.isArray(body.links)
    ? body.links.filter((link): link is string => typeof link === "string").map((link) => link.trim()).filter(Boolean)
    : [];
  const rawInput = typeof body.rawInput === "string" ? body.rawInput : links.join("\n");

  if (links.length === 0) {
    return NextResponse.json({ success: false, message: "没有识别到抖音链接，请粘贴视频链接或分享文案。" }, { status: 400 });
  }
  if (links.length > BATCH_MAX_ITEMS) {
    return NextResponse.json(
      { success: false, message: `一次最多处理 ${BATCH_MAX_ITEMS} 条链接，本次有 ${links.length} 条，请分批提交。` },
      { status: 400 }
    );
  }

  try {
    const result = await createBatch({
      requestId: String(body.requestId || hashBatchInput(links.map((link) => ({ link })))),
      links,
      rawInput,
      userScope
    });
    return NextResponse.json({
      success: true,
      existing: result.kind === "existing",
      duplicatesRemoved: result.kind === "created" ? result.duplicatesRemoved : 0,
      batch: result.batch
    });
  } catch (error) {
    if (error instanceof BatchRequestConflictError) {
      return NextResponse.json({ success: false, message: error.message }, { status: 409 });
    }
    console.error("[transcript-batch] 创建批次失败:", error);
    return NextResponse.json({ success: false, message: "创建批量任务失败，请重试。" }, { status: 500 });
  }
}

export async function GET(request: NextRequest) {
  const deny = await denyIfUnauthenticated(request);
  if (deny) return deny;
  const userScope = await resolveBatchScope(request);
  if (userScope === null) return unauthorized();
  const batches = await listUserBatches(userScope, 20);
  return NextResponse.json({ success: true, batches });
}

/** 桌面端（鉴权关闭）返回 "desktop"（本机共享目录）；未登录返回 null（401）。 */
async function resolveBatchScope(request: NextRequest): Promise<string | null> {
  const scoped = await resolveScopedUserId(request);
  return scoped ?? (process.env.DIRECTOR_WEB_AUTH_DISABLED === "1" ? "desktop" : null);
}
