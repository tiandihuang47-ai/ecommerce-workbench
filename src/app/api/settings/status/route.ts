import { denyIfUnauthenticated } from "@/lib/auth/guard";
import { NextResponse } from "next/server";
import { describeRoute, resolveRoute } from "@/lib/model-router";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  const deny = await denyIfUnauthenticated(request);
  if (deny) return deny;
  const chat = describeRoute("ai_chat");
  const replica = describeRoute("replica_dialogue_adaptation");
  const speech = describeRoute("speech_to_text");
  const vision = describeRoute("video_understanding");
  const image = resolveRoute("image_generation");
  return NextResponse.json({ success: true, deepseekConfigured: replica.configured, deepseekModel: replica.modelId, aiChatConfigured: chat.configured, aiChatModel: chat.modelId, aiChatProvider: chat.provider, aiChatBaseUrl: resolveRoute("ai_chat").provider.baseUrl, arkConfigured: vision.configured, speechConfigured: speech.configured, speechModel: speech.modelId, visionModel: vision.modelId, customImageDefault: image.provider.connectionStore?.startsWith("local:") ? "configured" : "", imageModel: image.modelId });
}
