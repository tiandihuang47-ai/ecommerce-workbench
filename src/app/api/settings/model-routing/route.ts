import { denyIfUnauthenticated } from "@/lib/auth/guard";
import { NextResponse } from "next/server";
import { listRouteOverview, validateModelRouting } from "@/lib/model-router";

export const runtime = "nodejs";

/**
 * 模型路由总览（只读）。
 *
 * 返回每个业务功能当前解析到的模型 / Provider / 需要哪个环境变量，
 * 以及配置校验结果。不会返回任何 API Key 的值。
 */
export async function GET(request: Request) {
  const deny = await denyIfUnauthenticated(request);
  if (deny) return deny;
  try {
    const validation = validateModelRouting();
    const routes = listRouteOverview();
    return NextResponse.json({
      success: true,
      source: "config/model-routing.yaml + config/models.yaml",
      validation,
      routes: routes.map((route) => ({
        routeKey: route.routeKey,
        label: route.label,
        capability: route.capability,
        modelAlias: route.modelAlias,
        modelId: route.modelId,
        provider: route.providerLabel,
        providerName: route.providerName,
        protocol: route.protocol,
        apiKeyEnv: route.apiKeyEnv,
        configured: route.configured,
        fallback: route.fallbackAlias || "none"
      }))
    });
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        message: error instanceof Error ? error.message : "模型路由配置读取失败。"
      },
      { status: 500 }
    );
  }
}
