import { denyIfUnauthenticated } from "@/lib/auth/guard";
import { readFile } from "node:fs/promises";
import { NextResponse } from "next/server";
import { resolveCommerceImageAsset } from "@/lib/commerce-image-store";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const deny = await denyIfUnauthenticated(request);
  if (deny) return deny;
  const url = new URL(request.url);
  const taskId = url.searchParams.get("taskId") || "";
  const assetId = url.searchParams.get("assetId") || "";
  const asset = await resolveCommerceImageAsset(taskId, assetId);
  if (!asset) return NextResponse.json({ success: false, code: "ASSET_NOT_FOUND", category: "validation", retryable: false, message: "图片不存在。" }, { status: 404 });
  try {
    const bytes = await readFile(asset.path);
    return new Response(bytes, {
      headers: {
        "Content-Type": asset.mimeType,
        "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(asset.name)}`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff"
      }
    });
  } catch {
    return NextResponse.json({ success: false, code: "ASSET_FILE_MISSING", category: "validation", retryable: false, message: "图片文件已丢失。" }, { status: 404 });
  }
}
