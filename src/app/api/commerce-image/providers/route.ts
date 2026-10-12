import { NextResponse, type NextRequest } from "next/server";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  deleteCommerceImageProviderConfig,
  ensureCommerceImageDataRoot,
  isCommerceImageProvider,
  listCommerceImageProviderStatuses,
  markCommerceImageProviderVerified,
  modelForProvider,
  saveCommerceImageProviderConfig
} from "@/lib/commerce-image-config";
import { CommerceImageProviderError, verifyCommerceImageProvider } from "@/lib/commerce-image-provider";
import { readImageMetadata } from "@/lib/commerce-image-file";
import { forbidden, getSessionUserFromRequest, isAuthDisabled, unauthorized } from "@/lib/auth/guard";

export const runtime = "nodejs";

/**
 * 生图服务配置只属于管理员（老板）：
 *   - 网页版：仅 admin 可查看 / 保存 / 删除 / 测试连接，普通同事一律 403，
 *     Key 明文永远不出这台机器；
 *   - 桌面 App（DIRECTOR_WEB_AUTH_DISABLED=1）：行为与从前完全一致。
 * 局域网同事出图走的是生图生成链路（读服务端全局配置），不需要访问这些接口。
 */
async function requireAdmin(request: NextRequest): Promise<"ok" | "desktop" | "unauthorized" | "forbidden"> {
  if (isAuthDisabled()) return "desktop";
  const user = await getSessionUserFromRequest(request);
  if (!user) return "unauthorized";
  if (user.role !== "admin") return "forbidden";
  return "ok";
}

function authFailure(guard: "unauthorized" | "forbidden") {
  return guard === "unauthorized" ? unauthorized() : forbidden();
}

export async function GET(request: NextRequest) {
  const guard = await requireAdmin(request);
  if (guard === "unauthorized") return unauthorized();
  const statuses = await listCommerceImageProviderStatuses();
  /* 管理员与桌面端：完整状态（含 baseUrl / 模型 / 掩码 Key）。
   * 普通登录用户：只回服务可用状态（生图页的状态面板需要），不含任何连接信息。 */
  if (guard !== "ok" && guard !== "desktop") {
    return NextResponse.json({
      success: true,
      limited: true,
      providers: statuses.map((item) => ({
        provider: item.provider,
        label: item.label,
        configured: item.configured,
        verifiedForCurrentConfig: item.verifiedForCurrentConfig,
        message: item.message
      }))
    });
  }
  return NextResponse.json({ success: true, providers: statuses });
}

export async function PATCH(request: NextRequest) {
  const guard = await requireAdmin(request);
  if (guard !== "ok" && guard !== "desktop") return authFailure(guard);
  const body = await jsonBody(request);
  if (!body || !isCommerceImageProvider(body.provider)) return failure("请选择有效的生图服务。 ");
  if (body.apiKey !== undefined && typeof body.apiKey !== "string") return failure("API Key 格式不正确。 ");
  await saveCommerceImageProviderConfig(body.provider, {
    apiKey: typeof body.apiKey === "string" ? body.apiKey : undefined,
    workspaceId: typeof body.workspaceId === "string" ? body.workspaceId : undefined,
    baseUrl: typeof body.baseUrl === "string" ? body.baseUrl : undefined,
    modelId: typeof body.modelId === "string" ? body.modelId : undefined
  });
  return NextResponse.json({ success: true, providers: await listCommerceImageProviderStatuses(), message: "配置已保存到本机权限隔离目录，不会返回明文。" });
}

export async function POST(request: NextRequest) {
  const guard = await requireAdmin(request);
  if (guard !== "ok" && guard !== "desktop") return authFailure(guard);
  const body = await jsonBody(request);
  if (!body || !isCommerceImageProvider(body.provider)) return failure("请选择有效的生图服务。 ");
  await saveCommerceImageProviderConfig(body.provider, {
    apiKey: typeof body.apiKey === "string" ? body.apiKey : undefined,
    workspaceId: typeof body.workspaceId === "string" ? body.workspaceId : undefined,
    baseUrl: typeof body.baseUrl === "string" ? body.baseUrl : undefined,
    modelId: typeof body.modelId === "string" ? body.modelId : undefined
  });
  try {
    console.log(`[PROVIDER_TEST] provider=${body.provider} model=${body.modelId || "(stored)"} baseUrl=${body.baseUrl || "(stored)"}`);
    const result = await verifyCommerceImageProvider(modelForProvider(body.provider));
    const metadata = readImageMetadata(result.bytes);
    const directory = path.join(await ensureCommerceImageDataRoot(), "verification");
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const fileName = `${body.provider}-${Date.now()}${metadata.extension}`;
    await writeFile(path.join(directory, fileName), result.bytes, { mode: 0o600 });
    await markCommerceImageProviderVerified(body.provider);
    console.log(`[PROVIDER_TEST] SUCCESS provider=${body.provider} width=${metadata.width} height=${metadata.height}`);
    return NextResponse.json({
      success: true,
      providers: await listCommerceImageProviderStatuses(),
      verification: { provider: body.provider, providerModelId: result.providerModelId, width: metadata.width, height: metadata.height, fileName },
      message: `连接成功，测试图已生成并保存（${metadata.width} × ${metadata.height}）。`
    });
  } catch (error) {
    if (error instanceof CommerceImageProviderError) {
      console.log(`[PROVIDER_TEST] FAIL provider=${body.provider} status_code=${error.detail.code} category=${error.detail.category} message=${error.detail.message.slice(0, 300)}`);
      return NextResponse.json({ success: false, ...error.detail }, { status: 502 });
    }
    const msg = error instanceof Error ? error.message : "连接测试失败。";
    console.log(`[PROVIDER_TEST] FAIL provider=${body.provider} raw_error=${msg.slice(0, 300)}`);
    return failure(msg, 502);
  }
}

export async function DELETE(request: NextRequest) {
  const guard = await requireAdmin(request);
  if (guard !== "ok" && guard !== "desktop") return authFailure(guard);
  const provider = new URL(request.url).searchParams.get("provider");
  if (!isCommerceImageProvider(provider)) return failure("请选择有效的生图服务。 ");
  await deleteCommerceImageProviderConfig(provider);
  return NextResponse.json({ success: true, providers: await listCommerceImageProviderStatuses(), message: "本机保存的配置已删除；环境变量不会被修改。" });
}

async function jsonBody(request: Request): Promise<Record<string, unknown> | null> {
  try {
    const value = await request.json();
    return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

function failure(message: string, status = 400) {
  return NextResponse.json({ success: false, code: "IMAGE_PROVIDER_ERROR", category: status >= 500 ? "unknown" : "validation", retryable: false, message }, { status });
}
