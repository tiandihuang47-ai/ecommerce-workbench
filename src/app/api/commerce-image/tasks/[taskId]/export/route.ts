import { denyIfUnauthenticated } from "@/lib/auth/guard";
import { NextResponse } from "next/server";
import { exportCommerceImageTask } from "@/lib/commerce-image-export";

export const runtime = "nodejs";

export async function GET(request: Request, context: { params: Promise<{ taskId: string }> }) {
  const deny = await denyIfUnauthenticated(request);
  if (deny) return deny;
  const { taskId } = await context.params;
  const search = new URL(request.url).searchParams;
  const formatValue = search.get("format");
  const format = formatValue === "long" || formatValue === "panel" ? formatValue : "zip";
  try {
    const result = await exportCommerceImageTask({
      taskId,
      setId: search.get("setId") || undefined,
      panelId: search.get("panelId") || undefined,
      format
    });
    return new Response(Uint8Array.from(result.bytes).buffer, {
      headers: {
        "Content-Type": result.mimeType,
        "Content-Disposition": `attachment; filename="commerce-image.${format === "zip" ? "zip" : "png"}"; filename*=UTF-8''${encodeURIComponent(result.fileName)}`,
        "Cache-Control": "no-store"
      }
    });
  } catch (error) {
    return NextResponse.json({ success: false, code: "EXPORT_ERROR", category: "validation", retryable: false, message: error instanceof Error ? error.message : "导出失败。" }, { status: 400 });
  }
}
