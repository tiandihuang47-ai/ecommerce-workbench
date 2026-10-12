import { formatTimestamp } from "@/lib/replica-config";
import type { ReplicaAdaptedDialogue, ReplicaProductUnderstanding, VideoDNA } from "@/lib/replica-types";

export interface ReplicaProductReference {
  reference: string;
  assetId?: string;
  name: string;
  role: string;
}

export interface ReplicaFidelityCheck {
  key: string;
  covered: number;
  total: number;
  passed: boolean;
}

export function compileReplicaPrompt(options: {
  dna: VideoDNA;
  product: ReplicaProductUnderstanding;
  productReferences?: Array<{ assetId?: string; name: string }>;
  dialogue: ReplicaAdaptedDialogue[];
  requirements: string;
  referenceCopy: string;
  copyMode: "source" | "custom";
  auditCorrections?: string[];
  targetModel?: string;
}) {
  const { dna, product } = options;
  const lines: string[] = [];
  const add = (...values: string[]) => values.filter((value) => value.trim()).forEach((value) => lines.push(value));
  const productReferences = normalizeProductReferences(options.productReferences || [], product.name);
  const targetModel = options.targetModel?.trim() || "Seedance 2.5";

  add(
    "GLOBAL CONSTRAINTS / HIGHEST FIDELITY",
    "目标：MAXIMUM REPLICATION。除目标产品和用户明确选择的文案外，所有可从 SOURCE VIDEO 继承的信息默认 LOCK。",
    "必须生成一条与 SOURCE VIDEO 在总时长、镜头开始/结束、镜头顺序、镜头长度、景别、机位、高度、角度、焦段感、构图、主体占比、运镜、人物数量、人物关系、站位、朝向、距离、调度、肢体动作、头部动作、手部动作、手指动作、腿部/脚步、重心、眼神、视线切换、微表情、情绪、情绪变化速度、台词时序、场景、前景、背景、道具、天气、光线、色温、产品位置、持拿方式、剪辑节奏、情绪节奏、BGM、环境音、音效和连续性上尽可能 1:1 的视频。",
    "默认策略：HIGHEST FIDELITY。未标记 REPLACE / ADAPT 的元素禁止自由发挥、新增镜头、删减镜头、改变剧情、改变人物关系或替换风格。",
    `原视频总时长：${formatTimestamp(dna.metadata.duration)}；画面：${dna.metadata.width}x${dna.metadata.height}；原始帧率约 ${dna.metadata.fps.toFixed(3)} fps。`,
    "时间轴必须使用绝对时间戳；动作先后、停顿、转向、视线切换和切镜不得提前或延后。",
    `TARGET MODEL：${targetModel}。按该模型可理解的长 Prompt 执行，但不得为省字数删除时间点、动作、眼神、微表情、调度、连续性或产品一致性细节。`,
    "OUTPUT：只输出一条可直接粘贴到目标视频模型的完整 Prompt；不要输出解释、确认语、分步建议、分析报告或多个版本。"
  );

  add("LOCK MATRIX", ...[
    "总时长 LOCK", "镜头顺序 LOCK", "镜头开始/结束 LOCK", "镜头长度 LOCK", "景别 LOCK", "机位/高度/角度 LOCK", "焦段感 LOCK",
    "构图 LOCK", "主体画面位置 LOCK", "主体占比 LOCK", "运镜类型/方向/速度 LOCK", "稳定度 LOCK", "人物数量 LOCK", "人物身份关系 LOCK",
    "入场/离场 LOCK", "站位/朝向 LOCK", "人物距离 LOCK", "镜头距离 LOCK", "场面调度 LOCK", "肢体动作 LOCK", "头部动作 LOCK",
    "手部/手指动作 LOCK", "腿部/脚步 LOCK", "重心/姿态 LOCK", "眼神/视线切换 LOCK", "微表情 LOCK", "情绪状态/变化/变化速度 LOCK",
    "台词结构与时序 LOCK", "语速/停顿/重音/语气 LOCK", "是否画外音 LOCK", "场景/背景/前景 LOCK", "道具 LOCK", "天气/建筑/环境 LOCK",
    "光线/色温/方向/光比 LOCK", "产品出现位置 LOCK", "产品持拿方式 LOCK", "剪辑/情绪/BGM节奏 LOCK", "环境音/音效 LOCK",
    "镜头/人物/产品/场景连续性 LOCK", "目标产品 REPLACE", "必要产品/品牌/价格文案 ADAPT"
  ].map((item) => `- ${item}`));

  add(
    "SOURCE VIDEO FIDELITY",
    `镜头边界：${dna.shotBoundaries.map(formatTimestamp).join(" → ")}`,
    `原视频环境：${formatEnvironment(dna)}`,
    `原视频节奏：平均镜头 ${dna.rhythm.averageShotLength.toFixed(3)} 秒；${dna.rhythm.pace}；钩子 ${formatTimestamp(dna.rhythm.hookTime)}；情绪高潮 ${formatTimestamp(dna.rhythm.emotionalPeakTime)}；转折 ${formatTimestamp(dna.rhythm.turnTime)}；CTA ${formatTimestamp(dna.rhythm.ctaTime)}。`,
    `全局连续性：${dna.continuity.join("；") || "保持人物、产品、光线、方向和道具连续。"}`
  );

  add("CHARACTER LOCK");
  dna.characters.forEach((character) => add(
    `- ${character.id}｜角色：${character.role}｜呈现年龄：${character.agePresentation}｜性别表现：${character.genderPresentation}｜身材：${character.build}｜身高比例：${character.heightProportion}`,
    `  发型：${character.hair}｜服装（目标产品除外）：${character.clothing}｜初始位置：${character.initialPosition}｜朝向：${character.orientation}｜镜头距离：${character.cameraDistance}｜与其他人物：${character.relationToOthers}｜入场 ${formatTimestamp(character.entrance)}｜离场 ${formatTimestamp(character.exit)}`
  ));

  add("PRODUCT REFERENCE MAP");
  productReferences.forEach((item) => add(
    `- ${item.reference}｜文件：${item.name}｜权威用途：${item.role}${item.assetId ? `｜assetId：${item.assetId}` : ""}`
  ));
  add("- 所有 PRODUCT_REF 均来自用户上传产品图，是颜色、版型、衣长、材质、面料、绗缝、拉链、口袋、帽子、领口、袖口、Logo、字母、图案和装饰的最高视觉事实来源。");

  add("PRODUCT REPLACEMENT",
    `- SOURCE PRODUCT：${dna.productMapping.sourceCandidates.join("；") || "原视频中可见的目标产品"}`,
    `- SOURCE LOCATION：${dna.productMapping.sourceLocations.join("；") || "按各镜头 product 标注"}`,
    `- REPLACE WITH：用户上传的 ${product.name}`,
    `- 颜色：${product.color}`,
    `- 版型/衣长/轮廓：${product.silhouette}`,
    `- 材质/面料：${product.material}`,
    `- 结构：${product.construction}`,
    `- Logo：${product.logo}`,
    `- 文字/图案：${product.textAndPattern}`,
    `- 细节：${product.details.join("；") || product.facts.join("；") || "以产品参考图为准"}`,
    `- 替换规则：${dna.productMapping.replacementInstruction}`,
    `- 一致性硬约束：${[...product.consistencyConstraints, ...dna.productMapping.consistencyRules].join("；")}`,
    "- 在运动、转身、遮挡、手持、远景和特写中，目标产品必须保持同一颜色、衣长、版型、结构、材质、Logo、文字、图案和细节；禁止变形、漂移、换色、增删部件或替换成相似产品。",
    "- 不能把原视频产品的外观、Logo、文字、颜色或版型带到用户产品上。"
  );

  add("DIALOGUE AUTHORITY");
  if (options.copyMode === "custom") {
    add(
      "- COPY MODE：USER_COPY。用户文案是台词最高事实来源。",
      "- 必须把用户文案映射回原视频时间结构，保持人物问答关系、动作配合、情绪变化、镜头节奏和台词起止位置。",
      "- 用户文案过长时由系统压缩适配；过短时按原视频对话节奏合理分配；不得重新询问用户。"
    );
  } else {
    add(
      "- COPY MODE：SOURCE_COPY。完整保留识别出的原视频台词结构、说话者、起止时间、语速、停顿、重音、语气、是否画外音和先后关系。",
      "- 只有因原产品视觉替换导致明显逻辑冲突时，才做最小必要产品词适配。"
    );
  }
  if (options.referenceCopy.trim()) add(`- 参考文案补充（低于用户明确选择）：${options.referenceCopy.trim()}`);
  if (options.requirements.trim()) add(`- 用户补充要求：${options.requirements.trim()}`);

  add("ADAPTED DIALOGUE TIMELINE");
  if (options.dialogue.length) {
    options.dialogue.forEach((item) => add(
      `- ${item.id}｜${formatTimestamp(item.start)}–${formatTimestamp(item.end)}｜说话者：${item.speaker}｜画外音：${item.offscreen ? "是" : "否"}｜语速：${item.speakingRate}｜停顿：${item.pauses}｜重音：${item.emphasis}｜语气/情绪：${item.emotion}`,
      `  原台词：${item.originalText}`,
      `  最终台词：${item.adaptedText}`,
      `  动作同步：${item.syncWithAction}；适配依据：${item.adaptationReason}`
    ));
  } else {
    add("- SOURCE COPY 模式未获得可靠逐字稿；不得凭空补写台词。保持自然口型或安静状态、原音频节奏和表情情绪。");
  }

  add("SHOT EXECUTION");
  dna.shots.forEach((shot) => {
    const shotId = `SHOT ${String(shot.index).padStart(2, "0")}`;
    const productRef = selectProductReference([shot.environment, ...shot.events, ...shot.subjects, ...shot.props, shot.camera.shotSize, shot.camera.composition], productReferences);
    add(
      "",
      `${shotId}`,
      `TIME RANGE｜${formatTimestamp(shot.start)}–${formatTimestamp(shot.end)}｜时长 ${shot.duration.toFixed(3)} 秒`,
      `SHOT PURPOSE｜${shotPurpose(shot, dna)}`,
      `CAMERA｜景别：${shot.camera.shotSize}；高度：${shot.camera.cameraHeight}；水平角：${shot.camera.horizontalAngle}；俯仰角：${shot.camera.pitchAngle}；焦段感：${shot.camera.lensFeel}；主体位置：${shot.camera.subjectFraming}；主体占比：${shot.camera.subjectScale}`,
      `CAMERA MOVEMENT｜类型：${shot.camera.movement}；方向：${shot.camera.movementDirection}；速度：${shot.camera.movementSpeed}；稳定度：${shot.camera.stability}；切镜：${shot.camera.cutTransition}`,
      `CHARACTERS｜${shot.subjects.join("；") || "沿用角色锁定"}`,
      `ENVIRONMENT｜${shot.environment}`,
      `LIGHTING｜${[dna.environment.lighting, dna.environment.colorTemperature, dna.environment.lightDirection, dna.environment.contrast].filter(Boolean).join("；")}`,
      `BACKGROUND｜${shot.camera.background || dna.environment.elements.join("；")}`,
      `PROPS｜${shot.props.join("；") || "沿用原道具"}`,
      `PRODUCT｜原产品位置：${shot.camera.focusPoint || dna.productMapping.sourceLocations.join("；") || "按原片"}；用户产品参考：${productRef.reference}；角度/光照：沿用原片角度与光线；持拿/穿着方式：由本镜头 BODY MOTION 和 BLOCKING 锁定；结构保持：颜色、版型、材质、Logo、文字、图案不得变化`
    );
    shot.events.forEach((event) => add(`SUB-EVENT｜${event}`));
    shot.actions.forEach((action) => add(
      `BODY MOTION｜${formatTimestamp(action.start)}–${formatTimestamp(action.end)}｜${action.subjectId}`,
      `  HEAD｜${action.head}`,
      `  SHOULDERS/TORSO｜${action.shoulders}；${action.torso}`,
      `  ARMS｜${action.arms}`,
      `  HAND/FINGER｜${action.hands}；${action.fingers}`,
      `  LEG/FOOT｜${action.legs}；${action.feet}`,
      `  WEIGHT/POSTURE｜${action.weight}；${action.lean}`,
      `  MOTION DYNAMICS｜速度：${action.speed}；幅度：${action.amplitude}；方向：${action.direction}；顺序：${action.sequence}`
    ));
    shot.facialExpressions.forEach((face) => add(
      `FACIAL EXPRESSION｜${formatTimestamp(face.start)}–${formatTimestamp(face.end)}｜${face.subjectId}`,
      `  EYE GAZE｜方向：${face.gazeDirection}；目标：${face.gazeTarget}；眼睛睁开程度：${face.eyeOpenness}`,
      `  MICRO EXPRESSION｜眉毛：${face.eyebrows}；眼睛：${face.eyeOpenness}；嘴唇：${face.lips}；嘴角：${face.mouthCorners}；下巴：${face.chin}；眨眼：${face.blinking}`,
      `  EMOTION｜状态：${face.emotion}；变化：${face.change}；强度：${face.intensity}；变化速度：${face.transitionSpeed}`
    ));
    shot.blocking.forEach((block) => add(
      `BLOCKING｜${formatTimestamp(block.start)}–${formatTimestamp(block.end)}｜${block.subjectId}`,
      `  POSITION｜入场：${block.entry}；离场：${block.exit}；站位：${block.position}；朝向：${block.facing}`,
      `  DISTANCE｜与镜头：${block.distanceToCamera}；与他人：${block.distanceToOthers}`,
      `  MOVEMENT/OCCLUSION｜移动：${block.movement}；遮挡：${block.occlusion}；道具关系：${block.propRelation}；环境关系：${block.environmentRelation}`
    ));
    const shotDialogue = options.dialogue.filter((item) => item.start < shot.end && item.end > shot.start);
    if (shotDialogue.length) {
      shotDialogue.forEach((item) => add(`DIALOGUE｜${formatTimestamp(item.start)}–${formatTimestamp(item.end)}｜${item.speaker}｜${item.adaptedText}｜语速：${item.speakingRate}；停顿：${item.pauses}；情绪：${item.emotion}`));
    }
    shot.dialogueIds.forEach((id) => add(`DIALOGUE SYNC｜${id} 保持原时间关系，不提前、不延后、不改说话者关系。`));
    shot.audioCues.forEach((cue) => add(`AUDIO｜${cue}`));
    shot.continuity.forEach((item) => add(`CONTINUITY｜${item}`));
    const nextShot = dna.shots.find((item) => item.index === shot.index + 1);
    add(`TRANSITION TO NEXT SHOT｜${nextShot ? `在 ${formatTimestamp(nextShot.start)} 按原片方式过渡：${shot.camera.cutTransition}` : `视频在 ${formatTimestamp(shot.end)} 结束，保持最后姿态稳定收尾。`}`);
  });

  add("0.25s EXECUTION TIMELINE", "以下为最终执行层。每个区间必须同时执行人物肢体、手部/道具、表情眼神、调度、产品状态、台词和音频连续性；未写出的细节必须从相邻区间连续过渡。");
  for (let time = 0; time < dna.metadata.duration; time += 0.25) {
    const stepStart = Math.min(time, dna.metadata.duration);
    const stepEnd = Math.min(time + 0.25, dna.metadata.duration);
    const shot = dna.shots.find((item) => stepStart >= item.start && stepStart < item.end) || dna.shots[dna.shots.length - 1];
    if (!shot) continue;
    const actions = findActive(shot.actions, stepStart, stepEnd);
    const faces = findActive(shot.facialExpressions, stepStart, stepEnd);
    const blocking = findActive(shot.blocking, stepStart, stepEnd);
    const dialogue = findActive(options.dialogue, stepStart, stepEnd);
    const frame = nearestFrameObservation(dna.frameObservations, (stepStart + stepEnd) / 2);
    add(
      `TIMELINE｜${formatTimestamp(stepStart)}–${formatTimestamp(stepEnd)}`,
      `  CAMERA｜景别/构图：${shot.camera.shotSize}；运动：${shot.camera.movement}；方向：${shot.camera.movementDirection}；速度：${shot.camera.movementSpeed}；焦点：${shot.camera.focusPoint}`,
      `  VISUAL EVIDENCE｜${frame?.visualSummary || "沿用上一区间画面"}`,
      `  BODY & HANDS｜${actions.map((item) => `${item.subjectId}：头${item.head}；肩${item.shoulders}；上身${item.torso}；臂${item.arms}；手${item.hands}；指${item.fingers}；腿脚${item.legs}/${item.feet}；重心${item.weight}；速度${item.speed}`).join(" || ") || "沿用上一区间人物状态"}`,
      `  EYE & FACE｜${faces.map((item) => `${item.subjectId}：情绪${item.emotion}；变化${item.change}；眼神${item.gazeDirection}/${item.gazeTarget}；眉眼嘴${item.eyebrows}/${item.lips}/${item.mouthCorners}；强度${item.intensity}`).join(" || ") || "沿用上一区间表情与眼神"}`,
      `  BLOCKING｜${blocking.map((item) => `${item.subjectId}：位置${item.position}；朝向${item.facing}；移动${item.movement}；与他人距离${item.distanceToOthers}；遮挡${item.occlusion}`).join(" || ") || "沿用上一区间调度"}`,
      `  PROPS & PRODUCT｜道具：${shot.props.join("；") || "沿用上一区间"}；产品状态：${frame?.product || "保持目标产品上一区间状态"}`,
      `  DIALOGUE｜${dialogue.length ? dialogue.map((item) => `${formatTimestamp(item.start)}–${formatTimestamp(item.end)} ${item.speaker}:${item.adaptedText}`).join(" || ") : "无台词或沿用上一区间台词状态；保持自然口型/安静状态"}`,
      `  AUDIO & CONTINUITY｜${shot.audioCues.join("；") || "沿用原音频"}；${shot.continuity.join("；") || "与前后帧连续"}`
    );
  }

  add("AUDIO DNA",
    `- 人声：${dna.audio.voice}`,
    `- 环境声：${dna.audio.environment}`,
    `- 背景音乐：${dna.audio.music}`,
    `- 音效：${dna.audio.soundEffects.join("；") || "保留原片已有音效，不新增无证据音效"}`,
    `- 节拍变化：${dna.audio.beatChanges.join("；") || "按原片"}`,
    `- 音量变化：${dna.audio.volumeChanges.join("；") || "按原片"}`,
    `- 静音窗口：${dna.audio.silenceWindows.map((item) => `${formatTimestamp(item.start)}–${formatTimestamp(item.end)}`).join("；") || "未确认"}`,
    `- 关键音画同步：${dna.audio.keySync.join("；") || "按原片动作、台词、切镜同步"}`);

  add("EDITING & RHYTHM",
    `- 快慢变化：${dna.rhythm.pace}`,
    `- 钩子时间：${formatTimestamp(dna.rhythm.hookTime)}；情绪高潮：${formatTimestamp(dna.rhythm.emotionalPeakTime)}；产品信息：${dna.rhythm.productInfoTime.map(formatTimestamp).join("、") || "按原片"}；价格信息：${dna.rhythm.priceInfoTime.map(formatTimestamp).join("、") || "按原片"}；转折：${formatTimestamp(dna.rhythm.turnTime)}；CTA：${formatTimestamp(dna.rhythm.ctaTime)}`,
    `- 切换节奏：${dna.rhythm.cutRhythm}`,
    `- 动作与台词关系：${dna.rhythm.actionDialogueRelationship}`);

  add("FINAL NEGATIVE CONSTRAINTS",
    "不要删镜头、合并镜头、改变镜头长度、改变景别、改变机位、改变运镜、改变人物数量/站位/关系、改变动作顺序、夸张微表情、重写成全新广告、添加无事实价格/功效/背书、改变场景光线、让产品变形或让台词脱离原时间轴。",
    "最终画面必须先满足源视频连续性，再满足产品替换和用户选择的文案模式。",
    "如果视觉模型无法确定某个细节，沿用原画面，不要自行创造。");
  if (options.auditCorrections?.length) add("FINAL SELF-CHECK CORRECTIONS", ...options.auditCorrections.map((item) => `- ${item}`));

  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

export function validateReplicaPrompt(prompt: string, dna: VideoDNA) {
  const checks = [
    { key: "镜头覆盖", pass: dna.shots.every((shot) => prompt.includes(`SHOT ${String(shot.index).padStart(2, "0")}`) && prompt.includes(formatTimestamp(shot.start)) && prompt.includes(formatTimestamp(shot.end))) },
    { key: "镜头目的", pass: prompt.includes("SHOT PURPOSE") },
    { key: "动作覆盖", pass: dna.shots.every((shot) => shot.actions.every((action) => prompt.includes(formatTimestamp(action.start)) && prompt.includes(formatTimestamp(action.end)))) },
    { key: "表情/眼神覆盖", pass: dna.shots.every((shot) => shot.facialExpressions.every((face) => prompt.includes(formatTimestamp(face.start)))) },
    { key: "调度覆盖", pass: dna.shots.every((shot) => shot.blocking.every((block) => prompt.includes(formatTimestamp(block.start)))) },
    { key: "产品替换", pass: prompt.includes("PRODUCT REPLACEMENT") && prompt.includes("REPLACE WITH") },
    { key: "产品参考图", pass: prompt.includes("PRODUCT REFERENCE MAP") && prompt.includes("PRODUCT_REF_01") },
    { key: "台词时序", pass: prompt.includes("DIALOGUE AUTHORITY") },
    { key: "0.25秒执行时间轴", pass: prompt.includes("0.25s EXECUTION TIMELINE") && prompt.includes("TIMELINE｜") }
  ];
  return { passed: checks.every((item) => item.pass), missing: checks.filter((item) => !item.pass).map((item) => item.key) };
}

export function buildFidelityChecklist(input: {
  dna: VideoDNA;
  prompt: string;
  dialogue: ReplicaAdaptedDialogue[];
  copyMode: "source" | "custom";
}): ReplicaFidelityCheck[] {
  const { dna, prompt, dialogue } = input;
  const shotTotal = dna.shots.length;
  const shotCovered = dna.shots.filter((shot) => prompt.includes(`SHOT ${String(shot.index).padStart(2, "0")}`)).length;
  const actionTotal = dna.shots.reduce((sum, shot) => sum + shot.actions.length, 0);
  const actionCovered = dna.shots.reduce((sum, shot) => sum + shot.actions.filter((action) => prompt.includes(formatTimestamp(action.start))).length, 0);
  const faceTotal = dna.shots.reduce((sum, shot) => sum + shot.facialExpressions.length, 0);
  const faceCovered = dna.shots.reduce((sum, shot) => sum + shot.facialExpressions.filter((face) => prompt.includes(formatTimestamp(face.start))).length, 0);
  const blockingTotal = dna.shots.reduce((sum, shot) => sum + shot.blocking.length, 0);
  const blockingCovered = dna.shots.reduce((sum, shot) => sum + shot.blocking.filter((block) => prompt.includes(formatTimestamp(block.start))).length, 0);
  const dialogueTotal = input.copyMode === "source" ? dna.dialogue.length : dialogue.length;
  const dialogueCovered = input.copyMode === "source" ? dna.dialogue.filter((item) => prompt.includes(item.id)).length : dialogue.filter((item) => prompt.includes(item.id)).length;
  return [
    { key: "shotCoverage", covered: shotCovered, total: shotTotal, passed: shotCovered === shotTotal },
    { key: "actionCoverage", covered: actionCovered, total: actionTotal, passed: actionCovered === actionTotal },
    { key: "expressionCoverage", covered: faceCovered, total: faceTotal, passed: faceCovered === faceTotal },
    { key: "blockingCoverage", covered: blockingCovered, total: blockingTotal, passed: blockingCovered === blockingTotal },
    { key: "dialogueCoverage", covered: dialogueCovered, total: dialogueTotal, passed: dialogueCovered >= dialogueTotal },
    { key: "timelineCoverage", covered: prompt.includes("0.25s EXECUTION TIMELINE") ? 1 : 0, total: 1, passed: prompt.includes("0.25s EXECUTION TIMELINE") },
    { key: "productMappingCoverage", covered: prompt.includes("PRODUCT REPLACEMENT") && prompt.includes("PRODUCT_REF_01") ? 1 : 0, total: 1, passed: prompt.includes("PRODUCT REPLACEMENT") && prompt.includes("PRODUCT_REF_01") },
    { key: "continuityCoverage", covered: prompt.includes("CONTINUITY") ? 1 : 0, total: 1, passed: prompt.includes("CONTINUITY") }
  ];
}

function normalizeProductReferences(products: Array<{ assetId?: string; name: string }>, productName: string): ReplicaProductReference[] {
  if (!products.length) return [{ reference: "PRODUCT_REF_01", name: `${productName}参考图`, role: "全角度产品外观权威参考" }];
  return products.map((item, index) => {
    const name = item.name || `产品图 ${index + 1}`;
    const role = productImageRole(name, index, products.length);
    return { reference: `PRODUCT_REF_${String(index + 1).padStart(2, "0")}`, assetId: item.assetId, name, role };
  });
}

function productImageRole(name: string, index: number, total: number) {
  const text = name.toLowerCase();
  if (/背面|后背|back/.test(text)) return "背面、后背结构和背部Logo/文字的权威参考";
  if (/侧面|侧身|side|profile/.test(text)) return "侧面轮廓、衣长、袖型和厚度参考";
  if (/细节|袖口|口袋|拉链|logo|图案|材质|fabric|detail/.test(text)) return "局部细节、Logo、文字、材质和工艺权威参考";
  if (/正面|正身|front|白底/.test(text)) return "正面版型、颜色、门襟和主Logo权威参考";
  if (index === 0) return "主参考：整体颜色、版型、结构和主要细节";
  return `补充参考 ${index + 1}/${total}：用于交叉验证产品一致性`;
}

function selectProductReference(text: string | string[], references: ReplicaProductReference[]) {
  const haystack = Array.isArray(text) ? text.join("\n") : text;
  const scored = references.map((item) => {
    const source = `${item.name} ${item.role}`.toLowerCase();
    let score = 0;
    if (/背|后背|back/.test(haystack) && /背面|后背|back/.test(source)) score += 6;
    if (/侧|侧面|profile|side/.test(haystack) && /侧面|side|profile/.test(source)) score += 5;
    if (/袖口|口袋|拉链|细节|材质|logo|文字|图案/.test(haystack) && /细节|袖口|口袋|拉链|logo|文字|图案|材质|detail/.test(source)) score += 5;
    if (/正面|正身|front/.test(haystack) && /正面|正身|front|主参考/.test(source)) score += 4;
    return { item, score };
  }).sort((a, b) => b.score - a.score);
  return scored[0]?.score ? scored[0].item : references[0];
}

function shotPurpose(shot: VideoDNA["shots"][number], dna: VideoDNA) {
  const text = [...shot.events, ...shot.subjects, shot.environment, ...shot.props].join("；");
  if (shot.index === 1 || Math.abs(shot.start - dna.rhythm.hookTime) < 0.35) return "开场钩子：按原片首帧构图与动作建立人物、场景和关注点。";
  if (Math.abs(dna.rhythm.turnTime - shot.start) < 0.35 || Math.abs(dna.rhythm.emotionalPeakTime - shot.start) < 0.35) return "情绪/转折段：保持原片情绪推进和动作变化。";
  if (Math.abs(dna.rhythm.ctaTime - shot.start) < 0.35 || /链接|下单|购买|引导|CTA/i.test(text)) return "转化/收尾段：保持原片引导方式和节奏。";
  return "信息推进段：保持原片动作、台词、镜头和产品可见性。";
}

function formatEnvironment(dna: VideoDNA) {
  return [dna.environment.sceneType, dna.environment.time, dna.environment.weather, dna.environment.lighting, dna.environment.colorTemperature, dna.environment.lightDirection, dna.environment.contrast, dna.environment.elements.join("；"), dna.environment.architecture, dna.environment.ground, dna.environment.ceiling, dna.environment.depth].filter(Boolean).join("；");
}

function findActive<T extends { start: number; end: number }>(items: T[], start: number, end: number) {
  return items.filter((item) => item.start < end && item.end > start).sort((a, b) => a.start - b.start);
}

function nearestFrameObservation(observations: VideoDNA["frameObservations"], time: number) {
  if (!observations.length) return null;
  return observations.reduce((best, item) => Math.abs(item.timestamp - time) < Math.abs(best.timestamp - time) ? item : best, observations[0]);
}
