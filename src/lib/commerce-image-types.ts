import type { ProductReferenceSnapshot } from "@/lib/pipeline-types";
import type { CommerceCreativeState } from "@/lib/commerce-image-v4-types";
import type { MarketingPipelineRecord } from "@/marketing/engine/types";

export type CommerceImageTaskKind = "detail_page" | "douyin_post" | "xiaohongshu_post" | "retouch" | "free_chat";

export type CommerceImageModel =
  | "auto"
  | "doubao-seedream-5-0-260128"
  | "doubao-seedream-5-0-pro-260628"
  | "gpt-image-2"
  | "gpt-image-2.5";

export type ResolvedCommerceImageModel = Exclude<CommerceImageModel, "auto">;

export type CommerceImageRatio = "3:4" | "4:3" | "16:9" | "9:16" | "2:3" | "3:2" | "1:1";
export type CommerceImageOutputRatio = CommerceImageRatio | "original";

export type CommerceImageQuality = "standard" | "high" | "ultra";

export type CommerceImageTaskStatus =
  | "draft"
  | "awaiting_input"
  | "planning"
  | "awaiting_approval"
  | "queued"
  | "generating"
  | "partial"
  | "completed"
  | "failed"
  | "cancelled";

export type CommerceImagePanelStatus = "draft" | "queued" | "generating" | "completed" | "failed" | "cancelled";

export type CommerceImageAssetRole =
  | "front"
  | "side"
  | "back"
  | "detail"
  | "package"
  | "logo"
  | "on_body"
  | "benchmark_reference"
  | "reference_segment"
  | "skill_reference"
  | "style_reference"
  | "chat_reference"
  | "chat_generated"
  | "other";

export type CommerceImageMarketingStrategy =
  | "auto"
  | "pain_point"
  | "contrast"
  | "scenario"
  | "emotion"
  | "listicle"
  | "evidence"
  | "custom_skill";

export type CommerceImageTextAlign = "left" | "center" | "right";

export type CommerceImageRetouchOperation =
  | "white_background"
  | "transparent_background"
  | "change_scene"
  | "remove_clutter"
  | "light_color"
  | "upscale"
  | "crop"
  | "batch_consistency";

export interface CommerceImageSize {
  width: number;
  height: number;
  label: string;
}

export interface CommerceImageBrandProfile {
  brandName: string;
  primaryColor: string;
  secondaryColor: string;
  fontStyle: string;
  styleNotes: string;
}

export interface CommerceImageAsset {
  id: string;
  sourceProfileAssetId?: string;
  role: CommerceImageAssetRole;
  name: string;
  mimeType: string;
  size: number;
  width?: number;
  height?: number;
  createdAt: string;
  storagePath?: string;
  url?: string;
}

/**
 * 生成任务固化的产品快照。
 * 任务创建时写入，之后产品被改名、更新资料、删图、删除，都不会改变这里的内容。
 */
export interface CommerceImageProductAssetSnapshot {
  productId: string;
  productName: string;
  brandName: string;
  category: string;
  /** 生成时那份产品资料的标识与时间，用于区分历史任务用的是哪一版。 */
  documentId: string;
  documentName: string;
  documentRevision: number;
  documentUpdatedAt: string;
  /** 生成时固化的产品资料正文（已截断），AI 只从这里取事实。 */
  documentText: string;
  /** 结构化后的产品事实文本，直接进入生图提示词。 */
  referenceText: string;
  imageCount: number;
  capturedAt: string;
}

/** 本次参考图片：使用整个产品，或只用手动勾选的几张。 */
export interface CommerceImageProductImageSelection {
  mode: "all" | "selected";
  /** 用户在产品资产里勾选的图片（productImageId）。 */
  selectedImageIds: string[];
  /** 实际复制进任务、可被生图引用的任务内素材 id。 */
  attachedAssetIds: string[];
  /** 真正发往模型的参考图 id（受模型参考图张数上限约束）。 */
  usedAssetIds: string[];
  updatedAt: string;
}

export interface CommerceImageVersion {
  id: string;
  assetId: string;
  modelId: ResolvedCommerceImageModel;
  providerModelId: string;
  width: number;
  height: number;
  mimeType: string;
  prompt: string;
  setId?: string;
  createdAt: string;
  storagePath?: string;
  imageUrl?: string;
  /** 这次生成真正请求的尺寸（可能与实际返回不同：上游可能降档）。 */
  requestedSize?: { width: number; height: number };
  /** 这次生成要求的目标比例（历史记录里也能看到当时选的比例）。 */
  ratio?: CommerceImageRatio | "original";
  /** 上游原始返回尺寸（本地做过等比裁剪时，可与最终宽高不同）。 */
  providerSize?: { width: number; height: number };
}

export interface CommerceImageTextLayer {
  id: string;
  name: string;
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
  fontFamily: "sans" | "serif" | "rounded";
  fontSize: number;
  fontWeight: 400 | 500 | 600 | 700 | 800 | 900;
  lineHeight: number;
  color: string;
  backgroundColor: string;
  backgroundOpacity: number;
  align: CommerceImageTextAlign;
  visible: boolean;
  locked: boolean;
}

export interface CommerceImageOverlay {
  visible: boolean;
  title: string;
  body: string;
  textColor: string;
  accentColor: string;
  position: "top" | "bottom";
  align: "left" | "center";
}

/**
 * A normalized rectangle on the generated canvas.  It is stored as a ratio so
 * a layout remains correct when the editor is zoomed or the image is exported
 * at a different pixel size.
 */
export interface CommerceImageCanvasRegion {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface CommerceImageTextSafeZone extends CommerceImageCanvasRegion {
  id: string;
  label: "标题留白" | "正文留白" | "备用留白";
  confidence: "planned" | "verified" | "fallback";
}

export interface CommerceImageLayoutGuide {
  subjectBox?: CommerceImageCanvasRegion;
  safeZones: CommerceImageTextSafeZone[];
  source: "planned" | "vision" | "fallback";
  checkedAt: string;
}

export interface CommerceImagePanelQuality {
  status: "pending" | "passed" | "needs_layout_retry" | "needs_regeneration" | "warning";
  productVisible: boolean;
  productFidelity: boolean;
  textSafe: boolean;
  storyFit: boolean;
  marketingFit: boolean;
  seriesConsistent: boolean;
  unexpectedText: boolean;
  /** 视觉检查是否在画面中识别到可读中文文字；未检查时为 undefined。 */
  textPresent?: boolean;
  /** 本图承诺的卖点证据是否在画面中清晰呈现；未绑定卖点或未检查时为 undefined。 */
  sellingPointFit?: boolean;
  detectedText: string[];
  layoutRetryCount: number;
  qualityRetryCount: number;
  warnings: string[];
  checkedAt: string;
}

export type CommerceImageStoryboardRole =
  | "cover_hook"
  | "scene_context"
  | "fact_proof"
  | "outfit_closing"
  | "highlight";

export interface CommerceImageStoryboardCard {
  id: string;
  order: number;
  role: CommerceImageStoryboardRole;
  title: string;
  purpose: string;
  visual: string;
  copyIntent: string;
}

export interface CommerceImageVisualBible {
  productAnchor: string;
  colorMood: string;
  photography: string;
  typography: string;
  scene: string;
  subjectRule: string;
  referenceAssetIds: string[];
}

export interface CommerceImageStoryboard {
  version: 1;
  theme: string;
  audience: string;
  emotionalHook: string;
  summary: string;
  visualBible: CommerceImageVisualBible;
  cards: CommerceImageStoryboardCard[];
  status: "draft" | "planned" | "confirmed" | "needs_revision";
  confirmedAt: string;
  updatedAt: string;
}

export interface CommerceImagePanel {
  id: string;
  kind: string;
  title: string;
  description: string;
  prompt: string;
  ratio: CommerceImageOutputRatio;
  status: CommerceImagePanelStatus;
  error: string;
  overlay: CommerceImageOverlay;
  storyboardCardId?: string;
  /** 本张画面绑定的卖点卡快照：进入提示词与质检，旧任务无此字段照常工作。 */
  sellingPointCardId?: string;
  sellingPoint?: CommerceSellingPointCard;
  order?: number;
  referenceSegmentId?: string;
  layoutGuide?: CommerceImageLayoutGuide;
  quality?: CommerceImagePanelQuality;
  textLayers: CommerceImageTextLayer[];
  imageFit: "cover" | "contain";
  versions: CommerceImageVersion[];
  selectedVersionId: string;
}

export interface CommerceImageDocument {
  id: string;
  name: string;
  mimeType: string;
  size: number;
  status: "ready" | "failed";
  excerpt: string;
  extractedText?: string;
  error: string;
  createdAt: string;
  storagePath?: string;
}

export interface CommerceImageChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
  /** 关联图片素材：用户消息为附带参考图，助手消息为生成结果。 */
  imageAssetIds?: string[];
  /** ok = 正常消息；error = 生成失败／已停止的提示消息。 */
  status?: "ok" | "error";
}

export interface CommerceImageReferenceSegment {
  id: string;
  title: string;
  kind: string;
  order: number;
  yStart: number;
  yEnd: number;
  layout: string;
  style: string;
  detectedText: string[];
  assetId: string;
}

export interface CommerceImageReferenceAnalysis {
  status: "idle" | "analyzing" | "completed" | "failed";
  sourceAssetId: string;
  width: number;
  height: number;
  summary: string;
  segments: CommerceImageReferenceSegment[];
  warnings: string[];
  error: string;
  updatedAt: string;
}

export interface CommerceImageProductFact {
  id: string;
  label: string;
  value: string;
  sourceName: string;
  sourceExcerpt: string;
  confidence: "confirmed" | "observed" | "uncertain";
}

/**
 * 卖点转化卡：一张图卖什么。所有字段只能来自商品事实与产品资料，
 * 不得编造价格、销量、认证、功效。visualEvidence 是画面真正拍得到的证据。
 */
export interface CommerceSellingPointCard {
  id: string;
  /** 卖点短名，如“90 白鸭绒”。 */
  label: string;
  /** 对谁（可为空）。 */
  audience: string;
  /** 痛点 / 购买动机（可为空）。 */
  painPoint: string;
  /** 为什么可信（对应事实）。 */
  reason: string;
  /** 画面能拍到的证据，只能来自商品图 / 产品事实。 */
  visualEvidence: string;
  /** 可直接发布的中文短句（8–20 字）。 */
  copyLine: string;
}

export interface CommerceImageStyleSkillSnapshot {
  id: string;
  name: string;
  description: string;
  version: string;
  contentHash: string;
  instructions: string;
  referenceAssetIds: string[];
}

export interface CommerceImageGenerationSet {
  id: string;
  index: number;
  label: string;
  status: "draft" | "generating" | "partial" | "completed" | "failed";
  createdAt: string;
}

export interface CommerceImageStructuredError {
  code: string;
  category: "configuration" | "authorization" | "model_access" | "quota" | "validation" | "transient" | "content_policy" | "unknown";
  message: string;
  retryable: boolean;
  provider?: "seedream" | "openai" | "openai_v25" | "text" | "vision";
  requestId?: string;
}

export interface CommerceImageStyleSkill {
  id: string;
  name: string;
  description: string;
  version: string;
  platforms: Array<"douyin" | "xiaohongshu">;
  tags: string[];
  instructions: string;
  contentHash: string;
  referenceAssets: CommerceImageAsset[];
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CommerceImagePublishPackage {
  title: string;
  body: string;
  tags: string[];
  complianceWarnings: string[];
}

export interface CommerceImageBrief {
  audience: string;
  sellingPoints: string;
  scene: string;
  style: string;
  extra: string;
  strategy: CommerceImageMarketingStrategy;
  cardCount: number;
  retouchOperation: CommerceImageRetouchOperation;
}

export interface CommerceImageQualityOption {
  value: CommerceImageQuality;
  label: string;
  description: string;
  /** Actual pixel dimension multiplier for this quality level. */
  sizeMultiplier: number;
}

/** 单张画面最终发给 Provider 的提示词快照。 */
export interface CommerceImagePromptPanelSnapshot {
  panelId: string;
  title: string;
  /** 真正发给 Image Provider 的完整提示词（含系列参考说明与干净底图规则）。 */
  compiledPrompt: string;
  /** 发请求时实际使用的模型。 */
  model: string;
  /** 请求尺寸，例如 1536×2048。 */
  size: string;
  capturedAt: string;
}

/**
 * 一次生成使用的提示词快照：发请求之前就写盘，历史任务永久保留，不随产品资料或
 * Prompt Compiler 变化而改变。
 * - userInstruction：用户在输入框里写的原始需求（原话）。
 * - compiledPrompt：通过产品资料 / 参考图 / 营销规划 / Prompt Compiler 装配后，
 *   真正发送给 Image Provider 的完整提示词（多图任务看 panels 逐张）。
 */
export interface CommerceImagePromptSnapshot {
  userInstruction: string;
  compiledPrompt: string;
  panels: CommerceImagePromptPanelSnapshot[];
  model: CommerceImageModel;
  resolvedModelId: ResolvedCommerceImageModel | "";
  ratio: CommerceImageOutputRatio;
  quality: CommerceImageQuality;
  count: number;
  contentGoal: string;
  capturedAt: string;
  updatedAt: string;
}

/**
 * 生成参数快照：比例是唯一真源，请求尺寸与最终真实尺寸都留档。
 * 历史任务重新打开时读这里，不必再推算。
 */
export interface CommerceImageGenerationSpec {
  /** 用户选择的比例（唯一真源）。 */
  aspectRatio: CommerceImageOutputRatio;
  /** 用户选择的清晰度档：standard=1K / high=2K / ultra=4K。 */
  resolution: CommerceImageQuality;
  requestedWidth: number;
  requestedHeight: number;
  /** 真正写进 Provider 请求的 size（例如 1152x2048）。 */
  providerRequestSize: string;
  /** Provider 返回的原始尺寸（可能被上游降档）。 */
  providerReturnedWidth?: number;
  providerReturnedHeight?: number;
  /** 最终落盘 = 下载的真实尺寸与比例。 */
  actualWidth?: number;
  actualHeight?: number;
  actualAspectRatio?: string;
  /** 比例校验结论：ok = 上游返回就是严格比例；cropped = 本地等比裁剪校正过；retried = 重新请求过。 */
  ratioStatus?: "ok" | "cropped" | "retried";
  recordedAt: string;
}

export interface CommerceImageTask {
  schemaVersion: 3;
  workflowVersion?: "legacy" | "conversation-v4";
  id: string;
  /** 归属账号 ID（网页端创建时打标；历史桌面数据没有此标记，不下发给前端） */
  userId?: string;
  title: string;
  kind: CommerceImageTaskKind;
  status: CommerceImageTaskStatus;
  model: CommerceImageModel;
  resolvedModelId: ResolvedCommerceImageModel | "";
  ratio: CommerceImageOutputRatio;
  quality?: CommerceImageQuality;
  productId: string;
  productName: string;
  productSnapshot?: ProductReferenceSnapshot;
  /** 生成时固化的产品资产快照：历史任务只读它，不再回查当前产品。 */
  productAssetSnapshot?: CommerceImageProductAssetSnapshot;
  /** 本次参考图片的选择方式与最终实际结果。 */
  productImageSelection?: CommerceImageProductImageSelection;
  brandProfile: CommerceImageBrandProfile;
  brief: CommerceImageBrief;
  sourceAssets: CommerceImageAsset[];
  documents: CommerceImageDocument[];
  chatMessages: CommerceImageChatMessage[];
  referenceAnalysis: CommerceImageReferenceAnalysis;
  productFacts: CommerceImageProductFact[];
  strategySnapshot?: CommerceImageStyleSkillSnapshot;
  planRevision: number;
  approvedPlanRevision: number;
  generationSetCount: 1 | 2 | 4;
  generationSets: CommerceImageGenerationSet[];
  selectedSetId: string;
  /** Present for every small-red-book project, including migrated projects. */
  storyboard?: CommerceImageStoryboard;
  panels: CommerceImagePanel[];
  publishPackage: CommerceImagePublishPackage;
  warnings: string[];
  error: string;
  lastError?: CommerceImageStructuredError;
  creative?: CommerceCreativeState;
  /** 营销生图引擎的可观测记录：商品事实 → 意图 → 策略 → 创意 → Prompt → 质检。 */
  marketing?: MarketingPipelineRecord;
  /** 本次生成真正使用的提示词快照（用户原话 + 最终发往 Provider 的提示词）。 */
  promptSnapshot?: CommerceImagePromptSnapshot;
  /** 生成参数快照：比例 / 清晰度 / 请求尺寸 / Provider 返回尺寸 / 最终真实尺寸。 */
  generationSpec?: CommerceImageGenerationSpec;
  progress?: {
    completed: number;
    total: number;
    currentPanelId: string;
    message: string;
    updatedAt: string;
  };
  approvedAt: string;
  createdAt: string;
  updatedAt: string;
}

export interface CommerceProductVisualProfile {
  productId: string;
  productName: string;
  brandProfile: CommerceImageBrandProfile;
  assets: CommerceImageAsset[];
  createdAt: string;
  updatedAt: string;
}

export interface CommerceImageProviderStatus {
  provider: "seedream" | "openai" | "openai_v25";
  label: string;
  modelId: ResolvedCommerceImageModel;
  providerModelId: string;
  configured: boolean;
  maskedKey: string;
  source: "local" | "environment" | "none";
  workspaceId?: string;
  baseUrl?: string;
  lastVerifiedAt: string;
  verifiedForCurrentConfig: boolean;
  message?: string;
}

export interface CommerceAssistantProviderStatus {
  provider: "text" | "vision";
  label: string;
  configured: boolean;
  maskedKey: string;
  source: "local" | "environment" | "none";
  baseUrl: string;
  modelId: string;
  lastVerifiedAt: string;
  verifiedForCurrentConfig: boolean;
  message?: string;
}
