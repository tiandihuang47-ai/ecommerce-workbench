import { denyIfUnauthenticated } from "@/lib/auth/guard";
import { NextResponse } from "next/server";
import { countProductImages, isProductId, saveProductImage } from "@/lib/product-asset-store";
import { PRODUCT_IMAGE_LIMIT, normalizeProductImageRole, productAssetUrl, type ProductImageAsset } from "@/lib/product-assets-types";

export const runtime = "nodejs";

const maxImageBytes = 25 * 1024 * 1024;
const allowedTypes = new Set(["image/png", "image/jpeg", "image/webp"]);

/** 给产品追加商品图片。一个产品最多 50 张，超出直接拒绝，不静默丢图。 */
export async function POST(request: Request, context: { params: Promise<{ productId: string }> }) {
  const deny = await denyIfUnauthenticated(request);
  if (deny) return deny;
  const { productId } = await context.params;
  if (!isProductId(productId)) return failure("产品不存在。", 404);

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return failure("上传请求格式不正确，请重新选择图片。");
  }

  const files = formData.getAll("images").filter((item): item is File => item instanceof File);
  if (!files.length) return failure("请先选择要上传的商品图片。");

  const existingCount = await countProductImages(productId);
  if (existingCount + files.length > PRODUCT_IMAGE_LIMIT) {
    return failure(`这个产品已经有 ${existingCount} 张图片，最多只能放 ${PRODUCT_IMAGE_LIMIT} 张；本次最多还能再加 ${Math.max(0, PRODUCT_IMAGE_LIMIT - existingCount)} 张。`, 422, "IMAGE_LIMIT_REACHED");
  }

  const role = normalizeProductImageRole(formData.get("role"));
  const saved: ProductImageAsset[] = [];
  for (const file of files) {
    if (!allowedTypes.has(file.type)) return failure(`${file.name} 不是支持的 PNG、JPG 或 WEBP 图片。`, 422, "UNSUPPORTED_IMAGE_TYPE");
    if (file.size <= 0 || file.size > maxImageBytes) return failure(`${file.name} 为空或超过 25MB。`, 422, "IMAGE_TOO_LARGE");
    try {
      const asset = await saveProductImage({ productId, bytes: new Uint8Array(await file.arrayBuffer()), name: file.name, role });
      saved.push({
        ...asset,
        url: productAssetUrl(productId, asset.id, "full"),
        thumbUrl: productAssetUrl(productId, asset.id, "thumb")
      });
    } catch (error) {
      return failure(error instanceof Error ? error.message : "图片保存失败。", 422, "IMAGE_SAVE_FAILED");
    }
  }

  return NextResponse.json({
    success: true,
    images: saved,
    total: existingCount + saved.length,
    limit: PRODUCT_IMAGE_LIMIT,
    message: `已添加 ${saved.length} 张商品图。`
  });
}

function failure(message: string, status = 400, code = "PRODUCT_IMAGE_ERROR") {
  return NextResponse.json({ success: false, code, message }, { status });
}
