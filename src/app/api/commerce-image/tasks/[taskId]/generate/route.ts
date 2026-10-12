import { denyIfUnauthenticated } from "@/lib/auth/guard";
import { NextResponse } from "next/server";
import { getCommerceImageTask, saveCommerceImageTask, toPublicCommerceImageTask } from "@/lib/commerce-image-store";
import { isCommerceImageTaskRunning, startCommerceImageTask } from "@/lib/commerce-image-runner";

export const runtime = "nodejs";

export async function POST(request: Request, context: { params: Promise<{ taskId: string }> }) {
  const deny = await denyIfUnauthenticated(request);
  if (deny) return deny;
  const { taskId } = await context.params;
  const task = await getCommerceImageTask(taskId);
  if (!task) return failure("生图项目不存在。", 404, "TASK_NOT_FOUND");
  if (!task.sourceAssets.some((asset) => !["benchmark_reference", "reference_segment", "style_reference", "skill_reference"].includes(asset.role))) return failure("请至少上传 1 张真实商品参考图。", 400, "PRODUCT_REFERENCE_REQUIRED");
  if (task.kind === "detail_page" && !task.sourceAssets.some((asset) => asset.role === "benchmark_reference")) return failure("请先上传一张对标详情长图。", 400, "BENCHMARK_REFERENCE_REQUIRED");
  let panelIds: string[] | undefined;
  let setIds: string[] | undefined;
  let instruction = "";
  let oneClick = false;
  try {
    const body = await request.json() as Record<string, unknown>;
    panelIds = Array.isArray(body.panelIds) ? body.panelIds.filter((item): item is string => typeof item === "string") : undefined;
    setIds = Array.isArray(body.setIds) ? body.setIds.filter((item): item is string => typeof item === "string") : undefined;
    instruction = typeof body.instruction === "string" ? body.instruction.trim().slice(0, 4000) : "";
    oneClick = body.oneClick === true;
  } catch { /* 允许空请求体 */ }
  /* 电商图文没有用户可见的「故事线确认」：内部规划由后台在一次生成里自动完成。
   * 旧任务里已确认的故事线数据照常保留，不影响读取。 */
  if (!oneClick && (!task.approvedAt || task.approvedPlanRevision !== task.planRevision)) return failure("方案已发生变化，请重新确认后再生成。", 400, "PLAN_NOT_APPROVED");
  if (oneClick && !instruction && !panelIds?.length && task.status === "completed" && task.approvedAt && task.approvedPlanRevision === task.planRevision) {
    return NextResponse.json({ success: true, started: false, task: toPublicCommerceImageTask(task), message: "当前图片已经生成，未重复调用模型。" });
  }
  if (isCommerceImageTaskRunning(taskId)) return NextResponse.json({ success: true, started: false, task: toPublicCommerceImageTask(task), message: "任务正在处理中，请稍候。" }, { status: 202 });
  /* 先把任务落成「排队中」再启动 runner：
   * runner 是异步的，如果这里不写，紧接着的 GET 会读到旧的 draft 状态，
   * 前端就会回到空状态并且停止轮询——这正是「必须切页面才能看到正在生成」的根因。 */
  const queued = await saveCommerceImageTask({
    ...task,
    status: "queued",
    error: "",
    lastError: undefined,
    progress: {
      completed: 0,
      total: Math.max(1, panelIds?.length || task.panels.length || task.brief.cardCount),
      currentPanelId: "",
      message: panelIds?.length ? "正在重新生成当前画面" : "已进入生成队列，AI 正在理解素材与需求",
      updatedAt: new Date().toISOString()
    }
  });
  const started = startCommerceImageTask(taskId, { panelIds, setIds, oneClick, instruction });
  return NextResponse.json({
    success: true,
    started,
    task: toPublicCommerceImageTask(queued),
    message: started
      ? panelIds?.length ? "当前画面已开始重新生成。" : "已开始：AI 会自动理解素材、规划画面并生成图片。"
      : "任务正在处理中，请稍候。"
  }, { status: 202 });
}

function failure(message: string, status = 400, code = "GENERATION_ERROR") {
  return NextResponse.json({ success: false, code, category: "validation", retryable: false, message }, { status });
}
