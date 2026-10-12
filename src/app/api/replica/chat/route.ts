import { denyIfUnauthenticated } from "@/lib/auth/guard";
import { NextResponse } from "next/server";
import { callReplicaText } from "@/lib/replica-ai";
import { getCachedProductUnderstanding, getCachedVideoDNA } from "@/lib/replica-cache";
import { generateReplicaPrompt } from "@/lib/replica-prompt-generation";
import { getReplicaTaskRecord, patchReplicaTaskRecord, saveReplicaTaskRecord, toPublicReplicaTask } from "@/lib/replica-task-store";
import { startReplicaTask } from "@/lib/replica-task-runner";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const deny = await denyIfUnauthenticated(request);
  if (deny) return deny;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ success: false, message: "请求体必须是合法 JSON。" }, { status: 400 });
  }
  const input = body && typeof body === "object" ? body as Record<string, unknown> : {};
  const messages = normalizeMessages(input.messages);
  const taskId = typeof input.taskId === "string" ? input.taskId.trim() : "";
  const videoReady = Boolean(input.videoReady);
  const productReady = Boolean(input.productReady);
  const latest = messages.filter((item) => item.role === "user").at(-1)?.content || "";
  if (!latest) return NextResponse.json({ success: false, message: "请先告诉 AI 这次想怎么复刻。" }, { status: 400 });

  if (taskId) {
    const task = await getReplicaTaskRecord(taskId);
    if (task) {
      if (!task.video.cacheKey || !task.productCacheKey) {
        return NextResponse.json({ success: true, source: "rule", content: "请先准备好爆款视频和产品图片。素材准备好后，我只会确认一次文案方式。" });
      }

      const wantsGeneration = /(开始生成|生成提示词|生成最终提示词|最终提示词|给我最终|直接生成|按原片生成|可以开始|开始吧)/i.test(latest);
      const saysSourceCopy = /(使用原视频文案|用原视频文案|原视频文案|原文案|保留原视频文案|a[.、。]?\s*使用原视频文案)/i.test(latest);
      const customMatch = latest.match(/(?:用我的文案|我的文案|使用我的文案|使用新文案|新文案|b[.、。]?\s*使用你提供的新文案)\s*[:：]?\s*([\s\S]+)/i);
      const choseSourceOnly = /^\s*(a[.、。]?|使用原视频文案|用原视频文案)\s*$/i.test(latest);
      const choseCustomOnly = /^\s*(b[.、。]?|用我的文案|我的文案|使用我的文案|使用你提供的新文案)\s*$/i.test(latest);
      const pendingCopy = task.copyPromptRequested === true;

      if (wantsGeneration || saysSourceCopy || customMatch || pendingCopy) {
        if (task.copyMode === "source" || task.copyMode === "custom") {
          const updated = await startGenerationFromTask(taskId, task.copyMode, task.customCopy || "");
          return NextResponse.json({ success: true, source: "rule", content: updated?.prompt || "Prompt 已生成。", task: updated ? toPublicReplicaTask(updated) : undefined });
        }
        if (saysSourceCopy || choseSourceOnly) {
          const updated = await startGenerationFromTask(taskId, "source", "");
          return NextResponse.json({ success: true, source: "rule", content: updated?.prompt || "Prompt 已生成。", task: updated ? toPublicReplicaTask(updated) : undefined });
        }
        if (customMatch && customMatch[1]?.trim()) {
          const updated = await startGenerationFromTask(taskId, "custom", customMatch[1].trim());
          return NextResponse.json({ success: true, source: "rule", content: updated?.prompt || "Prompt 已生成。", task: updated ? toPublicReplicaTask(updated) : undefined });
        }
        if (pendingCopy && (latest.length > 8 || latest.includes("\n"))) {
          const updated = await startGenerationFromTask(taskId, "custom", latest.trim());
          return NextResponse.json({ success: true, source: "rule", content: updated?.prompt || "Prompt 已生成。", task: updated ? toPublicReplicaTask(updated) : undefined });
        }
        await patchReplicaTaskRecord(taskId, { copyPromptRequested: true });
        if (customMatch && !customMatch[1]?.trim()) {
          return NextResponse.json({ success: true, source: "rule", content: "把这次要使用的完整文案发给我，我收到后直接生成最终复刻提示词。" });
        }
        if (choseCustomOnly) {
          return NextResponse.json({ success: true, source: "rule", content: "把这次要使用的完整文案发给我，我收到后直接生成最终复刻提示词。" });
        }
        return NextResponse.json({ success: true, source: "rule", content: "这次视频文案使用哪一种？\nA. 使用原视频文案\nB. 使用你提供的新文案\n\n如果选择 B，请直接把新文案发给我。" });
      }
    }
  }

  const system = [
    "你是爆款复刻工作台里的 AI 编导助手。唯一产品规则：除用户产品和使用者选择的文案外，原视频所有可复刻元素默认 HIGHEST FIDELITY / MAXIMUM REPLICATION。",
    "素材已准备后，如果用户表达生成意图，只允许问唯一确认问题：这次视频文案使用哪一种？A. 使用原视频文案；B. 使用你提供的新文案。选择 B 时请直接发送新文案。",
    "禁止询问发布平台、视频风格、还原程度、镜头风格、场景、人物、运镜、时长、产品位置、情绪、动作、目标人群、仿写方向、内容目的、是否保留原片结构或动作。",
    "回复要短、明确。不要展示 Video DNA、镜头数量或技术分析报告。不要把长 Prompt 放进聊天。",
    `视频状态：${videoReady ? "已准备" : "未准备"}；产品图片状态：${productReady ? "已准备" : "未准备"}。`
  ].join("\n");
  const user = ["对话记录：", ...messages.map((item) => `${item.role === "user" ? "用户" : "AI"}：${item.content}`), "请回复本轮用户。"].join("\n");

  try {
    const content = await callReplicaText({ route: "replica_chat", system, user, temperature: 0.2, maxTokens: 500 });
    return NextResponse.json({ success: true, source: "deepseek", content });
  } catch (error) {
    return NextResponse.json({ success: true, source: "fallback", content: fallbackReply({ videoReady, productReady, latest }), message: error instanceof Error ? error.message : "AI 暂不可用，已保留你的要求。" });
  }
}

async function startGenerationFromTask(taskId: string, copyMode: "source" | "custom", customCopy: string) {
  const task = await getReplicaTaskRecord(taskId);
  if (!task) return undefined;
  const patched = await patchReplicaTaskRecord(taskId, {
    copyMode,
    customCopy,
    copyPromptRequested: false,
    promptRequested: true,
    status: "compiling_prompt",
    error: ""
  });
  if (!patched) return undefined;

  const startedAt = Date.now();
  console.info(`[CHAT_GENERATION_START] taskId=${taskId} copyMode=${copyMode}`);
  try {
    const dna = await getCachedVideoDNA(task.video.cacheKey || task.video.hash);
    const product = task.productCacheKey ? await getCachedProductUnderstanding(task.productCacheKey) : null;
    if (!dna || !product) throw new Error("Video DNA 或产品理解缓存缺失，请重新继续分析。");
    console.info(`[CONTEXT_READY] taskId=${taskId}, shots=${dna.shots.length}, observations=${dna.frameObservations.length}, productChars=${JSON.stringify(product).length}`);
    console.info(`[PROMPT_COMPILE_START] taskId=${taskId}`);
    const generated = await generateReplicaPrompt({
      dna,
      product,
      productReferences: task.products.map((item) => ({ assetId: item.assetId, name: item.name })),
      requirements: task.requirements,
      referenceCopy: task.referenceCopy,
      copyMode,
      customCopy
    });
    const nextVersion = {
      id: `replica_version_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      version: patched.versions.length + 1,
      prompt: generated.prompt,
      note: patched.prompt ? "重新生成" : "首次生成",
      createdAt: new Date().toISOString()
    };
    const updated = await saveReplicaTaskRecord({
      ...patched,
      title: generated.title,
      prompt: generated.prompt,
      versions: [...patched.versions, nextVersion],
      selfCheck: generated.selfCheck,
      warnings: generated.warnings,
      status: "draft",
      error: ""
    });
    console.info(`[CHAT_GENERATION_END] taskId=${taskId}, duration=${((Date.now() - startedAt) / 1000).toFixed(1)}s, promptChars=${generated.prompt.length}, status=success`);
    return updated;
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
    throw error;
  }
}
function normalizeMessages(value: unknown) {
  if (!Array.isArray(value)) return [] as Array<{ role: "user" | "assistant"; content: string }>;
  return value.map((item) => {
    const record = item && typeof item === "object" ? item as Record<string, unknown> : {};
    return { role: record.role === "assistant" ? "assistant" as const : "user" as const, content: typeof record.content === "string" ? record.content.trim().slice(0, 6000) : "" };
  }).filter((item) => item.content);
}

function fallbackReply(input: { videoReady: boolean; productReady: boolean; latest: string }) {
  const missing = [!input.videoReady ? "爆款视频" : "", !input.productReady ? "产品图片" : ""].filter(Boolean);
  if (missing.length) return `收到。我会按最高还原处理：锁定原视频时间轴、镜头、人物动作、眼神、表情、调度、场景和节奏，只替换产品与必要文案。请先准备${missing.join("和")}，再开始生成。`;
  return "这次视频文案使用哪一种？\nA. 使用原视频文案\nB. 使用你提供的新文案\n\n如果选择 B，请直接把新文案发给我。";
}
