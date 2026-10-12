import {
  describeRoute,
  generateJsonByRoute,
  generateTextByRoute,
  type ProtocolMessage
} from "@/lib/model-router";

/**
 * 文本生成门面（历史名字 CopywritingService，现在覆盖全站所有文本输出）。
 *
 * 这里不再有任何模型名 / Base URL / API Key：
 * 只把业务 Route 交给中央 Model Router，具体用哪个模型由 config/model-routing.yaml 决定。
 *
 * Route 清单见 config/model-routing.yaml；业务代码里出现的字符串都是 routeKey。
 */

export type CopywritingSource = "route" | "fallback";

export interface CopywritingRequest {
  /** 业务 Route（= config/model-routing.yaml 里的 key） */
  purpose: string;
  system: string;
  user?: string;
  messages?: ProtocolMessage[];
  temperature?: number;
  maxTokens?: number;
  signal?: AbortSignal;
}

export interface CopywritingTextResult {
  text: string;
  source: CopywritingSource;
  modelAlias: string;
  modelId: string;
  provider: string;
}

export interface CopywritingJsonResult<T> extends CopywritingTextResult {
  value: T;
}

/** 某个 Route 当前需要的 API Key 是否已配置（不影响其它 Route）。 */
export function isRouteConfigured(routeKey: string) {
  return describeRoute(routeKey).configured;
}

function toRouterOptions(request: CopywritingRequest) {
  return {
    routeKey: request.purpose,
    system: request.system,
    user: request.user,
    messages: request.messages,
    temperature: request.temperature,
    maxTokens: request.maxTokens,
    signal: request.signal
  };
}

export async function generateCopywritingText(request: CopywritingRequest): Promise<CopywritingTextResult> {
  const result = await generateTextByRoute(toRouterOptions(request));
  return {
    text: result.text,
    source: result.source,
    modelAlias: result.modelAlias,
    modelId: result.modelId,
    provider: result.provider
  };
}

export async function generateCopywritingJson<T>(request: CopywritingRequest): Promise<CopywritingJsonResult<T>> {
  const result = await generateJsonByRoute<T>(toRouterOptions(request));
  return {
    text: result.text,
    value: result.value,
    source: result.source,
    modelAlias: result.modelAlias,
    modelId: result.modelId,
    provider: result.provider
  };
}
