/**
 * Director 内部能力表（§13）。
 *
 * 外部 Agent 的工具名一律先经 tool-mapping 映射到这里的能力 ID，
 * Skill Runtime 只按能力 ID 决定「能不能跑 / 用哪个 adapter 跑」。
 */

export type SkillCapabilityId =
  | "file.read"
  | "file.write"
  | "document.read"
  | "document.parse"
  | "web.search"
  | "web.fetch"
  | "image.generate"
  | "image.analyze"
  | "model.text"
  | "model.vision"
  | "shell.run"
  | "python.run"
  | "node.run"
  | "http.request"
  | "asset.read"
  | "asset.write"
  | "product.read"
  | "knowledge.search";

export interface SkillCapabilityDefinition {
  id: SkillCapabilityId;
  label: string;
  description: string;
  /** 适配器 ID，null 表示本阶段没有实现。 */
  adapter: string | null;
  /** 本阶段是否可用（可传函数，按环境动态判断）。 */
  available: boolean | (() => boolean);
  /** 复用的项目现有能力，便于开发者理解为什么它是可用的。 */
  reuses?: string;
}

import { isRouteConfigured } from "@/lib/copywriting-service";

function hasTextModel() {
  return isRouteConfigured("skill_verify");
}

export const skillCapabilities: SkillCapabilityDefinition[] = [
  {
    id: "file.read",
    label: "读取文件",
    description: "在 Skill 沙箱与已导入的原始文件范围内读取文本文件。",
    adapter: "sandbox-file-read",
    available: true
  },
  {
    id: "file.write",
    label: "写入文件",
    description: "写入 Skill 自己的工作目录（不影响项目文件）。",
    adapter: "sandbox-file-write",
    available: true
  },
  {
    id: "document.read",
    label: "读取文档",
    description: "读取 Markdown / 文本 / JSON / YAML 等文档内容。",
    adapter: "document-read",
    available: true
  },
  {
    id: "document.parse",
    label: "解析文档结构",
    description: "把文档切分成段落 / 标题结构后再交给模型。",
    adapter: "document-parse",
    available: true
  },
  {
    id: "model.text",
    label: "文本模型",
    description: "调用当前 AI 对话已配置的文本模型。",
    adapter: "deepseek-text",
    available: hasTextModel,
    reuses: "src/lib/deepseek.ts"
  },
  {
    id: "python.run",
    label: "运行 Python",
    description: "在 Skill 独立的 Python 隔离环境中执行脚本。",
    adapter: "python-isolated",
    available: true
  },
  {
    id: "node.run",
    label: "运行 Node",
    description: "在 Skill 独立的 node_modules 环境中执行脚本。",
    adapter: "node-isolated",
    available: true
  },
  {
    id: "shell.run",
    label: "运行 Shell",
    description: "在受限工作目录内执行必要命令（危险命令会被阻止）。",
    adapter: "shell-guarded",
    available: true
  },
  {
    id: "http.request",
    label: "发起网络请求",
    description: "访问外部 HTTP 接口（需要 Skill 明确声明）。",
    adapter: "http-request",
    available: true
  },
  {
    id: "asset.read",
    label: "读取资产",
    description: "读取 Director 资产库内容。",
    adapter: null,
    available: false
  },
  {
    id: "asset.write",
    label: "写入资产",
    description: "把 Skill 产出写回资产库。",
    adapter: null,
    available: false
  },
  {
    id: "product.read",
    label: "读取产品资料",
    description: "读取产品资料库内容。",
    adapter: null,
    available: false
  },
  {
    id: "knowledge.search",
    label: "知识库检索",
    description: "在资料库 / 知识库中检索。",
    adapter: null,
    available: false
  },
  {
    id: "web.search",
    label: "网页搜索",
    description: "联网搜索（本阶段未接入搜索服务商）。",
    adapter: null,
    available: false
  },
  {
    id: "web.fetch",
    label: "抓取网页",
    description: "抓取指定网页内容（本阶段未接入抓取服务）。",
    adapter: null,
    available: false
  },
  {
    id: "image.generate",
    label: "生成图片",
    description: "调用项目现有生图能力（本阶段仅登记能力，不自动执行）。",
    adapter: null,
    available: false,
    reuses: "src/lib/commerce-image-runner.ts"
  },
  {
    id: "image.analyze",
    label: "理解图片",
    description: "图片理解（当前模型不支持视觉输入）。",
    adapter: null,
    available: false
  },
  {
    id: "model.vision",
    label: "视觉模型",
    description: "支持图片输入的模型能力。",
    adapter: null,
    available: false
  }
];

const capabilityIndex = new Map<string, SkillCapabilityDefinition>(skillCapabilities.map((item) => [item.id, item]));

export function getSkillCapability(id: string) {
  return capabilityIndex.get(id) || null;
}

export function isCapabilityAvailable(id: string) {
  const capability = capabilityIndex.get(id);
  if (!capability) return false;
  return typeof capability.available === "function" ? capability.available() : capability.available;
}

export function listAvailableCapabilities() {
  return skillCapabilities.filter((item) => (typeof item.available === "function" ? item.available() : item.available));
}

export function listUnavailableCapabilities() {
  return skillCapabilities.filter((item) => !(typeof item.available === "function" ? item.available() : item.available));
}

export function isKnownCapability(id: string) {
  return capabilityIndex.has(id);
}
