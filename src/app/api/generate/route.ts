import { denyIfUnauthenticated } from "@/lib/auth/guard";
import { NextResponse } from "next/server";
import {
  generateWithDeepSeek,
  getDeepSeekErrorMessage,
  routeKeyForGenerateType,
  type GenerateType
} from "@/lib/deepseek";
import type { ToolInput } from "@/lib/generators";
import { isRouteConfigured } from "@/lib/copywriting-service";

const allowedTypes = new Set<GenerateType>(["topic", "script", "interview", "deconstruction", "editing", "link_deconstruction_rewrite"]);

export async function POST(request: Request) {
  const deny = await denyIfUnauthenticated(request);
  if (deny) return deny;
  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "请求体必须是合法 JSON" }, { status: 400 });
  }

  const parsed = parseGenerateBody(body);

  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }

  if (!isRouteConfigured(routeKeyForGenerateType(parsed.type))) {
    return NextResponse.json(
      { error: "当前未配置文本模型接口密钥（TEAMOROUTER_API_KEY 或 DEEPSEEK_API_KEY）" },
      { status: 500 }
    );
  }

  try {
    const content = await generateWithDeepSeek({
      type: parsed.type,
      input: parsed.input
    });

    return NextResponse.json({ content, source: "route", route: routeKeyForGenerateType(parsed.type) });
  } catch (error) {
    return NextResponse.json(
      { error: getDeepSeekErrorMessage(error) },
      { status: 502 }
    );
  }
}

function parseGenerateBody(body: unknown):
  | { ok: true; type: GenerateType; input: ToolInput }
  | { ok: false; error: string } {
  if (!body || typeof body !== "object") {
    return { ok: false, error: "请求参数不能为空" };
  }

  const record = body as Record<string, unknown>;
  const type = record.type;
  const input = record.input;

  if (typeof type !== "string" || !allowedTypes.has(type as GenerateType)) {
    return { ok: false, error: "type 不合法，只能是 topic、script、interview、deconstruction、editing、link_deconstruction_rewrite" };
  }

  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return { ok: false, error: "input 必须是对象" };
  }

  const normalizedInput = normalizeInput(input as Record<string, unknown>);

  if (!hasMeaningfulUserInput(normalizedInput)) {
    return { ok: false, error: "请先补充必要输入，再生成内容" };
  }

  return {
    ok: true,
    type: type as GenerateType,
    input: normalizedInput
  };
}

function normalizeInput(input: Record<string, unknown>): ToolInput {
  const normalized: ToolInput = {};

  for (const [key, value] of Object.entries(input)) {
    if (typeof value === "string") {
      normalized[key] = value;
    }

    if (Array.isArray(value)) {
      normalized[key] = value.filter((item): item is string => typeof item === "string");
    }
  }

  return normalized;
}

function hasMeaningfulUserInput(input: ToolInput) {
  return Object.entries(input).some(([key, value]) => {
    if (["purpose", "direction", "scriptType", "videoType"].includes(key)) {
      return false;
    }

    if (Array.isArray(value)) {
      return value.length > 0;
    }

    return value.trim().length > 0;
  });
}
