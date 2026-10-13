export const capabilityLabels = { text: "文字", vision: "看图", speech_to_text: "语音转写", image_generation: "生图" } as const;
export type SetupCapability = keyof typeof capabilityLabels;
export type ConnectionProtocol = "openai_compatible" | "anthropic_compatible";
export type ModelKind = "text" | "vision" | "audio_chat" | "audio_transcriptions" | "image_openai" | "image_seedream";
export const kindCapabilities: Record<ModelKind, SetupCapability> = { text: "text", vision: "vision", audio_chat: "speech_to_text", audio_transcriptions: "speech_to_text", image_openai: "image_generation", image_seedream: "image_generation" };
export const kindLabels: Record<ModelKind, string> = { text: "文字（对话、脚本、选题等共用）", vision: "看图（OpenAI 兼容接口）", audio_chat: "语音转写（音频对话接口）", audio_transcriptions: "语音转写（音频转写接口）", image_openai: "生图（OpenAI Images 兼容接口）", image_seedream: "生图（火山 Seedream 接口）" };
export interface PublicConnection { id: string; name: string; baseUrl: string; protocol: ConnectionProtocol; configured: boolean }
export interface PublicSetupModel { alias: string; label: string; modelId: string; connectionId?: string; kind?: ModelKind; capabilities: string[]; configured: boolean; verifiedAt?: string }
export interface ApiSetupSummary {
  revision: string;
  connections: PublicConnection[];
  models: PublicSetupModel[];
  defaults: Partial<Record<SetupCapability, string>>;
  overrides: Record<string, string>;
  presets: { name: string; baseUrl: string; protocol: ConnectionProtocol }[];
  routes: { key: string; label: string; capability: string; alias: string; modelId: string; configured: boolean }[];
}
