import type {
  CommerceImageModel,
  CommerceImageQuality,
  CommerceImageRatio,
  CommerceImageOutputRatio,
  CommerceImageSize,
  CommerceImageTaskKind,
  ResolvedCommerceImageModel
} from "@/lib/commerce-image-types";

export const commerceImageModelRegistry: Record<ResolvedCommerceImageModel, {
  id: ResolvedCommerceImageModel;
  label: string;
  shortLabel: string;
  provider: "seedream" | "openai" | "openai_v25" | "configured";
  description: string;
  maxReferenceImages: number;
  lastVerifiedAt: string;
  /** Official quality/resolution tiers supported by this model. */
  qualityOptions: Array<{ value: CommerceImageQuality; label: string; description: string; sizeMultiplier: number }>;
}> = {
  configured: {
    id: "configured", label: "我的默认生图模型", shortLabel: "我的生图模型", provider: "configured",
    description: "使用设置中选择的生图 API 和模型", maxReferenceImages: 8, lastVerifiedAt: "",
    qualityOptions: [{ value: "standard", label: "标准", description: "由已配置的模型生成", sizeMultiplier: 1 }, { value: "high", label: "高清", description: "由已配置的模型生成", sizeMultiplier: 1 }]
  },
  "doubao-seedream-5-0-260128": {
    id: "doubao-seedream-5-0-260128",
    label: "豆包 Seedream 5.0（旗舰）",
    shortLabel: "Seedream 5.0",
    provider: "seedream",
    description: "多图参考、场景生成和成套视觉一致性强",
    maxReferenceImages: 10,
    lastVerifiedAt: "2026-08-31",
    qualityOptions: [
      { value: "standard", label: "标准（1K）", description: "1024px 级别", sizeMultiplier: 1 },
      { value: "high", label: "高清（2K）", description: "2048px 级别", sizeMultiplier: 1.5 },
      { value: "ultra", label: "超清（4K）", description: "4096px 级别", sizeMultiplier: 2 }
    ]
  },
  "doubao-seedream-5-0-pro-260628": {
    id: "doubao-seedream-5-0-pro-260628",
    label: "豆包 Seedream 5.0 Pro",
    shortLabel: "Seedream 5.0 Pro",
    provider: "seedream",
    description: "多图参考、商品一致性和可控编辑能力强",
    maxReferenceImages: 10,
    lastVerifiedAt: "2026-09-03",
    qualityOptions: [
      { value: "standard", label: "标准（1K）", description: "1024px 级别", sizeMultiplier: 1 },
      { value: "high", label: "高清（2K）", description: "2048px 级别", sizeMultiplier: 1.5 },
      { value: "ultra", label: "超清（4K）", description: "4096px 级别", sizeMultiplier: 2 }
    ]
  },
  "gpt-image-2": {
    id: "gpt-image-2",
    label: "GPT Image 2",
    shortLabel: "GPT Image 2",
    provider: "openai",
    description: "高保真参考图输入、生成与局部编辑",
    maxReferenceImages: 8,
    lastVerifiedAt: "2026-08-31",
    qualityOptions: [
      { value: "standard", label: "标准", description: "quality: standard", sizeMultiplier: 1 },
      { value: "high", label: "高清（HD）", description: "quality: hd", sizeMultiplier: 1.3 }
    ]
  },
  "gpt-image-2.5": {
    id: "gpt-image-2.5",
    label: "GPT Image 2.5（Sunburst，较慢）",
    shortLabel: "GPT Image 2.5",
    provider: "openai_v25",
    description: "画面质量高但单张耗时明显更长（常见 1-2 分钟），追求速度时建议用自动推荐",
    maxReferenceImages: 8,
    lastVerifiedAt: "2026-09-10",
    qualityOptions: [
      { value: "standard", label: "标准", description: "3:4 请求 1536 × 2048 · quality: medium", sizeMultiplier: 1 },
      { value: "high", label: "高清", description: "3:4 请求 1536 × 2048 · quality: high", sizeMultiplier: 1 },
      /* 实测（2026-09-28 真机请求）：该通道按总像素限幅 ≤ 8,294,400（4K UHD），
       * 逐比例的最大严格尺寸见 commerceImageCanonicalSizes 的 ultra 列；
       * 3:4 → 2448×3264（7.99MP）、9:16 → 2160×3840（8.29MP）实测原生达标，55-71 秒。 */
      { value: "ultra", label: "超清（4K）", description: "3:4 请求 2448 × 3264 · 9:16 请求 2160 × 3840（实测原生达标）", sizeMultiplier: 1.5 }
    ]
  }
};

/**
 * 连接层 Provider → UI 模型注册表键。
 * openai_v25 的 UI 键（gpt-image-2.5）与真实 Provider model_id（config/models.yaml）刻意分离：
 * 换中转站只改 models.yaml 的 model_id，UI 注册表键与界面保持不变。
 */
export function commerceImageRegistryModelForProvider(provider: "seedream" | "openai" | "openai_v25" | "configured"): ResolvedCommerceImageModel {
  if (provider === "configured") return "configured";
  if (provider === "openai_v25") return "gpt-image-2.5";
  if (provider === "openai") return "gpt-image-2";
  return "doubao-seedream-5-0-pro-260628";
}

/**
 * 生图默认模型：GPT Image 2.5（Direct Mode 直连）。
 * 新建任务、任务里没写模型、以及历史遗留的「自动推荐」都统一成它——
 * 直接对话生图本来就以 GPT Image 2.5 为目标模型，「自动推荐」在部分机器上会
 * 因为环境里存在其它厂商 Key 而解析到别的通道。
 */
export const DEFAULT_COMMERCE_IMAGE_MODEL: CommerceImageModel = "gpt-image-2.5";

/** 各类型新建任务的默认张数：电商图文 / 抖音图文默认 1 张，其余保持原有默认。 */
export const commerceImageDefaultCardCount: Record<CommerceImageTaskKind, number> = {
  detail_page: 6,
  douyin_post: 1,
  xiaohongshu_post: 1,
  retouch: 1,
  free_chat: 1
};

/**
 * 生图界面「自动推荐」时用于估算参考图张数的默认档位。
 * 真正的默认模型由 config/model-routing.yaml 的 image_generation 决定；
 * 这里只是 UI 提示，属于 MODEL_ROUTING.md 登记过的例外。
 */
export const defaultCommerceImageModelId = "doubao-seedream-5-0-pro-260628";

export const commerceImageModelOptions: Array<{ value: CommerceImageModel; label: string; description: string }> = [
  { value: "auto", label: "自动推荐", description: "根据任务和已配置模型选择，并显示实际模型" },
  ...Object.values(commerceImageModelRegistry).filter((item) => item.id !== "doubao-seedream-5-0-260128").map((item) => ({
    value: item.id,
    label: item.label,
    description: item.description
  }))
];

export const commerceImageRatioOrder: CommerceImageRatio[] = ["1:1", "3:4", "9:16", "2:3", "3:2", "4:3", "16:9"];

export const commerceImageRatioSizes: Record<CommerceImageRatio, CommerceImageSize> = {
  "3:4": { width: 1536, height: 2048, label: "1536 × 2048" },
  "4:3": { width: 2048, height: 1536, label: "2048 × 1536" },
  "16:9": { width: 2048, height: 1152, label: "2048 × 1152" },
  "9:16": { width: 1152, height: 2048, label: "1152 × 2048" },
  "2:3": { width: 1360, height: 2040, label: "1360 × 2040" },
  "3:2": { width: 2040, height: 1360, label: "2040 × 1360" },
  "1:1": { width: 2048, height: 2048, label: "2048 × 2048" }
};

export const commerceImageTaskLabels: Record<CommerceImageTaskKind, { title: string; description: string; defaultRatio: CommerceImageRatio }> = {
  detail_page: { title: "电商详情页", description: "按模块生成商品卖点图，并导出切片与长图", defaultRatio: "3:4" },
  douyin_post: { title: "抖音图文", description: "封面、多页正文、标题、正文和标签", defaultRatio: "9:16" },
  xiaohongshu_post: { title: "电商图文", description: "围绕卖点与传播逻辑的多页电商图文", defaultRatio: "9:16" },
  retouch: { title: "商品修图", description: "白底、换场景、去杂物、调光和批量统一", defaultRatio: "1:1" },
  free_chat: { title: "自然对话生图", description: "像 GPT 网页生图一样直接对话，文字原样交给 GPT Image 2.5 生成", defaultRatio: "1:1" }
};

export function isCommerceImageRatio(value: unknown): value is CommerceImageRatio {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(commerceImageRatioSizes, value);
}

export function isCommerceImageOutputRatio(value: unknown): value is CommerceImageOutputRatio {
  return value === "original" || isCommerceImageRatio(value);
}

export function isResolvedCommerceImageModel(value: unknown): value is ResolvedCommerceImageModel {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(commerceImageModelRegistry, value);
}

export function isCommerceImageModel(value: unknown): value is CommerceImageModel {
  return value === "auto" || isResolvedCommerceImageModel(value);
}

export function ratioCssSize(ratio: CommerceImageRatio, max = 28) {
  const { width, height } = commerceImageRatioSizes[ratio];
  const scale = max / Math.max(width, height);
  return { width: Math.max(10, Math.round(width * scale)), height: Math.max(10, Math.round(height * scale)) };
}

/**
 * 真正发给 Provider 的尺寸。
 *
 * seedream 的适配器自己会按清晰度换算（×1／×1.5／×2），openai 走官方尺寸映射，
 * 只有 GPT Image 2.5（中转站通道）此前把基础尺寸原样发出去，导致「选了 4K 仍请求 1536×2048」。
 * 这里给该通道补上与其它通道同构的分档：
 *   - 标准 / 高清：长边 2048（= 该通道实测可原生达标的 2K，与历史请求完全一致，不改默认输出）
 *   - 超清（4K）：长边 4096，边长取 16 的倍数，最大 4096
 * 只做「不小于基础尺寸」的放大请求，绝不把基础尺寸改小。
 */
/**
 * 严格比例表：比例 × 清晰度档 → 精确输出像素。
 *
 * 硬约束：**宽高必须严格成比例**（例如 9:16 只能 1152×2048，不能 1152×2049 或 1360×2048），
 * 且两边都是 8 的倍数（避免编码器/上游对奇数边长做奇怪处理）。
 * 每档都取「不超过该档长边目标」的最大合法组合，所以：
 *   1:1  1024/2048/3072 边长
 *   9:16 长边 1024/2048/3072
 *   2:3  长边 1008/2040/3072（16 倍长边做不到严格 2:3，取最近的严格组合）
 * 这张表是唯一真源：UI 显示的「实际请求 W×H」、发给 Provider 的 size、结果校验都用它。
 */
export const commerceImageCanonicalSizes: Record<CommerceImageRatio, Record<CommerceImageQuality, CommerceImageSize>> = {
  "1:1": {
    standard: { width: 1024, height: 1024, label: "1024 × 1024" },
    high: { width: 2048, height: 2048, label: "2048 × 2048" },
    ultra: { width: 2880, height: 2880, label: "2880 × 2880" }
  },
  "3:4": {
    standard: { width: 768, height: 1024, label: "768 × 1024" },
    high: { width: 1536, height: 2048, label: "1536 × 2048" },
    ultra: { width: 2448, height: 3264, label: "2448 × 3264" }
  },
  "9:16": {
    standard: { width: 576, height: 1024, label: "576 × 1024" },
    high: { width: 1152, height: 2048, label: "1152 × 2048" },
    ultra: { width: 2160, height: 3840, label: "2160 × 3840" }
  },
  "2:3": {
    standard: { width: 672, height: 1008, label: "672 × 1008" },
    high: { width: 1360, height: 2040, label: "1360 × 2040" },
    ultra: { width: 2304, height: 3456, label: "2304 × 3456" }
  },
  "3:2": {
    standard: { width: 1008, height: 672, label: "1008 × 672" },
    high: { width: 2040, height: 1360, label: "2040 × 1360" },
    ultra: { width: 3456, height: 2304, label: "3456 × 2304" }
  },
  "4:3": {
    standard: { width: 1024, height: 768, label: "1024 × 768" },
    high: { width: 2048, height: 1536, label: "2048 × 1536" },
    ultra: { width: 3264, height: 2448, label: "3264 × 2448" }
  },
  "16:9": {
    standard: { width: 1024, height: 576, label: "1024 × 576" },
    high: { width: 2048, height: 1152, label: "2048 × 1152" },
    ultra: { width: 3840, height: 2160, label: "3840 × 2160" }
  }
};

/** 严格比例尺寸：UI 与请求都走这一个函数，避免出现两套数字。 */
export function resolveCanonicalCommerceImageSize(
  ratio: CommerceImageRatio,
  quality: CommerceImageQuality = "high"
): CommerceImageSize {
  return commerceImageCanonicalSizes[ratio]?.[quality] || commerceImageRatioSizes[ratio];
}

/** 判断宽高是否严格等于该比例（交叉相乘，整数比较，不做浮点近似）。 */
export function matchesCommerceImageRatio(ratio: string, width: number, height: number): boolean {
  if (!width || !height) return false;
  const parts = ratio.split(":");
  if (parts.length !== 2) return false;
  const [rawW, rawH] = parts.map((part) => Number.parseInt(part, 10));
  if (!Number.isFinite(rawW) || !Number.isFinite(rawH) || rawW <= 0 || rawH <= 0) return false;
  return width * rawH === height * rawW;
}

/**
 * GPT Image 2.5（中转站通道）清晰度分档 → 画面长边像素。
 *
 * 真机实测（2026-09-28，OriginGateway · gpt-image-2.5-sunburst-4k）：
 *   上游按「总像素」限幅：≤ 8,294,400（恰好 4K UHD 像素量）原样返回，实测
 *   2160×3840、2880×2880、2464×3280 均原生达标（55-71 秒）；
 *   总像素 ≥ 9.4MP 一律 400 拒绝（2304×4096、3072×4096、2560×3840、3840×3840）。
 *   结论：长边 4096 不可用；超清档 = 「严格比例 + 边长 16 倍数 + 总像素 ≤ 8,294,400」
 *   的最大组合，逐比例写在 commerceImageCanonicalSizes 的 ultra 列（唯一真源）。
 * 所以：
 *   1K = 长边 1024（标准）
 *   2K = 长边 2048（高清）
 *   4K = 各比例取上述上限（超清；不再按统一长边换算）
 * 界面上的 1K/2K/4K 与这里一一对应，面板里显示的就是真实请求像素。
 */
export const COMMERCE_IMAGE_V25_LONG_EDGES: Record<CommerceImageQuality, number> = {
  standard: 1024,
  high: 2048,
  /** 仅作展示参考；ultra 档由 commerceImageCanonicalSizes 按比例给出，不再统一换算。 */
  ultra: 3840
};
/** @deprecated 保留旧名字给外部引用；等于 4K 档长边。 */
export const COMMERCE_IMAGE_V25_ULTRA_LONG_EDGE = COMMERCE_IMAGE_V25_LONG_EDGES.ultra;

export function commerceImageRequestSize(
  provider: "seedream" | "openai" | "openai_v25" | "configured",
  size: CommerceImageSize,
  quality: CommerceImageQuality = "high"
): CommerceImageSize {
  if (provider !== "openai_v25") return size;
  /* 超清档不按统一长边换算：上游限制总像素 ≤ 8,294,400，各比例的最大严格尺寸
   * 已由 commerceImageCanonicalSizes 的 ultra 列给出，原样发送，避免被放大到 400 拒绝。 */
  if (quality === "ultra") return size;
  const target = COMMERCE_IMAGE_V25_LONG_EDGES[quality] || COMMERCE_IMAGE_V25_LONG_EDGES.high;
  const long = Math.max(size.width, size.height);
  if (target === long) return size;
  /* 1K 档比比例基准小：按比例缩到长边 1024（边长取 16 的倍数）。 */
  if (target < long) {
    const shrink = target / long;
    const width = Math.max(16, Math.round((size.width * shrink) / 16) * 16);
    const height = Math.max(16, Math.round((size.height * shrink) / 16) * 16);
    return { width, height, label: `${width} × ${height}` };
  }
  const scale = target / long;
  const width = Math.min(4096, Math.max(16, Math.round((size.width * scale) / 16) * 16));
  const height = Math.min(4096, Math.max(16, Math.round((size.height * scale) / 16) * 16));
  return { width, height, label: `${width} × ${height}` };
}

export function commerceImageRequestSizeForModel(
  model: ResolvedCommerceImageModel,
  size: CommerceImageSize,
  quality: CommerceImageQuality = "high"
): CommerceImageSize {
  const provider = commerceImageModelRegistry[model]?.provider;
  return provider ? commerceImageRequestSize(provider, size, quality) : size;
}

export function resolveCommerceImageSize(ratio: CommerceImageOutputRatio, original?: { width: number; height: number }) {
  if (ratio !== "original") return commerceImageRatioSizes[ratio];
  if (!original || original.width <= 0 || original.height <= 0) return commerceImageRatioSizes["1:1"];
  const scale = Math.min(1, 2048 / Math.max(original.width, original.height));
  const width = Math.max(16, Math.round((original.width * scale) / 16) * 16);
  const height = Math.max(16, Math.round((original.height * scale) / 16) * 16);
  return { width, height, label: `${width} × ${height}` };
}
