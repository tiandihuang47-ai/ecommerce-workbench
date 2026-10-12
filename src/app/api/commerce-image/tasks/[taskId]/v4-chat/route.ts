import { denyIfUnauthenticated } from "@/lib/auth/guard";
import { NextResponse } from "next/server";
import { randomUUID, createHash } from "node:crypto";
import { callCommerceTextJson } from "@/lib/commerce-image-ai";
import { getCommerceImageTask, saveCommerceImageTask, toPublicCommerceImageTask, enableConversationV4 } from "@/lib/commerce-image-store";
import { evidenceFromTask, buildPlanFromAI, INTENT_SYSTEM } from "@/lib/commerce-image-v4-workflow";
import { emptyCommerceCreativeState, type CommerceCreativeState, type CommerceCreativeCommand } from "@/lib/commerce-image-v4-types";
import type { CommerceImageRatio } from "@/lib/commerce-image-types";

export const runtime = "nodejs";

export async function POST(request: Request, context: { params: Promise<{ taskId: string }> }) {
  const deny = await denyIfUnauthenticated(request);
  if (deny) return deny;
  const { taskId } = await context.params;
  let task = await getCommerceImageTask(taskId);
  if (!task) return failure("生图项目不存在。", 404);

  let body: Record<string, unknown>;
  try { body = await request.json() as Record<string, unknown>; } catch { return failure("请求格式不正确。"); }

  const message = typeof body.message === "string" ? body.message.trim().slice(0, 8000) : "";
  if (!message) return failure("请输入内容。");

  const requestId = typeof body.requestId === "string" ? body.requestId.slice(0, 160) : randomUUID();
  const mode = body.mode === "plan_only" ? "plan_only" : "auto";
  const expectedRevision = typeof body.expectedTaskRevision === "number" ? body.expectedTaskRevision : undefined;

  if (task.workflowVersion !== "conversation-v4") {
    task = await enableConversationV4(taskId);
    if (!task) return failure("生图项目不存在。", 404);
  }
  if (!task.creative) {
    task = await saveCommerceImageTask({ ...task, creative: emptyCommerceCreativeState() });
  }
  const creative = task.creative || emptyCommerceCreativeState();

  const fingerprint = createHash("sha256").update(`${requestId}\0${message}\0${expectedRevision ?? ""}`).digest("hex");
  const existingRun = creative.runs.find((r) => r.requestId === requestId);
  if (existingRun) {
    if (existingRun.requestFingerprint !== fingerprint) return failure("同一请求 ID 但内容不同。", 409);
    return NextResponse.json({ success: true, task: toPublicCommerceImageTask(task), runId: existingRun.id, deduplicated: true });
  }

  if (expectedRevision !== undefined) {
    const taskRevision = task.chatMessages.length + task.panels.length;
    if (taskRevision !== expectedRevision) {
      return NextResponse.json({ success: false, code: "REVISION_CONFLICT", message: "任务已被修改，请刷新后重试。", currentRevision: taskRevision }, { status: 409 });
    }
  }

  const userMessage = { id: `commerce_image_message_${randomUUID()}`, role: "user" as const, content: message, createdAt: new Date().toISOString() };
  task = await saveCommerceImageTask({ ...task, chatMessages: [...task.chatMessages, userMessage] });

  const recentMessages = task.chatMessages.slice(-12);
  const conversationContext = recentMessages.map((m) => `${m.role}: ${m.content.slice(0, 300)}`).join("\n");
  const panelList = creative.plans.length
    ? creative.plans.flatMap((p) => p.panels.map((panel, i) => `${i + 1}. ${panel.purpose.slice(0, 80)}`)).join("\n")
    : task.panels.map((p, i) => `${i + 1}. ${p.title}`).join("\n");

  type IntentResult = { action: string; scope: string; targetPanelIndices: number[]; instruction: string; reply: string; planOnly?: boolean; count?: number; ratio?: string; platform?: string; visualDirectionHint?: string };
  let intent: IntentResult;
  try {
    intent = await callCommerceTextJson<IntentResult>({
      route: "commerce_chat",
      system: INTENT_SYSTEM,
      user: [
        `用户新消息：${message}`,
        `当前是否有方案：${creative.plans.length ? "是（" + creative.plans.length + " 个方案）" : "否"}`,
        `当前面板列表：\n${panelList || "（无）"}`,
        `最近对话：\n${conversationContext || "（无）"}`,
        `持续约束：${creative.explicitConstraints.join("；") || "（无）"}`,
        `mode：${mode}`
      ].join("\n"),
      temperature: 0.15,
      maxTokens: 2500
    });
  } catch (error) {
    return failure(`意图理解失败：${error instanceof Error ? error.message : "未知错误"}`, 502);
  }

  const action = intent.action as "discuss" | "clarify" | "plan" | "generate" | "revise";
  const instruction = intent.instruction || message;
  const reply = intent.reply || "收到。";

  if (action === "discuss") {
    const assistantMessage = { id: `commerce_image_message_${randomUUID()}`, role: "assistant" as const, content: reply, createdAt: new Date().toISOString() };
    task = await saveCommerceImageTask({ ...task, chatMessages: [...task.chatMessages, assistantMessage] });
    return NextResponse.json({ success: true, task: toPublicCommerceImageTask(task), reply, action: "discuss" });
  }

  if (action === "clarify") {
    const assistantMessage = { id: `commerce_image_message_${randomUUID()}`, role: "assistant" as const, content: reply, createdAt: new Date().toISOString() };
    const updatedState = { ...creative, explicitConstraints: [...new Set([...creative.explicitConstraints, message])].slice(0, 30) };
    task = await saveCommerceImageTask({ ...task, chatMessages: [...task.chatMessages, assistantMessage], creative: updatedState, status: "awaiting_input" });
    return NextResponse.json({ success: true, task: toPublicCommerceImageTask(task), reply, action: "clarify" });
  }

  if (action === "plan" || (action === "generate" && (intent.planOnly || mode === "plan_only"))) {
    const plan = await buildPlanFromAI(task, { ...intent, count: intent.count || 0, ratio: intent.ratio as CommerceImageRatio } as never, creative);
    const updatedState: CommerceCreativeState = {
      ...creative,
      plans: [...creative.plans, plan],
      activePlanId: plan.id,
      evidence: creative.evidence.length ? creative.evidence : evidenceFromTask(task)
    };
    const assistantMessage = { id: `commerce_image_message_${randomUUID()}`, role: "assistant" as const, content: reply, createdAt: new Date().toISOString() };
    task = await saveCommerceImageTask({ ...task, chatMessages: [...task.chatMessages, assistantMessage], creative: updatedState });
    return NextResponse.json({ success: true, task: toPublicCommerceImageTask(task), reply, action: "plan", planId: plan.id });
  }

  const plan = await buildPlanFromAI(task, { ...intent, count: intent.count || 0, ratio: intent.ratio as CommerceImageRatio } as never, creative);
  const state: CommerceCreativeState = {
    ...creative,
    plans: [...creative.plans, plan],
    activePlanId: plan.id,
    evidence: creative.evidence.length ? creative.evidence : evidenceFromTask(task)
  };

  const command: CommerceCreativeCommand = {
    action,
    scope: intent.scope as "project" | "panels" | "layers",
    targetPanelIds: (intent.targetPanelIndices || []).map((i: number) => plan.panels[i]?.id || "").filter(Boolean),
    targetLayerIds: [],
    expectedTaskRevision: 0,
    instruction
  };

  const runId = `commerce_image_v4_run_${randomUUID().slice(0, 12)}`;
  const run = {
    id: runId,
    requestId,
    requestFingerprint: fingerprint,
    command,
    mode: mode as "auto" | "plan_only",
    taskRevision: task.chatMessages.length,
    planSnapshot: plan,
    status: "queued" as const,
    phase: "planning" as const,
    modelSnapshots: [],
    attempts: [],
    completedPanelIds: [],
    artifactRevisionIds: [],
    error: "",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
  state.runs = [...state.runs, run];
  state.activeRunId = runId;

  const assistantMessage = { id: `commerce_image_message_${randomUUID()}`, role: "assistant" as const, content: reply, createdAt: new Date().toISOString() };
  task = await saveCommerceImageTask({ ...task, chatMessages: [...task.chatMessages, assistantMessage], creative: state });
  return NextResponse.json({ success: true, task: toPublicCommerceImageTask(task), reply, action, runId }, { status: 202 });
}

function failure(message: string, status = 400) {
  return NextResponse.json({ success: false, code: "V4_CHAT_ERROR", message }, { status });
}
