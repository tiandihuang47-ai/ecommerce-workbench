/**
 * 抖音评论的统一数据模型与处理工具（脚本模块使用）。
 *
 * 分层约定（见 docs/DOUYIN_COMMENT_INTEGRATION.md）：
 *   上游 raw JSON → Normalizer → CommentRecord → 清洗/采样 → CommentInsights → 脚本上下文
 * 业务层只消费 CommentRecord / CommentInsights，不直接碰抖音原始字段；
 * raw 只保留在 `raw` 字段里用于排查。
 */

/** 单条评论（主评论或回复）。字段缺失一律 null/空，不伪造。 */
export interface CommentRecord {
  commentId: string;
  awemeId: string;
  text: string;
  createdAt: string;
  likeCount: number;
  replyCount: number;
  user: {
    userId?: string;
    secUid?: string;
    nickname?: string;
    avatar?: string;
  };
  parentCommentId?: string;
  isReply: boolean;
  ipLocation?: string;
  raw?: Record<string, unknown>;
}

export type CommentFetchStatus = "idle" | "fetching" | "success" | "partial" | "failed";
export type CommentInsightStatus = "idle" | "running" | "done" | "failed";
export type CommentSignalType = "question" | "pain_point" | "purchase_barrier" | "positive" | "negative" | "content_opportunity";

export interface CommentInsightItem {
  topic: string;
  count: number;
  evidenceCommentIds: string[];
}

export interface CommentOpportunity {
  angle: string;
  reason: string;
  evidenceCommentIds: string[];
}

export interface RepresentativeComment {
  commentId: string;
  text: string;
  reason: string;
  signalType: CommentSignalType;
  likeCount?: number;
}

export interface CommentInsights {
  sampleSize: number;
  summary: string;
  highFrequencyTopics: CommentInsightItem[];
  highFrequencyQuestions: string[];
  painPoints: string[];
  purchaseBarriers: string[];
  desiredOutcomes: string[];
  productConcerns: string[];
  positiveSignals: string[];
  negativeSignals: string[];
  contentOpportunities: CommentOpportunity[];
  representativeComments: RepresentativeComment[];
  confidence: "low" | "medium" | "high";
  /** 提示词版本 & 输入指纹：同一条评论不重复分析（§六十二/§六十三）。 */
  promptVersion: string;
  commentsHash: string;
  generatedAt: string;
  source: "deepseek" | "fallback";
}

/** 脚本工作区里的评论状态（随草稿持久化）。 */
export interface DouyinCommentsState {
  status: CommentFetchStatus;
  awemeId: string;
  url: string;
  comments: CommentRecord[];
  totalFetched: number;
  totalReported: number;
  hasMore: boolean;
  fetchedAt: string;
  includeReplies: boolean;
  stage: string;
  error: string;
  insights: CommentInsights | null;
  insightStatus: CommentInsightStatus;
}

export const commentInsightPromptVersion = "comment-insight-v1";

/** 集中配置：不要在代码里散落 200 / 20 / 3 这些数字（§三十五/§三十六）。 */
export const douyinCommentConfig = {
  enabled: process.env.DOUYIN_COMMENTS_ENABLED !== "0",
  defaultMaxComments: clampInt(process.env.DOUYIN_COMMENTS_MAX, 200, 1, 1000),
  pageSize: clampInt(process.env.DOUYIN_COMMENTS_PAGE_SIZE, 20, 20, 50),
  includeReplies: process.env.DOUYIN_COMMENTS_INCLUDE_REPLIES === "1",
  analysisSampleSize: clampInt(process.env.DOUYIN_COMMENTS_SAMPLE_SIZE, 80, 10, 300),
  representativeCount: clampInt(process.env.DOUYIN_COMMENTS_REPRESENTATIVES, 10, 3, 20),
  requestTimeoutMs: clampInt(process.env.DOUYIN_COMMENTS_TIMEOUT_MS, 60000, 5000, 180000),
  maxRetries: clampInt(process.env.DOUYIN_COMMENTS_MAX_RETRIES, 2, 0, 5),
  cacheTtlMs: clampInt(process.env.DOUYIN_COMMENTS_CACHE_TTL_MS, 6 * 60 * 60 * 1000, 60000, 7 * 24 * 60 * 60 * 1000)
};

export function createCommentsState(url: string, awemeId = ""): DouyinCommentsState {
  return {
    status: "idle",
    awemeId,
    url,
    comments: [],
    totalFetched: 0,
    totalReported: 0,
    hasMore: false,
    fetchedAt: "",
    includeReplies: douyinCommentConfig.includeReplies,
    stage: "",
    error: "",
    insights: null,
    insightStatus: "idle"
  };
}

function clampInt(value: unknown, fallback: number, min: number, max: number) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.max(min, Math.min(Math.round(parsed), max));
}

function asString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function asNumber(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const matched = value.match(/\d+/);
    return matched ? Number(matched[0]) : 0;
  }
  return 0;
}

/** 上游 raw → CommentRecord。这是唯一做字段映射的地方，上游字段变化只改这里。 */
export function normalizeDouyinComments(
  rawComments: Array<Record<string, unknown>>,
  options: { awemeId?: string; maxComments?: number } = {}
): CommentRecord[] {
  const awemeId = options.awemeId || "";
  const records: CommentRecord[] = [];
  const seen = new Set<string>();

  rawComments.forEach((item, index) => {
    if (!item || typeof item !== "object") return;
    const raw = item.rawData && typeof item.rawData === "object" ? item.rawData as Record<string, unknown> : {};
    const user = (item.user && typeof item.user === "object" ? item.user : {}) as Record<string, unknown>;
    const text = asString(item.content) || asString(item.text);
    const commentId = asString(item.commentId) || asString(item.cid) || asString(raw.cid) || asString(item.id) || `comment_${index + 1}`;
    if (!text || seen.has(commentId)) return;
    seen.add(commentId);
    records.push({
      commentId,
      awemeId,
      text,
      createdAt: asString(item.createdAt),
      likeCount: asNumber(item.likeCount ?? raw.digg_count),
      replyCount: asNumber(item.replyCount ?? raw.reply_comment_total),
      user: {
        userId: asString(item.authorUserId) || asString(user.uid),
        secUid: asString(item.authorSecUid) || asString(user.sec_uid),
        nickname: asString(item.authorName) || asString(user.nickname),
        avatar: asString(item.authorAvatar)
      },
      parentCommentId: asString(item.parentCommentId) || undefined,
      isReply: Boolean(item.isReply),
      ipLocation: asString(item.ipLocation) || undefined,
      raw
    });
  });

  const limit = options.maxComments && options.maxComments > 0 ? options.maxComments : records.length;
  return records.slice(0, limit);
}

export function commentTextLength(record: CommentRecord) {
  return record.text.replace(/\s/g, "").length;
}

/** 清洗：去空、去纯表情/纯符号、去重复、压空格、限制异常长文本（§十三）。raw 永远保留。 */
export function cleanComments(records: CommentRecord[], maxLength = 300): CommentRecord[] {
  const seen = new Set<string>();
  const cleaned: CommentRecord[] = [];
  for (const record of records) {
    const normalized = record.text.replace(/\s+/g, " ").trim();
    if (!normalized) continue;
    // 纯表情 / 纯符号（没有任何中日韩文字、字母或数字）
    if (!/[\u4e00-\u9fa5a-zA-Z0-9]/.test(normalized)) continue;
    const dedupeKey = normalized.replace(/[。，！？、~～,.!?\s]/g, "");
    if (!dedupeKey || seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);
    cleaned.push({
      ...record,
      text: normalized.length > maxLength ? `${normalized.slice(0, maxLength)}…` : normalized
    });
  }
  return cleaned;
}

/**
 * 分析采样（§十二）：高赞 + 高回复 + 近期 + 普通评论混合，而不是只取最高赞。
 * 原始全集仍保留在 state.comments 里。
 */
export function buildAnalysisSample(records: CommentRecord[], size = douyinCommentConfig.analysisSampleSize): CommentRecord[] {
  if (records.length <= size) return records;
  const picked = new Map<string, CommentRecord>();
  const add = (list: CommentRecord[]) => {
    for (const item of list) {
      if (picked.size >= size) return;
      if (!picked.has(item.commentId)) picked.set(item.commentId, item);
    }
  };

  const byLikes = [...records].sort((a, b) => b.likeCount - a.likeCount);
  const byReplies = [...records].sort((a, b) => b.replyCount - a.replyCount);
  const byTime = [...records].sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""));

  add(byLikes.slice(0, Math.ceil(size * 0.4)));
  add(byReplies.slice(0, Math.ceil(size * 0.2)));
  add(byTime.slice(0, Math.ceil(size * 0.2)));
  // 其余名额按「中位区间」补，避免清一色高赞
  const midStart = Math.floor(records.length * 0.3);
  add(records.slice(midStart, midStart + size));
  add(records);

  return [...picked.values()].slice(0, size);
}

/** 评论指纹：用于判断是否需要重新做 AI 洞察（§六十二）。 */
export function commentsHash(records: CommentRecord[]) {
  const basis = records.map((item) => `${item.commentId}:${item.likeCount}:${item.text.length}`).join("|");
  let hash = 0;
  for (let index = 0; index < basis.length; index += 1) {
    hash = (hash * 31 + basis.charCodeAt(index)) | 0;
  }
  return `c${records.length}_${(hash >>> 0).toString(36)}`;
}

export function emptyInsights(sampleSize: number, hash: string, source: "deepseek" | "fallback" = "fallback"): CommentInsights {
  return {
    sampleSize,
    summary: "",
    highFrequencyTopics: [],
    highFrequencyQuestions: [],
    painPoints: [],
    purchaseBarriers: [],
    desiredOutcomes: [],
    productConcerns: [],
    positiveSignals: [],
    negativeSignals: [],
    contentOpportunities: [],
    representativeComments: [],
    confidence: sampleSize >= 60 ? "medium" : "low",
    promptVersion: commentInsightPromptVersion,
    commentsHash: hash,
    generatedAt: new Date().toISOString(),
    source
  };
}

/** 本地兜底洞察（AI 不可用时；只做关键词归纳，不编造）（§三十七 情况C）。 */
export function buildFallbackCommentInsights(records: CommentRecord[]): CommentInsights {
  const sample = records.slice(0, douyinCommentConfig.analysisSampleSize);
  const insights = emptyInsights(sample.length, commentsHash(records));
  const pick = (keywords: string[]) => sample.filter((item) => keywords.some((keyword) => item.text.includes(keyword)));
  const texts = (list: CommentRecord[]) => Array.from(new Set(list.map((item) => item.text))).slice(0, 6);

  insights.summary = sample.length
    ? `共分析 ${sample.length} 条评论（本地规则归纳，未调用模型）。`
    : "暂无可分析的评论。";
  insights.highFrequencyTopics = [
    { topic: "价格", count: pick(["贵", "价格", "多少钱", "划算", "优惠"]).length, evidenceCommentIds: pick(["贵", "价格", "多少钱", "划算", "优惠"]).slice(0, 3).map((item) => item.commentId) },
    { topic: "保暖", count: pick(["暖", "冷", "零下", "冬天", "厚"]).length, evidenceCommentIds: pick(["暖", "冷", "零下", "冬天", "厚"]).slice(0, 3).map((item) => item.commentId) },
    { topic: "尺码/身形", count: pick(["尺码", "码", "胖", "斤", "显瘦", "身高"]).length, evidenceCommentIds: pick(["尺码", "码", "胖", "斤", "显瘦", "身高"]).slice(0, 3).map((item) => item.commentId) },
    { topic: "颜色/款式", count: pick(["颜色", "好看", "款式", "显白"]).length, evidenceCommentIds: pick(["颜色", "好看", "款式", "显白"]).slice(0, 3).map((item) => item.commentId) }
  ].filter((item) => item.count > 0);
  insights.highFrequencyQuestions = texts(sample.filter((item) => /[?？吗呢]|多少|怎么|能不能|会不会/.test(item.text)));
  insights.purchaseBarriers = texts(pick(["怕", "担心", "会不会", "值不值", "贵", "犹豫"]));
  insights.desiredOutcomes = texts(pick(["想要", "显瘦", "保暖", "便宜", "好看", "链接"]));
  insights.positiveSignals = texts(pick(["好看", "喜欢", "买了", "不错", "信任", "值"]));
  insights.negativeSignals = texts(pick(["不好", "差", "失望", "退了", "起球", "不暖"]));
  insights.representativeComments = [...records]
    .sort((a, b) => b.likeCount - a.likeCount)
    .slice(0, douyinCommentConfig.representativeCount)
    .map((item) => ({
      commentId: item.commentId,
      text: item.text,
      reason: `点赞 ${item.likeCount}、回复 ${item.replyCount}`,
      signalType: /[?？吗呢]|多少|怎么/.test(item.text) ? "question" as const : item.likeCount > 0 ? "positive" as const : "pain_point" as const,
      likeCount: item.likeCount
    }));
  insights.confidence = sample.length >= 60 ? "medium" : "low";
  return insights;
}

/**
 * 给脚本 Agent 用的紧凑上下文块（§二十四/§四十七）：
 * 结构化洞察 + 少量代表性原评论，绝不把 200 条原文塞进提示词。
 */
export function buildCommentContextBlock(
  records: CommentRecord[],
  insights: CommentInsights | null
): string {
  if (!records.length && !insights) return "";
  const lines: string[] = [];
  if (insights) {
    lines.push(`样本：${insights.sampleSize} 条评论；置信度：${insights.confidence}`);
    if (insights.summary) lines.push(`整体：${insights.summary}`);
    const bullets = (label: string, values: string[]) => {
      const list = values.map((item) => asString(item)).filter(Boolean).slice(0, 6);
      if (list.length) lines.push(`${label}：${list.join("；")}`);
    };
    if (insights.highFrequencyTopics.length) {
      lines.push(`高频关注：${insights.highFrequencyTopics.slice(0, 8).map((item) => `${item.topic}(${item.count})`).join("、")}`);
    }
    bullets("高频提问", insights.highFrequencyQuestions);
    bullets("痛点", insights.painPoints);
    bullets("购买阻力", insights.purchaseBarriers);
    bullets("用户想要的结果", insights.desiredOutcomes);
    bullets("对产品的疑虑", insights.productConcerns);
    bullets("正向信号", insights.positiveSignals);
    bullets("负向信号", insights.negativeSignals);
    if (insights.contentOpportunities.length) {
      lines.push(`内容机会：${insights.contentOpportunities.slice(0, 5).map((item) => item.angle).filter(Boolean).join("；")}`);
    }
  }

  const representatives = (insights?.representativeComments?.length
    ? insights.representativeComments.slice(0, douyinCommentConfig.representativeCount)
    : records.slice(0, douyinCommentConfig.representativeCount).map((item) => ({
      commentId: item.commentId,
      text: item.text,
      reason: "",
      signalType: "question" as CommentSignalType,
      likeCount: item.likeCount
    })));

  if (representatives.length) {
    lines.push("代表性原评论（只可短引用，不要改写原话）");
    for (const item of representatives) {
      const meta = [item.likeCount ? `${item.likeCount} 赞` : "", item.reason].filter(Boolean).join(" · ");
      lines.push(`- （${item.commentId}）${item.text}${meta ? `（${meta}）` : ""}`);
    }
  }

  lines.push("注意：以上是观众看法，不是产品事实；不能当作产品参数、价格、功效的证据。");
  return lines.join("\n");
}
