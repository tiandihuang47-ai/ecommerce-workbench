import { denyIfUnauthenticated } from "@/lib/auth/guard";
import { NextResponse } from "next/server";
import { exportV4PanelPng, exportV4Zip } from "@/lib/commerce-image-v4-export";

export const runtime = "nodejs";

export async function GET(request: Request, context: { params: Promise<{ taskId: string }> }) {
  const deny = await denyIfUnauthenticated(request);
  if (deny) return deny;
  const { taskId } = await context.params;
  try {
    const url = new URL(request.url);
    const panelId = url.searchParams.get("panelId");
    const planId = url.searchParams.get("planId") || undefined;
    if (panelId) {
      const result = await exportV4PanelPng({ taskId, panelId, planId });
      return new Response(result.bytes as unknown as BodyInit, {
        headers: {
          "Content-Type": result.mimeType,
          "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(result.fileName)}`
        }
      });
    }
    const result = await exportV4Zip({ taskId, planId });
    return new Response(result.bytes as unknown as BodyInit, {
      headers: {
        "Content-Type": result.mimeType,
        "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(result.fileName)}`
      }
    });
  } catch (error) {
    return NextResponse.json({ success: false, message: error instanceof Error ? error.message : "导出失败。" }, { status: 400 });
  }
}
