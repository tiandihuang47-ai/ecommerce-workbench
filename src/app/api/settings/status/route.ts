import { denyIfUnauthenticated } from "@/lib/auth/guard";
import { NextResponse } from "next/server";
import { describeRoute, isProviderConfigured } from "@/lib/model-router";
import {
  AI_CHAT_BASE_URL,
  AI_CHAT_MODEL_ID,
  AI_CHAT_PROVIDER_LABEL,
  isAiChatConfigured
} from "@/lib/opus-chat-service";

export async function GET(request: Request) {
  const deny = await denyIfUnauthenticated(request);
  if (deny) return deny;
  return NextResponse.json({
    success: true,
    deepseekConfigured: isProviderConfigured("deepseek"),
    deepseekModel: describeRoute("replica_dialogue_adaptation").modelId,
    // AI 对话专用模型（模块级绑定：只有 AI 对话走这里，其他模块不受影响）
    aiChatConfigured: isAiChatConfigured(),
    aiChatModel: AI_CHAT_MODEL_ID,
    aiChatProvider: AI_CHAT_PROVIDER_LABEL,
    aiChatBaseUrl: AI_CHAT_BASE_URL,
    // 语音转写与视觉理解都走火山方舟（豆包），不再有阿里云通道。
    arkConfigured: isProviderConfigured("ark"),
    speechModel: describeRoute("speech_to_text").modelId,
    visionModel: describeRoute("video_understanding").modelId,
  });
}
