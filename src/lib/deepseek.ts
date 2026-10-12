import {
  deconstructionRules,
  editingRules,
  knowledgeItems,
  naturalInterviewRules,
  scriptStructureRules,
  storeContentRules,
  viralElementRules
} from "@/data/director-rules";
import type { ToolInput } from "@/lib/generators";
import { deepseekClient } from "@/lib/deepseek-client";
import { generateCopywritingText } from "@/lib/copywriting-service";

/** 兼容旧引用：DeepSeek 客户端现在定义在 @/lib/deepseek-client（连接来自 config/models.yaml）。 */
export { deepseekClient, deepseekModelId } from "@/lib/deepseek-client";

export type GenerateType = "topic" | "script" | "interview" | "deconstruction" | "editing" | "link_deconstruction_rewrite";

const legacyPictureTerm = `b${"roll"}`;

export interface GenerateWithDeepSeekParams {
  type: GenerateType;
  input: ToolInput;
}

export function routeKeyForGenerateType(type: GenerateType) {
  return routeByGenerateType[type];
}

/** 生成类型 → 中央模型路由的 Route Key（换模型只改 config/model-routing.yaml）。 */
const routeByGenerateType: Record<GenerateType, string> = {
  topic: "topic_generation",
  script: "script_generation",
  interview: "interview_generation",
  deconstruction: "deconstruction_analysis",
  editing: "editing_plan",
  link_deconstruction_rewrite: "link_deconstruction_rewrite"
};

const systemPrompts: Record<GenerateType, string> = {
  topic: `
你是抖音短视频爆款选题编导。
你必须基于用户提供的行业、产品/服务、目标人群、内容目的和本地规则库生成内容。
必须使用八大爆款元素：成本、人群、奇葩、最差、反差、怀旧、荷尔蒙、头牌。
输出 10 个选题，每个选题必须包含：
1. 选题标题
2. 使用的爆款元素
3. 适合的脚本类型
4. 开头钩子
5. 为什么这个选题容易吸引人
要求偏实战，能直接拿去拍摄，不要像课堂笔记。
`.trim(),
  script: `
你是抖音电商短视频编导。
你必须基于本地规则库里的教知识、晒过程、聊观点、讲故事结构生成脚本。
输出必须包含：
1. 标题
2. 开头 3 秒钩子
3. 逐字稿
4. 分镜脚本
5. 画中画建议
6. 拍摄建议
7. 结尾引导
8. 自检清单
严禁出现 ${legacyPictureTerm}、B${"roll"}、B-${"roll"} 等词，一律使用“画中画”。
内容要像现场编导给拍摄团队的工作稿，具体、可执行、能直接开拍。
`.trim(),
  interview: `
你是自然流短视频编导。
自然流不是随便聊天，而是编导带着脚本目标，通过提问、追问和切断，引导 IP 说出可剪辑、可传播的内容。
你需要输出：
1. 破冰问题
2. 主线问题
3. 亲密关系提问
4. 负面假设追问
5. 制造对立追问
6. 什么时候追问
7. 什么时候切断
8. 拍摄前检查清单
问题要具体，不要问“你怎么看”这种空问题。
`.trim(),
  deconstruction: `
你是短视频拆片专家。
拆片不是抄原文，而是拆结构、功能、情绪、钩子、广告植入和可迁移点。
你需要输出：
1. 原视频核心
2. 爆款元素
3. 开头钩子
4. 内容结构
5. 情绪变化
6. 成交/广告植入位置
7. 可迁移结构
8. 迁移到用户行业后的新选题
9. 新脚本大纲
不要照搬原视频文案，要把底层骨架迁移到用户行业。
`.trim(),
  link_deconstruction_rewrite: `
你是资深短视频编导和拆片专家，擅长从抖音、快手、视频号、小红书的爆款内容中拆解结构，并迁移成适合用户产品和行业的新脚本。

你必须遵守：
1. 不要直接复制原视频文案。
2. 不要逐句改写原文。
3. 不要做洗稿。
4. 只拆结构、钩子、情绪、节奏、画面逻辑和转化路径。
5. 仿写必须基于用户自己的产品、行业、目标人群和卖点。
6. 输出必须是原创脚本。
7. 严禁出现 ${legacyPictureTerm}、B${"roll"}、B-${"roll"} 等词，一律使用“画中画”。
8. 如果用户提供的信息不足，要明确指出缺失信息，但也要基于已有信息给出可用版本。

输出格式必须结构化 Markdown：

# 拆片结果

## 1. 视频核心主题
## 2. 目标人群
## 3. 开头钩子
## 4. 爆款元素
## 5. 内容结构
## 6. 情绪变化
## 7. 节奏设计
## 8. 画中画/画面辅助逻辑
## 9. 转化路径
## 10. 可迁移结构

# 仿写结果

## 1. 新选题
## 2. 标题
## 3. 开头 3 秒钩子
## 4. 完整口播脚本
## 5. 分镜建议
## 6. 画中画建议
## 7. 拍摄提醒
## 8. 结尾引导
## 9. 延展选题
`.trim(),
  editing: `
你是自然流剪辑编导。
你要根据用户素材判断最适合的剪辑结构，不要按素材原顺序机械排列，要按观众理解顺序重排。
你需要输出：
1. 最适合放开头的一句话
2. 应该删除的无效内容
3. 推荐剪辑顺序
4. 开头方式
5. 中间推进方式
6. 结尾强化方式
7. 成片自检标准
要求判断明确，能指导剪辑师直接动手。
`.trim()
};

/**
 * 供 AI 对话以「会话角色」复用与其他模块完全相同的系统提示词与本地编导规则库。
 * 纯增量导出，不影响原有 generate 流程。
 */
export function getDeepSeekSystemPrompt(type: GenerateType) {
  return systemPrompts[type];
}

export function getDeepSeekRulesContext(type: GenerateType) {
  return buildRulesContext(type);
}

export function buildPromptByType(type: GenerateType, input: ToolInput) {
  const rulesContext = buildRulesContext(type);

  return [
    "请基于以下本地编导规则库和用户输入生成结果。",
    "输出格式：Markdown。请使用清晰标题、编号列表和可复制的话术。",
    "安全要求：不要编造价格、销量、检测报告、明星背书等用户没有提供的事实。",
    `术语要求：如果需要表达辅助画面，一律写“画中画”，不要出现 ${legacyPictureTerm}。`,
    "",
    "【本地规则库】",
    JSON.stringify(rulesContext, null, 2),
    "",
    "【用户输入】",
    JSON.stringify(input, null, 2)
  ].join("\n");
}

export function safeJsonParse<T>(value: string): T | null {
  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}

export function getDeepSeekErrorMessage(error: unknown) {
  if (error instanceof Error) {
    return error.message;
  }

  return "DeepSeek 请求失败，请稍后重试";
}

/**
 * 文本生成统一出口（选题 / 脚本 / 采访 / 拆片 / 剪辑 / 链接拆片）。
 *
 * 主模型走 claude-opus-5-5（TeamoRouter），只有 Opus 不可用时才由 TextGeneration 服务回退 DeepSeek。
 * 爆款复刻不使用本函数（它继续全程走 DeepSeek，见 @/lib/replica-ai）。
 */
export async function generateWithDeepSeek({ type, input }: GenerateWithDeepSeekParams) {
  const systemPrompt = systemPrompts[type];
  const userPrompt = buildPromptByType(type, input);

  const { text } = await generateCopywritingText({
    purpose: routeByGenerateType[type],
    system: systemPrompt,
    user: userPrompt,
    temperature: 0.7
  });

  if (!text.trim()) {
    throw new Error("文本模型没有返回有效内容");
  }

  return text.replace(new RegExp(`\\bb[\\s-]?${"roll"}\\b`, "gi"), "画中画");
}

function buildRulesContext(type: GenerateType) {
  const shared = {
    knowledgeItems,
    storeContentRules
  };

  switch (type) {
    case "topic":
      return {
        viralElementRules,
        scriptStructureRules,
        naturalInterviewRules,
        shared
      };
    case "script":
      return {
        viralElementRules,
        scriptStructureRules,
        editingRules,
        shared
      };
    case "interview":
      return {
        naturalInterviewRules,
        viralElementRules,
        shared
      };
    case "deconstruction":
    case "link_deconstruction_rewrite":
      return {
        deconstructionRules,
        viralElementRules,
        scriptStructureRules,
        editingRules,
        shared
      };
    case "editing":
      return {
        editingRules,
        naturalInterviewRules,
        deconstructionRules,
        shared
      };
  }
}
