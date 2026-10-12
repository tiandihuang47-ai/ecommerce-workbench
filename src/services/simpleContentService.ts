import { createId, nowIso } from "@/lib/shared/time";
import { createProductReferenceSnapshot } from "@/lib/product-reference";
import type {
  ResourceItem,
  RiskCheckResult,
  ScriptRecord,
  ScriptRecordContentFormat,
  ScriptRecordMaterialSource,
  ScriptRecordPlatform,
  ScriptRecordContentType,
  ScriptRecordVideoGoal,
  ProductRecord,
  ProductReferenceSnapshot,
  CommentInsightRecord,
  CommentRecord,
  HighLikeCommentInsights,
  SimpleDeconstructionRecord,
  SimpleReviewRecord
} from "@/lib/pipeline-types";

export interface SimpleScriptInput {
  productName: string;
  productId?: string;
  productSnapshot?: ProductReferenceSnapshot;
  platform: ScriptRecordPlatform;
  contentFormat: ScriptRecordContentFormat;
  materialSource: ScriptRecordMaterialSource;
  targetAudience: string;
  painPoint: string;
  sellingPoint: string;
  contentType: ScriptRecordContentType;
  videoGoal: ScriptRecordVideoGoal;
  extra: string;
  duration: string;
  speakingStyle: string;
  scene: string;
  needShotList: boolean;
  needOverlay: boolean;
  needTitle: boolean;
  needNote: boolean;
  productForbiddenWords?: string;
  productForbiddenClaims?: string;
  comments?: string;
  liveTranscript?: string;
  originalScript?: string;
  rewriteGoal?: string;
  includeRiskCheck?: boolean;
  includeCoverTitle?: boolean;
}

export interface ScriptGenerateResult {
  title: string;
  hook: string;
  script: string;
  storyboard: string[];
  overlaySuggestions: string[];
  shootingTips: string[];
  cta: string;
  riskCheck?: RiskCheckResult;
  extra?: Record<string, unknown>;
}

export function generateLocalScript(input: SimpleScriptInput): ScriptRecord {
  const now = nowIso();
  const title = buildTitle(input);
  const hook = buildHook(input);
  const scriptText = buildScriptText(input);

  return {
    id: createId("script_record"),
    title,
    productId: input.productId || "",
    productSnapshot: input.productSnapshot,
    productName: input.productName,
    targetAudience: input.targetAudience,
    painPoint: input.painPoint,
    sellingPoint: input.sellingPoint,
    contentType: input.contentType,
    platform: input.platform,
    contentFormat: input.contentFormat,
    materialSource: input.materialSource,
    videoGoal: input.videoGoal,
    hook,
    scriptText,
    shotSuggestions: buildShotSuggestions(input),
    overlaySuggestions: buildOverlaySuggestions(input),
    shootingTips: [
      `平台提醒：${platformStyleRules(input.platform)}`,
      "开头不要铺垫，第一句话必须让目标人群知道和自己有关。",
      "每 8-12 秒换一次画面，口播、细节、对比、案例交替出现。",
      "不要夸大效果，不要编造价格、销量、检测报告或背书。",
      input.extra ? `补充要求：${input.extra}` : ""
    ].filter(Boolean).join("\n"),
    endingCTA: buildEnding(input),
    riskCheckResult: input.includeRiskCheck === false ? undefined : buildRiskCheck({
      text: [title, hook, scriptText, input.sellingPoint, input.extra].join("\n"),
      forbiddenWords: input.productForbiddenWords || "",
      forbiddenClaims: input.productForbiddenClaims || ""
    }),
    status: "草稿",
    tags: [input.contentType, input.videoGoal, input.speakingStyle].filter(Boolean).join("、"),
    favorite: false,
    createdBy: "编导",
    createdAt: now,
    updatedAt: now,
    reviewId: "",
    sourceType: "脚本生成",
    sourceDeconstructionId: "",
    sourcePlatform: "",
    sourceUrl: "",
    sourceTranscript: "",
    sourceAnalysis: "",
    sourceRewrite: ""
  };
}

export function scriptResultToRecord(result: ScriptGenerateResult, input: SimpleScriptInput): ScriptRecord {
  const fallback = generateLocalScript(input);
  return {
    ...fallback,
    title: result.title || fallback.title,
    hook: result.hook || fallback.hook,
    scriptText: result.script || fallback.scriptText,
    shotSuggestions: Array.isArray(result.storyboard) && result.storyboard.length ? result.storyboard.join("\n") : fallback.shotSuggestions,
    overlaySuggestions: Array.isArray(result.overlaySuggestions) && result.overlaySuggestions.length ? result.overlaySuggestions.join("\n") : fallback.overlaySuggestions,
    shootingTips: Array.isArray(result.shootingTips) && result.shootingTips.length ? result.shootingTips.join("\n") : fallback.shootingTips,
    endingCTA: result.cta || fallback.endingCTA,
    riskCheckResult: result.riskCheck || fallback.riskCheckResult,
    sourceType: "脚本生成"
  };
}

export function parseAiScript(content: string, input: SimpleScriptInput): ScriptRecord {
  const fallback = generateLocalScript(input);
  return {
    ...fallback,
    title: pickSection(content, ["标题"]) || fallback.title,
    hook: pickSection(content, ["开头 3 秒钩子", "开头3秒钩子", "钩子"]) || fallback.hook,
    scriptText: pickSection(content, ["完整口播脚本", "逐字稿", "口播脚本"]) || content || fallback.scriptText,
    shotSuggestions: pickSection(content, ["分镜建议", "分镜脚本"]) || fallback.shotSuggestions,
    overlaySuggestions: pickSection(content, ["画中画建议"]) || fallback.overlaySuggestions,
    shootingTips: pickSection(content, ["拍摄提醒", "拍摄建议", "拍摄注意事项"]) || fallback.shootingTips,
    endingCTA: pickSection(content, ["结尾引导", "结尾转化话术", "结尾引导话术"]) || fallback.endingCTA,
    riskCheckResult: buildRiskCheck({
      text: content,
      forbiddenWords: input.productForbiddenWords || "",
      forbiddenClaims: input.productForbiddenClaims || ""
    })
  };
}

export function scriptRecordToApiResult(record: ScriptRecord): ScriptGenerateResult {
  return {
    title: record.title,
    hook: record.hook,
    script: record.scriptText,
    storyboard: splitLines(record.shotSuggestions),
    overlaySuggestions: splitLines(record.overlaySuggestions),
    shootingTips: splitLines(record.shootingTips),
    cta: record.endingCTA,
    riskCheck: record.riskCheckResult,
    extra: {}
  };
}

export function generateTopicIdeas(input: SimpleScriptInput) {
  if (input.materialSource === "评论区" && input.comments?.trim()) {
    return generateCommentInsights(input.comments).topicIdeas.split("\n").filter(Boolean);
  }
  return [
    `${input.platform}${input.targetAudience}买${input.productName}前，最容易忽略的 3 个判断标准`,
    `为什么解决“${input.painPoint}”不能只看价格`,
    `${input.contentFormat}怎么把${input.sellingPoint}拍清楚，而不是喊口号`
  ];
}

export function generateSimilarScript(source: ScriptRecord): ScriptRecord {
  const now = nowIso();
  return {
    ...source,
    id: createId("script_record"),
    title: `${source.title}｜相似版本`,
    hook: source.hook.replace("先别急着", "别再只看表面了，先搞懂"),
    scriptText: `${source.scriptText}\n\n补充段：把用户最担心的顾虑再说具体一点，用一个真实场景或评论问题承接。`,
    status: "草稿",
    favorite: false,
    createdAt: now,
    updatedAt: now,
    reviewId: ""
  };
}

export function generateCommentInsights(rawComments: string): CommentInsightRecord {
  const now = nowIso();
  const lines = rawComments.split(/\n+/).map((item) => item.trim()).filter(Boolean);
  const useful = lines.length ? lines : [rawComments.trim()].filter(Boolean);
  const questionLines = useful.filter((item) => /[?？吗呢会不会值不值适合]/.test(item)).slice(0, 6);
  const painPoints = questionLines.length ? questionLines.join("\n") : "用户在评论区主要关注价格、效果、适合人群、使用场景和售后承接。";
  const objections = useful.filter((item) => /贵|担心|怕|不敢|会不会|真的假的|值不值|售后|质量/.test(item)).slice(0, 6).join("\n") || "价格是否值得、效果是否真实、是否适合自己、售后是否靠谱。";
  const topicIdeas = [
    questionLines[0] ? `评论区都在问：${questionLines[0].replace(/[?？]/g, "")}` : "这个价格到底值不值？先看 3 个判断标准",
    questionLines[1] ? `关于“${questionLines[1].replace(/[?？]/g, "")}”，老板直接讲实话` : "买之前最该问清楚的一件事",
    "用户最担心的不是价格，而是买完以后有没有用",
    "把评论区高频问题一次说透",
    "同类产品怎么选才不踩坑"
  ].join("\n");

  return {
    id: createId("comment_insight"),
    rawComments,
    painPoints,
    objections,
    topicIdeas,
    replyScripts: [
      "可以，具体要看你的使用场景，我建议先看这 3 点。",
      "这个问题很多人都会忽略，我下一条视频专门讲。",
      "如果你担心的是效果和售后，可以先别急着下单，先把需求发我判断一下。"
    ].join("\n"),
    createdAt: now,
    updatedAt: now
  };
}

export function productToScriptInputPatch(product: ProductRecord): Partial<SimpleScriptInput> {
  const productSnapshot = createProductReferenceSnapshot(product);
  return {
    productId: product.id,
    productSnapshot,
    productName: product.name,
    targetAudience: product.targetAudience,
    painPoint: [product.painPoints, product.objections].filter(Boolean).join("\n"),
    sellingPoint: [product.coreSellingPoints, product.secondarySellingPoints, product.competitorComparison].filter(Boolean).join("\n"),
    productForbiddenWords: product.forbiddenWords,
    productForbiddenClaims: product.forbiddenClaims,
    extra: [product.useScenarios && `使用场景：${product.useScenarios}`, product.buyerFeedback && `买家反馈：${product.buyerFeedback}`].filter(Boolean).join("\n")
  };
}

export interface DeconstructionInput {
  title: string;
  sourceUrl: string;
  transcript: string;
  productName: string;
  productId?: string;
  productSnapshot?: ProductReferenceSnapshot;
  platform?: SimpleDeconstructionRecord["platform"];
  normalizedUrl?: string;
  sourceDescription?: string;
  sourceAuthor?: string;
  sourceCover?: string;
  manualDescription?: string;
  comments?: string;
  topComments?: CommentRecord[];
  commentInsights?: HighLikeCommentInsights;
  commentsSource?: SimpleDeconstructionRecord["commentsSource"];
  commentsFetchStatus?: SimpleDeconstructionRecord["commentsFetchStatus"];
  commentsFetchError?: string;
  rewriteReferenceSource?: "structure" | "comments" | "structure_comments";
  targetIndustry?: string;
  targetAudience?: string;
  rewriteGoal?: SimpleDeconstructionRecord["rewriteGoal"];
  rewriteStyle?: SimpleDeconstructionRecord["rewriteStyle"];
  extraRequirement?: string;
  videoPath?: string;
  audioPath?: string;
  asrMessage?: string;
}

export function generateLocalDeconstruction(input: DeconstructionInput): SimpleDeconstructionRecord {
  const now = nowIso();
  const productName = input.productName || "本公司产品";
  const targetAudience = input.targetAudience || "目标用户";
  const targetIndustry = input.targetIndustry || productName;
  const transcriptPreview = [input.transcript, input.manualDescription, input.sourceDescription].filter(Boolean).join("\n").trim().slice(0, 120);
  const rewrittenTopic = `${targetAudience}选择${productName}前，先看懂这个隐藏判断标准`;
  const rewrittenScript = [
    `1. 如果你是${targetAudience}，正在看${productName}，先别急着做决定。`,
    "2. 很多爆款内容能吸引人，不是因为文案多狠，而是开头先点破了用户一直没说出口的担心。",
    `3. 迁移到${targetIndustry}，我们要先把用户最怕踩坑的地方说出来，再用真实细节证明这个产品为什么值得信任。`,
    `4. 这条脚本重点不是模仿原视频，而是复用它的结构：先制造冲突，再给判断标准，最后把${productName}的价值落到具体画面。`,
    input.rewriteGoal === "直播间引流" ? "5. 想看现场怎么判断，今晚直播间我直接拆案例。" : "5. 如果你也在纠结，评论区留下你的需求，我按真实情况帮你判断。"
  ].join("\n");

  return {
    id: createId("deconstruction"),
    title: input.title || rewrittenTopic,
    sourceUrl: input.sourceUrl,
    platform: input.platform || "unknown",
    normalizedUrl: input.normalizedUrl || input.sourceUrl,
    sourceTitle: input.title,
    sourceDescription: input.sourceDescription || "",
    sourceAuthor: input.sourceAuthor || "",
    sourceCover: input.sourceCover || "",
    videoUrl: "",
    audioUrl: "",
    duration: "",
    publishTime: "",
    rawText: input.transcript || input.manualDescription || input.sourceDescription || "",
    structuredJson: "",
    transcript: input.transcript,
    videoPath: input.videoPath || "",
    audioPath: input.audioPath || "",
    asrProvider: input.transcript ? "豆包语音转写 / 手动输入" : "",
    asrMessage: input.asrMessage || "",
    analysisMarkdown: "",
    rewriteMarkdown: "",
    manualDescription: input.manualDescription || "",
    comments: input.comments || "",
    topComments: input.topComments || [],
    commentInsights: input.commentInsights || {
      topConcerns: [],
      userPainPoints: [],
      purchaseObjections: [],
      contentAngles: [],
      shootingSuggestions: [],
      topicIdeas: [],
      hookIdeas: [],
      scriptDirections: [],
      conversionOpportunities: [],
      riskNotes: [],
      commentTags: []
    },
    commentsSource: input.commentsSource || "",
    commentsFetchStatus: input.commentsFetchStatus || "idle",
    commentsFetchError: input.commentsFetchError || "",
    commentBasedTopicIdeas: input.commentInsights?.topicIdeas?.join("\n") || "",
    commentBasedShootingSuggestions: input.commentInsights?.shootingSuggestions?.join("\n") || "",
    commentBasedHookIdeas: input.commentInsights?.hookIdeas?.join("\n") || "",
    targetIndustry,
    productId: input.productId || "",
    productSnapshot: input.productSnapshot,
    targetProduct: productName,
    targetAudience,
    rewriteGoal: input.rewriteGoal || "成交",
    rewriteStyle: input.rewriteStyle || "口语化",
    coreTheme: `围绕“${input.title || "爆款内容"}”放大用户已有困惑，再用结果或反差给答案。`,
    hook: `很多人以为【表面判断】就够了，其实真正影响结果的是【隐藏标准】。`,
    viralElements: "人群圈定、反差、成本感、头牌背书或避坑感。",
    structure: [
      "1. 开头先点名目标人群和冲突。",
      "2. 中段用 2-3 个判断标准拆解问题。",
      "3. 插入案例、对比或评论，证明不是空口判断。",
      "4. 结尾给出可执行建议和转化动作。"
    ].join("\n"),
    emotionFlow: `疑惑/焦虑 → 被点破 → 看到标准 → 建立信任 → 想进一步咨询。${transcriptPreview ? `原内容参考：${transcriptPreview}` : ""}`,
    visualRhythm: "开头人物口播或强字幕抛冲突，中段穿插产品细节、评论反馈、对比画面，结尾回到人物做行动引导。",
    conversionPoint: input.rewriteGoal === "涨粉" ? "结尾引导关注系列内容。" : input.rewriteGoal === "直播间引流" ? "结尾引导进入直播间看案例拆解。" : "结尾引导评论、私信或咨询。",
    reusableStructure: `“先指出用户常见误判 → 给出专业标准 → 用真实证据证明 → 引导评论或私信”。`,
    rewrittenTopic,
    rewrittenTitle: `${productName}别只看表面，真正影响结果的是这 3 个细节`,
    rewrittenHook: `${targetAudience}如果正在纠结${productName}，先别急着下单，真正决定结果的是这个隐藏标准。`,
    rewrittenScript,
    shotSuggestions: [
      "镜头 1：人物中近景，直接抛出新钩子，字幕突出“先别急着下单”。",
      "镜头 2：插入原问题对应的真实场景，不展示原视频素材，只展示自己的产品/业务场景。",
      "镜头 3：产品细节或服务流程特写，证明核心卖点。",
      "镜头 4：评论截图、用户反馈或对比画面，强化可信度。",
      "镜头 5：人物回到镜头前，给出结尾引导。"
    ].join("\n"),
    overlaySuggestions: [
      "痛点出现时：放评论区问题、用户顾虑或错误示范。",
      "讲判断标准时：放产品细节、流程清单、对比画面。",
      "讲转化动作时：放咨询入口、直播间提示或评论区关键词。"
    ].join("\n"),
    shootingTips: "不要复刻原视频画面和文案，只复用结构。拍自己的产品、自己的场景、自己的案例，避免夸大承诺。",
    endingCTA: input.rewriteGoal === "直播间引流" ? "想看我现场拆不同情况怎么选，今晚直播间直接讲。" : "把你的情况留在评论区，我按真实需求帮你判断。",
    extendedTopics: [
      `${productName}最容易被忽略的 3 个成本`,
      `${targetAudience}买${productName}前必须问清楚的 5 个问题`,
      `为什么便宜的${productName}可能更贵`,
      `${productName}怎么选才不踩坑`,
      `从一个真实案例看${productName}的判断标准`
    ].join("\n"),
    newTopicIdeas: [
      `${productName}别只看价格，真正影响结果的是这 3 个细节`,
      `买${productName}前，先看懂这个避坑标准`,
      `为什么有人做${productName}效果好，有人花钱还踩坑`
    ].join("\n"),
    newScriptDirections: `把原视频的冲突迁移到${productName}：开头点破误区，中段给标准，结尾引导用户留下需求。`,
    createdAt: now,
    updatedAt: now
  };
}

export function parseAiDeconstruction(content: string, input: DeconstructionInput): SimpleDeconstructionRecord {
  const fallback = generateLocalDeconstruction(input);
  return {
    ...fallback,
    analysisMarkdown: content,
    rewriteMarkdown: content,
    coreTheme: pickSection(content, ["视频核心主题", "原视频核心", "原视频核心主题"]) || fallback.coreTheme,
    targetAudience: pickSection(content, ["目标人群"]) || fallback.targetAudience,
    hook: pickSection(content, ["开头钩子"]) || fallback.hook,
    viralElements: pickSection(content, ["爆款元素"]) || fallback.viralElements,
    structure: pickSection(content, ["内容结构", "视频结构"]) || fallback.structure,
    emotionFlow: pickSection(content, ["情绪变化", "情绪流动"]) || fallback.emotionFlow,
    visualRhythm: pickSection(content, ["节奏设计", "画面节奏"]) || fallback.visualRhythm,
    overlaySuggestions: pickSection(content, ["画中画/画面辅助逻辑", "画中画建议"]) || fallback.overlaySuggestions,
    conversionPoint: pickSection(content, ["转化路径", "成交/广告植入位置", "广告/成交植入位置", "成交/引导位置", "成交引导位置"]) || fallback.conversionPoint,
    reusableStructure: pickSection(content, ["可迁移结构"]) || fallback.reusableStructure,
    rewrittenTopic: pickSection(content, ["新选题"]) || fallback.rewrittenTopic,
    rewrittenTitle: pickSection(content, ["标题"]) || fallback.rewrittenTitle,
    rewrittenHook: pickSection(content, ["开头 3 秒钩子", "开头3秒钩子"]) || fallback.rewrittenHook,
    rewrittenScript: pickSection(content, ["完整口播脚本", "口播脚本"]) || fallback.rewrittenScript,
    shotSuggestions: pickSection(content, ["分镜建议"]) || fallback.shotSuggestions,
    shootingTips: pickSection(content, ["拍摄提醒"]) || fallback.shootingTips,
    endingCTA: pickSection(content, ["结尾引导"]) || fallback.endingCTA,
    extendedTopics: pickSection(content, ["延展选题", "可继续延展的 5 个选题"]) || fallback.extendedTopics,
    newTopicIdeas: pickSection(content, ["可迁移到本公司产品的新选题", "迁移到用户行业后的新选题", "新选题"]) || fallback.newTopicIdeas,
    newScriptDirections: pickSection(content, ["可生成的新脚本方向", "新脚本大纲", "完整口播脚本"]) || fallback.newScriptDirections
  };
}

export function generateReviewConclusion(record: SimpleReviewRecord, script?: ScriptRecord) {
  const views = Number(record.views || 0);
  const completion = parsePercent(record.completionRate);
  const interaction = parsePercent(record.likeRate) + parsePercent(record.commentRate) + parsePercent(record.saveRate);
  const successPoints = [
    record.topicJudgement.includes("有效") ? "选题能打中目标人群" : "",
    record.hookJudgement.includes("有效") ? "开头能快速抛出问题" : "",
    interaction >= 3 ? "互动数据有继续放大的价值" : ""
  ].filter(Boolean);
  const failurePoints = [
    completion > 0 && completion < 25 ? "完播偏低，中段节奏或信息密度需要优化" : "",
    record.shootingJudgement.includes("否") || record.shootingJudgement.includes("不到位") ? "拍摄没有完全服务脚本重点" : "",
    record.editingJudgement.includes("否") || record.editingJudgement.includes("不到位") ? "剪辑没有强化钩子和转化点" : ""
  ].filter(Boolean);
  const conclusion = [
    `这条内容的核心判断：${script?.title || "该脚本"}${views ? `播放 ${views}` : "数据待补充"}，${completion ? `完播约 ${completion}%` : "完播待补充"}。`,
    successPoints.length ? `成功点：${successPoints.join("；")}。` : "成功点：目前还需要更多数据或主观判断支撑。",
    failurePoints.length ? `失败点：${failurePoints.join("；")}。` : "失败点：暂未发现明显单点问题，建议继续看评论和转化承接。",
    `下次优化：${record.nextOptimization || record.problemReason || "保留有效开头，强化证据画面和结尾转化动作。"}`,
    record.conversionData ? `转化补充：${record.conversionData}` : ""
  ].filter(Boolean).join("\n");

  return {
    conclusion,
    successPoints: successPoints.join("\n") || "保留能明确点名目标人群和痛点的表达。",
    failurePoints: failurePoints.join("\n") || "继续观察中段留存、评论问题和转化承接。",
    recommendAsCase: successPoints.length >= 2 && failurePoints.length <= 1
  };
}

export function deconstructionToResource(item: SimpleDeconstructionRecord): ResourceItem {
  return {
    id: createId("resource"),
    type: "拆片结构",
    title: item.title,
    content: [
      `核心主题：${item.coreTheme}`,
      `开头钩子：${item.hook}`,
      `爆款元素：${item.viralElements}`,
      `内容结构：${item.structure}`,
      `画面节奏：${item.visualRhythm}`,
      `可迁移结构：${item.reusableStructure}`,
      `新选题：${item.rewrittenTopic || item.newTopicIdeas}`,
      `仿写脚本：${item.rewrittenScript || item.newScriptDirections}`
    ].join("\n\n"),
    tags: "爆款拆解、结构沉淀",
    createdAt: nowIso(),
    updatedAt: nowIso()
  };
}

export function deconstructionToScriptRecord(item: SimpleDeconstructionRecord): ScriptRecord {
  const now = nowIso();
  return {
    id: createId("script_record"),
    title: item.rewrittenTitle || item.rewrittenTopic || `${item.targetProduct || "产品"}仿写脚本`,
    productId: item.productId || "",
    productSnapshot: item.productSnapshot,
    productName: item.targetProduct,
    targetAudience: item.targetAudience,
    painPoint: item.coreTheme,
    sellingPoint: item.reusableStructure,
    contentType: "带货转化",
    platform: item.platform === "xiaohongshu" ? "小红书" : item.platform === "kuaishou" ? "快手" : item.platform === "wechat_channels" ? "视频号" : "抖音",
    contentFormat: "短视频口播",
    materialSource: "爆款拆解",
    videoGoal: item.rewriteGoal,
    hook: item.rewrittenHook,
    scriptText: item.rewrittenScript,
    shotSuggestions: item.shotSuggestions,
    overlaySuggestions: item.overlaySuggestions,
    shootingTips: item.shootingTips,
    endingCTA: item.endingCTA,
    status: "草稿",
    tags: ["爆款拆解仿写", item.rewriteStyle, item.targetIndustry].filter(Boolean).join("、"),
    favorite: false,
    createdBy: "编导",
    createdAt: now,
    updatedAt: now,
    reviewId: "",
    sourceType: "爆款拆解仿写",
    sourceDeconstructionId: item.id,
    sourcePlatform: item.platform,
    sourceUrl: item.sourceUrl || item.normalizedUrl,
    sourceTranscript: item.transcript,
    sourceAnalysis: item.analysisMarkdown || [
      `核心主题：${item.coreTheme}`,
      `开头钩子：${item.hook}`,
      `爆款元素：${item.viralElements}`,
      `内容结构：${item.structure}`,
      `可迁移结构：${item.reusableStructure}`
    ].join("\n\n"),
    sourceRewrite: item.rewriteMarkdown || item.rewrittenScript,
    performanceLevel: ""
  };
}

function buildTitle(input: SimpleScriptInput) {
  if (!input.needTitle && input.includeCoverTitle === false) {
    return `${input.productName}短视频脚本`;
  }
  if (input.contentType === "小红书图文" || input.contentFormat === "图文笔记") {
    return `${input.productName}真实体验：这些细节比价格更重要`;
  }
  if (input.contentType === "直播切片" || input.contentFormat === "直播切片") {
    return `${input.productName}直播间高频问题，一次讲清楚`;
  }
  if (input.contentType === "产品卖点提炼") return `${input.productName}卖点提炼：把优势讲成人话`;
  if (input.contentType === "脚本改写") return `${input.productName}脚本优化版`;
  if (input.contentType === "评论回复") return `评论区都在问${input.productName}，这条说清楚`;
  if (input.contentType === "竞品对比") return `${input.productName}和同类产品怎么选？先看这几点`;
  if (input.contentType === "避坑科普") return `买${input.productName}前，先避开这几个坑`;
  if (input.contentType === "老板 IP") return `老板实话：${input.productName}真正该看什么`;
  if (input.contentType === "带货转化") {
    return `${input.productName}别急着下单，先看懂这个判断标准`;
  }
  if (input.contentType === "讲故事") {
    return `我为什么建议${input.targetAudience}先解决这件事`;
  }
  return `${input.targetAudience}遇到“${input.painPoint}”时，先看这 3 点`;
}

function buildHook(input: SimpleScriptInput) {
  if (input.platform === "小红书") {
    return `真实说一下，${input.targetAudience}选${input.productName}时，我最建议先看“${input.painPoint}”。`;
  }
  if (input.platform === "私域朋友圈") {
    return `最近很多朋友问${input.productName}怎么选，我把最容易踩坑的点说清楚。`;
  }
  return `${input.targetAudience}如果正在纠结${input.productName}，先别急着做决定，真正影响结果的是“${input.painPoint}”。`;
}

function buildScriptText(input: SimpleScriptInput) {
  if (input.contentType === "产品卖点提炼") {
    return [
      `核心卖点：${input.sellingPoint || "资料中未提供，请先补充产品真实优势。"}`,
      `次级卖点：围绕${input.targetAudience || "目标人群"}的使用场景、体验细节、售后承接继续展开。`,
      `用户痛点：${input.painPoint || "资料中未提供。"}`,
      `购买理由：把“${input.sellingPoint || "核心卖点"}”对应到具体场景，不要空喊优势。`,
      "成交话术：如果你正好有这个需求，可以先把使用场景发我，我按真实情况帮你判断适不适合。",
      "可拍摄角度：痛点避坑、使用场景、细节证明、同类对比、评论区问题回复。",
      `禁忌表达：不要编造价格、销量、检测报告、明星背书、全网最低等没有依据的信息。`,
      "适合生成的脚本方向：短视频口播、老板 IP、避坑科普、评论回复、图文笔记。"
    ].join("\n");
  }

  if (input.contentType === "脚本改写") {
    const original = input.originalScript?.trim() || "资料中未提供原脚本，请先粘贴需要改写的脚本。";
    return [
      `改写目标：${input.rewriteGoal || input.extra || "更口语、更清晰、更适合平台"}`,
      `改写后的开头：${buildHook(input)}`,
      "改写后的完整脚本：",
      original === "资料中未提供原脚本，请先粘贴需要改写的脚本。"
        ? original
        : `${buildHook(input)}\n${original.slice(0, 700)}\n最后把用户最关心的“${input.painPoint || "核心顾虑"}”再落回到“${input.sellingPoint || "真实卖点"}”，结尾给出评论/私信/直播间承接。`,
      "改写说明：保留原脚本核心意思，强化开头、痛点表达、证据画面和结尾转化。",
      "优化点：删掉铺垫和空话，增加具体场景、用户顾虑和画中画证明。"
    ].join("\n");
  }

  if (input.contentType === "小红书图文" || input.contentFormat === "图文笔记") {
    return [
      `图文标题：${buildTitle(input)}`,
      `封面文案：${input.targetAudience}先别急着买${input.productName}`,
      "",
      "正文内容：",
      `1. 这篇不是硬广，是给${input.targetAudience}看的真实判断清单。`,
      `2. 你最需要先确认的是：${input.painPoint}。`,
      `3. 我们主打的是：${input.sellingPoint}。但这个卖点一定要配合细节图、反馈图或使用场景来讲。`,
      `4. 如果你还在犹豫，可以先按“场景、预算、顾虑”三件事来判断。`,
      "",
      "图片顺序建议：封面痛点图 → 使用场景 → 产品细节 → 对比说明 → 买家反馈 → 成交引导。",
      "每张图配文：第一张点痛点，第二张给场景，第三张拍细节，第四张讲对比，第五张放反馈，第六张引导评论或私信。",
      `话题标签：#${input.productName} #真实测评 #避坑指南 #${input.platform}`,
      buildEnding(input)
    ].join("\n");
  }

  if (input.contentType === "直播切片" || input.contentFormat === "直播切片") {
    const live = input.liveTranscript?.trim();
    return [
      `可剪切片标题：${buildTitle(input)}`,
      `开头钩子：${buildHook(input)}`,
      "",
      "重新整理后的短视频口播：",
      live ? `直播原话基础：${live.slice(0, 220)}` : `很多人在直播间问${input.productName}到底值不值得，核心不是听我说多好，而是看它能不能解决“${input.painPoint}”。`,
      `保留重点：${input.sellingPoint}。`,
      "需要删除的废话：重复寒暄、无关互动、没有信息量的口头禅。",
      "字幕重点：值不值、适合谁、怎么判断、现在该怎么选。",
      "结尾直播间引导：想看上身/实测/细节，进直播间我直接给你对比。"
    ].join("\n");
  }

  if (input.contentType === "评论回复") {
    const comments = input.comments?.trim() || "资料中未提供评论，请粘贴评论区问题。";
    return [
      `评论区问题提炼：${comments.slice(0, 260)}`,
      `用户真实痛点：${input.painPoint || "用户担心效果、价格、适合人群和售后承接。"}`,
      `视频选题：评论区都在问${input.productName}值不值，这条直接说清楚。`,
      `开头钩子：${buildHook(input)}`,
      "评论回复型脚本：",
      `评论里很多人问这个问题，本质上不是单纯问${input.productName}，而是在担心“${input.painPoint}”。`,
      `我的建议是先看三个点：第一，看你的使用场景；第二，看卖点有没有证据；第三，看售后和承接是否清楚。`,
      `我们能讲的是：${input.sellingPoint || "资料中未提供核心卖点"}。没有资料的部分我不乱承诺。`,
      buildEnding(input)
    ].join("\n");
  }

  if (input.contentType === "竞品对比") {
    return [
      `对比选题：${input.productName}和同类产品怎么选？别只看价格。`,
      "对比维度：使用场景、核心卖点、细节证明、售后承接、长期成本。",
      `开头钩子：${buildHook(input)}`,
      `口播脚本：很多人选${input.productName}或同类产品时，第一反应是比价格。但真正影响体验的是“${input.painPoint}”。你要看的是能不能用“${input.sellingPoint}”解决这个问题。`,
      `产品优势表达：只讲资料里已经提供的卖点：${input.sellingPoint || "资料中未提供"}`,
      "风险提醒：不要贬低竞品，不要使用无法证明的第一、唯一、全网最低等表达。",
      "拍摄建议：用表格字幕做对比，画中画放产品细节、使用场景和评论问题。"
    ].join("\n");
  }

  if (input.contentType === "避坑科普") {
    return [
      `避坑选题：买${input.productName}前，先避开这几个坑。`,
      `用户容易踩的坑：${input.painPoint || "只看价格、只听卖点、没有看使用场景。"}`,
      `开头钩子：${buildHook(input)}`,
      `科普脚本：如果你是${input.targetAudience}，选${input.productName}之前先别急着下单。第一，看它是不是解决你的真实问题；第二，看卖点有没有证据；第三，看你最担心的售后或效果有没有明确承接。`,
      `正确选择标准：围绕${input.sellingPoint || "资料中未提供核心卖点"}做判断。`,
      "产品自然带入方式：讲标准时顺带展示自己的产品细节，不要硬夸。"
    ].join("\n");
  }

  const linesByType: Partial<Record<ScriptRecordContentType, string[]>> = {
    教知识: [
      buildHook(input),
      `很多人踩坑，不是因为不懂${input.productName}，而是没有先把判断标准搞清楚。`,
      `第一，看它能不能直接解决“${input.painPoint}”。`,
      `第二，看“${input.sellingPoint}”有没有真实画面或案例能证明。`,
      "第三，看后续承接是不是清楚，别只听一句好听的卖点。",
      buildEnding(input)
    ],
    晒过程: [
      `今天直接带你看一次${input.productName}真实过程。`,
      `先看用户最担心的点：${input.painPoint}。`,
      `接着看我们怎么把“${input.sellingPoint}”落到具体动作里。`,
      "中间这一步最容易被忽略，但它决定最后体验。",
      buildEnding(input)
    ],
    聊观点: [
      `我先说结论：${input.targetAudience}选择${input.productName}，不要只看表面。`,
      `真正影响结果的是你有没有提前处理“${input.painPoint}”。`,
      `所以我更看重“${input.sellingPoint}”，因为它能降低后续试错成本。`,
      "如果这点讲不清楚，再便宜也可能不是省钱。",
      buildEnding(input)
    ],
    讲故事: [
      `之前有个${input.targetAudience}来问${input.productName}，一开始只关心价格。`,
      `聊到后面才发现，他真正担心的是“${input.painPoint}”。`,
      `我们没有直接推产品，而是先把“${input.sellingPoint}”对应的细节给他看。`,
      "他看完才知道，自己之前一直在看错重点。",
      buildEnding(input)
    ],
    带货转化: [
      `如果你准备买${input.productName}，这条先收藏。`,
      `别只问贵不贵，先看它能不能解决“${input.painPoint}”。`,
      `我们主打“${input.sellingPoint}”，重点不是把话说满，而是把细节拍清楚。`,
      "你可以对比一下同类产品，有没有这些细节和承接。",
      buildEnding(input)
    ],
    短视频口播: [
      buildHook(input),
      `很多${input.targetAudience}不是不想买${input.productName}，而是卡在“${input.painPoint}”。`,
      `这条我直接说判断标准：先看场景，再看细节，最后看承接。`,
      `我们能提供的真实卖点是：${input.sellingPoint || "资料中未提供"}`,
      buildEnding(input)
    ],
    电商带货: [
      `如果你准备买${input.productName}，这条先看完。`,
      `别只看价格，先看它能不能解决“${input.painPoint}”。`,
      `核心卖点是：${input.sellingPoint || "资料中未提供"}。`,
      "画面上要把产品细节、上身/使用场景、对比和反馈拍出来。",
      buildEnding(input)
    ],
    "老板 IP": [
      `我是做${input.productName}相关业务的，今天说一句实话。`,
      `很多${input.targetAudience}踩坑，是因为没先搞清楚“${input.painPoint}”。`,
      `真正该看的不是话术多好听，而是${input.sellingPoint || "资料中未提供的真实卖点"}有没有证据。`,
      buildEnding(input)
    ]
  };

  return [
    `平台风格：${platformStyleRules(input.platform)}`,
    "",
    ...(linesByType[input.contentType] || linesByType["短视频口播"] || []).map((line, index) => `${index + 1}. ${line}`)
  ].join("\n");
}

function buildShotSuggestions(input: SimpleScriptInput) {
  if (!input.needShotList) return "未开启分镜建议，可在高级设置中勾选。";
  if (input.contentType === "小红书图文") {
    return [
      "图 1：封面，突出痛点和产品关键词。",
      "图 2：真实使用场景，展示目标人群代入感。",
      "图 3：产品/服务细节，证明核心卖点。",
      "图 4：对比或避坑说明，降低购买顾虑。",
      "图 5：评论反馈或常见问题。",
      "图 6：结尾引导评论、私信或进店咨询。"
    ].join("\n");
  }
  return [
    "镜头 1：人物中近景直视镜头，直接说开头钩子，字幕压出痛点关键词。",
    `镜头 2：切到${input.scene || "真实使用场景"}，展示用户为什么会遇到这个问题。`,
    "镜头 3：产品细节或服务过程特写，用画面证明核心卖点。",
    "镜头 4：加入对比、评论截图或案例反馈，降低用户顾虑。",
    "镜头 5：回到人物口播，给出结尾引导。"
  ].join("\n");
}

function buildOverlaySuggestions(input: SimpleScriptInput) {
  if (!input.needOverlay) return "未开启画中画建议，可在高级设置中勾选。";
  return [
    "痛点段：放用户评论、错误示范、使用前状态。",
    "卖点段：放产品细节、过程证据、对比图、客户反馈。",
    input.contentType === "直播切片" ? "直播段：放直播间弹幕、商品细节、主播手部动作。" : "",
    "转化段：放评论区问题、私信入口、直播间承接画面。"
  ].filter(Boolean).join("\n");
}

function splitLines(value: string) {
  return value.split(/\n+/).map((item) => item.trim()).filter(Boolean);
}

function buildEnding(input: SimpleScriptInput) {
  if (input.videoGoal === "涨粉") return "想看更多真实避坑和判断标准，先关注，我继续拆给你看。";
  if (input.videoGoal === "建信任") return "如果你也遇到类似情况，可以把你的问题留在评论区，我按真实情况帮你判断。";
  if (input.videoGoal === "引流") return "想要完整判断清单，评论区留一个“清单”，我发你。";
  if (input.videoGoal === "直播间引流") return "想看现场细节和对比，今晚直播间我直接讲清楚。";
  if (input.videoGoal === "复购") return "如果你之前用过，也可以把反馈发我，我按你的场景给你搭配建议。";
  if (input.videoGoal === "测试选题") return "你最想先看哪一部分？评论区告诉我，我下一条按反馈继续测。";
  if (input.videoGoal === "复盘测试") return "你觉得这个判断标准有没有用？评论区告诉我，我下一条继续测试。";
  return "如果你正在纠结怎么选，直接把需求发我，我帮你看适不适合。";
}

function platformStyleRules(platform: ScriptRecordPlatform) {
  const rules: Record<ScriptRecordPlatform, string> = {
    抖音: "开头强钩子，节奏快，痛点直接，适合强转化。",
    小红书: "语气真实种草，标题像体验分享，细节充分，不要太硬广。",
    快手: "强调真实、信任、人设和售后，适合老板口播和直播承接。",
    视频号: "强调品质、信任和老板 IP，语气稳一点，不要太炸。",
    淘宝内容: "强调商品信息、卖点、使用场景和转化理由。",
    朋友圈: "像熟人推荐，适合复购、信任和成交理由。",
    私域朋友圈: "像熟人推荐，适合复购、信任和成交理由。"
  };
  return rules[platform];
}

function buildRiskCheck(input: { text: string; forbiddenWords: string; forbiddenClaims: string }): RiskCheckResult {
  const builtInRiskWords = ["全网最低", "第一", "100%", "永久", "根治", "治愈", "绝对", "稳赚", "最低价", "唯一", "国家级", "顶级"];
  const productRiskWords = input.forbiddenWords.split(/[、,\n，\s]+/).map((item) => item.trim()).filter(Boolean);
  const forbiddenClaims = input.forbiddenClaims.split(/\n+/).map((item) => item.trim()).filter(Boolean);
  const riskyWords = [...builtInRiskWords, ...productRiskWords].filter((word) => word && input.text.includes(word));
  const reasons = [
    riskyWords.length ? `检测到 ${riskyWords.join("、")} 等高风险或产品禁忌词。` : "",
    /销量|检测报告|明星|专利|认证|原价/.test(input.text) ? "涉及销量、检测报告、背书或价格信息，请确认是否有证据材料。" : "",
    forbiddenClaims.length ? `产品资料标记了不能承诺的内容：${forbiddenClaims.join("；")}` : ""
  ].filter(Boolean);
  const level: RiskCheckResult["level"] = riskyWords.length >= 2 || /根治|治愈|全网最低|100%/.test(input.text) ? "high" : riskyWords.length || reasons.length ? "medium" : "low";

  return {
    level,
    riskyWords,
    reasons: reasons.length ? reasons : ["暂未发现明显高风险表达，但仍需按产品真实资料核对。"],
    suggestions: riskyWords.slice(0, 5).map((word) => ({
      original: word,
      suggestion: word === "100%" ? "尽量 / 大多数情况下 / 根据实际情况" : word.includes("最低") ? "更划算 / 性价比更合适" : "更稳妥的事实表达",
      replacement: word === "100%" ? "尽量 / 大多数情况下 / 根据实际情况" : word.includes("最低") ? "更划算 / 性价比更合适" : "更稳妥的事实表达"
    })),
    disclaimer: "风控检查只是内容风险提醒，不构成法律意见。涉及功效、价格、数据和背书时，请以真实证据材料为准。"
  };
}

function pickSection(markdown: string, names: string[]) {
  for (const name of names) {
    const escaped = escapeRegExp(name);
    const numberedName = `(?:\\d+[\\.、]\\s*)?${escaped}`;
    const patterns = [
      new RegExp(`(?:^|\\n)#{1,4}\\s*${numberedName}\\s*\\n([\\s\\S]*?)(?=\\n#{1,4}\\s|$)`, "i"),
      new RegExp(`(?:^|\\n)(?:\\*\\*)?${numberedName}(?:\\*\\*)?[：:]\\s*([\\s\\S]*?)(?=\\n(?:#{1,4}\\s|\\d+\\.\\s|[-*]\\s*\\*\\*)|$)`, "i")
    ];
    for (const pattern of patterns) {
      const match = markdown.match(pattern);
      const value = match?.[1]?.trim();
      if (value) return value.replace(/^\s*[-*]\s*/, "").trim();
    }
  }
  return "";
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function parsePercent(value: string) {
  const matched = value.match(/\d+(\.\d+)?/);
  return matched ? Number(matched[0]) : 0;
}
