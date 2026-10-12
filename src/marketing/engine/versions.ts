/**
 * 营销生图引擎 · 版本号
 *
 * 每个关键能力一个版本；每个生成任务都会记录当时使用的版本，
 * 以后改规则先升版本号，再比较新旧效果，可以快速回退。
 */
export const MARKETING_ENGINE_VERSION = "v1";

export const MARKETING_LAYER_VERSIONS = {
  productTruth: "v1",
  intent: "v1",
  strategy: "v1",
  platform: "v1",
  copy: "v1",
  creative: "v1",
  productFidelity: "v1",
  typography: "v1",
  promptCompiler: "v1",
  qa: "v1"
} as const;
