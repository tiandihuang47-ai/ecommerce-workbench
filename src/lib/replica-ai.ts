import { describeRoute, generateTextByRoute, generateVisionJsonByRoute } from "@/lib/model-router";

/**
 * 爆款复刻的模型调用。
 *
 * 按产品要求：爆款复刻**继续全程使用 DeepSeek** —— 这一点现在写在
 * config/model-routing.yaml 的 replica_* 三个 Route 上，业务代码不再硬编码模型。
 * 视频/产品图的视觉理解走 video_understanding / product_image_understanding。
 */

export type ReplicaVisionContent =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string; detail?: "low" | "high" | "auto" } };

export function getReplicaVisionStatus() {
  const described = describeRoute("video_understanding");
  return {
    configured: described.configured,
    model: described.modelId,
    baseUrl: described.provider,
    route: described.routeKey
  };
}

export async function callReplicaVisionJson(options: {
  system: string;
  content: ReplicaVisionContent[];
  temperature?: number;
  maxTokens?: number;
  /** 默认 video_understanding（视频逐帧）；产品图可传 product_image_understanding。 */
  route?: string;
  purpose?: string;
}) {
  const { value } = await generateVisionJsonByRoute<Record<string, unknown>>({
    routeKey: options.route || "video_understanding",
    system: options.system,
    content: options.content,
    temperature: options.temperature,
    maxTokens: options.maxTokens
  });
  return value;
}

export async function callReplicaTextJson(options: {
  system: string;
  user: string;
  temperature?: number;
  maxTokens?: number;
  /** 默认 replica_dialogue_adaptation；自检用 replica_self_check。 */
  route?: string;
}) {
  const { text } = await generateTextByRoute({
    routeKey: options.route || "replica_dialogue_adaptation",
    system: options.system,
    user: options.user,
    temperature: options.temperature,
    maxTokens: options.maxTokens
  });
  return parseLooseJson(text);
}

export async function callReplicaText(options: {
  system: string;
  user: string;
  temperature?: number;
  maxTokens?: number;
  /** 默认 replica_chat；提示词润色用 replica_prompt_refine。 */
  route?: string;
}) {
  const { text } = await generateTextByRoute({
    routeKey: options.route || "replica_chat",
    system: options.system,
    user: options.user,
    temperature: options.temperature,
    maxTokens: options.maxTokens
  });
  return text.trim();
}

export function clipReplicaText(value: unknown, max = 30000) {
  const text = typeof value === "string" ? value.trim() : "";
  return text.length > max ? `${text.slice(0, max)}\n[内容已截断]` : text;
}

export function parseLooseJson<T = Record<string, unknown>>(value: string): T {
  const cleaned = value
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
  try {
    return JSON.parse(cleaned) as T;
  } catch {
    const objectStart = cleaned.indexOf("{");
    const objectEnd = cleaned.lastIndexOf("}");
    if (objectStart >= 0 && objectEnd > objectStart) {
      try {
        return JSON.parse(cleaned.slice(objectStart, objectEnd + 1)) as T;
      } catch {
        throw new Error("模型返回的数据无法解析。");
      }
    }
    throw new Error("模型返回的数据无法解析。");
  }
}
