import { denyIfUnauthenticated } from "@/lib/auth/guard";
import { NextResponse } from "next/server";
import { deleteProductImage, isProductId } from "@/lib/product-asset-store";

export const runtime = "nodejs";

/** 从产品里删除一张商品图片（磁盘文件与档案由调用方同步更新）。 */
export async function DELETE(request: Request, context: { params: Promise<{ productId: string; assetId: string }> }) {
  const deny = await denyIfUnauthenticated(request);
  if (deny) return deny;
  const { productId, assetId } = await context.params;
  if (!isProductId(productId)) return NextResponse.json({ success: false, message: "产品不存在。" }, { status: 404 });
  await deleteProductImage(productId, assetId);
  return NextResponse.json({ success: true, message: "图片已删除。" });
}
