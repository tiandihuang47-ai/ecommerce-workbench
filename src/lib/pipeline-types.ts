import type { ProductDocumentAnalysisStatus, ProductDocumentAsset, ProductImageAsset } from "@/lib/product-assets-types";

export type Platform = "抖音" | "小红书" | "视频号" | "快手" | "B站";
export type ContentGoal =
  | "涨粉"
  | "引流"
  | "种草"
  | "获客"
  | "成交"
  | "建信任"
  | "复购"
  | "直播间引流"
  | "私信咨询"
  | "品牌曝光";
export type ProjectStatus = "待选题" | "待脚本" | "待拍摄" | "待剪辑" | "待发布" | "已发布" | "已复盘";
export type Priority = "高" | "中" | "低";
export type VideoContentType = "教知识" | "晒过程" | "聊观点" | "讲故事" | "测评" | "直播切片" | "图文笔记";
export type VideoTaskStatus =
  | "选题中"
  | "脚本中"
  | "待拍摄"
  | "拍摄中"
  | "待剪辑"
  | "剪辑中"
  | "待审核"
  | "待发布"
  | "已发布"
  | "待复盘"
  | "已归档";
export type ShotRequiredLevel = "必拍" | "可替代" | "补充";
export type ShotCompletionStatus = "未拍" | "已拍" | "需补拍";
export type EditRhythm = "快节奏" | "中等" | "慢节奏" | "情绪化" | "强转化";
export type PublishStatus = "待发布" | "已发布";
export type CaseType = "成功案例" | "失败案例";
export type ContentAssetType =
  | "成功案例库"
  | "失败案例库"
  | "爆款开头库"
  | "高转化脚本库"
  | "有效选题库"
  | "无效选题库"
  | "画中画素材库"
  | "拍摄参考库"
  | "剪辑节奏库"
  | "复盘结论库"
  | "拆片结构库";
export type Role = "管理员" | "编导" | "摄影师" | "剪辑师" | "运营" | "只读成员";
export type Permission =
  | "全部权限"
  | "新建任务"
  | "查看任务"
  | "编辑选题"
  | "编辑脚本"
  | "生成分镜"
  | "查看分镜拍摄单"
  | "标记镜头已拍"
  | "提交拍摄完成"
  | "查看剪辑说明单"
  | "提交剪辑版本"
  | "查看修改意见"
  | "编辑发布记录"
  | "填写发布数据"
  | "发起审核"
  | "处理审核"
  | "填写复盘"
  | "发表评论";
export type ApprovalNodeName = "选题审核" | "脚本审核" | "分镜审核" | "拍摄审核" | "剪辑审核" | "发布前审核" | "复盘审核";
export type ApprovalObjectType = "选题" | "脚本" | "分镜" | "拍摄素材" | "剪辑成片" | "发布信息" | "复盘结论";
export type ApprovalStatus = "待提交" | "待审核" | "通过" | "驳回" | "需修改";
export type VersionContentType = "脚本" | "分镜拍摄单" | "剪辑说明单" | "发布文案" | "复盘结论";
export type CommentType = "普通评论" | "修改意见" | "风险提醒" | "复盘补充";
export type CommentModule = "选题" | "脚本" | "分镜" | "拍摄" | "剪辑" | "发布" | "复盘";
export type CommentStatus = "未处理" | "处理中" | "已解决";
export type RiskType =
  | "任务逾期"
  | "脚本未审核却进入拍摄"
  | "分镜未生成却进入拍摄"
  | "剪辑说明未生成却进入剪辑"
  | "发布后超过24小时未填写数据"
  | "已发布但未复盘"
  | "有未解决修改意见"
  | "当前任务使用的不是最新版本"
  | "产品资料缺失核心卖点"
  | "产品资料缺失禁忌词";
export type RiskStatus = "未处理" | "已处理";

export interface Project {
  id: string;
  name: string;
  industry: string;
  productName: string;
  targetPlatform: Platform;
  contentGoal: ContentGoal;
  audience: string;
  sellingPoints: string;
  painPoints: string;
  forbiddenWords: string;
  owner: string;
  status: ProjectStatus;
  createdAt: string;
  updatedAt: string;
}

export interface ProductProfile {
  id: string;
  productName: string;
  projectId: string;
  category: string;
  price: string;
  specifications: string;
  colors: string;
  usageScenarios: string;
  inventoryStatus: string;
  baseInfo: string;
  priceRange: string;
  sellingPoints: string;
  painPoints: string;
  audience: string;
  ageRange: string;
  userScenario: string;
  spendingPower: string;
  purchaseMotivation: string;
  userConcerns: string;
  secondarySellingPoints: string;
  differentiatedSellingPoints: string;
  competitorAdvantages: string;
  conversionReasons: string;
  expressionStyles: string;
  competitorComparison: string;
  faq: string;
  customerServiceScript: string;
  forbiddenWords: string;
  productImages: string;
  productVideos: string;
  commentScreenshots: string;
  buyerFeedback: string;
  competitorMaterials: string;
  proofMaterials: string;
  materialConditions: string;
  liveRoomScript: string;
  forbiddenEffects: string;
  exaggeratedClaims: string;
  sensitiveInfo: string;
  suitableContentTypes: string;
  suitableViralElements: string;
  suitableScriptStructures: string;
  suitablePictureInPicture: string;
  unsuitableDirections: string;
  notes: string;
  createdAt: string;
  updatedAt: string;
}

export type Product = ProductProfile;

export interface TopicCard {
  id: string;
  projectId: string;
  productId: string;
  title: string;
  audience: string;
  painPoint: string;
  angle: string;
  hook: string;
  coreOpinion: string;
  sellingPoint: string;
  shootingSuggestion: string;
  conversionAction: string;
  platform: Platform;
  priority: Priority;
  adopted: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ScriptItem {
  id: string;
  projectId: string;
  productId: string;
  topicId: string;
  scriptType: string;
  duration: string;
  style: string;
  title: string;
  hook: string;
  copy: string;
  rhythm: string;
  pictureInPicture: string;
  productShowPoints: string;
  actionSuggestion: string;
  subtitleHighlights: string;
  ending: string;
  shootingNotes: string;
  forbiddenWordReminder: string;
  createdAt: string;
  updatedAt: string;
}

export interface ShotRow {
  id: string;
  index: number;
  spokenLine: string;
  visualContent: string;
  action: string;
  personStatus: string;
  productPoint: string;
  shotSize: "近景" | "中景" | "全景" | "特写";
  movement: "固定" | "推近" | "拉远" | "跟拍" | "摇镜";
  shootingFocus: string;
  pictureInPicture: string;
  props: string;
  scene: string;
  propsAndScene: string;
  editNotes: string;
  requiredLevel: ShotRequiredLevel;
  completionStatus: ShotCompletionStatus;
  notes: string;
}

export type ShotItem = ShotRow;

export interface ShotList {
  id: string;
  taskId: string;
  projectId: string;
  productId: string;
  scriptId: string;
  scene: string;
  needModel: boolean;
  needProductCloseup: boolean;
  needPictureInPicture: boolean;
  rows: ShotRow[];
  createdAt: string;
  updatedAt: string;
}

export interface VideoTask {
  id: string;
  videoTitle: string;
  projectId: string;
  productId: string;
  contentType: VideoContentType;
  contentGoal: ContentGoal;
  status: VideoTaskStatus;
  topicOwner: string;
  scriptOwner: string;
  shootingOwner: string;
  editingOwner: string;
  publishingOwner: string;
  reviewOwner: string;
  dueDate: string;
  priority: Priority;
  remarks: string;
  topicId: string;
  scriptId: string;
  shotListId: string;
  editBriefId: string;
  publishRecordId: string;
  reviewRecordId: string;
  createdAt: string;
  updatedAt: string;
}

export type Script = ScriptItem;

export interface EditBriefVersion {
  id: string;
  name: "初版" | "修改版" | "终版";
  notes: string;
  createdAt: string;
}

export interface EditBrief {
  id: string;
  taskId: string;
  projectId: string;
  productId: string;
  scriptId: string;
  shotListId: string;
  editor: string;
  targetDuration: string;
  rhythm: EditRhythm;
  openingTreatment: string;
  subtitleHighlights: string;
  pictureInPicturePositions: string;
  enlargedKeywords: string;
  soundEffectRequirements: string;
  musicStyle: string;
  transitionRequirements: string;
  productDetailPositions: string;
  emotionHighlights: string;
  conversionGuidePosition: string;
  forbiddenActions: string;
  referenceVideoLinks: string;
  deadline: string;
  reviewFeedback: string;
  revisionRecords: string;
  currentVersion: "初版" | "修改版" | "终版";
  versions: EditBriefVersion[];
  createdAt: string;
  updatedAt: string;
}

export interface PublishPlan {
  id: string;
  taskId: string;
  projectId: string;
  scriptId: string;
  shotListId: string;
  platform: Platform;
  account: string;
  publishAt: string;
  goal: ContentGoal;
  title: string;
  cover: string;
  coverTitle: string;
  caption: string;
  hashtags: string;
  productLink: string;
  liveRoomHandoff: string;
  privateDomainGuide: string;
  publisher: string;
  publishStatus: PublishStatus;
  publishUrl: string;
  pinnedComment: string;
  commentGuide: string;
  privateMessageScript: string;
  liveRoomGuide: string;
  publishTimeSuggestion: string;
  multiPlatformRewrite: string;
  status: PublishStatus;
  createdAt: string;
  updatedAt: string;
}

export type PublishRecord = PublishPlan;

export interface TeamMember {
  id: string;
  name: string;
  role: Role;
  permissions: Permission[];
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ApprovalRecord {
  id: string;
  taskId: string;
  nodeName: ApprovalNodeName;
  objectType: ApprovalObjectType;
  status: ApprovalStatus;
  submitter: string;
  reviewer: string;
  submittedAt: string;
  reviewedAt: string;
  reviewOpinion: string;
  changeRequest: string;
  versionId: string;
  blocksNextStep: boolean;
  createdAt: string;
}

export interface VersionRecord {
  id: string;
  versionName: string;
  contentType: VersionContentType;
  taskId: string;
  creator: string;
  createdAt: string;
  changeNote: string;
  contentSnapshot: string;
  isLatest: boolean;
  approved: boolean;
}

export interface TaskComment {
  id: string;
  taskId: string;
  author: string;
  content: string;
  commentType: CommentType;
  module: CommentModule;
  assignee: string;
  status: CommentStatus;
  createdAt: string;
  resolvedAt: string;
}

export interface ReviewMetrics {
  views: string;
  fiveSecondRetention: string;
  completionRate: string;
  averageWatchTime: string;
  likeRate: string;
  commentRate: string;
  shareRate: string;
  favoriteRate: string;
  profileVisits: string;
  productClicks: string;
  liveRoomClicks: string;
  transactionAmount: string;
  transactionCount: string;
}

export type ReviewScoreKey =
  | "topicAudienceHit"
  | "openingEffectiveness"
  | "viralElementClarity"
  | "scriptStructure"
  | "informationDensity"
  | "emotionPoint"
  | "pictureInPictureEffectiveness"
  | "shootingCompletion"
  | "editingService"
  | "titleCoverMatch"
  | "endingGuidance";

export type ProblemAttributionKey =
  | "选题问题"
  | "开头问题"
  | "脚本问题"
  | "拍摄问题"
  | "剪辑问题"
  | "标题封面问题"
  | "发布时间问题"
  | "产品承接问题"
  | "账号流量问题";

export interface ReviewScores extends Record<ReviewScoreKey, number> {}

export interface ReviewScore {
  topic: number;
  opening: number;
  script: number;
  shooting: number;
  editing: number;
  publishing: number;
  conversion: number;
}

export interface ReviewInsight {
  primaryCause: string;
  secondaryCause: string;
  evidence: string;
  nextAction: string;
  coreReason: string;
  keepNext: string;
  removeNext: string;
  strengthenNext: string;
  nextTestDirection: string;
}

export interface ReviewJudgement {
  viewsMet: boolean;
  completionMet: boolean;
  interactionMet: boolean;
  productClickMet: boolean;
  transactionMet: boolean;
}

export interface ReviewRecord {
  id: string;
  taskId: string;
  projectId: string;
  productId: string;
  publishRecordId: string;
  videoTitle: string;
  publishedAt: string;
  platform: Platform;
  account: string;
  metrics: ReviewMetrics;
  scores: ReviewScores;
  dataScores: ReviewScore;
  judgements: ReviewJudgement;
  problemAttributions: ProblemAttributionKey[];
  primaryCause: string;
  secondaryCause: string;
  evidence: string;
  nextAction: string;
  retainedPoints: string;
  avoidNextTime: string;
  reusableStructure: string;
  reusableOpening: string;
  reusablePictureInPicture: string;
  nextOptimization: string;
  coreReason: string;
  keepNext: string;
  removeNext: string;
  strengthenNext: string;
  nextTestDirection: string;
  scoreHint: string;
  insight: ReviewInsight;
  autoConclusion: string;
  caseType: CaseType | "";
  addedToAssetLibrary: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface TaskRisk {
  id: string;
  taskId: string;
  riskType: RiskType;
  title: string;
  description: string;
  actionText: string;
  status: RiskStatus;
  createdAt: string;
  resolvedAt: string;
}

export interface ContentAsset {
  id: string;
  title: string;
  assetType: ContentAssetType;
  sourceVideo: string;
  productId: string;
  scenario: string;
  effectivenessReason: string;
  reusableMethod: string;
  notes: string;
  tags: string;
  creator: string;
  sourceRecordId: string;
  createdAt: string;
}

export interface ViralAnalysis {
  id: string;
  url: string;
  title: string;
  transcript: string;
  industry: string;
  platform: Platform;
  openingHook: string;
  structure: string;
  emotionPoints: string;
  painPoints: string;
  sellingPointPlacement: string;
  pictureInPictureUsage: string;
  conversionAction: string;
  reusableFormula: string;
  productApplication: string;
  createdAt: string;
  updatedAt: string;
}

export interface DeconstructionRecord {
  id: string;
  originalTitle: string;
  originalUrl: string;
  videoType: string;
  industry: string;
  audience: string;
  viralElements: string;
  openingHook: string;
  structure: string;
  emotionChanges: string;
  visualRhythm: string;
  conversionPlacement: string;
  transferableStructure: string;
  transferableIndustries: string;
  migratedTopic: string;
  migratedScriptOutline: string;
  addedToAssetLibrary: boolean;
  createdAt: string;
  updatedAt: string;
}

export type ScriptRecordContentType =
  | "短视频口播"
  | "电商带货"
  | "老板 IP"
  | "小红书图文"
  | "评论回复"
  | "直播切片"
  | "竞品对比"
  | "避坑科普"
  | "产品卖点提炼"
  | "脚本改写"
  | "教知识"
  | "晒过程"
  | "聊观点"
  | "讲故事"
  | "带货转化";
export type ScriptRecordPlatform = "抖音" | "小红书" | "快手" | "视频号" | "淘宝内容" | "朋友圈" | "私域朋友圈";
export type ScriptRecordContentFormat = "短视频口播" | "电商带货" | "小红书种草" | "图文笔记" | "直播切片" | "评论回复" | "老板 IP" | "达人口播" | "竞品对比" | "避坑科普";
export type ScriptRecordMaterialSource = "手动输入" | "产品资料" | "爆款拆解" | "评论区";
export type ScriptRecordVideoGoal = "涨粉" | "建信任" | "引流" | "成交" | "直播间引流" | "复购" | "测试选题" | "复盘测试";
export type ScriptRecordStatus = "草稿" | "已确认" | "已拍摄" | "已发布" | "已复盘";
export type ScriptPerformanceLevel = "表现好" | "一般" | "表现差" | "";

export interface RiskCheckResult {
  level: "low" | "medium" | "high" | "低" | "中" | "高";
  riskyWords: string[];
  reasons: string[];
  suggestions: Array<{
    original: string;
    suggestion?: string;
    replacement: string;
  }>;
  disclaimer: string;
}

export interface ProductRecord {
  id: string;
  name: string;
  category: string;
  priceRange: string;
  coreSellingPoints: string;
  secondarySellingPoints: string;
  targetAudience: string;
  painPoints: string;
  objections: string;
  useScenarios: string;
  competitorComparison: string;
  buyerFeedback: string;
  forbiddenWords: string;
  forbiddenClaims: string;
  materialLinks: string;
  sourceType?: "manual" | "word";
  brandName?: string;
  productFacts?: string;
  specifications?: string;
  colors?: string;
  faq?: string;
  customerServiceScript?: string;
  proofMaterials?: string;
  notes?: string;
  sourceDocumentName?: string;
  sourceDocumentText?: string;
  sourceDocumentImportedAt?: string;
  /* ---- 产品资产：商品图片 + 唯一产品文档 ----
   * 只保存元数据与 id，二进制文件放在本地运行时目录 products/<productId>/ 下。
   * 旧数据没有这些字段时统一补空，首次读取自动完成迁移。 */
  images?: ProductImageAsset[];
  coverImageId?: string;
  document?: ProductDocumentAsset | null;
  /** 产品资料的 AI 理解状态（后台异步，不阻塞保存）。 */
  documentAnalysisStatus?: ProductDocumentAnalysisStatus;
  documentAnalysisError?: string;
  /** 这次分析结果属于哪一份文档；只有仍是最新文档时才写回，避免旧结果覆盖新资料。 */
  documentAnalysisDocumentId?: string;
  /** 软删除时间。有值的产品不出现在选择器与正常列表，但历史任务不受影响。 */
  archivedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ProductReferenceSnapshot {
  id: string;
  name: string;
  brandName: string;
  category: string;
  priceRange: string;
  productFacts: string;
  specifications: string;
  colors: string;
  coreSellingPoints: string;
  secondarySellingPoints: string;
  targetAudience: string;
  painPoints: string;
  objections: string;
  useScenarios: string;
  competitorComparison: string;
  buyerFeedback: string;
  forbiddenWords: string;
  forbiddenClaims: string;
  proofMaterials: string;
  sourceDocumentName: string;
  updatedAt: string;
}

export type ProductRecordSaveInput = Pick<ProductRecord, "name"> & Partial<Omit<ProductRecord, "name">>;

export interface CommentInsightRecord {
  id: string;
  rawComments: string;
  painPoints: string;
  objections: string;
  topicIdeas: string;
  replyScripts: string;
  createdAt: string;
  updatedAt: string;
}

export interface CommentRecord {
  id: string;
  platform: SimpleDeconstructionRecord["platform"];
  videoUrl: string;
  commentId: string;
  content: string;
  likeCount: number;
  authorName: string;
  createdAt: string;
  rawData: Record<string, unknown>;
}

export interface HighLikeCommentInsights {
  topConcerns: string[];
  userPainPoints: string[];
  purchaseObjections: string[];
  contentAngles: string[];
  shootingSuggestions: string[];
  topicIdeas: string[];
  hookIdeas: string[];
  scriptDirections: string[];
  conversionOpportunities: string[];
  riskNotes: string[];
  commentTags?: Array<{ commentId: string; tags: string[] }>;
}

export interface ScriptRecord {
  id: string;
  title: string;
  productId?: string;
  productSnapshot?: ProductReferenceSnapshot;
  productName: string;
  targetAudience: string;
  painPoint: string;
  sellingPoint: string;
  contentType: ScriptRecordContentType;
  platform?: ScriptRecordPlatform;
  contentFormat?: ScriptRecordContentFormat;
  materialSource?: ScriptRecordMaterialSource;
  videoGoal: ScriptRecordVideoGoal;
  hook: string;
  scriptText: string;
  shotSuggestions: string;
  overlaySuggestions: string;
  shootingTips: string;
  endingCTA: string;
  riskCheckResult?: RiskCheckResult;
  status: ScriptRecordStatus;
  tags: string;
  favorite: boolean;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  reviewId: string;
  sourceType: string;
  sourceDeconstructionId: string;
  sourcePlatform?: string;
  sourceUrl?: string;
  sourceTranscript?: string;
  sourceAnalysis?: string;
  sourceRewrite?: string;
  performanceLevel?: ScriptPerformanceLevel;
  /**
   * 抖音来源资产（脚本页「抖音链接」链路）：逐字稿 + 评论 + 评论洞察。
   * 只在脚本页写入；老记录没有这个字段，读取方需要判空。
   */
  douyinSource?: {
    url: string;
    awemeId: string;
    transcript: string;
    commentCount: number;
    commentsFetchedAt: string;
    comments?: Array<Record<string, unknown>>;
    commentInsights?: Record<string, unknown> | null;
  };
}

export interface SimpleReviewRecord {
  id: string;
  scriptId: string;
  platform?: ScriptRecordPlatform | "";
  publishTime: string;
  views: string;
  fiveSecondRetention: string;
  completionRate: string;
  avgWatchTime: string;
  likeRate: string;
  commentRate: string;
  saveRate: string;
  conversionData: string;
  topicJudgement: string;
  hookJudgement: string;
  scriptJudgement: string;
  shootingJudgement: string;
  editingJudgement: string;
  problemReason: string;
  nextOptimization: string;
  conclusion: string;
  successPoints: string;
  failurePoints: string;
  recommendAsCase: boolean;
  performanceLevel?: ScriptPerformanceLevel;
  aiConclusion?: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * 脚本工作台解析成功的抖音逐字稿（「逐字稿库」）。
 * 解析成功即写入，供 AI 对话直接引用；同视频重新解析按 awemeId 合并，不产生重复。
 */
export interface SimpleTranscriptRecord {
  /** 有 awemeId 时固定为 transcript_<awemeId>，天然去重。 */
  id: string;
  title: string;
  authorName: string;
  /** 用户原始粘贴内容（链接或整段分享文案）。 */
  link: string;
  awemeId: string;
  transcript: string;
  createdAt: string;
  updatedAt: string;
}

export interface SimpleDeconstructionRecord {
  id: string;
  sourceType?: "link" | "upload" | "manual";
  title: string;
  sourceUrl: string;
  platform: "douyin" | "kuaishou" | "xiaohongshu" | "bilibili" | "youtube" | "tiktok" | "wechat_channels" | "generic" | "unknown";
  normalizedUrl: string;
  cleanUrl?: string;
  sourceTitle: string;
  sourceDescription: string;
  sourceAuthor: string;
  sourceCover: string;
  videoUrl?: string;
  audioUrl?: string;
  duration?: string;
  publishTime?: string;
  rawText?: string;
  structuredJson?: string;
  transcript: string;
  transcriptSegments?: string;
  videoPath?: string;
  audioPath?: string;
  asrProvider?: string;
  asrMessage?: string;
  parseStrategy?: string;
  parseAttempts?: string;
  analysisMarkdown?: string;
  analysisResult?: string;
  rewriteMarkdown?: string;
  manualDescription: string;
  comments: string;
  topComments?: CommentRecord[];
  commentInsights?: HighLikeCommentInsights;
  commentsSource?: "crawler-service" | "third-party-api" | "yt-dlp" | "manual" | "unsupported" | "existing-parser" | "";
  commentsFetchStatus?: "idle" | "fetching" | "success" | "failed" | "manual";
  commentsFetchError?: string;
  commentBasedTopicIdeas?: string;
  commentBasedShootingSuggestions?: string;
  commentBasedHookIdeas?: string;
  productId?: string;
  productSnapshot?: ProductReferenceSnapshot;
  targetIndustry: string;
  targetProduct: string;
  targetAudience: string;
  rewriteGoal: "涨粉" | "建信任" | "引流" | "成交" | "直播间引流";
  rewriteStyle: "犀利" | "接地气" | "专业" | "口语化" | "情绪化" | "成交转化";
  coreTheme: string;
  hook: string;
  viralElements: string;
  structure: string;
  emotionFlow: string;
  visualRhythm: string;
  conversionPoint: string;
  reusableStructure: string;
  rewrittenTopic: string;
  rewrittenTitle: string;
  rewrittenHook: string;
  rewrittenScript: string;
  shotSuggestions: string;
  overlaySuggestions: string;
  shootingTips: string;
  endingCTA: string;
  extendedTopics: string;
  newTopicIdeas: string;
  newScriptDirections: string;
  savedScriptId?: string;
  status?: "analyzing" | "completed" | "failed";
  errorMessage?: string;
  favorite?: boolean;
  tags?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ResourceItem {
  id: string;
  type: string;
  title: string;
  content: string;
  tags: string;
  createdAt: string;
  updatedAt: string;
}

export interface DirectorMethod {
  id: string;
  category: "开头钩子" | "痛点表达" | "卖点转化" | "分镜方法" | "画中画方法" | "结尾成交" | "自然流获客" | "拆片方法" | "剪辑结构";
  name: string;
  scenario: string;
  steps: string;
  example: string;
  promptTemplate: string;
  createdAt: string;
  updatedAt: string;
}

export interface PipelineData {
  projects: Project[];
  products: ProductProfile[];
  videoTasks: VideoTask[];
  topics: TopicCard[];
  scripts: ScriptItem[];
  shotLists: ShotList[];
  editBriefs: EditBrief[];
  publishPlans: PublishPlan[];
  reviewRecords: ReviewRecord[];
  contentAssets: ContentAsset[];
  deconstructionRecords: DeconstructionRecord[];
  approvalRecords: ApprovalRecord[];
  versionRecords: VersionRecord[];
  taskComments: TaskComment[];
  teamMembers: TeamMember[];
  taskRisks: TaskRisk[];
  viralAnalyses: ViralAnalysis[];
  directorMethods: DirectorMethod[];
  scriptRecords: ScriptRecord[];
  simpleReviewRecords: SimpleReviewRecord[];
  simpleDeconstructionRecords: SimpleDeconstructionRecord[];
  scriptTranscripts: SimpleTranscriptRecord[];
  resourceItems: ResourceItem[];
  productRecords: ProductRecord[];
  commentInsightRecords: CommentInsightRecord[];
}

export const platforms: Platform[] = ["抖音", "小红书", "视频号", "快手", "B站"];
export const contentGoals: ContentGoal[] = ["涨粉", "引流", "种草", "获客", "成交", "建信任", "复购", "直播间引流", "私信咨询", "品牌曝光"];
export const projectStatuses: ProjectStatus[] = ["待选题", "待脚本", "待拍摄", "待剪辑", "待发布", "已发布", "已复盘"];
export const videoContentTypes: VideoContentType[] = ["教知识", "晒过程", "聊观点", "讲故事", "测评", "直播切片", "图文笔记"];
export const videoTaskStatuses: VideoTaskStatus[] = ["选题中", "脚本中", "待拍摄", "拍摄中", "待剪辑", "剪辑中", "待审核", "待发布", "已发布", "待复盘", "已归档"];
export const topicAngles = ["痛点型", "避坑型", "对比型", "测评型", "评论区回复型", "老板IP型", "反差型", "成交型"];
export const scriptTypes = ["带货口播", "自然流获客", "老板IP", "评论区回复", "直播切片", "产品测评", "痛点种草", "反差对比"];
export const videoDurations = ["15秒", "30秒", "60秒", "90秒"];
export const speakingStyles = ["真实口语", "犀利痛点", "专业讲解", "生活化种草", "老板视角"];
export const methodCategories: DirectorMethod["category"][] = ["开头钩子", "痛点表达", "卖点转化", "分镜方法", "画中画方法", "结尾成交", "自然流获客", "拆片方法", "剪辑结构"];
export const editRhythms: EditRhythm[] = ["快节奏", "中等", "慢节奏", "情绪化", "强转化"];
export const shotRequiredLevels: ShotRequiredLevel[] = ["必拍", "可替代", "补充"];
export const shotCompletionStatuses: ShotCompletionStatus[] = ["未拍", "已拍", "需补拍"];
export const contentAssetTypes: ContentAssetType[] = ["成功案例库", "失败案例库", "爆款开头库", "高转化脚本库", "有效选题库", "无效选题库", "画中画素材库", "拍摄参考库", "剪辑节奏库", "复盘结论库", "拆片结构库"];
export const scriptRecordContentTypes: ScriptRecordContentType[] = ["短视频口播", "电商带货", "老板 IP", "小红书图文", "评论回复", "直播切片", "竞品对比", "避坑科普", "产品卖点提炼", "脚本改写", "教知识", "晒过程", "聊观点", "讲故事", "带货转化"];
export const scriptRecordPlatforms: ScriptRecordPlatform[] = ["抖音", "小红书", "快手", "视频号", "淘宝内容", "朋友圈"];
export const scriptRecordContentFormats: ScriptRecordContentFormat[] = ["短视频口播", "电商带货", "小红书种草", "图文笔记", "直播切片", "评论回复", "老板 IP", "达人口播", "竞品对比", "避坑科普"];
export const scriptRecordMaterialSources: ScriptRecordMaterialSource[] = ["手动输入", "产品资料", "爆款拆解", "评论区"];
export const scriptRecordVideoGoals: ScriptRecordVideoGoal[] = ["涨粉", "建信任", "引流", "成交", "直播间引流", "复购", "测试选题", "复盘测试"];
export const scriptRecordStatuses: ScriptRecordStatus[] = ["草稿", "已确认", "已拍摄", "已发布", "已复盘"];
export const roles: Role[] = ["管理员", "编导", "摄影师", "剪辑师", "运营", "只读成员"];
export const rolePermissions: Record<Role, Permission[]> = {
  管理员: ["全部权限"],
  编导: ["新建任务", "查看任务", "编辑选题", "编辑脚本", "生成分镜", "发起审核", "填写复盘", "发表评论"],
  摄影师: ["查看任务", "查看分镜拍摄单", "标记镜头已拍", "提交拍摄完成", "发表评论"],
  剪辑师: ["查看任务", "查看剪辑说明单", "提交剪辑版本", "查看修改意见", "发表评论"],
  运营: ["查看任务", "编辑发布记录", "填写发布数据", "发表评论"],
  只读成员: ["查看任务"]
};
export const approvalNodeDefinitions: Array<{ nodeName: ApprovalNodeName; objectType: ApprovalObjectType }> = [
  { nodeName: "选题审核", objectType: "选题" },
  { nodeName: "脚本审核", objectType: "脚本" },
  { nodeName: "分镜审核", objectType: "分镜" },
  { nodeName: "拍摄审核", objectType: "拍摄素材" },
  { nodeName: "剪辑审核", objectType: "剪辑成片" },
  { nodeName: "发布前审核", objectType: "发布信息" },
  { nodeName: "复盘审核", objectType: "复盘结论" }
];
export const approvalStatuses: ApprovalStatus[] = ["待提交", "待审核", "通过", "驳回", "需修改"];
export const versionContentTypes: VersionContentType[] = ["脚本", "分镜拍摄单", "剪辑说明单", "发布文案", "复盘结论"];
export const commentTypes: CommentType[] = ["普通评论", "修改意见", "风险提醒", "复盘补充"];
export const commentModules: CommentModule[] = ["选题", "脚本", "分镜", "拍摄", "剪辑", "发布", "复盘"];

export const reviewScoreLabels: Record<ReviewScoreKey, string> = {
  topicAudienceHit: "选题是否打中目标人群",
  openingEffectiveness: "开头 3 秒是否有效",
  viralElementClarity: "爆款元素是否明确",
  scriptStructure: "脚本结构是否清晰",
  informationDensity: "信息密度是否足够",
  emotionPoint: "情绪点是否明显",
  pictureInPictureEffectiveness: "画中画是否有效",
  shootingCompletion: "拍摄是否完成脚本要求",
  editingService: "剪辑是否服务内容",
  titleCoverMatch: "标题封面是否匹配",
  endingGuidance: "结尾引导是否明确"
};

export const reviewScoreKeys = Object.keys(reviewScoreLabels) as ReviewScoreKey[];
export const problemAttributionOptions: ProblemAttributionKey[] = ["选题问题", "开头问题", "脚本问题", "拍摄问题", "剪辑问题", "标题封面问题", "发布时间问题", "产品承接问题", "账号流量问题"];
