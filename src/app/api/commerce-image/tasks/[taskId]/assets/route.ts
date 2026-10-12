import { denyIfUnauthenticated } from "@/lib/auth/guard";
import { NextResponse } from "next/server";
import { persistCommerceImageSource, removeCommerceImageSource, toPublicCommerceImageTask } from "@/lib/commerce-image-store";
import type { CommerceImageAssetRole } from "@/lib/commerce-image-types";

export const runtime = "nodejs";

const maxImageBytes = 25 * 1024 * 1024;
const allowedTypes = new Set(["image/png", "image/jpeg", "image/webp"]);

export async function POST(request: Request, context: { params: Promise<{ taskId: string }> }) {
  const deny = await denyIfUnauthenticated(request);
  if (deny) return deny;
  const { taskId } = await context.params;
  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return failure("上传请求格式不正确。 ");
  }
  const files = formData.getAll("images").filter((item): item is File => item instanceof File);
  if (!files.length) return failure("请先选择商品参考图。 ");
  const role = roleValue(formData.get("role"));
  const saveToProductProfile = formData.get("saveToProductProfile") !== "false";
  let latest = null;
  for (const file of files) {
    if (!allowedTypes.has(file.type)) return failure(`${file.name} 不是支持的 PNG、JPG 或 WEBP 图片。`);
    if (file.size <= 0 || file.size > maxImageBytes) return failure(`${file.name} 为空或超过 25MB。`);
    try {
      const stored = await persistCommerceImageSource({
        taskId,
        bytes: new Uint8Array(await file.arrayBuffer()),
        name: file.name,
        role,
        saveToProductProfile
      });
      latest = stored.task;
    } catch (error) {
      return failure(error instanceof Error ? error.message : "商品图保存失败。", 422);
    }
  }
  return NextResponse.json({ success: true, task: latest ? toPublicCommerceImageTask(latest) : null, message: `已上传 ${files.length} 张参考图。` });
}

export async function DELETE(request: Request, context: { params: Promise<{ taskId: string }> }) {
  const deny = await denyIfUnauthenticated(request);
  if (deny) return deny;
  const { taskId } = await context.params;
  const assetId = new URL(request.url).searchParams.get("assetId") || "";
  const task = await removeCommerceImageSource(taskId, assetId);
  if (!task) return failure("没有找到要删除的参考图。", 404);
  return NextResponse.json({ success: true, task: toPublicCommerceImageTask(task) });
}

function roleValue(value: FormDataEntryValue | null): CommerceImageAssetRole {
  const roles: CommerceImageAssetRole[] = ["front", "side", "back", "detail", "package", "logo", "on_body", "benchmark_reference", "style_reference", "other"];
  return typeof value === "string" && roles.includes(value as CommerceImageAssetRole) ? value as CommerceImageAssetRole : "front";
}

function failure(message: string, status = 400) {
  return NextResponse.json({ success: false, code: "ASSET_ERROR", category: "validation", retryable: false, message }, { status });
}
