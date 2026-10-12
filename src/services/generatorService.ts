import { viralElementRules } from "@/data/director-rules";
import { createId, nowIso } from "@/lib/shared/time";
import type {
  ContentAsset,
  ContentGoal,
  EditBrief,
  Platform,
  ProductProfile,
  Project,
  PublishPlan,
  ReviewRecord,
  ScriptItem,
  ShotList,
  ShotRow,
  TopicCard,
  VideoTask,
  ViralAnalysis
} from "@/lib/pipeline-types";

export interface TopicGenerationInput {
  project: Project;
  product?: ProductProfile;
  count: number;
  goal: ContentGoal;
  angle: string;
  extra: string;
}

export interface ScriptGenerationInput {
  project: Project;
  product?: ProductProfile;
  topic: TopicCard;
  scriptType: string;
  duration: string;
  style: string;
  extra: string;
}

export interface ShotListGenerationInput {
  project: Project;
  product?: ProductProfile;
  script: ScriptItem;
  task?: VideoTask;
  scene: string;
  needModel: boolean;
  needProductCloseup: boolean;
  needPictureInPicture: boolean;
}

export interface PublishPlanGenerationInput {
  project: Project;
  task?: VideoTask;
  script?: ScriptItem;
  shotList?: ShotList;
  platform: Platform;
  goal: ContentGoal;
}

export interface EditBriefGenerationInput {
  project: Project;
  product?: ProductProfile;
  task?: VideoTask;
  script?: ScriptItem;
  shotList?: ShotList;
  editor: string;
  targetDuration: string;
  rhythm: EditBrief["rhythm"];
  deadline: string;
}

export interface ViralAnalysisInput {
  url: string;
  title: string;
  transcript: string;
  industry: string;
  platform: Platform;
}

export function generateTopics(input: TopicGenerationInput): TopicCard[] {
  const product = input.product;
  const sellingPoint = product?.sellingPoints || input.project.sellingPoints;
  const painPoint = product?.painPoints || input.project.painPoints;
  const audience = product?.audience || input.project.audience;
  const templates = [
    "第一次买{product}，最容易被忽略的 3 个成本",
    "{audience}别急着下单，先看懂这个避坑标准",
    "为什么便宜的{product}，最后反而更贵",
    "我替{audience}测了一个真实场景，结果很反常识",
    "评论区问得最多的{product}问题，一次讲透",
    "老板视角：我最怕客户只看价格不看这一步",
    "{industry}里外行不知道的一个真实差距",
    "想成交前，先让用户相信你解决这个痛点"
  ];

  return Array.from({ length: Math.max(1, input.count) }).map((_, index) => {
    const rule = viralElementRules[index % viralElementRules.length];
    const title = templates[index % templates.length]
      .replaceAll("{product}", product?.productName || input.project.productName)
      .replaceAll("{audience}", audience || "目标用户")
      .replaceAll("{industry}", input.project.industry);
    const now = nowIso();

    return {
      id: createId("topic"),
      projectId: input.project.id,
      productId: product?.id || "",
      title,
      audience,
      painPoint,
      angle: input.angle,
      hook: `${audience || "目标用户"}如果正在纠结${product?.productName || input.project.productName}，先别急着花钱，真正影响结果的是这一点。`,
      coreOpinion: `${input.angle}内容要先放大用户真实担心，再用可验证的标准证明“${sellingPoint || "产品价值"}”。`,
      sellingPoint,
      shootingSuggestion: `拍真实场景、产品细节和用户决策过程；画面里要出现${product?.materialConditions || "产品细节、服务过程、对比结果"}。`,
      conversionAction: input.goal === "私信咨询" ? "引导评论区留言问题，再私信承接具体方案。" : "结尾引导收藏、评论需求或进入直播间咨询。",
      platform: input.project.targetPlatform,
      priority: index < 2 ? "高" : index < 5 ? "中" : "低",
      adopted: false,
      createdAt: now,
      updatedAt: now
    };
  });
}

export function generateScript(input: ScriptGenerationInput): ScriptItem {
  const productName = input.product?.productName || input.project.productName;
  const sellingPoint = input.product?.sellingPoints || input.project.sellingPoints;
  const painPoint = input.topic.painPoint || input.project.painPoints;
  const forbiddenWords = [input.project.forbiddenWords, input.product?.forbiddenWords].filter(Boolean).join("、") || "不要夸大承诺，不说绝对化效果";
  const now = nowIso();

  return {
    id: createId("script"),
    projectId: input.project.id,
    productId: input.product?.id || "",
    topicId: input.topic.id,
    scriptType: input.scriptType,
    duration: input.duration,
    style: input.style,
    title: input.topic.title,
    hook: input.topic.hook,
    copy: [
      `如果你也在看${productName}，先别只问价格。`,
      `很多人最后后悔，不是因为没买贵的，而是没有提前解决“${painPoint}”。`,
      `我建议你先看三个地方：第一，看它有没有真实场景；第二，看卖点能不能被验证；第三，看售后和承接话术是不是清楚。`,
      `我们主打的是${sellingPoint}，所以拍摄时不要只拍成品，要把过程、细节和对比结果拍出来。`,
      `如果你想按自己的情况判断，评论区留下你的需求，我帮你看该怎么选。`
    ].join("\n"),
    rhythm: `${input.duration}节奏：前三秒抛痛点，中段用 2-3 个判断标准推进，后 5 秒做转化引导。`,
    pictureInPicture: `插入评论区问题、产品细节、竞品对比、真实案例和${input.product?.materialConditions || "可证明卖点的素材"}。`,
    productShowPoints: sellingPoint,
    actionSuggestion: input.scriptType.includes("自然流") ? "人物保持聊天状态，编导从亲密关系、负面假设、制造对立三个方向追问。" : "人物先看镜头抛痛点，再切产品细节和真实场景。",
    subtitleHighlights: `突出“${painPoint}”“${sellingPoint}”“先别急着下单”“评论区留下需求”。`,
    ending: input.project.contentGoal === "直播间引流" ? "想看现场怎么判断，今晚直播间我直接拆案例。" : "把你的情况发评论区，我按真实需求帮你判断。",
    shootingNotes: `注意不要空讲专业，要拍动作、细节、对比和用户关心的问题。额外要求：${input.extra || "无"}`,
    forbiddenWordReminder: `发布前检查禁忌词：${forbiddenWords}`,
    createdAt: now,
    updatedAt: now
  };
}

export function generateShotList(input: ShotListGenerationInput): ShotList {
  const lines = input.script.copy.split("\n").filter(Boolean);
  const now = nowIso();
  const rows: ShotRow[] = lines.map((line, index) => ({
    id: createId("shot"),
    index: index + 1,
    spokenLine: line,
    visualContent: index === 0 ? "人物正面中近景，直接抛出痛点" : index === lines.length - 1 ? "人物回到镜头前做转化引导" : "产品细节、服务过程或案例对比画面",
    action: index === 0 ? "看镜头，说第一句钩子" : "边展示边讲解，动作跟口播同步",
    personStatus: index === 0 ? "站定看镜头，状态坚定，语速略快" : "自然讲解，手部动作配合产品或案例展示",
    productPoint: input.product?.sellingPoints || input.project.sellingPoints,
    shotSize: index === 0 ? "中景" : index % 2 === 0 ? "特写" : "近景",
    movement: index === 0 ? "固定" : index % 2 === 0 ? "推近" : "跟拍",
    shootingFocus: index === 0 ? "钩子必须清晰，收音干净，人物状态要稳" : "画面必须服务这一句口播，避免拍成无效空镜",
    pictureInPicture: input.needPictureInPicture ? input.script.pictureInPicture : "不需要",
    props: input.product?.materialConditions || "产品、评论截图、对比素材、真实案例",
    scene: input.scene || "门店、办公室、产品展示台或真实服务现场",
    propsAndScene: input.scene || "门店、办公室、产品展示台或真实服务现场",
    editNotes: index === 0 ? "开头不加长铺垫，字幕压出痛点关键词" : "根据口播断句切画面，画中画只用于证明观点",
    requiredLevel: index <= 1 || index === lines.length - 1 ? "必拍" : index % 2 === 0 ? "可替代" : "补充",
    completionStatus: "未拍",
    notes: input.needProductCloseup ? "补拍产品细节和前后对比，避免画面只有口播。" : "注意收音和字幕重点。"
  }));

  return {
    id: createId("shotlist"),
    taskId: input.task?.id || "",
    projectId: input.project.id,
    productId: input.product?.id || "",
    scriptId: input.script.id,
    scene: input.scene,
    needModel: input.needModel,
    needProductCloseup: input.needProductCloseup,
    needPictureInPicture: input.needPictureInPicture,
    rows,
    createdAt: now,
    updatedAt: now
  };
}

export function generatePublishPlan(input: PublishPlanGenerationInput): PublishPlan {
  const titleBase = input.script?.title || "这条内容发布前先补齐标题";
  const productName = input.project.productName;
  const now = nowIso();

  return {
    id: createId("publish"),
    taskId: input.task?.id || "",
    projectId: input.project.id,
    scriptId: input.script?.id || "",
    shotListId: input.shotList?.id || "",
    platform: input.platform,
    account: "",
    publishAt: "",
    goal: input.goal,
    title: `${titleBase}｜${productName}避坑指南`,
    cover: "",
    coverTitle: `别急着买${productName}`,
    caption: `很多人做决定前只看价格，却忽略了真正影响结果的标准。这条把${productName}的判断方法讲清楚，收藏后慢慢看。`,
    hashtags: `#${input.project.industry} #${productName} #避坑 #真实测评 #种草`,
    productLink: "",
    liveRoomHandoff: "发布后评论区有明确需求时，引导进入直播间看案例拆解。",
    privateDomainGuide: "对预算、需求、场景明确的用户，引导私信发送需求清单。",
    publisher: input.task?.publishingOwner || "",
    publishStatus: "待发布",
    publishUrl: "",
    pinnedComment: "把你的情况写在评论区，我按真实需求帮你判断。",
    commentGuide: "你最担心价格、效果还是售后？评论区留一个关键词。",
    privateMessageScript: `你好，我看到你在问${productName}，可以先发我预算、需求和所在城市，我帮你判断适合哪种方案。`,
    liveRoomGuide: "想看真实案例拆解，今晚直播间直接讲不同预算怎么选。",
    publishTimeSuggestion: input.platform === "小红书" ? "建议 20:00-22:30 发布，标题突出体验和避坑。" : "建议 11:30-13:00 或 19:00-22:00 发布，开头三秒突出痛点。",
    multiPlatformRewrite: `抖音：更强钩子和冲突。\n小红书：更像经验笔记，增加清单。\n视频号：更稳重专业，突出信任。\n快手：更口语，突出真实场景。\nB站：标题更完整，正文补充过程。`,
    status: "待发布",
    createdAt: now,
    updatedAt: now
  };
}

export function generateEditBrief(input: EditBriefGenerationInput): EditBrief {
  const now = nowIso();
  const script = input.script;
  const shotList = input.shotList;
  const productName = input.product?.productName || input.project.productName;
  const requiredShots = shotList?.rows.filter((row) => row.requiredLevel === "必拍").map((row) => `镜头${row.index}：${row.visualContent}`).join("\n") || "优先使用开头钩子、产品细节、用户痛点和结尾转化镜头。";

  return {
    id: createId("editbrief"),
    taskId: input.task?.id || "",
    projectId: input.project.id,
    productId: input.product?.id || "",
    scriptId: script?.id || "",
    shotListId: shotList?.id || "",
    editor: input.editor,
    targetDuration: input.targetDuration,
    rhythm: input.rhythm,
    openingTreatment: script ? `开头 3 秒直接保留“${script.hook}”，不要加片头和空镜铺垫。` : "开头 3 秒必须先给痛点或反常识，不加品牌片头。",
    subtitleHighlights: script?.subtitleHighlights || "字幕重点突出用户痛点、核心卖点和转化动作。",
    pictureInPicturePositions: script?.pictureInPicture || "在痛点、证明卖点、成交引导三个位置插入画中画素材。",
    enlargedKeywords: `放大关键词：${input.product?.painPoints || input.project.painPoints || "用户痛点"}、${input.product?.sellingPoints || input.project.sellingPoints || "核心卖点"}、${productName}`,
    soundEffectRequirements: "开头钩子、对比结论、成交引导处可加轻量提示音，不要盖过口播。",
    musicStyle: input.rhythm === "情绪化" ? "低频、情绪推进型音乐，音量保持在口播下方。" : "干净轻节奏背景音乐，避免廉价感强的模板音乐。",
    transitionRequirements: "以口播逻辑切镜头，不为了转场而转场；产品细节处可用轻微推近。",
    productDetailPositions: requiredShots,
    emotionHighlights: "在用户痛点、错误做法、正确标准三处增强停顿和字幕强调。",
    conversionGuidePosition: "结尾 5 秒保留评论、私信、直播间或购买承接话术。",
    forbiddenActions: `${input.product?.forbiddenWords || input.project.forbiddenWords || "不要夸大承诺，不说绝对化表达"}；不要使用与产品事实不一致的素材。`,
    referenceVideoLinks: "",
    deadline: input.deadline,
    reviewFeedback: "",
    revisionRecords: "初版：根据脚本和分镜生成剪辑说明单。",
    currentVersion: "初版",
    versions: [{ id: createId("editversion"), name: "初版", notes: "系统根据脚本和分镜生成。", createdAt: now }],
    createdAt: now,
    updatedAt: now
  };
}

export function generateReviewConclusion(review: ReviewRecord): string {
  const scoreEntries = Object.values(review.scores) as number[];
  const avg = scoreEntries.length > 0 ? scoreEntries.reduce((sum, value) => sum + Number(value || 0), 0) / scoreEntries.length : 0;
  const problems = review.problemAttributions.length > 0 ? review.problemAttributions.join("、") : "暂未明确";
  const dataSignal = [
    `播放量 ${review.metrics.views || "未填"}`,
    `5 秒留存 ${review.metrics.fiveSecondRetention || "未填"}`,
    `完播率 ${review.metrics.completionRate || "未填"}`,
    `商品点击 ${review.metrics.productClicks || "未填"}`,
    `成交金额 ${review.metrics.transactionAmount || "未填"}`
  ].join("，");

  return [
    `本条视频综合评分约 ${avg.toFixed(1)} 分。核心数据：${dataSignal}。`,
    `主要问题归因：${problems}。`,
    `可保留：${review.retainedPoints || "需要补充值得保留的结构、开头或画面。"}。`,
    `下次避免：${review.avoidNextTime || "需要明确下一条要避开的具体问题。"}。`,
    `下一条优化建议：${review.nextOptimization || "围绕开头、信息密度、画中画证明和结尾转化做一次定向优化。"}`
  ].join("\n");
}

export function reviewToContentAsset(review: ReviewRecord): ContentAsset {
  return {
    id: createId("asset"),
    title: `${review.videoTitle || "未命名视频"}复盘沉淀`,
    assetType: review.caseType === "失败案例" ? "失败案例库" : "成功案例库",
    sourceVideo: review.videoTitle,
    productId: review.productId,
    scenario: `${review.platform}｜${review.account || "未填写账号"}`,
    effectivenessReason: review.retainedPoints || review.avoidNextTime || review.autoConclusion,
    reusableMethod: [review.reusableStructure, review.reusableOpening, review.reusablePictureInPicture].filter(Boolean).join("\n") || review.autoConclusion,
    notes: review.nextOptimization,
    tags: review.problemAttributions.join("、"),
    creator: "复盘沉淀",
    sourceRecordId: review.id,
    createdAt: nowIso()
  };
}

export function analyzeViralVideo(input: ViralAnalysisInput): ViralAnalysis {
  const now = nowIso();
  const transcript = input.transcript || input.title;

  return {
    id: createId("viral"),
    url: input.url,
    title: input.title,
    transcript: input.transcript,
    industry: input.industry,
    platform: input.platform,
    openingHook: `开头先用“${input.title}”制造问题感或反常识，让用户想知道为什么。`,
    structure: "问题/冲突开场 → 具体案例或过程 → 情绪放大 → 卖点或观点植入 → 评论/私信/购买引导",
    emotionPoints: transcript.includes("坑") ? "焦虑、怕踩坑、想省钱" : "好奇、共鸣、信任、行动冲动",
    painPoints: "用户怕花冤枉钱、怕选错、怕效果不好、怕售后没人管。",
    sellingPointPlacement: "不要一开头硬广，中段先讲用户问题，再把产品/服务作为解决方案带出。",
    pictureInPictureUsage: "用评论截图、对比画面、产品细节、真实流程和结果反馈辅助证明观点。",
    conversionAction: "结尾引导评论区留言具体情况，或进入直播间看案例拆解。",
    reusableFormula: "用户担心的问题 → 真实案例 → 错误做法 → 正确标准 → 产品/服务承接 → 行动引导",
    productApplication: `套用到${input.industry}：先找用户最怕的一个坑，再用产品细节和真实案例证明你能解决。`,
    createdAt: now,
    updatedAt: now
  };
}

export function shotListToMarkdownTable(shotList: ShotList) {
  const header = "| 镜头序号 | 对应口播 | 景别 | 画面内容 | 人物状态 | 镜头运动 | 拍摄重点 | 所需道具 | 所需场景 | 产品展示点 | 画中画素材 | 剪辑备注 | 必拍等级 | 完成状态 |\n| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |";
  const rows = shotList.rows.map((row) =>
    [
      row.index,
      row.spokenLine,
      row.shotSize,
      row.visualContent,
      row.personStatus,
      row.movement,
      row.shootingFocus,
      row.props,
      row.scene,
      row.productPoint,
      row.pictureInPicture,
      row.editNotes,
      row.requiredLevel,
      row.completionStatus
    ]
      .map((cell) => String(cell).replace(/\|/g, "｜").replace(/\n/g, " "))
      .join(" | ")
  );

  return [header, ...rows.map((row) => `| ${row} |`)].join("\n");
}

export function shotListToCsv(shotList: ShotList) {
  const header = ["镜头序号", "对应口播", "景别", "画面内容", "人物状态", "镜头运动", "拍摄重点", "所需道具", "所需场景", "产品展示点", "画中画素材", "剪辑备注", "必拍等级", "完成状态"];
  const rows = shotList.rows.map((row) => [
    row.index,
    row.spokenLine,
    row.shotSize,
    row.visualContent,
    row.personStatus,
    row.movement,
    row.shootingFocus,
    row.props,
    row.scene,
    row.productPoint,
    row.pictureInPicture,
    row.editNotes,
    row.requiredLevel,
    row.completionStatus
  ]);

  return [header, ...rows].map((row) => row.map(csvCell).join(",")).join("\n");
}

export function shotListToShootingChecklist(shotList: ShotList) {
  return shotList.rows
    .map((row) => `- [${row.completionStatus === "已拍" ? "x" : " "}] 镜头 ${row.index}｜${row.requiredLevel}｜${row.shotSize}｜${row.visualContent}｜道具：${row.props || "无"}｜场景：${row.scene || shotList.scene}`)
    .join("\n");
}

function csvCell(value: unknown) {
  return `"${String(value).replace(/"/g, '""')}"`;
}
