import { denyIfUnauthenticated } from "@/lib/auth/guard";
import { NextResponse } from "next/server";
import { readProductDocumentFile } from "@/lib/product-asset-store";

export const runtime = "nodejs";

/** 下载产品绑定的那一份资料原文件。 */
export async function GET(request: Request) {
  const deny = await denyIfUnauthenticated(request);
  if (deny) return deny;
  const url = new URL(request.url);
  const productId = url.searchParams.get("productId") || "";
  const documentId = url.searchParams.get("documentId") || "";
  const resolved = await readProductDocumentFile(productId, documentId);
  if (!resolved) {
    return NextResponse.json({ success: false, message: "产品资料文件不存在或已被替换。" }, { status: 404 });
  }
  return new Response(new Uint8Array(resolved.bytes), {
    headers: {
      "Content-Type": "application/octet-stream",
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(resolved.name)}`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff"
    }
  });
}
