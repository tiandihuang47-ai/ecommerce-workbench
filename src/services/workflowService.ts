import { approvalNodeDefinitions, reviewScoreLabels } from "@/lib/pipeline-types";
import { createId, nowIso } from "@/lib/shared/time";
import type {
  ApprovalNodeName,
  ApprovalRecord,
  ApprovalStatus,
  ContentAsset,
  EditBrief,
  PipelineData,
  ProductProfile,
  ReviewRecord,
  ReviewScore,
  ScriptItem,
  ShotList,
  TaskComment,
  TaskRisk,
  VersionContentType,
  VersionRecord,
  VideoTask
} from "@/lib/pipeline-types";
import {
  generateEditBrief,
  generateReviewConclusion,
  generateScript,
  generateShotList,
  generateTopics,
  reviewToContentAsset
} from "@/services/generatorService";

export function latestApprovalForNode(records: ApprovalRecord[], taskId: string, nodeName: ApprovalNodeName) {
  return records
    .filter((item) => item.taskId === taskId && item.nodeName === nodeName)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
}

export function approvalStatus(records: ApprovalRecord[], taskId: string, nodeName: ApprovalNodeName): ApprovalStatus {
  return latestApprovalForNode(records, taskId, nodeName)?.status || "待提交";
}

export function createApprovalRecord(input: {
  taskId: string;
  nodeName: ApprovalNodeName;
  status: ApprovalStatus;
  submitter: string;
  reviewer: string;
  reviewOpinion?: string;
  changeRequest?: string;
  versionId?: string;
}): ApprovalRecord {
  const node = approvalNodeDefinitions.find((item) => item.nodeName === input.nodeName) || approvalNodeDefinitions[0];
  const now = nowIso();
  return {
    id: createId("approval"),
    taskId: input.taskId,
    nodeName: input.nodeName,
    objectType: node.objectType,
    status: input.status,
    submitter: input.submitter,
    reviewer: input.reviewer,
    submittedAt: input.status === "待审核" ? now : "",
    reviewedAt: ["通过", "驳回", "需修改"].includes(input.status) ? now : "",
    reviewOpinion: input.reviewOpinion || "",
    changeRequest: input.changeRequest || "",
    versionId: input.versionId || "",
    blocksNextStep: input.status === "驳回" || input.status === "需修改",
    createdAt: now
  };
}

export function getContentSnapshot(data: PipelineData, task: VideoTask, contentType: VersionContentType) {
  if (contentType === "脚本") {
    const script = data.scripts.find((item) => item.id === task.scriptId);
    return script
      ? JSON.stringify({ title: script.title, hook: script.hook, copy: script.copy, rhythm: script.rhythm, pictureInPicture: script.pictureInPicture, ending: script.ending }, null, 2)
      : "当前任务未关联脚本";
  }

  if (contentType === "分镜拍摄单") {
    const shotList = data.shotLists.find((item) => item.id === task.shotListId);
    return shotList ? JSON.stringify(shotList, null, 2) : "当前任务未关联分镜拍摄单";
  }

  if (contentType === "剪辑说明单") {
    const editBrief = data.editBriefs.find((item) => item.id === task.editBriefId);
    return editBrief ? JSON.stringify(editBrief, null, 2) : "当前任务未关联剪辑说明单";
  }

  if (contentType === "发布文案") {
    const publish = data.publishPlans.find((item) => item.id === task.publishRecordId);
    return publish ? JSON.stringify({ title: publish.title, coverTitle: publish.coverTitle, caption: publish.caption, hashtags: publish.hashtags, commentGuide: publish.commentGuide }, null, 2) : "当前任务未关联发布记录";
  }

  const review = data.reviewRecords.find((item) => item.id === task.reviewRecordId);
  return review ? JSON.stringify({ autoConclusion: review.autoConclusion, insight: review.insight, nextOptimization: review.nextOptimization }, null, 2) : "当前任务未关联复盘记录";
}

export function createVersionRecord(input: {
  data: PipelineData;
  task: VideoTask;
  contentType: VersionContentType;
  versionName: string;
  creator: string;
  changeNote: string;
}): VersionRecord {
  return {
    id: createId("version"),
    versionName: input.versionName,
    contentType: input.contentType,
    taskId: input.task.id,
    creator: input.creator,
    createdAt: nowIso(),
    changeNote: input.changeNote,
    contentSnapshot: getContentSnapshot(input.data, input.task, input.contentType),
    isLatest: true,
    approved: false
  };
}

export function analyzeTaskRisks(data: PipelineData, task: VideoTask): TaskRisk[] {
  const product = data.products.find((item) => item.id === task.productId);
  const latestVersions = data.versionRecords.filter((item) => item.taskId === task.id && item.isLatest);
  const handled = data.taskRisks.filter((item) => item.taskId === task.id && item.status === "已处理").map((item) => item.riskType);
  const risks: TaskRisk[] = [];
  const add = (riskType: TaskRisk["riskType"], title: string, description: string, actionText: string) => {
    if (handled.includes(riskType)) return;
    risks.push({
      id: `${task.id}_${riskType}`,
      taskId: task.id,
      riskType,
      title,
      description,
      actionText,
      status: "未处理",
      createdAt: nowIso(),
      resolvedAt: ""
    });
  };

  const today = new Date().toISOString().slice(0, 10);
  if (task.dueDate && task.dueDate < today && task.status !== "已归档") {
    add("任务逾期", "任务已逾期", "截止时间已过但任务还未归档。", "重新确认负责人和截止时间，或推进任务状态。");
  }

  if ((task.status === "待拍摄" || task.status === "拍摄中") && approvalStatus(data.approvalRecords, task.id, "脚本审核") !== "通过") {
    add("脚本未审核却进入拍摄", "脚本未审核通过", "任务已进入拍摄阶段，但脚本审核未通过。", "先完成脚本审核，避免摄影师按旧脚本拍摄。");
  }

  if ((task.status === "待拍摄" || task.status === "拍摄中") && !task.shotListId) {
    add("分镜未生成却进入拍摄", "缺少分镜拍摄单", "任务进入拍摄阶段，但没有标准分镜拍摄单。", "从脚本生成分镜拍摄单，并标记必拍镜头。");
  }

  if ((task.status === "待剪辑" || task.status === "剪辑中") && !task.editBriefId) {
    add("剪辑说明未生成却进入剪辑", "缺少剪辑说明单", "任务进入剪辑阶段，但没有剪辑说明单。", "根据脚本和分镜生成剪辑说明单。");
  }

  const publish = data.publishPlans.find((item) => item.id === task.publishRecordId);
  if (publish?.publishAt && publish.status === "已发布") {
    const publishedAt = new Date(publish.publishAt).getTime();
    const over24h = Number.isFinite(publishedAt) && Date.now() - publishedAt > 24 * 60 * 60 * 1000;
    const hasData = data.reviewRecords.some((item) => item.taskId === task.id && (item.metrics.views || item.metrics.completionRate || item.metrics.productClicks));
    if (over24h && !hasData) {
      add("发布后超过24小时未填写数据", "发布后未补数据", "视频发布超过 24 小时，但没有填写复盘数据。", "补充播放、留存、完播、互动和转化数据。");
    }
  }

  if ((task.status === "已发布" || task.status === "待复盘") && !task.reviewRecordId) {
    add("已发布但未复盘", "已发布但未复盘", "视频已发布或待复盘，但没有复盘记录。", "进入标准化复盘，填写数据和归因。");
  }

  const unresolvedComments = data.taskComments.some((item) => item.taskId === task.id && item.commentType === "修改意见" && item.status !== "已解决");
  if (unresolvedComments) {
    add("有未解决修改意见", "存在未解决修改意见", "任务协作评论里还有未解决的修改意见。", "处理评论区修改意见，并标记已解决。");
  }

  const contentTypes: VersionContentType[] = ["脚本", "分镜拍摄单", "剪辑说明单", "发布文案", "复盘结论"];
  const missingLatest = contentTypes.some((type) => data.versionRecords.some((item) => item.taskId === task.id && item.contentType === type) && !latestVersions.some((item) => item.contentType === type));
  if (missingLatest) {
    add("当前任务使用的不是最新版本", "版本状态异常", "存在版本记录，但当前没有明确的最新版本。", "在版本记录里创建或恢复最新版本。");
  }

  if (task.productId && !product?.sellingPoints?.trim()) {
    add("产品资料缺失核心卖点", "产品资料缺核心卖点", "关联产品资料没有核心卖点，脚本容易失去事实依据。", "回到产品资料库补齐核心卖点。");
  }

  if (task.productId && !product?.forbiddenWords?.trim()) {
    add("产品资料缺失禁忌词", "产品资料缺禁忌词", "关联产品资料没有禁忌词，发布前风控不足。", "回到产品资料库补齐禁忌词和谨慎表达。");
  }

  return risks;
}

export function buildScoreHint(score: ReviewScore) {
  const entries = [
    ["选题", score.topic],
    ["开头", score.opening],
    ["脚本", score.script],
    ["拍摄", score.shooting],
    ["剪辑", score.editing],
    ["发布", score.publishing],
    ["转化", score.conversion]
  ];
  const lows = entries.filter(([, value]) => Number(value) <= 2).map(([label]) => label);
  const highs = entries.filter(([, value]) => Number(value) >= 4).map(([label]) => label);
  return `高分项：${highs.join("、") || "暂无"}。低分项：${lows.join("、") || "暂无"}。优先复盘低分项和数据未达标项。`;
}

export function enhanceReviewConclusion(review: ReviewRecord) {
  const contentScoreSummary = Object.entries(review.scores)
    .map(([key, value]) => `${reviewScoreLabels[key as keyof typeof reviewScoreLabels]}：${value}分`)
    .join("；");
  const dataScoreHint = buildScoreHint(review.dataScores);
  return [
    generateReviewConclusion(review),
    `数据评分提示：${dataScoreHint}`,
    `内容评分：${contentScoreSummary}`,
    `主因：${review.primaryCause || "待补充"}；次因：${review.secondaryCause || "待补充"}。`,
    `证据：${review.evidence || "请补充具体数据或评论证据"}。`,
    `下次动作：${review.nextAction || review.nextOptimization || "围绕低分项做一条对照测试视频"}。`
  ].join("\n");
}

export function createNextTaskFromFailedReview(review: ReviewRecord, sourceTask?: VideoTask): VideoTask {
  const now = nowIso();
  return {
    id: createId("task"),
    videoTitle: review.nextTestDirection || `${review.videoTitle || "失败复盘"}优化测试`,
    projectId: review.projectId,
    productId: review.productId,
    contentType: sourceTask?.contentType || "教知识",
    contentGoal: sourceTask?.contentGoal || "涨粉",
    status: "选题中",
    topicOwner: sourceTask?.topicOwner || "",
    scriptOwner: sourceTask?.scriptOwner || "",
    shootingOwner: sourceTask?.shootingOwner || "",
    editingOwner: sourceTask?.editingOwner || "",
    publishingOwner: sourceTask?.publishingOwner || "",
    reviewOwner: sourceTask?.reviewOwner || "",
    dueDate: "",
    priority: "高",
    remarks: `来源失败复盘：${review.videoTitle}\n下次保留：${review.keepNext || review.retainedPoints}\n下次删除：${review.removeNext || review.avoidNextTime}\n下次加强：${review.strengthenNext || review.nextOptimization}`,
    topicId: "",
    scriptId: "",
    shotListId: "",
    editBriefId: "",
    publishRecordId: "",
    reviewRecordId: "",
    createdAt: now,
    updatedAt: now
  };
}

export function localAiProductInsights(product: ProductProfile) {
  return {
    sellingPoints: product.sellingPoints || [product.differentiatedSellingPoints, product.competitorAdvantages, product.conversionReasons].filter(Boolean).join("\n") || `${product.productName}需要突出真实场景、可验证卖点和用户购买理由。`,
    painPoints: product.painPoints || [product.userConcerns, product.purchaseMotivation, product.userScenario].filter(Boolean).join("\n") || "用户担心选错、花冤枉钱、效果不符合预期、售后承接不清楚。",
    forbiddenRisk: [product.forbiddenWords, product.forbiddenEffects, product.exaggeratedClaims, product.sensitiveInfo].filter(Boolean).join("\n") || "避免绝对化承诺、夸大效果、虚构销量价格和没有证据的对比结论。"
  };
}

export function localAiTaskTopic(project: NonNullable<PipelineData["projects"][number]>, product?: ProductProfile) {
  return generateTopics({ project, product, count: 1, goal: project.contentGoal, angle: "痛点型", extra: "来自任务详情的一键生成" })[0];
}

export function localAiTaskScript(project: NonNullable<PipelineData["projects"][number]>, product: ProductProfile | undefined, task: VideoTask, topicTitle?: string) {
  const topic = {
    id: task.topicId || createId("topic"),
    projectId: project.id,
    productId: product?.id || "",
    title: topicTitle || task.videoTitle,
    audience: product?.audience || project.audience,
    painPoint: product?.painPoints || project.painPoints,
    angle: task.contentType,
    hook: `${product?.audience || project.audience || "目标用户"}如果正在纠结${product?.productName || project.productName}，先看这个判断标准。`,
    coreOpinion: product?.sellingPoints || project.sellingPoints,
    sellingPoint: product?.sellingPoints || project.sellingPoints,
    shootingSuggestion: product?.materialConditions || "拍产品细节、用户场景和对比证据。",
    conversionAction: "评论区留下你的需求，我帮你判断。",
    platform: project.targetPlatform,
    priority: task.priority,
    adopted: true,
    createdAt: nowIso(),
    updatedAt: nowIso()
  };
  return generateScript({ project, product, topic, scriptType: task.contentType, duration: "60秒", style: "真实口语", extra: task.remarks });
}

export function localAiAssetFromReview(review: ReviewRecord): ContentAsset {
  return reviewToContentAsset({ ...review, autoConclusion: review.autoConclusion || enhanceReviewConclusion(review) });
}
