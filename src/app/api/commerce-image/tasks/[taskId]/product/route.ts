import { denyIfUnauthenticated } from "@/lib/auth/guard";
import { NextResponse } from "next/server";
import { attachProductToTask } from "@/lib/commerce-image-store";
import { getCommerceImageTask, toPublicCommerceImageTask } from "@/lib/commerce-image-store";
import { isCommerceImageTaskRunning } from "@/lib/commerce-image-runner";

export const runtime = "nodejs";

type ProductPayload = {
  id?: unknown;
  name?: unknown;
  brandName?: unknown;
  category?: unknown;
  documentId?: unknown;
  documentName?: unknown;
  documentRevision?: unknown;
  documentUpdatedAt?: unknown;
  documentText?: unknown;
  referenceText?: unknown;
  facts?: unknown;
  images?: unknown;
};

/**
 * 把「已有产品」挂到当前生图任务：
 * 复制选中的商品图到任务目录 + 固化产品资料快照 + 写入产品事实。
 */
export async function POST(request: Request, context: { params: Promise<{ taskId: string }> }) {
  const deny = await denyIfUnauthenticated(request);
  if (deny) return deny;
  const { taskId } = await context.params;
  const task = await getCommerceImageTask(taskId);
  if (!task) return failure("生图项目不存在。", 404);
  if (isCommerceImageTaskRunning(taskId)) return failure("任务正在生成图片，暂时不能更换产品。", 409);

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return failure("请求体必须是合法 JSON。");
  }

  const product = recordValue(body.product);
  const productId = stringValue(product.id, 120);
  if (!productId) return failure("请先选择产品。");

  const mode = body.mode === "selected" ? "selected" : "all";
  const selectedImageIds = Array.isArray(body.selectedImageIds)
    ? body.selectedImageIds.filter((item): item is string => typeof item === "string")
    : [];

  const images = Array.isArray(product.images)
    ? product.images.filter(isRecord).map((image) => ({
      id: stringValue(image.id, 120),
      role: stringValue(image.role, 40),
      name: stringValue(image.name, 200)
    })).filter((image) => image.id)
    : [];
  if (!images.length) return failure("这个产品还没有商品图片，请先在产品资料里上传。");

  if (mode === "selected" && !selectedImageIds.length) return failure("请至少勾选一张本次要用的商品图片。");

  const facts = Array.isArray(product.facts)
    ? product.facts.filter(isRecord).map((fact) => ({
      label: stringValue(fact.label, 60) || "产品信息",
      value: stringValue(fact.value, 2000)
    })).filter((fact) => fact.value)
    : [];

  try {
    const updated = await attachProductToTask({
      taskId,
      product: {
        id: productId,
        name: stringValue(product.name, 200) || "未命名产品",
        brandName: stringValue(product.brandName, 200),
        category: stringValue(product.category, 200),
        documentId: stringValue(product.documentId, 120),
        documentName: stringValue(product.documentName, 200),
        documentRevision: Number(product.documentRevision) || 0,
        documentUpdatedAt: stringValue(product.documentUpdatedAt, 60),
        documentText: typeof product.documentText === "string" ? product.documentText : "",
        referenceText: typeof product.referenceText === "string" ? product.referenceText : "",
        facts,
        images
      },
      mode,
      selectedImageIds
    });
    return NextResponse.json({
      success: true,
      task: toPublicCommerceImageTask(updated),
      message: `已使用产品「${updated.productName}」，本次参考 ${updated.productImageSelection?.attachedAssetIds.length || 0} 张商品图。`
    });
  } catch (error) {
    return failure(error instanceof Error ? error.message : "应用产品失败，请重试。", 422);
  }
}

/** 取消当前任务对产品的引用（不动产品本身，也不删已复制的图片）。 */
export async function DELETE(request: Request, context: { params: Promise<{ taskId: string }> }) {
  const deny = await denyIfUnauthenticated(request);
  if (deny) return deny;
  const { taskId } = await context.params;
  const task = await getCommerceImageTask(taskId);
  if (!task) return failure("生图项目不存在。", 404);
  if (isCommerceImageTaskRunning(taskId)) return failure("任务正在生成图片，暂时不能更换产品。", 409);
  const { saveCommerceImageTask } = await import("@/lib/commerce-image-store");
  const saved = await saveCommerceImageTask({
    ...task,
    productId: "",
    productName: "",
    productSnapshot: undefined,
    productAssetSnapshot: undefined,
    productImageSelection: undefined,
    approvedAt: "",
    approvedPlanRevision: 0,
    planRevision: task.planRevision + 1
  });
  return NextResponse.json({ success: true, task: toPublicCommerceImageTask(saved), message: "已取消产品引用。" });
}

function recordValue(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function stringValue(value: unknown, max: number) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function failure(message: string, status = 400) {
  return NextResponse.json({ success: false, code: "PRODUCT_ATTACH_ERROR", message }, { status });
}
