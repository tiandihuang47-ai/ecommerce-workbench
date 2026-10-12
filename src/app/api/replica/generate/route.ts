import { denyIfUnauthenticated } from "@/lib/auth/guard";
import { NextResponse } from "next/server";
import { callReplicaTextJson, clipReplicaText } from "@/lib/replica-ai";
import { getCachedProductUnderstanding, getCachedVideoDNA, isSafeCacheKey } from "@/lib/replica-cache";
import { compileReplicaPrompt, validateReplicaPrompt } from "@/lib/replica-prompt-compiler";
import { getReplicaConfig } from "@/lib/replica-config";
import type { ReplicaAdaptedDialogue, ReplicaDialogueDNA, ReplicaSelfCheck, VideoDNA } from "@/lib/replica-types";

export const runtime = "nodejs";
export const maxDuration = 300;

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
  const videoCacheKey = stringValue(input.videoCacheKey);
  const productCacheKey = stringValue(input.productCacheKey);
  if (!isSafeCacheKey(videoCacheKey) || !isSafeCacheKey(productCacheKey)) {
    return NextResponse.json({ success: false, message: "视频或产品理解结果已失效，请重新上传并理解素材。", retryable: true }, { status: 400 });
  }

  const dna = await getCachedVideoDNA(videoCacheKey);
  const product = await getCachedProductUnderstanding(productCacheKey);
  if (!dna) return NextResponse.json({ success: false, message: "没有找到视频理解缓存，请重新上传爆款视频。", retryable: true }, { status: 409 });
  if (!product) return NextResponse.json({ success: false, message: "没有找到产品理解缓存，请重新上传产品图片。", retryable: true }, { status: 409 });

  const requirements = stringValue(input.requirements);
  const referenceCopy = stringValue(input.referenceCopy);
  const warnings = [...dna.analysisMeta.warnings];
  const adaptation = await adaptDialogue({ dnaDialogue: dna.dialogue, productName: product.name, productFacts: product.facts, requirements, referenceCopy, sourceCandidates: dna.productMapping.sourceCandidates });
  warnings.push(...adaptation.warnings);
  const targetModel = getReplicaConfig().targetVideoModel;

  let prompt = compileReplicaPrompt({ dna, product, dialogue: adaptation.dialogue, requirements, referenceCopy, copyMode: "source", targetModel });
  let deterministic = validateReplicaPrompt(prompt, dna);
  if (!deterministic.passed) {
    prompt = compileReplicaPrompt({ dna, product, dialogue: adaptation.dialogue, requirements, referenceCopy, copyMode: "source", auditCorrections: deterministic.missing.map((item) => `补回缺失模块：${item}，不得省略。`), targetModel });
    deterministic = validateReplicaPrompt(prompt, dna);
  }

  const selfCheck = await runSelfCheck(prompt, dna, deterministic);
  if (selfCheck.correctionDirectives.length) {
    prompt = compileReplicaPrompt({ dna, product, dialogue: adaptation.dialogue, requirements, referenceCopy, copyMode: "source", auditCorrections: selfCheck.correctionDirectives, targetModel });
  }
  const finalCheck = validateReplicaPrompt(prompt, dna);
  if (!finalCheck.passed) {
    warnings.push(`自动自检仍发现结构字段：${finalCheck.missing.join("、")}；已保留完整原始镜头结构，请重试生成。`);
  }

  return NextResponse.json({
    success: true,
    source: adaptation.source,
    title: `${product.name || "我的产品"} · 爆款复刻`,
    prompt,
    selfCheck,
    warnings,
    metadata: {
      duration: dna.metadata.duration,
      sourceFileName: dna.sourceFileName,
      videoCacheKey,
      productCacheKey
    }
  });
}

async function adaptDialogue(input: {
  dnaDialogue: ReplicaDialogueDNA[];
  productName: string;
  productFacts: string[];
  requirements: string;
  referenceCopy: string;
  sourceCandidates: string[];
}) {
  const fallback = input.dnaDialogue.map((item) => localAdaptedDialogue(item, input.productName, input.sourceCandidates));
  if (!input.dnaDialogue.length) return { source: "fallback" as const, dialogue: fallback, warnings: ["原视频未获得可靠台词，未凭空添加台词。"] };
  try {
    const raw = await callReplicaTextJson({
      route: "replica_dialogue_adaptation",
      system: [
        "你是高还原广告改写编辑。只能做最小必要产品/品牌/价格文案替换，不能重写成新脚本。",
        "严格保持每段台词的说话者关系、时间区间、长度级别、问答冲突、转折、语速和情绪推进。产品事实只使用给定资料；没有事实就保留原结构并写中性表达。",
        "只输出 JSON：{dialogue:[{id,adaptedText,adaptationReason}]}。"
      ].join("\n"),
      user: JSON.stringify({
        productName: input.productName,
        productFacts: input.productFacts,
        sourceCandidates: input.sourceCandidates,
        requirements: input.requirements,
        referenceCopy: input.referenceCopy,
        dialogue: input.dnaDialogue.map((item) => ({ id: item.id, start: item.start, end: item.end, speaker: item.speaker, text: item.text, emotion: item.emotion, syncWithAction: item.syncWithAction }))
      }),
      temperature: 0.1,
      maxTokens: 6000
    }) as { dialogue?: unknown[] };
    if (!Array.isArray(raw.dialogue)) throw new Error("文案适配结果缺少 dialogue。");
    const byId = new Map(raw.dialogue.map((item) => {
      const record = asRecord(item);
      return [stringValue(record.id), record] as const;
    }));
    const dialogue = input.dnaDialogue.map((item) => {
      const adapted = byId.get(item.id);
      return {
        ...item,
        originalText: item.text,
        adaptedText: stringValue(adapted?.adaptedText) || item.text,
        adaptationReason: stringValue(adapted?.adaptationReason) || "保持原台词结构，仅做必要产品适配。"
      };
    });
    return { source: "deepseek" as const, dialogue, warnings: [] as string[] };
  } catch (error) {
    return { source: "fallback" as const, dialogue: fallback, warnings: [`文案适配未调用成功：${error instanceof Error ? error.message : "未知错误"}；已保留原台词结构并做最小本地替换。`] };
  }
}

function localAdaptedDialogue(item: ReplicaDialogueDNA, productName: string, sourceCandidates: string[]): ReplicaAdaptedDialogue {
  let adaptedText = item.text;
  for (const candidate of sourceCandidates) {
    if (candidate.trim()) adaptedText = adaptedText.split(candidate).join(productName);
  }
  return { ...item, originalText: item.text, adaptedText, adaptationReason: adaptedText === item.text ? "未发现可安全替换的产品词，保留原句长度和节奏。" : "本地保守替换已识别的产品词，保留原句结构。" };
}

async function runSelfCheck(prompt: string, dna: VideoDNA, deterministic: { passed: boolean; missing: string[] }): Promise<ReplicaSelfCheck> {
  const checkedAt = new Date().toISOString();
  try {
    const raw = await callReplicaTextJson({
      route: "replica_self_check",
      system: "你是复刻提示词发布前的严格审校器。只输出 JSON：{passed,issues,correctionDirectives}。检查镜头时间轴、动作、表情眼神、调度、台词时序、产品替换、连续性和矛盾指令；发现问题要给可执行修正，不要写泛泛评价。",
      user: JSON.stringify({
        auditPayload: buildAuditPayload(prompt, dna),
        deterministicCheck: deterministic
      }),
      temperature: 0,
      maxTokens: 2800
    }) as { passed?: unknown; issues?: unknown; correctionDirectives?: unknown };
    const issues = stringArray(raw.issues);
    const corrections = stringArray(raw.correctionDirectives);
    return { source: "deepseek", passed: raw.passed === true && deterministic.passed && issues.length === 0, issues: [...new Set([...issues, ...deterministic.missing.map((item) => `结构化校验缺少：${item}`)])], correctionDirectives: corrections, checkedAt };
  } catch (error) {
    return { source: "local", passed: deterministic.passed, issues: deterministic.missing.map((item) => `结构化校验缺少：${item}`).concat(error instanceof Error ? [`AI 自检未调用成功：${error.message}`] : ["AI 自检未调用成功。"]), correctionDirectives: deterministic.missing.map((item) => `确保最终提示词保留 ${item} 细节。`), checkedAt };
  }
}

function buildAuditPayload(prompt: string, dna: VideoDNA) {
  return {
    compiledPromptSize: prompt.length,
    compiledPromptHeadTail: clipReplicaText(`${prompt.slice(0, 5000)}\n[完整提示词中间内容由结构化 DNA 审计代替]\n${prompt.slice(-3500)}`, 9000),
    metadata: dna.metadata,
    rhythm: dna.rhythm,
    environment: dna.environment,
    continuity: dna.continuity,
    productMapping: dna.productMapping,
    dialogue: dna.dialogue.map((item) => ({
      id: item.id,
      speaker: item.speaker,
      start: item.start,
      end: item.end,
      text: item.text,
      speakingRate: item.speakingRate,
      pauses: item.pauses,
      emphasis: item.emphasis,
      emotion: item.emotion,
      syncWithAction: item.syncWithAction
    })),
    expectedShots: dna.shots.map((shot) => ({
      id: shot.id,
      index: shot.index,
      start: shot.start,
      end: shot.end,
      duration: shot.duration,
      purpose: shot.purpose,
      camera: {
        shotSize: shot.camera.shotSize,
        cameraHeight: shot.camera.cameraHeight,
        lensFeel: shot.camera.lensFeel,
        subjectScale: shot.camera.subjectScale,
        movement: shot.camera.movement,
        movementDirection: shot.camera.movementDirection,
        movementSpeed: shot.camera.movementSpeed
      },
      subjects: shot.subjects,
      environment: shot.environment,
      props: shot.props,
      actionCount: shot.actions.length,
      actions: shot.actions.map((action) => ({ start: action.start, end: action.end, subjectId: action.subjectId, sequence: action.sequence, speed: action.speed, direction: action.direction })),
      facialExpressionCount: shot.facialExpressions.length,
      facialExpressions: shot.facialExpressions.map((face) => ({ start: face.start, end: face.end, subjectId: face.subjectId, emotion: face.emotion, gazeDirection: face.gazeDirection, gazeTarget: face.gazeTarget, intensity: face.intensity })),
      blockingCount: shot.blocking.length,
      blocking: shot.blocking.map((block) => ({ start: block.start, end: block.end, subjectId: block.subjectId, position: block.position, distanceToCamera: block.distanceToCamera, occlusion: block.occlusion }))
    }))
  };
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function stringArray(value: unknown) {
  return Array.isArray(value) ? value.map((item) => typeof item === "string" ? item.trim() : String(item || "").trim()).filter(Boolean) : [];
}
