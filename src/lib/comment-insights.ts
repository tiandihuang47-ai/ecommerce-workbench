import { createId, nowIso } from "@/lib/shared/time";
import type { CommentRecord, HighLikeCommentInsights, SimpleDeconstructionRecord } from "@/lib/pipeline-types";

export function normalizeCommentRecords(
  comments: Array<Partial<CommentRecord> & { content?: string }>,
  options: { platform: SimpleDeconstructionRecord["platform"]; videoUrl: string; limit?: number }
) {
  const now = nowIso();
  return comments
    .map((item, index): CommentRecord => ({
      id: item.id || createId("comment"),
      platform: item.platform || options.platform || "unknown",
      videoUrl: item.videoUrl || options.videoUrl || "",
      commentId: item.commentId || String(item.rawData?.id || item.rawData?.cid || index + 1),
      content: String(item.content || "").trim(),
      likeCount: numberValue(item.likeCount),
      authorName: item.authorName || "",
      createdAt: item.createdAt || now,
      rawData: item.rawData || {}
    }))
    .filter((item) => item.content)
    .sort((a, b) => b.likeCount - a.likeCount)
    .slice(0, options.limit || 10);
}

export function parseManualComments(value: string, options: { platform: SimpleDeconstructionRecord["platform"]; videoUrl: string; limit?: number }) {
  const rows = value
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const matched = line.match(/^(\d+(?:\.\d+)?)(万|w|W|k|K)?\s*(赞|likes?)?\s*[:：\-—]?\s*(.+)$/i);
      if (!matched) {
        return { content: line, likeCount: 0, rawData: { source: "manual" } };
      }
      const base = Number(matched[1] || 0);
      const unit = matched[2] || "";
      const multiplier = /万|w/i.test(unit) ? 10000 : /k/i.test(unit) ? 1000 : 1;
      return {
        content: matched[4].trim(),
        likeCount: Math.round(base * multiplier),
        rawData: { source: "manual", original: line }
      };
    });

  return normalizeCommentRecords(rows, options);
}

export function commentsToText(comments: CommentRecord[]) {
  return comments.map((item) => `${item.likeCount ? `${item.likeCount}赞 ` : ""}${item.content}`).join("\n");
}

export function buildFallbackCommentInsights(comments: CommentRecord[], productContext?: { targetProduct?: string; targetAudience?: string }): HighLikeCommentInsights {
  const text = comments.map((item) => item.content).join("\n");
  const questions = comments.filter((item) => /[?？吗呢会不会值不值适合]/.test(item.content)).slice(0, 8).map((item) => item.content);
  const concerns = pickByKeywords(comments, ["贵", "价格", "值", "多少钱", "划算", "质量", "售后", "真假", "显", "适合", "怕", "担心"]);
  const product = productContext?.targetProduct || "你的产品";
  const audience = productContext?.targetAudience || "目标人群";
  const mainConcern = concerns[0] || questions[0] || comments[0]?.content || "用户想确认产品是否适合自己";

  return {
    topConcerns: uniq([mainConcern, ...concerns, ...questions]).slice(0, 6),
    userPainPoints: uniq([
      ...pickByKeywords(comments, ["怕", "担心", "不敢", "显", "适合", "踩坑"]),
      `用户想确认${product}是否真的适合${audience}`
    ]).slice(0, 6),
    purchaseObjections: uniq([
      ...pickByKeywords(comments, ["贵", "值不值", "质量", "售后", "真假", "会不会"]),
      "担心买错、效果不符合预期、缺少真实证明"
    ]).slice(0, 6),
    contentAngles: [
      `围绕评论“${mainConcern}”做一条正面回应视频`,
      `把高赞评论拆成 3 个判断标准，让${audience}快速自查`,
      `用对比画面证明${product}的关键差异`
    ],
    shootingSuggestions: [
      "拍评论提到的具体顾虑，不要只讲卖点。",
      "补充前后对比、细节特写、真实使用场景或用户反馈。",
      "用字幕把高赞评论原话压出来，再用画面逐条回应。",
      "如果评论集中在颜色/尺码/效果/价格，优先拍对比和实测。"
    ],
    topicIdeas: [
      `评论区都在问：${mainConcern.replace(/[?？]/g, "")}`,
      `${audience}买${product}前，最担心的不是价格，而是这个细节`,
      `${product}到底值不值？看完这 3 点再决定`,
      `把评论区最高赞的问题一次说清楚`,
      `为什么同样是${product}，有人满意有人踩坑？`
    ],
    hookIdeas: [
      `评论区问得最多的这个问题，我直接说实话。`,
      `很多人不敢买${product}，不是因为贵，是怕这个。`,
      `如果你也担心“${mainConcern.replace(/[?？]/g, "")}”，先看这 3 个细节。`,
      `别再只看表面了，${product}真正要看的是这里。`,
      `这条高赞评论，其实说出了大多数人的顾虑。`
    ],
    scriptDirections: [
      "高赞评论开场 → 点破用户顾虑 → 给判断标准 → 产品细节证明 → 评论/私信承接。",
      "先承认用户担心是合理的，再用实拍细节降低顾虑。",
      "不要硬转化，先做问题解释，再把卖点变成证据。"
    ],
    conversionOpportunities: [
      "把评论区高频问题做成置顶评论回复。",
      "结尾引导用户留言自己的情况，方便私信承接。",
      "直播间可用同一问题做开场讲解和异议处理。"
    ],
    riskNotes: [
      "评论洞察只能作为内容灵感，不能编造功效、价格、销量和检测结论。",
      "引用评论时避免展示敏感个人信息。"
    ],
    commentTags: comments.map((item) => ({ commentId: item.commentId, tags: inferTags(item.content) }))
  };
}

function pickByKeywords(comments: CommentRecord[], keywords: string[]) {
  return comments.filter((item) => keywords.some((keyword) => item.content.includes(keyword))).map((item) => item.content);
}

function inferTags(content: string) {
  const tags = [];
  if (/贵|价格|值|多少钱|划算/.test(content)) tags.push("价格顾虑");
  if (/显|颜色|尺码|适合|年龄|胖|瘦/.test(content)) tags.push("适配顾虑");
  if (/质量|真假|售后|退|换|起球|耐用/.test(content)) tags.push("信任顾虑");
  if (/[?？吗呢会不会]/.test(content)) tags.push("用户提问");
  if (/想要|链接|怎么买|哪里买|直播/.test(content)) tags.push("成交信号");
  return tags.length ? tags : ["内容反馈"];
}

function uniq(items: string[]) {
  return Array.from(new Set(items.map((item) => item.trim()).filter(Boolean)));
}

function numberValue(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string") return 0;
  const matched = value.trim().match(/^(\d+(?:\.\d+)?)(万|w|W|k|K)?/);
  if (!matched) return 0;
  const base = Number(matched[1] || 0);
  const unit = matched[2] || "";
  const multiplier = /万|w/i.test(unit) ? 10000 : /k/i.test(unit) ? 1000 : 1;
  return Math.round(base * multiplier);
}
