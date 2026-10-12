import { denyIfUnauthenticated } from "@/lib/auth/guard";
import { NextResponse } from "next/server";
import { readProductImage } from "@/lib/product-asset-store";

export const runtime = "nodejs";

/** 读取产品图片字节。variant=thumb 时返回列表用缩略图。 */
export async function GET(request: Request) {
  const deny = await denyIfUnauthenticated(request);
  if (deny) return deny;
  const url = new URL(request.url);
  const productId = url.searchParams.get("productId") || "";
  const assetId = url.searchParams.get("assetId") || "";
  const variant = url.searchParams.get("variant") === "thumb" ? "thumb" : "full";
  const resolved = await readProductImage(productId, assetId, variant);
  if (!resolved) {
    return NextResponse.json({ success: false, message: "这张产品图片不存在或已被删除。" }, { status: 404 });
  }
  return new Response(new Uint8Array(resolved.bytes), {
    headers: {
      "Content-Type": resolved.mimeType,
      "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(resolved.name)}`,
      "Cache-Control": "private, max-age=300",
      "X-Content-Type-Options": "nosniff"
    }
  });
}
