import type { ProductRecord, ScriptRecord } from "@/lib/pipeline-types";
import { sanitizeScriptCopy } from "@/lib/script-copy";

export type ReferenceKind = "video" | "text" | "document";
export type ReferenceStatus = "uploading" | "analyzing" | "done" | "failed";

export interface ReferenceItem {
  id: string;
  kind: ReferenceKind;
  name: string;
  status: ReferenceStatus;
  error?: string;
  transcript?: string;
  extractedText?: string;
  summary?: string;
  analysis?: string;
  facts?: string[];
  inferences?: string[];
}

export type DouyinTranscriptStatus = "idle" | "running" | "done" | "failed";

/** 脚本页「抖音链接 → 逐字稿」的本地状态（随脚本草稿一起持久化）。 */
export interface DouyinTranscriptState {
  status: DouyinTranscriptStatus;
  /** 用户原始粘贴内容（链接或整段分享文案）。 */
  link: string;
  /** ASR 逐字稿，用户可编辑。 */
  transcript: string;
  title: string;
  authorName: string;
  durationSeconds: number;
  /** 抖音视频 id：随草稿持久化，供逐字稿库按 awemeId 精确去重。 */
  awemeId?: string;
  /** 失败阶段，用于区分错误类型。 */
  stage: string;
  error: string;
  /** 账户类问题（例如阿里云欠费）重试无用，界面不再显示「重试」。 */
  retryable?: boolean;
  /** 解析成功后写入的「逐字稿库」记录 id，用于手动编辑时同步库中同一条。 */
  transcriptRecordId?: string;
  updatedAt: string;
}

export function createDouyinTranscriptState(link: string, transcript = ""): DouyinTranscriptState {
  return {
    status: "idle",
    link,
    transcript,
    title: "",
    authorName: "",
    durationSeconds: 0,
    stage: "",
    error: "",
    retryable: true,
    updatedAt: new Date().toISOString()
  };
}

/**
 * 逐字稿作为一份参考资料参与脚本生成。
 * 没有逐字稿时返回 null，旧的脚本生成逻辑完全不受影响。
 */
export function douyinTranscriptToReference(state?: DouyinTranscriptState | null): ReferenceItem | null {
  if (!state || state.status !== "done") return null;
  const transcript = state.transcript?.trim() || "";
  if (!transcript) return null;
  const label = state.title.trim() ? `抖音视频逐字稿 · ${state.title.trim()}` : "抖音视频逐字稿";
  return {
    id: "ref_douyin_transcript",
    kind: "video",
    name: label,
    status: "done",
    transcript,
    summary: `抖音视频逐字稿（${transcript.replace(/\s/g, "").length} 字）`,
    extractedText: state.link
  };
}

/** 选题依据来源引用（名称必须在本次提供的素材清单内，服务端已校验 valid） */
export interface DirectionSource {
  name: string;
  quote: string;
  kind: string;
  /** false=模型引用了不存在的来源，显示"依据无效"，不得当成已验证 */
  valid: boolean;
}

export type DirectionStatus = "ready" | "needs_material" | "needs_conditions";

export interface DirectionOption {
  id: string;
  name: string;
  play: string;
  reason: string;
  /** 目标观众及具体问题 */
  audience?: string;
  /** 对应商品卖点 */
  sellingPoint?: string;
  /** 推荐依据摘要 */
  basis?: string;
  /** 可定位的来源引用 */
  sources?: DirectionSource[];
  /** 可用证明方式 */
  proofMethods?: string[];
  /** 人员/场地/素材要求 */
  requirements?: string[];
  /** 还缺什么 */
  missing?: string[];
  /** 与近期内容的区别 */
  difference?: string;
  /** 准备状态：可直接展开 / 需补资料 / 需调整条件 */
  status?: DirectionStatus;
  /** 是否存在至少一个有效来源；false = 待验证设想 */
  verified?: boolean;
}

export interface ScriptSection {
  key: string;
  label: string;
  content: string;
}

export interface ScriptDocument {
  title: string;
  sections: ScriptSection[];
}

/** 脚本页现在只产出这一段：能照着念的口播文案。 */
export const copySection = { key: "script", label: "文案" } as const;

function normalizeForCompare(value: string) {
  return value.replace(/\s+/g, "");
}

/**
 * 把任何来源的脚本收敛成「只有文案」：
 * 合并 开头 → 正文/对话 → 结尾，丢掉 镜头/动作/画中画 等描述段落，并做一次清洗。
 * 任何来源都过这里，旧草稿、旧记录、旧版本打开后同样只剩文案。
 */
export function toCopyOnlyDocument(document: ScriptDocument): ScriptDocument {
  const title = document.title?.trim() || "";
  const contentOf = (section: ScriptSection) => sanitizeScriptCopy(section.content || "").trim();
  const pick = (keys: string[]) => document.sections
    .filter((section) => keys.includes(section.key) || keys.includes(section.label))
    .map(contentOf)
    .filter(Boolean);

  const hook = pick(["hook", "开头 · 0–3s", "开头"]).join("\n").trim();
  const body = pick(["script", "dialog", "copy", "文案", "对话", "脚本"]).join("\n").trim();
  const ending = pick(["ending", "结尾"]).join("\n").trim();

  const parts: string[] = [];
  if (hook && !(body && normalizeForCompare(body).startsWith(normalizeForCompare(hook).slice(0, 10)))) {
    parts.push(hook);
  }
  if (body) parts.push(body);
  if (ending && !(body && normalizeForCompare(body).endsWith(normalizeForCompare(ending).slice(0, 10)))) {
    parts.push(ending);
  }

  const content = parts.join("\n").replace(/\n{3,}/g, "\n\n").trim();
  return {
    title,
    sections: content ? [{ key: copySection.key, label: copySection.label, content }] : []
  };
}

/** 复制给用户看的纯文案：标题 + 文案正文，不带段落标签。 */
export function documentToCopyText(document: ScriptDocument) {
  const parts = [document.title?.trim() || ""];
  for (const section of document.sections) {
    const content = section.content?.trim() || "";
    if (content) parts.push(content);
  }
  return parts.filter(Boolean).join("\n\n");
}

export function documentToPlainText(document: ScriptDocument) {
  const parts = [document.title?.trim() || ""];
  for (const section of document.sections) {
    const content = section.content?.trim() || "";
    if (!content) continue;
    parts.push(section.label, content);
  }
  return parts.filter(Boolean).join("\n\n");
}

export function estimateDurationSeconds(text: string) {
  const chars = (text || "").replace(/\s/g, "").length;
  if (!chars) return 0;
  return Math.max(1, Math.round(chars / 4));
}

export function buildProductPromptText(product?: ProductRecord) {
  if (!product) return "未选择产品资料";
  return [
    `产品名称：${product.name || ""}`,
    product.brandName ? `品牌：${product.brandName}` : "",
    product.category ? `品类：${product.category}` : "",
    product.priceRange ? `价格区间：${product.priceRange}` : "",
    product.colors ? `颜色/款式：${product.colors}` : "",
    product.specifications ? `规格参数：${product.specifications}` : "",
    product.productFacts ? `产品事实：${product.productFacts}` : "",
    product.coreSellingPoints ? `核心卖点：${product.coreSellingPoints}` : "",
    product.secondarySellingPoints ? `次级卖点：${product.secondarySellingPoints}` : "",
    product.targetAudience ? `目标人群：${product.targetAudience}` : "",
    product.painPoints ? `用户痛点：${product.painPoints}` : "",
    product.objections ? `用户顾虑：${product.objections}` : "",
    product.useScenarios ? `使用场景：${product.useScenarios}` : "",
    product.buyerFeedback ? `买家反馈：${product.buyerFeedback}` : "",
    product.forbiddenWords ? `禁忌词：${product.forbiddenWords}` : "",
    product.forbiddenClaims ? `不能承诺的内容：${product.forbiddenClaims}` : ""
  ].filter(Boolean).join("\n");
}

export function buildProductMetaLine(product?: ProductRecord) {
  if (!product) return "";
  const parts = [
    product.colors?.trim(),
    product.targetAudience?.trim(),
    product.useScenarios?.trim()
  ].filter(Boolean);
  return parts.join(" · ");
}

export function oldRecordToDocument(record: ScriptRecord): ScriptDocument {
  const sections: ScriptSection[] = [];

  const hook = record.hook?.trim();
  if (hook) {
    sections.push({ key: "hook", label: "开头 · 0–3s", content: hook });
  }

  const script = record.scriptText?.trim();
  if (script) {
    sections.push({ key: "script", label: "对话", content: script });
  }

  const shots = record.shotSuggestions?.trim();
  if (shots) {
    sections.push({ key: "shots", label: "镜头", content: shots });
  }

  const overlay = record.overlaySuggestions?.trim();
  if (overlay) {
    sections.push({ key: "overlay", label: "画中画", content: overlay });
  }

  const tips = record.shootingTips?.trim();
  if (tips) {
    sections.push({ key: "tips", label: "动作", content: tips });
  }

  const cta = record.endingCTA?.trim();
  if (cta) {
    sections.push({ key: "ending", label: "结尾", content: cta });
  }

  // 旧记录里的 镜头/动作/画中画 不再展示，只把能念的内容合并成一段文案；
  // 数据本身不动，历史记录仍然完整保留。
  return toCopyOnlyDocument({
    title: record.title?.trim() || record.productName || "未命名脚本",
    sections
  });
}
