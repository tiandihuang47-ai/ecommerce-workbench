import { adminGuardFailure, originMismatchForRequest, requireAdminFromRequest, forbidden } from "@/lib/auth/guard";
import { generateJsonByRoute, generateVisionJsonByRoute, requestAudioByRoute } from "@/lib/model-router";
import { discoverSetupModels, getApiSetupSummary, markSetupVerified, redactSetupError, saveSetupAssignments, saveSetupConnection, SetupError, verificationRoute } from "@/lib/model-router/settings";
import { verifyCommerceImageProvider } from "@/lib/commerce-image-provider";
import { readImageMetadata } from "@/lib/commerce-image-file";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;
async function deny(request: Request) {
  if (originMismatchForRequest(request)) return forbidden();
  return adminGuardFailure(await requireAdminFromRequest(request));
}
export async function GET(request: Request) {
  const failure = await deny(request); if (failure) return failure;
  try { return Response.json({ success: true, ...getApiSetupSummary() }, { headers: { "Cache-Control": "no-store" } }); }
  catch (e) { return fail(e); }
}
export async function POST(request: Request) {
  const failure = await deny(request); if (failure) return failure;
  try {
    const raw = await request.text();
    if (raw.length > 1500000) throw new SetupError("配置请求过大；验证音频请使用 1MB 以内的文件。", 413);
    let body;
    try { body = JSON.parse(raw); }
    catch { throw new SetupError("配置请求格式不正确，请刷新后重试。"); }
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new SetupError("无效的配置请求。");
    if (body.action === "discover") return Response.json({ success: true, models: await discoverSetupModels(body) });
    if (body.action === "connect") return Response.json({ success: true, ...saveSetupConnection(body) });
    if (body.action === "assign") return Response.json({ success: true, ...saveSetupAssignments(body) });
    if (body.action === "verify") {
      const summary = getApiSetupSummary();
      if (summary.revision !== body.revision) throw new SetupError("配置已变化，请刷新后重试。", 409);
      if (!summary.models.some((m) => m.alias === body.alias && m.connectionId)) throw new SetupError("请选择新增的 API 模型进行验证。");
      const route = verificationRoute(body.alias);
      if (route.capability === "text") {
        const result = await generateJsonByRoute<{ ok: boolean }>({ routeKey: route.key, system: '连接测试，只返回 JSON：{"ok":true}', user: "确认接口可正常返回 JSON。", maxTokens: 256 });
        if (result.value.ok !== true) throw new SetupError("模型有回复，但未按要求返回 JSON；部分文字功能可能无法使用。", 502);
      } else if (route.capability === "vision") {
        const result = await generateVisionJsonByRoute<{ seen: boolean }>({ routeKey: route.key, system: '看图连接测试。能读到图片时只返回 JSON：{"seen":true}', content: [{ type: "text", text: "这是看图能力验证，请确认你收到图片。" }, { type: "image_url", image_url: { url: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aH1sAAAAASUVORK5CYII=" } }], maxTokens: 256 });
        if (result.value.seen !== true) throw new SetupError("模型没有确认收到图片，请检查模型是否支持看图。", 502);
      } else if (route.capability === "image_generation") {
        const result = await verifyCommerceImageProvider("configured");
        if (!result.bytes.length) throw new SetupError("生图接口没有返回图片。", 502);
        readImageMetadata(result.bytes);
      } else if (route.capability === "speech_to_text") {
        if (typeof body.audioBase64 !== "string" || !["mp3", "wav"].includes(body.audioFormat)) throw new SetupError("请选择 1MB 以内的 MP3 或 WAV 音频，再验证转写。");
        const response = await requestAudioByRoute(Buffer.from(body.audioBase64, "base64"), body.audioFormat);
        if (!response.ok) throw new SetupError(`语音转写接口返回 HTTP ${response.status}，请检查模型权限和接口类型。`, 502);
        const data = await response.json();
        const text = data.text || data.choices?.[0]?.message?.content;
        if (typeof text !== "string" || !text.trim()) throw new SetupError("接口没有返回转写文字，请选择有人声的音频重试。", 502);
      } else throw new SetupError("该能力暂不支持自动验证。");
      return Response.json({ success: true, ...markSetupVerified(body.alias, summary.revision), message: "对应能力已完成一次真实调用验证。" });
    }
    throw new SetupError("无效的配置操作。");
  } catch (e) { return fail(e); }
}
function fail(e: unknown) {
  return Response.json({ success: false, message: redactSetupError(e) }, { status: e instanceof SetupError ? e.status : 400 });
}
