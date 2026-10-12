import { denyIfUnauthenticated } from "@/lib/auth/guard";
import { NextResponse } from "next/server";
import { callReplicaText } from "@/lib/replica-ai";

export const runtime = "nodejs";
export const maxDuration = 120;

export async function POST(request: Request) {
  const deny = await denyIfUnauthenticated(request);
  if (deny) return deny;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ success: false, message: "请求体必须是合法 JSON。" }, { status: 400 });
  }
  const input = body && typeof body === "object" ? body as Record<string, unknown> : {};
  const prompt = stringValue(input.prompt);
  const instruction = stringValue(input.instruction);
  if (!prompt || !instruction) return NextResponse.json({ success: false, message: "请先输入要修改的要求。" }, { status: 400 });

  try {
    const revised = await callReplicaText({
      route: "replica_prompt_refine",
      system: [
        "你是高还原复刻提示词编辑器。用户要修改的是一份可执行 Prompt，不是分析报告。",
        "只根据用户要求修改，保留所有原有 GLOBAL CONSTRAINTS、LOCK、时间戳、SHOT、BODY MOTION、FACIAL EXPRESSION & GAZE、BLOCKING、DIALOGUE、AUDIO、ENVIRONMENT、CONTINUITY 和 PRODUCT REPLACEMENT；不能因为润色而删减镜头或降低还原度。",
        "输出完整修改后的 Prompt，不要解释、不要 Markdown 代码围栏。"
      ].join("\n"),
      user: `【当前 Prompt】\n${prompt}\n\n【用户修改要求】\n${instruction}`,
      temperature: 0.1,
      maxTokens: Math.min(80000, Math.max(24000, Math.ceil(prompt.length * 1.2)))
    });
    const requiredMarkers = ["GLOBAL CONSTRAINTS", "PRODUCT REPLACEMENT", "BODY MOTION", "BLOCKING", "CONTINUITY"];
    if (revised.length < Math.floor(prompt.length * 0.85) || requiredMarkers.some((marker) => !revised.includes(marker))) {
      throw new Error("AI 修改结果缺失镜头或连续性细节，本轮改为在原 Prompt 末尾保留修改要求。");
    }
    return NextResponse.json({ success: true, source: "deepseek", prompt: revised });
  } catch (error) {
    const fallback = `${prompt}\n\nUSER REFINEMENT（待生成模型执行）：${instruction}`;
    return NextResponse.json({ success: true, source: "fallback", prompt: fallback, message: error instanceof Error ? error.message : "AI 暂不可用，已将修改要求保留在 Prompt 末尾。" });
  }
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}
