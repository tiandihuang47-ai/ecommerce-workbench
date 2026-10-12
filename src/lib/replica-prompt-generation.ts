import { callReplicaTextJson, clipReplicaText } from "@/lib/replica-ai";
import { buildFidelityChecklist, compileReplicaPrompt, validateReplicaPrompt } from "@/lib/replica-prompt-compiler";
import { getReplicaConfig } from "@/lib/replica-config";
import type { ReplicaAdaptedDialogue, ReplicaDialogueDNA, ReplicaSelfCheck, VideoDNA, ReplicaProductUnderstanding } from "@/lib/replica-types";

export async function generateReplicaPrompt(input: {
  dna: VideoDNA;
  product: ReplicaProductUnderstanding;
  productReferences?: Array<{ assetId?: string; name: string }>;
  requirements: string;
  referenceCopy: string;
  copyMode: "source" | "custom";
  customCopy?: string;
}) {
  const warnings = [...input.dna.analysisMeta.warnings];
  const adaptation = await adaptDialogue({
    dnaDialogue: input.dna.dialogue,
    productName: input.product.name,
    productFacts: input.product.facts,
    requirements: input.requirements,
    referenceCopy: input.referenceCopy,
    copyMode: input.copyMode,
    customCopy: input.customCopy,
    shots: input.dna.shots,
    sourceCandidates: input.dna.productMapping.sourceCandidates
  });
  warnings.push(...adaptation.warnings);
  const targetModel = getReplicaConfig().targetVideoModel;
  let prompt = compileReplicaPrompt({
    dna: input.dna,
    product: input.product,
    productReferences: input.productReferences,
    dialogue: adaptation.dialogue,
    requirements: input.requirements,
    referenceCopy: input.referenceCopy,
    copyMode: input.copyMode,
    targetModel
  });
  let deterministic = validateReplicaPrompt(prompt, input.dna);
  if (!deterministic.passed) {
    prompt = compileReplicaPrompt({
      dna: input.dna,
      product: input.product,
      dialogue: adaptation.dialogue,
      requirements: input.requirements,
    referenceCopy: input.referenceCopy,
    copyMode: input.copyMode,
      auditCorrections: deterministic.missing.map((item) => `补回缺失模块：${item}，不得省略。`),
      targetModel
    });
    deterministic = validateReplicaPrompt(prompt, input.dna);
  }
  const selfCheck = await runSelfCheck(prompt, input.dna, deterministic);
  if (selfCheck.correctionDirectives.length) {
    prompt = compileReplicaPrompt({
      dna: input.dna,
      product: input.product,
      dialogue: adaptation.dialogue,
      requirements: input.requirements,
      referenceCopy: input.referenceCopy,
      copyMode: input.copyMode,
      auditCorrections: selfCheck.correctionDirectives,
      targetModel
    });
  }
  const finalCheck = validateReplicaPrompt(prompt, input.dna);
  const fidelityChecklist = buildFidelityChecklist({ dna: input.dna, prompt, dialogue: adaptation.dialogue, copyMode: input.copyMode });
  if (!finalCheck.passed) {
    warnings.push(`自动自检仍发现结构字段：${finalCheck.missing.join("、")}；已保留完整原始镜头结构。`);
  }
  return {
    title: `${input.product.name || "我的产品"} · 爆款复刻`,
    prompt,
    selfCheck,
    warnings,
    fidelityChecklist
  };
}

async function adaptDialogue(input: {
  dnaDialogue: ReplicaDialogueDNA[];
  productName: string;
  productFacts: string[];
  requirements: string;
  referenceCopy: string;
  copyMode: "source" | "custom";
  customCopy?: string;
  shots: VideoDNA["shots"];
  sourceCandidates: string[];
}) {
  if (input.copyMode === "custom" && input.customCopy?.trim()) {
    return {
      source: "user" as const,
      dialogue: buildCustomDialogue(input.customCopy.trim(), input.dnaDialogue, input.shots),
      warnings: []
    };
  }
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
        dialogue: input.dnaDialogue.map((item) => ({ id: item.id, start: item.start, end: item.end, speaker: item.speaker, text: item.text, emotion: item.emotion }))
      }),
      temperature: 0.1,
      maxTokens: 9000
    }) as { dialogue?: unknown };
    const adapted = Array.isArray(raw.dialogue) ? raw.dialogue.map(asRecord) : [];
    const byId = new Map(adapted.map((item) => [String(item.id), item]));
    const dialogue = input.dnaDialogue.map((item) => {
      const replacement = byId.get(item.id);
      const text = typeof replacement?.adaptedText === "string" ? replacement.adaptedText.trim() : "";
      return text ? {
        ...item,
        originalText: item.text,
        adaptedText: text,
        adaptationReason: typeof replacement?.adaptationReason === "string" ? replacement.adaptationReason.slice(0, 260) : "AI 最小替换。"
      } satisfies ReplicaAdaptedDialogue : localAdaptedDialogue(item, input.productName, input.sourceCandidates);
    });
    return { source: "deepseek" as const, dialogue, warnings: [] as string[] };
  } catch (error) {
    return { source: "fallback" as const, dialogue: fallback, warnings: [`文案适配未调用成功：${error instanceof Error ? error.message : "未知错误"}；已保留原台词结构并做最小本地替换。`] };
  }
}

function buildCustomDialogue(customText: string, dnaDialogue: ReplicaDialogueDNA[], shots: VideoDNA["shots"]): ReplicaAdaptedDialogue[] {
  const speechLines = parseCustomSpeechLines(customText);
  if (!speechLines.length) return [];
  const duration = shots.length ? shots[shots.length - 1].end : Math.max(...dnaDialogue.map((item) => item.end), 0.25);
  const totalWeight = speechLines.reduce((sum, item) => sum + Math.max(item.text.length, 1), 0);
  let cursor = 0;
  return speechLines.map((line, index) => {
    const previousEnd = cursor;
    const length = Math.max(line.text.length, 1) / totalWeight * duration;
    const start = Math.max(0, cursor);
    const end = Math.min(duration, cursor + length);
    cursor = end;
    const midpoint = (start + end) / 2;
    const nearestOriginal = dnaDialogue.reduce<ReplicaDialogueDNA | null>((best, item) => !best || Math.abs((item.start + item.end) / 2 - midpoint) < Math.abs((best.start + best.end) / 2 - midpoint) ? item : best, null);
    return {
      id: `user_dialogue_${String(index + 1).padStart(2, "0")}`,
      speaker: line.speaker || nearestOriginal?.speaker || "画面人物",
      start,
      end,
      text: line.text,
      speakingRate: nearestOriginal?.speakingRate || "按原视频语速节奏",
      pauses: "按句子长度和原视频情绪节奏分配",
      emphasis: nearestOriginal?.emphasis || "按用户台词语义强调",
      emotion: nearestOriginal?.emotion || "按原视频对应区间情绪",
      offscreen: line.speaker ? /画外音|旁白/.test(line.speaker) : nearestOriginal?.offscreen || false,
      interruption: nearestOriginal?.interruption || "无",
      gapFromPrevious: index === 0 ? 0 : Math.max(0, start - previousEnd),
      syncWithAction: "与同时间区间的动作、眼神和表情保持同步；用户台词替换原台词。",
      originalText: line.text,
      adaptedText: line.text,
      adaptationReason: "用户台词最高优先级；时间区间按视频总时长、镜头边界和句子长度分配。"
    } satisfies ReplicaAdaptedDialogue;
  });
}

function parseCustomSpeechLines(customText: string) {
  return customText.split(/\n+/).flatMap((line) => {
    const trimmed = line.trim();
    if (!trimmed) return [];
    const speakerMatch = trimmed.match(/^(女主|男主|女|男|旁白|画外音|人物A|人物B|甲|乙)\s*[:：]\s*(.+)$/);
    if (speakerMatch) return [{ speaker: speakerMatch[1], text: speakerMatch[2].trim() }];
    return trimmed.split(/(?<=[。！？!?；;])/).map((sentence) => sentence.trim()).filter(Boolean).map((sentence) => ({ speaker: "", text: sentence }));
  });
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
      user: JSON.stringify({ auditPayload: buildAuditPayload(prompt, dna), deterministicCheck: deterministic }),
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
      id: item.id, speaker: item.speaker, start: item.start, end: item.end, text: item.text,
      speakingRate: item.speakingRate, pauses: item.pauses, emphasis: item.emotion, emotion: item.emotion,
      syncWithAction: item.syncWithAction
    })),
    expectedShots: dna.shots.map((shot) => ({
      id: shot.id, index: shot.index, start: shot.start, end: shot.end, duration: shot.duration,
      purpose: shot.purpose, subjects: shot.subjects, environment: shot.environment, props: shot.props,
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

function stringArray(value: unknown) {
  return Array.isArray(value) ? value.map((item) => typeof item === "string" ? item.trim() : String(item || "").trim()).filter(Boolean) : [];
}
