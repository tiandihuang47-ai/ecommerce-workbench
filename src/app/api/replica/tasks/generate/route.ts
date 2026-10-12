import { denyIfUnauthenticated } from "@/lib/auth/guard";
import { NextResponse } from "next/server";
import { getCachedProductUnderstanding, getCachedVideoDNA } from "@/lib/replica-cache";
import { generateReplicaPrompt } from "@/lib/replica-prompt-generation";
import { getReplicaTaskRecord, patchReplicaTaskRecord, saveReplicaTaskRecord, toPublicReplicaTask } from "@/lib/replica-task-store";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const deny = await denyIfUnauthenticated(request);
  if (deny) return deny;
  let body: Record<string, unknown> = {};
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ success: false, message: "请求体必须是合法 JSON。" }, { status: 400 });
  }
  const taskId = String(body.taskId || "");
  const task = await getReplicaTaskRecord(taskId);
  if (!task) return NextResponse.json({ success: false, message: "任务不存在。" }, { status: 404 });
  const requirements = typeof body.requirements === "string" ? body.requirements.trim() : "";
  const referenceCopy = typeof body.referenceCopy === "string" ? body.referenceCopy.trim() : "";
  const rawMode = String(body.copyMode || (body.dialogueHandling && typeof body.dialogueHandling === "object" ? (body.dialogueHandling as Record<string, unknown>).mode : "") || "");
  const mode = rawMode === "source" || rawMode === "original" ? "source" : rawMode === "custom" ? "custom" : null;
  if (!mode) return NextResponse.json({ success: false, message: "这次视频文案使用原视频文案，还是你的新文案？" }, { status: 400 });
  const customCopy = mode === "custom" ? String(body.customCopy || (body.dialogueHandling && typeof body.dialogueHandling === "object" ? (body.dialogueHandling as Record<string, unknown>).instruction : "") || "").trim() : "";
  if (mode === "custom" && !customCopy) return NextResponse.json({ success: false, message: "把这次要使用的完整文案发给我，我收到后直接生成最终复刻提示词。" }, { status: 400 });
  const messages = Array.isArray(body.messages) ? body.messages : task.messages;
  const updated = await patchReplicaTaskRecord(taskId, {
    requirements: requirements || task.requirements,
    referenceCopy: referenceCopy || task.referenceCopy,
    copyMode: mode,
    customCopy,
    messages,
    promptRequested: true,
    status: task.video.cacheKey ? (task.products.length ? task.productCacheKey ? "compiling_prompt" : "analyzing_product" : "analyzing_video") : "analyzing_video",
    error: ""
  });
  if (!updated) return NextResponse.json({ success: false, message: "任务不存在。" }, { status: 404 });
  const startedAt = Date.now();
  console.info(`[CHAT_GENERATION_START] taskId=${taskId} copyMode=${mode}`);
  try {
    const dna = await getCachedVideoDNA(task.video.cacheKey || task.video.hash);
    const product = task.productCacheKey ? await getCachedProductUnderstanding(task.productCacheKey) : null;
    if (!dna || !product) throw new Error("Video DNA 或产品理解缓存缺失，请重新继续分析。");
    console.info(`[CONTEXT_READY] taskId=${taskId}, shots=${dna.shots.length}, observations=${dna.frameObservations.length}, productChars=${JSON.stringify(product).length}`);
    console.info(`[PROMPT_COMPILE_START] taskId=${taskId}`);
    const generated = await generateReplicaPrompt({
      dna,
      product,
      productReferences: updated.products.map((item) => ({ assetId: item.assetId, name: item.name })),
      requirements: updated.requirements,
      referenceCopy: updated.referenceCopy,
      copyMode: mode,
      customCopy
    });
    const nextVersion = {
      id: `replica_version_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      version: updated.versions.length + 1,
      prompt: generated.prompt,
      note: updated.prompt ? "重新生成" : "首次生成",
      createdAt: new Date().toISOString()
    };
    const saved = await saveReplicaTaskRecord({
      ...updated,
      title: generated.title,
      prompt: generated.prompt,
      versions: [...updated.versions, nextVersion],
      selfCheck: generated.selfCheck,
      warnings: generated.warnings,
      status: "draft",
      error: ""
    });
    console.info(`[CHAT_GENERATION_END] taskId=${taskId}, duration=${((Date.now() - startedAt) / 1000).toFixed(1)}s, promptChars=${generated.prompt.length}, status=success`);
    return NextResponse.json({
      success: true,
      task: toPublicReplicaTask(saved),
      prompt: generated.prompt,
      message: "已按原片最高还原规则生成完整复刻提示词。"
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Prompt 编译失败。";
    console.info(`[CHAT_GENERATION_END] taskId=${taskId}, duration=${((Date.now() - startedAt) / 1000).toFixed(1)}s, status=failed, message=${message}`);
    await patchReplicaTaskRecord(taskId, {
      status: "failed",
      error: message,
      analysisProgress: {
        status: "failed",
        stage: "PROMPT_COMPILE",
        stageLabel: "Prompt 编译失败",
        startedAt: new Date(startedAt).toISOString(),
        stageStartedAt: new Date(startedAt).toISOString(),
        updatedAt: new Date().toISOString(),
        lastHeartbeatAt: new Date().toISOString(),
        errorCode: "PROMPT_COMPILE_FAILED",
        errorMessage: message,
        errorStack: error instanceof Error ? (error.stack || "").slice(0, 4000) : ""
      }
    });
    return NextResponse.json({ success: false, message }, { status: 502 });
  }
}
