import { denyIfUnauthenticated } from "@/lib/auth/guard";
import { NextResponse } from "next/server";
import { buildCommerceImagePlan } from "@/lib/commerce-image-plan";
import { getCommerceImageTask, saveCommerceImageTask, toPublicCommerceImageTask } from "@/lib/commerce-image-store";

export const runtime = "nodejs";

export async function POST(request: Request, context: { params: Promise<{ taskId: string }> }) {
  const deny = await denyIfUnauthenticated(request);
  if (deny) return deny;
  const { taskId } = await context.params;
  const task = await getCommerceImageTask(taskId);
  if (!task) return failure("生图项目不存在。", 404);
  if (task.status === "queued" || task.status === "generating") return failure("项目正在生成，暂时不能重新规划。", 409);
  let force = false;
  try {
    const body = await request.json() as Record<string, unknown>;
    force = body.force === true;
  } catch { /* 请求体可为空 */ }
  if (!force && task.panels.some((panel) => panel.versions.length)) return failure("项目已有生成版本；如需重做方案，请确认覆盖现有画面方案。", 409);
  const plan = await buildCommerceImagePlan(task);
  const panels = plan.panels.map((panel, index) => {
    const previous = task.panels.find((item) => item.kind === panel.kind && item.title === panel.title) || task.panels[index];
    if (!previous?.versions.length) return panel;
    return {
      ...panel,
      status: "completed" as const,
      versions: previous.versions,
      selectedVersionId: previous.selectedVersionId || previous.versions.at(-1)?.id || ""
    };
  });
  const saved = await saveCommerceImageTask({
    ...task,
    ...plan,
    panels,
    status: "awaiting_approval",
    approvedAt: "",
    approvedPlanRevision: 0,
    planRevision: task.planRevision + 1,
    generationSets: [],
    selectedSetId: "",
    error: ""
  });
  return NextResponse.json({ success: true, source: "local-rules", task: toPublicCommerceImageTask(saved), message: "视觉方案和发布文案已生成，请确认后开始出图。" });
}

function failure(message: string, status = 400) {
  return NextResponse.json({ success: false, code: "PLAN_ERROR", category: "validation", retryable: false, message }, { status });
}
