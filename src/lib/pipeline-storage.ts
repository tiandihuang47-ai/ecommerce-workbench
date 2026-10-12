"use client";

import { knowledgeItems } from "@/data/director-rules";
import { createId, nowIso } from "@/lib/shared/time";
import { storageGet, storageRemove, storageSet } from "@/lib/web-storage";
import { PRODUCT_IMAGE_LIMIT, normalizeProductImageRole, type ProductDocumentAnalysisStatus, type ProductDocumentAsset, type ProductImageAsset } from "@/lib/product-assets-types";
import type {
  ApprovalRecord,
  ContentAsset,
  DeconstructionRecord,
  DirectorMethod,
  EditBrief,
  PipelineData,
  CommentInsightRecord,
  ProductProfile,
  ProductRecord,
  ProductRecordSaveInput,
  Project,
  PublishPlan,
  ReviewRecord,
  ResourceItem,
  ScriptItem,
  ScriptRecord,
  ShotList,
  ShotRow,
  SimpleDeconstructionRecord,
  SimpleReviewRecord,
  SimpleTranscriptRecord,
  TaskComment,
  TaskRisk,
  TeamMember,
  TopicCard,
  VideoTask,
  VersionRecord,
  ViralAnalysis
} from "@/lib/pipeline-types";

const storageKeys = {
  projects: "director-platform.projects",
  products: "director-platform.products",
  videoTasks: "director-platform.videoTasks",
  topics: "director-platform.topics",
  scripts: "director-platform.scripts",
  shotLists: "director-platform.shotLists",
  editBriefs: "director-platform.editBriefs",
  publishPlans: "director-platform.publishPlans",
  reviewRecords: "director-platform.reviewRecords",
  contentAssets: "director-platform.contentAssets",
  deconstructionRecords: "director-platform.deconstructionRecords",
  approvalRecords: "director-platform.approvalRecords",
  versionRecords: "director-platform.versionRecords",
  taskComments: "director-platform.taskComments",
  teamMembers: "director-platform.teamMembers",
  taskRisks: "director-platform.taskRisks",
  viralAnalyses: "director-platform.viralAnalyses",
  directorMethods: "director-platform.directorMethods",
  scriptRecords: "director-platform.scriptRecords",
  simpleReviewRecords: "director-platform.simpleReviewRecords",
  simpleDeconstructionRecords: "director-platform.simpleDeconstructionRecords",
  scriptTranscripts: "director-platform.scriptTranscripts",
  resourceItems: "director-platform.resourceItems",
  productRecords: "director-platform.productRecords",
  commentInsightRecords: "director-platform.commentInsightRecords"
} as const;

export { createId, nowIso };

export function getProjects() {
  return readList<Project>(storageKeys.projects);
}

export function saveProject(item: Project) {
  return upsertItem(storageKeys.projects, item);
}

export function deleteProject(id: string) {
  deleteItem<Project>(storageKeys.projects, id);
}

export function getProducts() {
  return readList<ProductProfile>(storageKeys.products).map(normalizeProduct);
}

export function saveProduct(item: ProductProfile) {
  return upsertItem(storageKeys.products, item);
}

export function deleteProduct(id: string) {
  deleteItem<ProductProfile>(storageKeys.products, id);
}

export function getVideoTasks() {
  return readList<VideoTask>(storageKeys.videoTasks);
}

export function saveVideoTask(item: VideoTask) {
  return upsertItem(storageKeys.videoTasks, item);
}

export function deleteVideoTask(id: string) {
  deleteItem<VideoTask>(storageKeys.videoTasks, id);
}

export function getTopics() {
  return readList<TopicCard>(storageKeys.topics);
}

export function saveTopic(item: TopicCard) {
  return upsertItem(storageKeys.topics, item);
}

export function deleteTopic(id: string) {
  deleteItem<TopicCard>(storageKeys.topics, id);
}

export function getScripts() {
  return readList<ScriptItem>(storageKeys.scripts);
}

export function saveScript(item: ScriptItem) {
  return upsertItem(storageKeys.scripts, item);
}

export function deleteScript(id: string) {
  deleteItem<ScriptItem>(storageKeys.scripts, id);
}

export function getShotLists() {
  return readList<ShotList>(storageKeys.shotLists).map(normalizeShotList);
}

export function saveShotList(item: ShotList) {
  return upsertItem(storageKeys.shotLists, item);
}

export function deleteShotList(id: string) {
  deleteItem<ShotList>(storageKeys.shotLists, id);
}

export function getEditBriefs() {
  return readList<EditBrief>(storageKeys.editBriefs);
}

export function saveEditBrief(item: EditBrief) {
  return upsertItem(storageKeys.editBriefs, item);
}

export function deleteEditBrief(id: string) {
  deleteItem<EditBrief>(storageKeys.editBriefs, id);
}

export function getPublishPlans() {
  return readList<PublishPlan>(storageKeys.publishPlans).map(normalizePublishPlan);
}

export function savePublishPlan(item: PublishPlan) {
  return upsertItem(storageKeys.publishPlans, item);
}

export function deletePublishPlan(id: string) {
  deleteItem<PublishPlan>(storageKeys.publishPlans, id);
}

export function getReviewRecords() {
  return readList<ReviewRecord>(storageKeys.reviewRecords).map(normalizeReviewRecord);
}

export function saveReviewRecord(item: ReviewRecord) {
  return upsertItem(storageKeys.reviewRecords, item);
}

export function deleteReviewRecord(id: string) {
  deleteItem<ReviewRecord>(storageKeys.reviewRecords, id);
}

export function getContentAssets() {
  return readList<ContentAsset>(storageKeys.contentAssets);
}

export function saveContentAsset(item: ContentAsset) {
  return upsertItem(storageKeys.contentAssets, item);
}

export function deleteContentAsset(id: string) {
  deleteItem<ContentAsset>(storageKeys.contentAssets, id);
}

export function getDeconstructionRecords() {
  return readList<DeconstructionRecord>(storageKeys.deconstructionRecords);
}

export function saveDeconstructionRecord(item: DeconstructionRecord) {
  return upsertItem(storageKeys.deconstructionRecords, item);
}

export function deleteDeconstructionRecord(id: string) {
  deleteItem<DeconstructionRecord>(storageKeys.deconstructionRecords, id);
}

export function getApprovalRecords() {
  return readList<ApprovalRecord>(storageKeys.approvalRecords);
}

export function saveApprovalRecord(item: ApprovalRecord) {
  return upsertItem(storageKeys.approvalRecords, item);
}

export function deleteApprovalRecord(id: string) {
  deleteItem<ApprovalRecord>(storageKeys.approvalRecords, id);
}

export function getVersionRecords() {
  return readList<VersionRecord>(storageKeys.versionRecords);
}

export function saveVersionRecord(item: VersionRecord) {
  return upsertItem(storageKeys.versionRecords, item);
}

export function deleteVersionRecord(id: string) {
  deleteItem<VersionRecord>(storageKeys.versionRecords, id);
}

export function getTaskComments() {
  return readList<TaskComment>(storageKeys.taskComments);
}

export function saveTaskComment(item: TaskComment) {
  return upsertItem(storageKeys.taskComments, item);
}

export function deleteTaskComment(id: string) {
  deleteItem<TaskComment>(storageKeys.taskComments, id);
}

export function getTeamMembers() {
  return readList<TeamMember>(storageKeys.teamMembers);
}

export function saveTeamMember(item: TeamMember) {
  return upsertItem(storageKeys.teamMembers, item);
}

export function deleteTeamMember(id: string) {
  deleteItem<TeamMember>(storageKeys.teamMembers, id);
}

export function getTaskRisks() {
  return readList<TaskRisk>(storageKeys.taskRisks);
}

export function saveTaskRisk(item: TaskRisk) {
  return upsertItem(storageKeys.taskRisks, item);
}

export function deleteTaskRisk(id: string) {
  deleteItem<TaskRisk>(storageKeys.taskRisks, id);
}

export function getViralAnalyses() {
  return readList<ViralAnalysis>(storageKeys.viralAnalyses);
}

export function saveViralAnalysis(item: ViralAnalysis) {
  return upsertItem(storageKeys.viralAnalyses, item);
}

export function deleteViralAnalysis(id: string) {
  deleteItem<ViralAnalysis>(storageKeys.viralAnalyses, id);
}

export function getDirectorMethods() {
  const stored = readList<DirectorMethod>(storageKeys.directorMethods);
  if (stored.length > 0) {
    return stored;
  }

  const defaults = knowledgeItems.map((item, index): DirectorMethod => ({
    id: `method_default_${index}`,
    category: mapMethodCategory(item.module),
    name: item.methodName,
    scenario: item.scenario,
    steps: item.steps.join("\n"),
    example: item.example,
    promptTemplate: item.promptTemplate,
    createdAt: nowIso(),
    updatedAt: nowIso()
  }));

  writeList(storageKeys.directorMethods, defaults);
  return defaults;
}

export function saveDirectorMethod(item: DirectorMethod) {
  return upsertItem(storageKeys.directorMethods, item);
}

export function deleteDirectorMethod(id: string) {
  deleteItem<DirectorMethod>(storageKeys.directorMethods, id);
}

export function getScriptRecords() {
  const saved = readList<ScriptRecord>(storageKeys.scriptRecords).map(normalizeScriptRecord);
  const savedIds = new Set(saved.map((item) => item.id));
  const converted = getScripts()
    .map(scriptItemToRecord)
    .filter((item) => !savedIds.has(item.id));

  return [...saved, ...converted].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export function saveScriptRecord(item: ScriptRecord) {
  return upsertItem(storageKeys.scriptRecords, normalizeScriptRecord(item));
}

export function deleteScriptRecord(id: string) {
  deleteItem<ScriptRecord>(storageKeys.scriptRecords, id);
}

/** 脚本工作台解析成功的逐字稿库（AI 对话可直接引用），按更新时间倒序。 */
export function getScriptTranscriptRecords() {
  return readList<SimpleTranscriptRecord>(storageKeys.scriptTranscripts)
    .filter((item) => (item.transcript || "").trim())
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export type ScriptTranscriptMergeInput = {
  awemeId?: string;
  link: string;
  title: string;
  authorName: string;
  transcript: string;
  /** 无 awemeId 且链接可能缺失时的确定性 id（例如工作台草稿、脚本记录来源），保证幂等。 */
  fallbackId?: string;
};

/** 在内存列表里把一条解析结果并入逐字稿库；返回落库记录与是否真的写入了新内容。 */
function mergeScriptTranscriptInto(
  records: SimpleTranscriptRecord[],
  input: ScriptTranscriptMergeInput,
  now: string
): { record: SimpleTranscriptRecord; changed: boolean } | null {
  const transcript = (input.transcript || "").trim();
  if (!transcript) return null;
  const existing =
    (input.awemeId
      ? records.find((entry) => entry.id === `transcript_${input.awemeId}` || (Boolean(entry.awemeId) && entry.awemeId === input.awemeId))
      : undefined)
    || (input.link ? records.find((entry) => entry.link === input.link) : undefined)
    || (input.fallbackId ? records.find((entry) => entry.id === input.fallbackId) : undefined);
  const title = (input.title || "").trim();
  if (existing && existing.transcript === transcript && existing.title === title) {
    return { record: existing, changed: false };
  }
  const next: SimpleTranscriptRecord = {
    id: existing?.id || (input.awemeId ? `transcript_${input.awemeId}` : input.fallbackId || createId("transcript")),
    title,
    authorName: (input.authorName || "").trim(),
    link: input.link || existing?.link || "",
    awemeId: input.awemeId || existing?.awemeId || "",
    // 逐字稿原文完整存档（不再为模型上下文截断；存储层的 8MB 上限由 web-storage 统一保护）
    transcript,
    createdAt: existing?.createdAt || now,
    updatedAt: now
  };
  const index = records.findIndex((entry) => entry.id === next.id);
  if (index >= 0) records[index] = next;
  else records.unshift(next);
  return { record: next, changed: true };
}

/** 解析成功后把逐字稿并入「逐字稿库」（脚本工作台 / 批量扒稿共用），返回落库后的记录。 */
export function saveScriptTranscriptRecord(input: ScriptTranscriptMergeInput): SimpleTranscriptRecord {
  const records = readList<SimpleTranscriptRecord>(storageKeys.scriptTranscripts);
  const merged = mergeScriptTranscriptInto(records, input, nowIso());
  if (merged?.changed) writeList(storageKeys.scriptTranscripts, records);
  return merged?.record || records[0];
}

/** 批量合并（AI 对话打开时自愈用）：单次读库、逐条合并、单次写回。 */
export function mergeScriptTranscriptRecords(inputs: ScriptTranscriptMergeInput[]): void {
  if (inputs.length === 0) return;
  const records = readList<SimpleTranscriptRecord>(storageKeys.scriptTranscripts);
  const now = nowIso();
  let changed = false;
  for (const input of inputs) {
    if (mergeScriptTranscriptInto(records, input, now)?.changed) changed = true;
  }
  if (changed) writeList(storageKeys.scriptTranscripts, records);
}

/** 工作台手动编辑逐字稿后同步库中同一条；记录不存在时静默跳过。 */
export function updateScriptTranscriptRecordText(id: string, transcript: string) {
  const items = readList<SimpleTranscriptRecord>(storageKeys.scriptTranscripts);
  const index = items.findIndex((entry) => entry.id === id);
  if (index < 0) return;
  // 原文完整存档，不截断
  items[index] = { ...items[index], transcript, updatedAt: nowIso() };
  writeList(storageKeys.scriptTranscripts, items);
}

/** 默认只返回未归档的产品；历史任务与快照不走这里，不受影响。 */
export function getProductRecords(options: { includeArchived?: boolean } = {}) {
  const raw = readList<Partial<ProductRecord>>(storageKeys.productRecords);
  /* 首次读取自动迁移：老档案没有 images / document / coverImageId / archivedAt 字段时，
   * 补齐后立刻写回，之后就是新结构；不会要求用户重新录入旧产品。 */
  const needsMigration = raw.some((item) => (
    item.images === undefined || item.document === undefined || item.coverImageId === undefined || item.archivedAt === undefined
  ));
  const records = raw.map(normalizeProductRecord).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  if (needsMigration && typeof window !== "undefined") {
    writeList(storageKeys.productRecords, records);
  }
  return options.includeArchived ? records : records.filter((item) => !item.archivedAt);
}

/** 包含已归档产品的全量读取，供历史任务回看当时使用的产品。 */
export function getAllProductRecords() {
  return getProductRecords({ includeArchived: true });
}

export function getProductRecordById(id: string, options: { includeArchived?: boolean } = {}) {
  return getProductRecords(options).find((item) => item.id === id) || null;
}

/** 软删除：产品从列表与选择器消失，但历史任务快照与图片文件都保留。 */
export function archiveProductRecord(id: string) {
  const all = getProductRecords({ includeArchived: true });
  const existing = all.find((item) => item.id === id);
  if (!existing) return null;
  const now = nowIso();
  return upsertItem(storageKeys.productRecords, normalizeProductRecord({ ...existing, archivedAt: now, updatedAt: now }));
}

export function restoreProductRecord(id: string) {
  const all = getProductRecords({ includeArchived: true });
  const existing = all.find((item) => item.id === id);
  if (!existing) return null;
  return upsertItem(storageKeys.productRecords, normalizeProductRecord({ ...existing, archivedAt: "", updatedAt: nowIso() }));
}

export function saveProductRecord(item: ProductRecordSaveInput) {
  const name = item.name.trim();
  if (!name) {
    throw new Error("产品名称不能为空。");
  }

  const existing = item.id
    ? readList<Partial<ProductRecord>>(storageKeys.productRecords).find((entry) => entry.id === item.id)
    : undefined;
  const now = nowIso();
  const saved = normalizeProductRecord({
    ...existing,
    ...item,
    id: item.id || createId("product_record"),
    name,
    createdAt: existing?.createdAt || item.createdAt || now,
    updatedAt: now
  });

  return upsertItem(storageKeys.productRecords, saved);
}

export function deleteProductRecord(id: string) {
  deleteItem<ProductRecord>(storageKeys.productRecords, id);
}

export function getCommentInsightRecords() {
  return readList<CommentInsightRecord>(storageKeys.commentInsightRecords).map(normalizeCommentInsightRecord).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export function saveCommentInsightRecord(item: CommentInsightRecord) {
  return upsertItem(storageKeys.commentInsightRecords, normalizeCommentInsightRecord(item));
}

export function deleteCommentInsightRecord(id: string) {
  deleteItem<CommentInsightRecord>(storageKeys.commentInsightRecords, id);
}

export function getSimpleReviewRecords() {
  const saved = readList<SimpleReviewRecord>(storageKeys.simpleReviewRecords).map(normalizeSimpleReviewRecord);
  const savedIds = new Set(saved.map((item) => item.id));
  const converted = getReviewRecords()
    .map(reviewRecordToSimple)
    .filter((item) => !savedIds.has(item.id));

  return [...saved, ...converted].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export function saveSimpleReviewRecord(item: SimpleReviewRecord) {
  return upsertItem(storageKeys.simpleReviewRecords, normalizeSimpleReviewRecord(item));
}

export function deleteSimpleReviewRecord(id: string) {
  deleteItem<SimpleReviewRecord>(storageKeys.simpleReviewRecords, id);
}

export function getSimpleDeconstructionRecords() {
  const saved = readList<SimpleDeconstructionRecord>(storageKeys.simpleDeconstructionRecords).map(normalizeSimpleDeconstructionRecord);
  const savedIds = new Set(saved.map((item) => item.id));
  const converted = [
    ...getViralAnalyses().map(viralAnalysisToSimple),
    ...getDeconstructionRecords().map(deconstructionRecordToSimple)
  ].filter((item) => !savedIds.has(item.id));

  return [...saved, ...converted].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export function saveSimpleDeconstructionRecord(item: SimpleDeconstructionRecord) {
  return upsertItem(storageKeys.simpleDeconstructionRecords, normalizeSimpleDeconstructionRecord(item));
}

export function deleteSimpleDeconstructionRecord(id: string) {
  deleteItem<SimpleDeconstructionRecord>(storageKeys.simpleDeconstructionRecords, id);
}

export function getResourceItems() {
  return readList<ResourceItem>(storageKeys.resourceItems).map(normalizeResourceItem);
}

export function saveResourceItem(item: ResourceItem) {
  return upsertItem(storageKeys.resourceItems, normalizeResourceItem(item));
}

export function deleteResourceItem(id: string) {
  deleteItem<ResourceItem>(storageKeys.resourceItems, id);
}

export function getPipelineData(): PipelineData {
  return {
    projects: getProjects(),
    products: getProducts(),
    videoTasks: getVideoTasks(),
    topics: getTopics(),
    scripts: getScripts(),
    shotLists: getShotLists(),
    editBriefs: getEditBriefs(),
    publishPlans: getPublishPlans(),
    reviewRecords: getReviewRecords(),
    contentAssets: getContentAssets(),
    deconstructionRecords: getDeconstructionRecords(),
    approvalRecords: getApprovalRecords(),
    versionRecords: getVersionRecords(),
    taskComments: getTaskComments(),
    teamMembers: getTeamMembers(),
    taskRisks: getTaskRisks(),
    viralAnalyses: getViralAnalyses(),
    directorMethods: getDirectorMethods(),
    scriptRecords: getScriptRecords(),
    simpleReviewRecords: getSimpleReviewRecords(),
    simpleDeconstructionRecords: getSimpleDeconstructionRecords(),
    scriptTranscripts: getScriptTranscriptRecords(),
    resourceItems: getResourceItems(),
    productRecords: getProductRecords(),
    commentInsightRecords: getCommentInsightRecords()
  };
}

export function clearPipelineData() {
  if (typeof window === "undefined") {
    return;
  }

  Object.values(storageKeys).forEach((key) => storageRemove(key));
}

export function importPipelineData(data: Partial<PipelineData>) {
  if (data.projects) writeList(storageKeys.projects, data.projects);
  if (data.products) writeList(storageKeys.products, data.products);
  if (data.videoTasks) writeList(storageKeys.videoTasks, data.videoTasks);
  if (data.topics) writeList(storageKeys.topics, data.topics);
  if (data.scripts) writeList(storageKeys.scripts, data.scripts);
  if (data.shotLists) writeList(storageKeys.shotLists, data.shotLists);
  if (data.editBriefs) writeList(storageKeys.editBriefs, data.editBriefs);
  if (data.publishPlans) writeList(storageKeys.publishPlans, data.publishPlans);
  if (data.reviewRecords) writeList(storageKeys.reviewRecords, data.reviewRecords);
  if (data.contentAssets) writeList(storageKeys.contentAssets, data.contentAssets);
  if (data.deconstructionRecords) writeList(storageKeys.deconstructionRecords, data.deconstructionRecords);
  if (data.approvalRecords) writeList(storageKeys.approvalRecords, data.approvalRecords);
  if (data.versionRecords) writeList(storageKeys.versionRecords, data.versionRecords);
  if (data.taskComments) writeList(storageKeys.taskComments, data.taskComments);
  if (data.teamMembers) writeList(storageKeys.teamMembers, data.teamMembers);
  if (data.taskRisks) writeList(storageKeys.taskRisks, data.taskRisks);
  if (data.viralAnalyses) writeList(storageKeys.viralAnalyses, data.viralAnalyses);
  if (data.directorMethods) writeList(storageKeys.directorMethods, data.directorMethods);
  if (data.scriptRecords) writeList(storageKeys.scriptRecords, data.scriptRecords);
  if (data.simpleReviewRecords) writeList(storageKeys.simpleReviewRecords, data.simpleReviewRecords);
  if (data.simpleDeconstructionRecords) writeList(storageKeys.simpleDeconstructionRecords, data.simpleDeconstructionRecords);
  if (data.scriptTranscripts) writeList(storageKeys.scriptTranscripts, data.scriptTranscripts);
  if (data.resourceItems) writeList(storageKeys.resourceItems, data.resourceItems);
  if (data.productRecords) writeList(storageKeys.productRecords, data.productRecords);
  if (data.commentInsightRecords) writeList(storageKeys.commentInsightRecords, data.commentInsightRecords);
}

function readList<T>(key: string): T[] {
  if (typeof window === "undefined") {
    return [];
  }

  // 统一走 web-storage：网页模式读按账号的服务器快照，桌面模式读 localStorage
  const raw = storageGet(key);
  if (!raw) {
    return [];
  }

  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as T[]) : [];
  } catch {
    return [];
  }
}

function writeList<T>(key: string, items: T[]) {
  if (typeof window === "undefined") {
    return;
  }

  storageSet(key, JSON.stringify(items));
}

function upsertItem<T extends { id: string }>(key: string, item: T) {
  const items = readList<T>(key);
  const index = items.findIndex((entry) => entry.id === item.id);
  const next = index >= 0 ? items.map((entry) => (entry.id === item.id ? item : entry)) : [item, ...items];
  writeList(key, next);
  return item;
}

function deleteItem<T extends { id: string }>(key: string, id: string) {
  writeList(
    key,
    readList<T>(key).filter((entry) => entry.id !== id)
  );
}

function mapMethodCategory(moduleName: string): DirectorMethod["category"] {
  if (moduleName.includes("拆片")) return "拆片方法";
  if (moduleName.includes("自然流")) return "自然流获客";
  if (moduleName.includes("剪辑")) return "剪辑结构";
  if (moduleName.includes("实体店")) return "卖点转化";
  if (moduleName.includes("选题")) return "开头钩子";
  return "痛点表达";
}

function normalizeProduct(item: ProductProfile): ProductProfile {
  return {
    ...item,
    category: item.category || "",
    price: item.price || item.priceRange || "",
    specifications: item.specifications || "",
    colors: item.colors || "",
    usageScenarios: item.usageScenarios || "",
    inventoryStatus: item.inventoryStatus || "",
    ageRange: item.ageRange || "",
    userScenario: item.userScenario || "",
    spendingPower: item.spendingPower || "",
    purchaseMotivation: item.purchaseMotivation || "",
    userConcerns: item.userConcerns || "",
    secondarySellingPoints: item.secondarySellingPoints || "",
    differentiatedSellingPoints: item.differentiatedSellingPoints || "",
    competitorAdvantages: item.competitorAdvantages || item.competitorComparison || "",
    conversionReasons: item.conversionReasons || "",
    expressionStyles: item.expressionStyles || "",
    productImages: item.productImages || "",
    productVideos: item.productVideos || "",
    commentScreenshots: item.commentScreenshots || "",
    buyerFeedback: item.buyerFeedback || "",
    competitorMaterials: item.competitorMaterials || "",
    proofMaterials: item.proofMaterials || "",
    forbiddenEffects: item.forbiddenEffects || "",
    exaggeratedClaims: item.exaggeratedClaims || "",
    sensitiveInfo: item.sensitiveInfo || "",
    suitableContentTypes: item.suitableContentTypes || "",
    suitableViralElements: item.suitableViralElements || "",
    suitableScriptStructures: item.suitableScriptStructures || "",
    suitablePictureInPicture: item.suitablePictureInPicture || "",
    unsuitableDirections: item.unsuitableDirections || ""
  };
}

function normalizeShotList(item: ShotList): ShotList {
  return {
    ...item,
    taskId: item.taskId || "",
    rows: item.rows.map(normalizeShotRow)
  };
}

function normalizeShotRow(row: ShotRow): ShotRow {
  return {
    ...row,
    personStatus: row.personStatus || row.action || "",
    shootingFocus: row.shootingFocus || row.notes || "",
    props: row.props || row.propsAndScene || "",
    scene: row.scene || row.propsAndScene || "",
    editNotes: row.editNotes || row.notes || "",
    requiredLevel: row.requiredLevel || "必拍",
    completionStatus: row.completionStatus || "未拍"
  };
}

function normalizePublishPlan(item: PublishPlan): PublishPlan {
  return {
    ...item,
    taskId: item.taskId || "",
    account: item.account || "",
    publishAt: item.publishAt || "",
    cover: item.cover || "",
    productLink: item.productLink || "",
    liveRoomHandoff: item.liveRoomHandoff || item.liveRoomGuide || "",
    privateDomainGuide: item.privateDomainGuide || item.privateMessageScript || "",
    publisher: item.publisher || "",
    publishStatus: item.publishStatus || item.status || "待发布",
    publishUrl: item.publishUrl || ""
  };
}

function normalizeReviewRecord(item: ReviewRecord): ReviewRecord {
  const dataScores = item.dataScores || {
    topic: 3,
    opening: 3,
    script: 3,
    shooting: 3,
    editing: 3,
    publishing: 3,
    conversion: 3
  };
  const judgements = item.judgements || {
    viewsMet: false,
    completionMet: false,
    interactionMet: false,
    productClickMet: false,
    transactionMet: false
  };
  const insight = item.insight || {
    primaryCause: item.primaryCause || "",
    secondaryCause: item.secondaryCause || "",
    evidence: item.evidence || "",
    nextAction: item.nextAction || "",
    coreReason: item.coreReason || "",
    keepNext: item.keepNext || item.retainedPoints || "",
    removeNext: item.removeNext || item.avoidNextTime || "",
    strengthenNext: item.strengthenNext || "",
    nextTestDirection: item.nextTestDirection || item.nextOptimization || ""
  };

  return {
    ...item,
    dataScores,
    judgements,
    primaryCause: item.primaryCause || insight.primaryCause,
    secondaryCause: item.secondaryCause || insight.secondaryCause,
    evidence: item.evidence || insight.evidence,
    nextAction: item.nextAction || insight.nextAction,
    coreReason: item.coreReason || insight.coreReason,
    keepNext: item.keepNext || insight.keepNext,
    removeNext: item.removeNext || insight.removeNext,
    strengthenNext: item.strengthenNext || insight.strengthenNext,
    nextTestDirection: item.nextTestDirection || insight.nextTestDirection,
    scoreHint: item.scoreHint || "",
    insight
  };
}

function normalizeScriptRecord(item: ScriptRecord): ScriptRecord {
  return {
    ...item,
    title: item.title || "未命名脚本",
    productId: item.productId || "",
    productSnapshot: item.productSnapshot,
    productName: item.productName || "",
    targetAudience: item.targetAudience || "",
    painPoint: item.painPoint || "",
    sellingPoint: item.sellingPoint || "",
    contentType: item.contentType || "教知识",
    platform: item.platform || "抖音",
    contentFormat: item.contentFormat || (item.contentType === "带货转化" ? "电商带货" : "短视频口播"),
    materialSource: item.materialSource || "手动输入",
    videoGoal: item.videoGoal || "成交",
    hook: item.hook || "",
    scriptText: item.scriptText || "",
    shotSuggestions: item.shotSuggestions || "",
    overlaySuggestions: item.overlaySuggestions || "",
    shootingTips: item.shootingTips || "",
    endingCTA: item.endingCTA || "",
    status: item.status || "草稿",
    tags: item.tags || "",
    favorite: Boolean(item.favorite),
    createdBy: item.createdBy || "编导",
    createdAt: item.createdAt || nowIso(),
    updatedAt: item.updatedAt || item.createdAt || nowIso(),
    reviewId: item.reviewId || "",
    sourceType: item.sourceType || "",
    sourceDeconstructionId: item.sourceDeconstructionId || "",
    sourcePlatform: item.sourcePlatform || "",
    sourceUrl: item.sourceUrl || "",
    sourceTranscript: item.sourceTranscript || "",
    sourceAnalysis: item.sourceAnalysis || "",
    sourceRewrite: item.sourceRewrite || "",
    performanceLevel: item.performanceLevel || ""
  };
}

function scriptItemToRecord(item: ScriptItem): ScriptRecord {
  return normalizeScriptRecord({
    id: item.id,
    title: item.title,
    productName: "",
    targetAudience: "",
    painPoint: "",
    sellingPoint: item.productShowPoints || "",
    contentType: mapScriptRecordContentType(item.scriptType),
    videoGoal: "成交",
    hook: item.hook,
    scriptText: item.copy,
    shotSuggestions: item.rhythm,
    overlaySuggestions: item.pictureInPicture,
    shootingTips: item.shootingNotes,
    endingCTA: item.ending,
    status: "草稿",
    tags: item.scriptType,
    favorite: false,
    createdBy: "编导",
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
    reviewId: "",
    sourceType: "旧版脚本生产",
    sourceDeconstructionId: ""
  });
}

function mapScriptRecordContentType(value: string): ScriptRecord["contentType"] {
  if (value.includes("晒过程")) return "晒过程";
  if (value.includes("聊观点")) return "聊观点";
  if (value.includes("讲故事")) return "讲故事";
  if (value.includes("带货") || value.includes("转化") || value.includes("测评") || value.includes("种草")) return "带货转化";
  return "教知识";
}

function normalizeSimpleReviewRecord(item: SimpleReviewRecord): SimpleReviewRecord {
  return {
    ...item,
    scriptId: item.scriptId || "",
    platform: item.platform || "",
    publishTime: item.publishTime || "",
    views: item.views || "",
    fiveSecondRetention: item.fiveSecondRetention || "",
    completionRate: item.completionRate || "",
    avgWatchTime: item.avgWatchTime || "",
    likeRate: item.likeRate || "",
    commentRate: item.commentRate || "",
    saveRate: item.saveRate || "",
    conversionData: item.conversionData || "",
    topicJudgement: item.topicJudgement || "",
    hookJudgement: item.hookJudgement || "",
    scriptJudgement: item.scriptJudgement || "",
    shootingJudgement: item.shootingJudgement || "",
    editingJudgement: item.editingJudgement || "",
    problemReason: item.problemReason || "",
    nextOptimization: item.nextOptimization || "",
    conclusion: item.conclusion || "",
    successPoints: item.successPoints || "",
    failurePoints: item.failurePoints || "",
    recommendAsCase: Boolean(item.recommendAsCase),
    performanceLevel: item.performanceLevel || "",
    aiConclusion: item.aiConclusion || item.conclusion || "",
    createdAt: item.createdAt || nowIso(),
    updatedAt: item.updatedAt || item.createdAt || nowIso()
  };
}

function normalizeProductRecord(item: Partial<ProductRecord>): ProductRecord {
  return {
    ...item,
    id: item.id || createId("product_record"),
    name: item.name || "",
    category: item.category || "",
    priceRange: item.priceRange || "",
    coreSellingPoints: item.coreSellingPoints || "",
    secondarySellingPoints: item.secondarySellingPoints || "",
    targetAudience: item.targetAudience || "",
    painPoints: item.painPoints || "",
    objections: item.objections || "",
    useScenarios: item.useScenarios || "",
    competitorComparison: item.competitorComparison || "",
    buyerFeedback: item.buyerFeedback || "",
    forbiddenWords: item.forbiddenWords || "",
    forbiddenClaims: item.forbiddenClaims || "",
    materialLinks: item.materialLinks || "",
    sourceType: item.sourceType === "word" ? "word" : "manual",
    brandName: item.brandName || "",
    productFacts: item.productFacts || "",
    specifications: item.specifications || "",
    colors: item.colors || "",
    faq: item.faq || "",
    customerServiceScript: item.customerServiceScript || "",
    proofMaterials: item.proofMaterials || "",
    notes: item.notes || "",
    sourceDocumentName: item.sourceDocumentName || "",
    sourceDocumentText: item.sourceDocumentText || "",
    sourceDocumentImportedAt: item.sourceDocumentImportedAt || "",
    images: normalizeProductImages(item.images),
    coverImageId: item.coverImageId || "",
    document: normalizeProductDocument(item.document),
    documentAnalysisStatus: normalizeAnalysisStatus(item.documentAnalysisStatus),
    documentAnalysisError: item.documentAnalysisError || "",
    documentAnalysisDocumentId: item.documentAnalysisDocumentId || "",
    archivedAt: item.archivedAt || "",
    createdAt: item.createdAt || nowIso(),
    updatedAt: item.updatedAt || item.createdAt || nowIso()
  };
}

function normalizeProductImages(value: unknown): ProductImageAsset[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is ProductImageAsset => Boolean(item) && typeof item === "object" && typeof (item as ProductImageAsset).id === "string")
    .map((item): ProductImageAsset => ({
      id: item.id,
      name: item.name || "商品图",
      role: normalizeProductImageRole(item.role),
      mimeType: item.mimeType || "image/png",
      width: Number(item.width) || 0,
      height: Number(item.height) || 0,
      size: Number(item.size) || 0,
      addedAt: item.addedAt || nowIso(),
      url: item.url,
      thumbUrl: item.thumbUrl
    }))
    .slice(0, PRODUCT_IMAGE_LIMIT);
}

function normalizeAnalysisStatus(value: unknown): ProductDocumentAnalysisStatus {
  return value === "processing" || value === "ready" || value === "failed" ? value : "none";
}

function normalizeProductDocument(value: unknown): ProductDocumentAsset | null {
  if (!value || typeof value !== "object") return null;
  const document = value as ProductDocumentAsset;
  if (!document.id) return null;
  return {
    id: document.id,
    name: document.name || "产品资料",
    format: document.format || "docx",
    size: Number(document.size) || 0,
    text: document.text || "",
    uploadedAt: document.uploadedAt || nowIso(),
    updatedAt: document.updatedAt || document.uploadedAt || nowIso(),
    revision: Number(document.revision) || 1,
    downloadUrl: document.downloadUrl
  };
}

function normalizeCommentInsightRecord(item: CommentInsightRecord): CommentInsightRecord {
  return {
    ...item,
    id: item.id || createId("comment_insight"),
    rawComments: item.rawComments || "",
    painPoints: item.painPoints || "",
    objections: item.objections || "",
    topicIdeas: item.topicIdeas || "",
    replyScripts: item.replyScripts || "",
    createdAt: item.createdAt || nowIso(),
    updatedAt: item.updatedAt || item.createdAt || nowIso()
  };
}

function reviewRecordToSimple(item: ReviewRecord): SimpleReviewRecord {
  return normalizeSimpleReviewRecord({
    id: item.id,
    scriptId: "",
    publishTime: item.publishedAt,
    views: item.metrics.views,
    fiveSecondRetention: item.metrics.fiveSecondRetention,
    completionRate: item.metrics.completionRate,
    avgWatchTime: item.metrics.averageWatchTime,
    likeRate: item.metrics.likeRate,
    commentRate: item.metrics.commentRate,
    saveRate: item.metrics.favoriteRate,
    conversionData: [item.metrics.productClicks && `商品点击：${item.metrics.productClicks}`, item.metrics.transactionAmount && `成交：${item.metrics.transactionAmount}`].filter(Boolean).join("\n"),
    topicJudgement: item.scores.topicAudienceHit >= 4 ? "有效" : "需优化",
    hookJudgement: item.scores.openingEffectiveness >= 4 ? "有效" : "需优化",
    scriptJudgement: item.scores.scriptStructure >= 4 ? "清晰" : "需优化",
    shootingJudgement: item.scores.shootingCompletion >= 4 ? "到位" : "需优化",
    editingJudgement: item.scores.editingService >= 4 ? "到位" : "需优化",
    problemReason: item.problemAttributions.join("、") || item.primaryCause,
    nextOptimization: item.nextOptimization || item.nextAction,
    conclusion: item.autoConclusion || item.coreReason,
    successPoints: item.retainedPoints || item.keepNext,
    failurePoints: item.avoidNextTime || item.removeNext,
    recommendAsCase: Boolean(item.caseType),
    createdAt: item.createdAt,
    updatedAt: item.updatedAt
  });
}

function normalizeSimpleDeconstructionRecord(item: Partial<SimpleDeconstructionRecord> & { id: string }): SimpleDeconstructionRecord {
  const sourceTitle = item.sourceTitle || item.title || "未命名拆解";
  const rewrittenTopic = item.rewrittenTopic || item.newTopicIdeas || "";
  const rewrittenTitle = item.rewrittenTitle || rewrittenTopic.split("\n")[0] || sourceTitle;
  const rewrittenScript = item.rewrittenScript || item.newScriptDirections || "";

  return {
    ...item,
    sourceType: item.sourceType || (item.sourceUrl ? "link" : "manual"),
    title: item.title || sourceTitle,
    sourceUrl: item.sourceUrl || "",
    platform: item.platform || "unknown",
    normalizedUrl: item.normalizedUrl || item.sourceUrl || "",
    cleanUrl: item.cleanUrl || item.normalizedUrl || item.sourceUrl || "",
    sourceTitle,
    sourceDescription: item.sourceDescription || "",
    sourceAuthor: item.sourceAuthor || "",
    sourceCover: item.sourceCover || "",
    videoUrl: item.videoUrl || "",
    audioUrl: item.audioUrl || "",
    duration: item.duration || "",
    publishTime: item.publishTime || "",
    rawText: item.rawText || "",
    structuredJson: item.structuredJson || "",
    transcript: item.transcript || "",
    transcriptSegments: item.transcriptSegments || "",
    videoPath: item.videoPath || "",
    audioPath: item.audioPath || "",
    asrProvider: item.asrProvider || "",
    asrMessage: item.asrMessage || "",
    parseStrategy: item.parseStrategy || "",
    parseAttempts: item.parseAttempts || "",
    analysisMarkdown: item.analysisMarkdown || "",
    analysisResult: item.analysisResult || item.analysisMarkdown || "",
    rewriteMarkdown: item.rewriteMarkdown || "",
    manualDescription: item.manualDescription || "",
    comments: item.comments || "",
    topComments: Array.isArray(item.topComments) ? item.topComments : [],
    commentInsights: item.commentInsights || {
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
    commentsSource: item.commentsSource || "",
    commentsFetchStatus: item.commentsFetchStatus || "idle",
    commentsFetchError: item.commentsFetchError || "",
    commentBasedTopicIdeas: item.commentBasedTopicIdeas || "",
    commentBasedShootingSuggestions: item.commentBasedShootingSuggestions || "",
    commentBasedHookIdeas: item.commentBasedHookIdeas || "",
    productId: item.productId || "",
    productSnapshot: item.productSnapshot,
    targetIndustry: item.targetIndustry || "",
    targetProduct: item.targetProduct || "",
    targetAudience: item.targetAudience || "",
    rewriteGoal: item.rewriteGoal || "成交",
    rewriteStyle: item.rewriteStyle || "口语化",
    coreTheme: item.coreTheme || "",
    hook: item.hook || "",
    viralElements: item.viralElements || "",
    structure: item.structure || "",
    emotionFlow: item.emotionFlow || "",
    visualRhythm: item.visualRhythm || "",
    conversionPoint: item.conversionPoint || "",
    reusableStructure: item.reusableStructure || "",
    rewrittenTopic,
    rewrittenTitle,
    rewrittenHook: item.rewrittenHook || item.hook || "",
    rewrittenScript,
    shotSuggestions: item.shotSuggestions || "",
    overlaySuggestions: item.overlaySuggestions || "",
    shootingTips: item.shootingTips || "",
    endingCTA: item.endingCTA || "",
    extendedTopics: item.extendedTopics || "",
    newTopicIdeas: item.newTopicIdeas || rewrittenTopic,
    newScriptDirections: item.newScriptDirections || rewrittenScript,
    savedScriptId: item.savedScriptId || "",
    status: item.status || "completed",
    errorMessage: item.errorMessage || "",
    favorite: Boolean(item.favorite),
    tags: item.tags || "",
    createdAt: item.createdAt || nowIso(),
    updatedAt: item.updatedAt || item.createdAt || nowIso()
  };
}

function viralAnalysisToSimple(item: ViralAnalysis): SimpleDeconstructionRecord {
  return normalizeSimpleDeconstructionRecord({
    id: item.id,
    title: item.title,
    sourceUrl: item.url,
    transcript: item.transcript,
    coreTheme: item.painPoints || item.title,
    hook: item.openingHook,
    viralElements: item.reusableFormula,
    structure: item.structure,
    emotionFlow: item.emotionPoints,
    reusableStructure: item.productApplication,
    newTopicIdeas: item.productApplication,
    newScriptDirections: item.reusableFormula,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt
  });
}

function deconstructionRecordToSimple(item: DeconstructionRecord): SimpleDeconstructionRecord {
  return normalizeSimpleDeconstructionRecord({
    id: item.id,
    title: item.originalTitle,
    sourceUrl: item.originalUrl,
    transcript: "",
    coreTheme: item.videoType || item.originalTitle,
    hook: item.openingHook,
    viralElements: item.viralElements,
    structure: item.structure,
    emotionFlow: item.emotionChanges,
    reusableStructure: item.transferableStructure,
    newTopicIdeas: item.migratedTopic,
    newScriptDirections: item.migratedScriptOutline,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt
  });
}

function normalizeResourceItem(item: ResourceItem): ResourceItem {
  return {
    ...item,
    type: item.type || "其他沉淀资料",
    title: item.title || "未命名资料",
    content: item.content || "",
    tags: item.tags || "",
    createdAt: item.createdAt || nowIso(),
    updatedAt: item.updatedAt || item.createdAt || nowIso()
  };
}
