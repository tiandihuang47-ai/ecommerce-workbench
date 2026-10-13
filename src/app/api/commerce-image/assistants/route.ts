import { adminGuardFailure, denyIfUnauthenticated, requireAdminFromRequest } from "@/lib/auth/guard";
import { NextResponse } from "next/server";
import {
  deleteCommerceAssistantConfig,
  isCommerceAssistantProvider,
  listCommerceAssistantStatuses,
  markCommerceAssistantVerified,
  saveCommerceAssistantConfig
} from "@/lib/commerce-image-config";
import { verifyCommerceAssistant } from "@/lib/commerce-image-ai";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const deny = await denyIfUnauthenticated(request);
  if (deny) return deny;
  return NextResponse.json({ success: true, providers: await listCommerceAssistantStatuses() });
}

export async function PATCH(request: Request) {
  const adminFailure = await adminGuardFailure(await requireAdminFromRequest(request));
  if (adminFailure) return adminFailure;
  const body = await jsonBody(request);
  if (!body || !isCommerceAssistantProvider(body.provider)) return failure("请选择有效的 AI 理解服务。");
  await saveCommerceAssistantConfig(body.provider, {
    apiKey: stringValue(body.apiKey),
    baseUrl: stringValue(body.baseUrl),
    modelId: stringValue(body.modelId)
  });
  return NextResponse.json({ success: true, providers: await listCommerceAssistantStatuses(), message: "AI 理解配置已安全保存到本机。" });
}

export async function POST(request: Request) {
  const adminFailure = await adminGuardFailure(await requireAdminFromRequest(request));
  if (adminFailure) return adminFailure;
  const body = await jsonBody(request);
  if (!body || !isCommerceAssistantProvider(body.provider)) return failure("请选择有效的 AI 理解服务。");
  await saveCommerceAssistantConfig(body.provider, {
    apiKey: stringValue(body.apiKey),
    baseUrl: stringValue(body.baseUrl),
    modelId: stringValue(body.modelId)
  });
  try {
    await verifyCommerceAssistant(body.provider);
    await markCommerceAssistantVerified(body.provider);
    return NextResponse.json({ success: true, providers: await listCommerceAssistantStatuses(), message: "连接验证成功。" });
  } catch (error) {
    return failure(error instanceof Error ? error.message : "连接测试失败。", 502);
  }
}

export async function DELETE(request: Request) {
  const adminFailure = await adminGuardFailure(await requireAdminFromRequest(request));
  if (adminFailure) return adminFailure;
  const provider = new URL(request.url).searchParams.get("provider");
  if (!isCommerceAssistantProvider(provider)) return failure("请选择有效的 AI 理解服务。");
  await deleteCommerceAssistantConfig(provider);
  return NextResponse.json({ success: true, providers: await listCommerceAssistantStatuses(), message: "本机配置已删除；环境变量不会被修改。" });
}

async function jsonBody(request: Request): Promise<Record<string, unknown> | null> {
  try {
    const value = await request.json();
    return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value.trim() : undefined;
}

function failure(message: string, status = 400) {
  return NextResponse.json({ success: false, code: "AI_PROVIDER_ERROR", category: "configuration", retryable: false, message }, { status });
}
