import OpenAI from "openai";
import { findModel, findProvider, resolveProvider } from "@/lib/model-router/config";

/**
 * DeepSeek 客户端（底层）。
 *
 * 只被两类调用者使用：
 * 1. 爆款复刻模块 —— 按需求继续全程使用 DeepSeek；
 * 2. 其它文本 Route 在配置了 fallback 时的兜底（由 Model Router 触发）。
 *
 * 模型 id / Base URL / API Key 全部来自 config/models.yaml 的 "deepseek" Provider，
 * 这里不再硬编码模型名，也不再读取 DEEPSEEK_MODEL。
 */

/** 当前 DeepSeek Provider 上被注册为默认文本兜底的模型 id。 */
export function deepseekModelId() {
  return findModel("deepseek_v4_flash").modelId;
}

export function deepseekClient() {
  const provider = resolveProvider(findProvider(findModel("deepseek_v4_flash").provider));
  if (!provider.apiKey) {
    throw new Error(`未配置 ${provider.apiKeyEnv || "DEEPSEEK_API_KEY"}。请在 .env.local 中填写后重启应用。`);
  }
  return new OpenAI({ apiKey: provider.apiKey, baseURL: provider.baseUrl });
}
