import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, mkdir, rm, stat, writeFile } from "node:fs/promises";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import JSZip from "jszip";
import sharp from "sharp";

const root = process.cwd();
const dataRoot = await mkdtemp(path.join(os.tmpdir(), "director-commerce-image-"));
const appPort = await freePort();
const counters = { base64: 0, url: 0, download: 0, retry: 0, auth: 0, model: 0, chat: 0, vision: 0 };
let retryOnce = true;
let badTextChecksRemaining = 0;
const imageRequests = [];
const qualityReferenceCounts = [];
const mockServer = http.createServer(async (request, response) => {
  try {
    const url = new URL(request.url || "/", "http://127.0.0.1");
    if (url.pathname.endsWith("/chat/completions")) {
      counters.chat += 1;
      const body = JSON.parse(await readBody(request) || "{}");
      const canned = cannedChatResult(JSON.stringify(body.messages || []), body);
      if (canned === null) return json(response, 400, { error: { code: "InvalidURL", message: "Vision test requires an inline Data URL." } });
      return json(response, 200, { choices: [{ message: { content: canned } }] });
    }
    /* 中央模型路由的 opus（teamorouter）走 Anthropic Messages 协议（/v1/messages）。 */
    if (url.pathname.endsWith("/v1/messages")) {
      const body = JSON.parse(await readBody(request) || "{}");
      const canned = cannedChatResult(JSON.stringify({ system: body.system || "", messages: body.messages || [] }), body);
      if (canned === null) return json(response, 400, { error: { code: "InvalidURL", message: "Vision test requires an inline Data URL." } });
      return json(response, 200, { content: [{ type: "text", text: canned }] });
    }
    if (url.pathname === "/generated.png") {
      counters.download += 1;
      const image = await solidPng(2048, 2048, "#d9dce5");
      response.writeHead(200, { "Content-Type": "image/png" });
      response.end(image);
      return;
    }
    if (url.pathname.endsWith("/images/generations")) {
      const body = JSON.parse(await readBody(request) || "{}");
      imageRequests.push(body);
      if (url.pathname.startsWith("/auth/")) {
        counters.auth += 1;
        return json(response, 401, { error: { code: "Unauthorized", message: "invalid api key sk-secret-should-not-leak" } });
      }
      if (url.pathname.startsWith("/model/")) {
        counters.model += 1;
        return json(response, 404, { error: { code: "ModelNotOpen", message: "model not open" } });
      }
      if (url.pathname.startsWith("/retry/")) {
        counters.retry += 1;
        if (retryOnce) {
          retryOnce = false;
          return json(response, 429, { error: { code: "RateLimit", message: "rate limited" } });
        }
      } else if (url.pathname.startsWith("/url/")) {
        counters.url += 1;
        return json(response, 200, { data: [{ url: `http://127.0.0.1:${mockServer.address().port}/generated.png` }] });
      } else {
        counters.base64 += 1;
      }
      const [width, height] = String(body.size || "2048x2048").split("x").map(Number);
      const image = await solidPng(width, height, "#d9dce5");
      return json(response, 200, { data: [{ b64_json: image.toString("base64") }] });
    }
    json(response, 404, { message: "not found" });
  } catch (error) {
    json(response, 500, { message: error instanceof Error ? error.message : String(error) });
  }
});

/* 按请求内容返回固定的 canned JSON；OpenAI 与 Anthropic 两种协议共用同一份决策。
 * 返回 null 表示要求返回 400（用于校验视觉请求必须内联 Data URL）。 */
function cannedChatResult(content, body) {
  const imageParts = ((body && body.messages) || [])
    .flatMap((message) => Array.isArray(message.content) ? message.content : [])
    .filter((part) => part?.type === "image_url");
  if (imageParts.length && imageParts.some((part) => !String(part.image_url?.url || "").startsWith("data:image/"))) {
    return null;
  }
  if (content.includes("LAYOUT_QUALITY_CHECK")) {
    counters.vision += 1;
    qualityReferenceCounts.push(imageParts.length);
    const hasBadText = badTextChecksRemaining > 0;
    if (hasBadText) badTextChecksRemaining -= 1;
    const result = {
      productVisible: true,
      productFidelity: true,
      textSafe: true,
      textPresent: true,
      storyFit: true,
      marketingFit: true,
      seriesConsistent: true,
      sellingPointFit: true,
      unexpectedText: hasBadText,
      detectedText: hasBadText ? ["乱码测试"] : [],
      subjectBox: { x: 0.48, y: 0.28, width: 0.42, height: 0.62 },
      safeZones: [
        { label: "标题留白", x: 0.07, y: 0.08, width: 0.4, height: 0.13 },
        { label: "正文留白", x: 0.07, y: 0.23, width: 0.36, height: 0.1 }
      ],
      warnings: []
    };
    return JSON.stringify(result);
  } else if (content.includes("facts")) {
    counters.vision += 1;
    const result = { facts: [{ label: "填充物", value: "90白鸭绒", sourceName: "产品资料.md", sourceExcerpt: "填充物：90白鸭绒", confidence: "confirmed" }] };
    return JSON.stringify(result);
  } else if (content.includes("sections")) {
    counters.vision += 1;
    const result = { summary: "简洁分区与留白", sections: [{ start: 0, end: 1, title: "商品卖点模块", kind: "detail", layout: "上图下文", style: "克制简洁", detectedText: ["竞品文字"] }] };
    return JSON.stringify(result);
  } else if (content.includes("MARKETING_INTENT") || content.includes("MARKETING_STRATEGY") || content.includes("MARKETING_CREATIVE_PLAN")) {
    /* 营销引擎在本测试里刻意失败：任务按产品设计回退到本地规划与程序排版文字层，
     * 覆盖「引擎不可用时不阻塞出图」的回退路径。 */
    return "营销引擎在测试中不可用";
  } else {
    const match = content.match(/恰好\s+(\d+)\s+个/);
    const count = Math.max(1, Number(match?.[1] || 5));
    const result = {
      summary: `已规划 ${count} 个画面`,
      storyboard: {
        theme: "穿红色羽绒服回家过年",
        emotionalHook: "回家过年，先把暖意穿在身上",
        summary: "用封面、场景、细节和收藏收尾讲完同一个回家过年主题。",
        visualBible: { productAnchor: "锁定真实羽绒服颜色、版型和细节", colorMood: "红色暖调新年氛围", photography: "统一自然柔光商品摄影", typography: "深色标题与米白留白", scene: "回家过年", subjectRule: "没有上身图时使用无人物商品场景" },
        cards: Array.from({ length: count }, (_, index) => ({ role: index === 0 ? "cover_hook" : index === 1 ? "scene_context" : index === count - 1 ? "outfit_closing" : index === 2 ? "fact_proof" : "highlight", title: `故事画面 ${index + 1}`, purpose: "围绕同一个主题推进", visual: "真实商品、暖调场景、上方留白", copyIntent: index === 0 ? "回家过年，先把暖意穿在身上" : "90白鸭绒" }))
      },
      panels: Array.from({ length: count }, (_, index) => ({ title: `画面 ${index + 1}`, kind: index === 0 ? "cover" : "detail", description: "真实商品与清晰留白", headline: index === 0 ? "轻量通勤" : "真实细节", body: "90白鸭绒", layout: "商品居中", style: "克制高级" })),
      publishTitle: "轻量羽绒服怎么选",
      publishBody: "先看真实填充物与做工。",
      tags: ["羽绒服", "通勤"]
    };
    return JSON.stringify(result);
  }
}
await new Promise((resolve) => mockServer.listen(0, "127.0.0.1", resolve));
const mockPort = mockServer.address().port;
const mockBase = `http://127.0.0.1:${mockPort}`;

const app = spawn(path.join(root, "node_modules", ".bin", "next"), ["start", "-p", String(appPort)], {
  cwd: root,
  stdio: ["ignore", "pipe", "pipe"],
  env: {
    ...process.env,
    COMMERCE_IMAGE_DATA_DIR: dataRoot,
    COMMERCE_SEEDREAM_API_KEY: "mock-seedream-key",
    COMMERCE_SEEDREAM_BASE_URL: `${mockBase}/base64`,
    COMMERCE_SEEDREAM_MODEL: "doubao-seedream-5-0-pro-260628",
    DEEPSEEK_API_KEY: "mock-text-key",
    DEEPSEEK_BASE_URL: `${mockBase}/openai`,
    /* 中央模型路由的 Provider 也全部指向本地 mock，保证测试确定性、不打真实 API：
     * opus（teamorouter，Anthropic 协议）与豆包视觉（ark，OpenAI 兼容协议）。 */
    TEAMOROUTER_API_KEY: "mock-opus-key",
    TEAMOROUTER_BASE_URL: `${mockBase}/anthropic`,
    ARK_API_KEY: "mock-ark-key",
    ARK_BASE_URL: `${mockBase}/ark`,
    REPLICA_VISION_API_KEY: "mock-vision-key",
    REPLICA_VISION_BASE_URL: `${mockBase}/openai`,
    REPLICA_VISION_MODEL: "mock-vision"
  }
});
let appOutput = "";
app.stdout.on("data", (chunk) => { appOutput += chunk.toString(); });
app.stderr.on("data", (chunk) => { appOutput += chunk.toString(); });
const baseUrl = `http://127.0.0.1:${appPort}`;

try {
  await waitForServer(`${baseUrl}/api/commerce-image/tasks`);
  const productPng = await solidPng(600, 800, "#7157e8");
  const benchmarkPng = await solidPng(600, 2400, "#f3efe8");

  const oneClick = await createTask({
    kind: "detail_page",
    title: "自动测试 · 一键详情页",
    productName: "轻量羽绒服",
    model: "doubao-seedream-5-0-pro-260628",
    ratio: "3:4",
    generationSetCount: 4,
    brief: { audience: "通勤女性", sellingPoints: "90白鸭绒", scene: "冬季通勤", style: "真实克制", strategy: "auto", cardCount: 5 }
  });
  await uploadImage(oneClick.id, benchmarkPng, "benchmark_reference", "benchmark.png");
  await uploadImage(oneClick.id, productPng, "front", "product.png");
  await uploadDocument(oneClick.id, "产品资料.md", "填充物：90白鸭绒\n适合冬季通勤。");
  const oneClickCallsBefore = counters.base64;
  await api(`/api/commerce-image/tasks/${oneClick.id}/generate`, {
    method: "POST",
    json: { oneClick: true, instruction: "整体克制高级，首图突出通勤保暖，所有文字保持可编辑。" }
  });
  const oneClickResult = await waitForTask(oneClick.id, ["completed", "partial", "failed"], 60_000);
  assert.equal(oneClickResult.status, "completed", oneClickResult.error);
  assert.equal(oneClickResult.panels.length, 5, "详情页应严格使用用户选择的生成张数");
  assert.equal(oneClickResult.generationSets.length, 1, "一键流程只生成一套，避免套数和张数混淆");
  assert.equal(counters.base64 - oneClickCallsBefore, 5, "一次点击应直接完成五张图片生成");
  assert.equal(oneClickResult.brief.extra, "整体克制高级，首图突出通勤保暖，所有文字保持可编辑。");
  assert.ok(oneClickResult.chatMessages.some((message) => message.role === "user" && message.content.includes("首图突出通勤保暖")), "生成要求应自动保存为用户消息");
  assert.equal(oneClickResult.approvedPlanRevision, oneClickResult.planRevision, "一键流程应在服务端自动确认最新方案");
  const callsBeforeUnchangedClick = counters.base64;
  const unchangedClick = await api(`/api/commerce-image/tasks/${oneClick.id}/generate`, { method: "POST", json: { oneClick: true } });
  assert.equal(unchangedClick.started, false, "已完成且输入未变化时不应再次启动任务");
  assert.equal(counters.base64, callsBeforeUnchangedClick, "重复点击不得再次调用生图模型");

  /* 直连模式（当前产品行为）：小红书/抖音没有用户可见的「故事线确认」，
   * 分析后按「钩子 → 场景 → 证明 → 收束」绑定卖点卡；质检在后台回填，
   * 认为需要重做时只提示，不自动扣费重画。 */
  const direct = await createTask({
    kind: "xiaohongshu_post",
    title: "自动测试 · 小红书直连",
    productName: "红色羽绒服",
    model: "doubao-seedream-5-0-pro-260628",
    ratio: "3:4",
    brief: { audience: "春节返乡女性", sellingPoints: "90白鸭绒", scene: "回家过年", style: "真实克制", extra: "穿红色羽绒服回家过年", strategy: "emotion", cardCount: 4 }
  });
  await uploadImage(direct.id, productPng, "front", "product.png");
  await uploadDocument(direct.id, "产品资料.txt", "填充物：90白鸭绒");
  await api(`/api/commerce-image/tasks/${direct.id}/analyze`, { method: "POST" });
  const directPlan = await waitForTask(direct.id, ["awaiting_approval", "failed"], 30_000);
  assert.equal(directPlan.status, "awaiting_approval", directPlan.error);
  assert.equal(directPlan.schemaVersion, 3);
  assert.equal(directPlan.panels.length, 4);
  assert.ok(directPlan.panels.slice(0, 3).every((panel) => panel.sellingPoint?.label), "前三张应绑定卖点卡");
  assert.ok(!directPlan.panels[3].sellingPoint, "收尾页只负责收束，不绑定卖点卡");
  assert.ok(directPlan.panels[0].title.includes("封面钩子"), "面板标题应体现营销职责");
  assert.ok(directPlan.panels[0].prompt.includes("本张转化任务"), "绑定卖点卡的面板必须带转化任务");
  assert.ok(directPlan.panels.every((panel) => panel.prompt.includes("直连执行要求")), "直连提示词必须保留执行要求");
  assert.ok(directPlan.panels.every((panel) => panel.prompt.includes("穿红色羽绒服回家过年")), "用户原话必须原样进入提示词");
  assert.ok(directPlan.panels.every((panel) => !/小红书|x=|y=|#7c3aed/.test(panel.prompt)), "提示词不能泄漏平台名、排版坐标和色号");

  const callsBeforeDirectGeneration = counters.base64;
  const directRequestsStart = imageRequests.length;
  const doubleDirect = await Promise.all([
    api(`/api/commerce-image/tasks/${direct.id}/generate`, { method: "POST", json: { oneClick: true } }),
    api(`/api/commerce-image/tasks/${direct.id}/generate`, { method: "POST", json: { oneClick: true } })
  ]);
  assert.equal(doubleDirect.filter((payload) => payload.started === true).length, 1, "双击只能启动一个后台任务");
  const directResult = await waitForTask(direct.id, ["completed", "partial", "failed"], 60_000);
  assert.equal(directResult.status, "completed", directResult.error);
  assert.equal(counters.base64 - callsBeforeDirectGeneration, 4, "直连模式应按张数生成四张图片");
  const directRequests = imageRequests.slice(directRequestsStart);
  assert.equal(Array.isArray(directRequests[0].image) ? directRequests[0].image.length : 1, 1);
  assert.equal(directRequests[1].image.length, 2, "第二张必须带第一张底图作系列参考");
  assert.equal(directRequests[3].image.length, 3, "第四张必须带首张和前张底图作系列参考");

  /* 后台质检回填：绑定卖点卡的三张接受卖点呈现检查；程序排版文字层按模板保留
   *（营销引擎规则回退时也有兜底文案层），不被视觉安全区覆盖。 */
  const qualityChecked = await waitForPanelQuality(direct.id, directResult.panels.slice(0, 3).map((panel) => panel.id));
  const directPanels = qualityChecked.panels.slice(0, 3);
  assert.ok(directPanels.every((panel) => panel.quality?.textSafe && panel.quality?.productVisible && panel.quality?.productFidelity && panel.quality?.storyFit), "直连底图应通过商品保真、故事和文字安全区质检");
  assert.ok(directPanels.every((panel) => panel.quality?.sellingPointFit === true), "质检应回填卖点呈现结论");
  assert.ok(directPanels.every((panel) => panel.layoutGuide?.source === "vision"), "质检后应保存视觉检查得到的安全区");
  assert.ok(qualityReferenceCounts.every((count) => count >= 2), "商品质检必须同时看到真实商品图和候选图");
  assert.ok(qualityChecked.panels[0].textLayers.length > 0, "封面应有程序排版文字层");
  assert.ok(qualityChecked.panels[0].textLayers.every((layer) => layer.visible !== false && layer.text), "通过质检的文字层应保持可见且带文案");

  /* 乱码质检：只标记 needs_regeneration 并提示用户重做，不再自动扣费重画。 */
  badTextChecksRemaining = 1;
  const beforeBadText = counters.base64;
  await api(`/api/commerce-image/tasks/${direct.id}/generate`, { method: "POST", json: { panelIds: [directResult.panels[1].id] } });
  const retriedText = await waitForTask(direct.id, ["completed", "partial", "failed"], 60_000);
  assert.equal(counters.base64 - beforeBadText, 1, "重新生成当前画面只调用一次生图模型");
  assert.equal(retriedText.panels[1].versions.length, 2, "重新生成会保存新版本");
  assert.equal(retriedText.panels[0].versions.length, 1, "已完成的其他图不重复生成");
  const badQualityTask = await waitForPanelQuality(direct.id, [directResult.panels[1].id]);
  const badPanel = badQualityTask.panels.find((panel) => panel.id === directResult.panels[1].id);
  assert.equal(badPanel.quality.unexpectedText, true, "乱码结论应回填到质检结果");
  assert.equal(badPanel.quality.status, "needs_regeneration", "乱码应标记为建议重做");
  assert.ok((badPanel.quality.warnings || []).some((warning) => warning.includes("重新生成")), "质检应提示用户手动重做");

  badTextChecksRemaining = 0;
  await api(`/api/commerce-image/tasks/${direct.id}/generate`, { method: "POST", json: { panelIds: [directResult.panels[1].id] } });
  const recovered = await waitForTask(direct.id, ["completed", "partial", "failed"], 60_000);
  assert.equal(counters.base64 - beforeBadText, 2, "手动重做第二次调用一次生图模型");
  const recoveredQuality = await waitForPanelQuality(direct.id, [directResult.panels[1].id]);
  const recoveredPanel = recoveredQuality.panels.find((panel) => panel.id === directResult.panels[1].id);
  assert.equal(recoveredPanel.quality.status, "passed", "清理乱码后质检应通过");

  const detail = await createTask({
    kind: "detail_page",
    title: "自动测试 · 详情页",
    productName: "轻量羽绒服",
    model: "doubao-seedream-5-0-pro-260628",
    ratio: "3:4",
    generationSetCount: 2,
    brief: { audience: "通勤女性", sellingPoints: "90白鸭绒", scene: "冬季通勤", style: "克制高级", strategy: "auto", cardCount: 6 }
  });
  await uploadImage(detail.id, benchmarkPng, "benchmark_reference", "benchmark.png");
  await uploadImage(detail.id, productPng, "front", "product.png");
  await uploadDocument(detail.id, "产品资料.md", "---\nname: 产品\n---\n填充物：90白鸭绒\n适合冬季通勤。");
  await api(`/api/commerce-image/tasks/${detail.id}/analyze`, { method: "POST" });
  let analyzed = await waitForTask(detail.id, ["awaiting_approval", "failed"], 30_000);
  assert.equal(analyzed.status, "awaiting_approval", analyzed.error);
  assert.equal(analyzed.schemaVersion, 3);
  assert.ok(analyzed.panels.length >= 3 && analyzed.panels.length <= 12);
  assert.equal(analyzed.documents[0].extractedText, undefined);
  assert.ok(analyzed.productFacts.some((fact) => fact.value === "90白鸭绒"));

  analyzed = (await api(`/api/commerce-image/tasks/${detail.id}/approve`, { method: "POST" })).task;
  assert.equal(analyzed.generationSets.length, 2);
  const plannedCalls = analyzed.panels.length * 2;
  const beforeGenerate = counters.base64;
  await api(`/api/commerce-image/tasks/${detail.id}/generate`, { method: "POST", json: {} });
  let generated = await waitForTask(detail.id, ["completed", "partial", "failed"], 60_000);
  assert.equal(generated.status, "completed", generated.error);
  assert.equal(counters.base64 - beforeGenerate, plannedCalls);
  for (const panel of generated.panels) {
    assert.equal(panel.versions.length, 2);
    assert.ok(panel.versions.every((version) => version.providerModelId === "doubao-seedream-5-0-pro-260628"));
  }

  await api(`/api/commerce-image/tasks/${detail.id}/generate`, { method: "POST", json: {} });
  await waitForTask(detail.id, ["completed"], 10_000);
  assert.equal(counters.base64 - beforeGenerate, plannedCalls, "完整任务重复启动不应再次调用模型");

  const firstPanel = generated.panels[0];
  await api(`/api/commerce-image/tasks/${detail.id}/generate`, { method: "POST", json: { panelIds: [firstPanel.id] } });
  generated = await waitForTask(detail.id, ["completed", "partial", "failed"], 30_000);
  assert.equal(counters.base64 - beforeGenerate, plannedCalls + 1);
  const editedLayers = generated.panels[0].textLayers.map((layer, index) => index === 0 ? { ...layer, text: "手动改正后的卖点" } : layer);
  const callsBeforeText = counters.base64;
  generated = (await api(`/api/commerce-image/tasks/${detail.id}`, { method: "PATCH", json: { panels: [{ id: generated.panels[0].id, textLayers: editedLayers }] } })).task;
  assert.equal(generated.approvedPlanRevision, generated.planRevision, "文字层修改不应使已确认方案失效");
  assert.equal(counters.base64, callsBeforeText, "文字修改不得调用模型");

  const panelExport = await fetch(`${baseUrl}/api/commerce-image/tasks/${detail.id}/export?format=panel&panelId=${generated.panels[0].id}&setId=${generated.selectedSetId}`);
  assert.equal(panelExport.status, 200);
  assert.equal(panelExport.headers.get("content-type"), "image/png");
  const stats = await sharp(Buffer.from(await panelExport.arrayBuffer())).stats();
  assert.ok(stats.channels.some((channel) => channel.stdev > 0), "文字合成后的图片不应仍是纯色");
  const zipResponse = await fetch(`${baseUrl}/api/commerce-image/tasks/${detail.id}/export?format=zip&setId=${generated.selectedSetId}`);
  assert.equal(zipResponse.status, 200);
  const exportedZip = await JSZip.loadAsync(await zipResponse.arrayBuffer());
  assert.ok(exportedZip.file("detail-page.png"));
  assert.ok(exportedZip.file("项目说明.md"));
  assert.ok(exportedZip.file("版本清单.json"));

  const skillMarkdown = "---\nname: 证据型电商风格\ndescription: 强调真实证据和买家问题\nversion: 1.0\nplatforms: [xiaohongshu, douyin]\ntags: [证据, 电商]\n---\n使用问题、证据、结论结构；不得编造数据。";
  const skillForm = new FormData();
  skillForm.set("skill", new Blob([skillMarkdown], { type: "text/markdown" }), "SKILL.md");
  const importedSkill = await api("/api/commerce-image/style-skills", { method: "POST", body: skillForm });
  const duplicateSkill = await api("/api/commerce-image/style-skills", { method: "POST", body: skillForm });
  assert.equal(importedSkill.skill.id, duplicateSkill.skill.id, "相同 Skill 内容不应重复导入");
  const safeZip = new JSZip();
  safeZip.file("skill/SKILL.md", skillMarkdown.replace("version: 1.0", "version: 1.1"));
  safeZip.file("skill/references/sample.png", productPng);
  const safeZipForm = new FormData();
  safeZipForm.set("skill", new Blob([await safeZip.generateAsync({ type: "uint8array" })], { type: "application/zip" }), "style.zip");
  const zipSkill = await api("/api/commerce-image/style-skills", { method: "POST", body: safeZipForm });
  assert.equal(zipSkill.skill.referenceAssets.length, 1);
  const unsafeZip = new JSZip();
  unsafeZip.file("SKILL.md", skillMarkdown);
  unsafeZip.file("../escape.txt", "no");
  const unsafeForm = new FormData();
  unsafeForm.set("skill", new Blob([await unsafeZip.generateAsync({ type: "uint8array" })], { type: "application/zip" }), "unsafe.zip");
  const unsafeResponse = await fetch(`${baseUrl}/api/commerce-image/style-skills`, { method: "POST", body: unsafeForm });
  assert.equal(unsafeResponse.status, 422, "路径穿越 ZIP 必须被拒绝");

  const social = await createTask({
    kind: "xiaohongshu_post",
    title: "自动测试 · 小红书",
    productName: "轻量羽绒服",
    model: "doubao-seedream-5-0-pro-260628",
    ratio: "3:4",
    generationSetCount: 1,
    brief: { audience: "通勤女性", sellingPoints: "90白鸭绒", scene: "冬季通勤", style: "真实", strategy: "evidence", cardCount: 4 }
  });
  await uploadImage(social.id, productPng, "front", "product.png");
  await uploadDocument(social.id, "产品资料.txt", "填充物：90白鸭绒");
  await api(`/api/commerce-image/tasks/${social.id}/style-skill`, { method: "POST", json: { skillId: importedSkill.skill.id } });
  await api(`/api/commerce-image/tasks/${social.id}/analyze`, { method: "POST" });
  const socialPlan = await waitForTask(social.id, ["awaiting_approval", "failed"], 30_000);
  assert.equal(socialPlan.status, "awaiting_approval", socialPlan.error);
  assert.equal(socialPlan.panels.length, 4);
  assert.equal(socialPlan.strategySnapshot.name, "证据型电商风格");
  const adaptedPayload = await api(`/api/commerce-image/tasks/${social.id}/adapt`, { method: "POST" });
  const adapted = await waitForTask(adaptedPayload.task.id, ["awaiting_approval", "failed"], 30_000);
  assert.equal(adapted.kind, "douyin_post");
  assert.equal(adapted.documents.length, 1);
  assert.ok(adapted.sourceAssets.some((asset) => asset.role === "front"));
  assert.equal(adapted.strategySnapshot.name, "证据型电商风格");

  /* 任务默认 high 档：seedream 适配器按清晰度 ×1.5 换算并取 16 的倍数
   * （commerce-image-provider.ts seedreamSizeForQuality）。2:3 / 3:2 因取整偏离严格比例，
   * runner 会等比裁剪回严格比例（2036×3054 / 3054×2036）。 */
  const expectedSizes = {
    "1:1": [3072, 3072], "3:4": [2304, 3072], "9:16": [1728, 3072], "2:3": [2036, 3054],
    "3:2": [3054, 2036], "4:3": [3072, 2304], "16:9": [3072, 1728]
  };
  for (const [ratio, expected] of Object.entries(expectedSizes)) {
    const item = await localPlannedTask("retouch", ratio, productPng);
    await api(`/api/commerce-image/tasks/${item.id}/generate`, { method: "POST", json: {} });
    const result = await waitForTask(item.id, ["completed", "failed"], 30_000);
    assert.equal(result.status, "completed", `${ratio}: ${result.error}`);
    assert.deepEqual([result.panels[0].versions[0].width, result.panels[0].versions[0].height], expected);
  }

  await configureSeedream(`${mockBase}/base64`);
  const providerVerification = await api("/api/commerce-image/providers", { method: "POST", json: { provider: "seedream" } });
  assert.equal(providerVerification.verification.providerModelId, "doubao-seedream-5-0-pro-260628");
  assert.deepEqual([providerVerification.verification.width, providerVerification.verification.height], [2048, 2048]);
  assert.ok((await stat(path.join(dataRoot, "verification", providerVerification.verification.fileName))).size > 0);

  await configureSeedream(`${mockBase}/url`);
  const urlTask = await localPlannedTask("retouch", "1:1", productPng);
  await api(`/api/commerce-image/tasks/${urlTask.id}/generate`, { method: "POST", json: {} });
  assert.equal((await waitForTask(urlTask.id, ["completed", "failed"], 30_000)).status, "completed");
  assert.equal(counters.url, 1);
  assert.equal(counters.download, 1);

  retryOnce = true;
  await configureSeedream(`${mockBase}/retry`);
  const retryTask = await localPlannedTask("retouch", "1:1", productPng);
  await api(`/api/commerce-image/tasks/${retryTask.id}/generate`, { method: "POST", json: {} });
  assert.equal((await waitForTask(retryTask.id, ["completed", "failed"], 30_000)).status, "completed");
  assert.equal(counters.retry, 2, "429 应只退避重试一次");

  await configureSeedream(`${mockBase}/auth`);
  const authTask = await localPlannedTask("detail_page", "3:4", productPng, benchmarkPng);
  await api(`/api/commerce-image/tasks/${authTask.id}/generate`, { method: "POST", json: {} });
  const authFailed = await waitForTask(authTask.id, ["failed", "partial"], 20_000);
  /* 生成并发为 2（PANEL_CONCURRENCY）：致命鉴权错误后停止后续模块，
   * 在途的并发请求最多 2 个，绝不能把 4 张全部打完。 */
  assert.ok(counters.auth >= 1 && counters.auth <= 2, "鉴权错误出现后必须停止剩余模块");
  assert.equal(authFailed.lastError.category, "authorization");
  assert.ok(!JSON.stringify(authFailed).includes("sk-secret-should-not-leak"), "任务与接口不得泄漏服务商错误中的密钥");

  await configureSeedream(`${mockBase}/model`);
  const modelTask = await localPlannedTask("detail_page", "3:4", productPng, benchmarkPng);
  await api(`/api/commerce-image/tasks/${modelTask.id}/generate`, { method: "POST", json: {} });
  const modelFailed = await waitForTask(modelTask.id, ["failed", "partial"], 20_000);
  assert.ok(counters.model >= 1 && counters.model <= 2, "ModelNotOpen 出现后必须停止剩余模块");
  assert.equal(modelFailed.lastError.category, "model_access");

  const legacyId = "commerce_image_task_legacy_compat";
  const legacyDirectory = path.join(dataRoot, "tasks", legacyId);
  await mkdir(legacyDirectory, { recursive: true });
  await writeFile(path.join(legacyDirectory, "task.json"), JSON.stringify({
    id: legacyId,
    kind: "detail_page",
    title: "旧任务",
    status: "draft",
    model: "doubao-seedream-5-0-260128",
    ratio: "3:4",
    sourceAssets: [],
    brief: {},
    panels: [{
      id: "commerce_image_panel_legacy",
      title: "旧画面",
      prompt: "old",
      ratio: "3:4",
      status: "draft",
      overlay: { visible: true, title: "旧标题", body: "旧正文", textColor: "#ffffff", accentColor: "#7c3aed", position: "top", align: "left" },
      versions: []
    }],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  }));
  const legacy = (await api(`/api/commerce-image/tasks/${legacyId}`)).task;
  assert.equal(legacy.schemaVersion, 3);
  assert.equal(legacy.model, "doubao-seedream-5-0-260128");
  assert.equal(legacy.panels[0].textLayers.length, 2);

  console.log(JSON.stringify({
    success: true,
    checks: {
      schemaAndLegacyCompatibility: true,
      oneClickAnalysisApprovalAndGeneration: true,
      directPlanWithSellingPointCards: true,
      directModeGenerationAndDoubleClickDeduplication: true,
      deferredQualityAndSellingPointFit: true,
      seriesImageReferences: true,
      garbledTextFlaggedForManualRegeneration: true,
      documentAndVisionAnalysis: true,
      dashscopeVisionDataUrlCompatibility: true,
      generationSetsAndResume: true,
      textLayersWithoutModelCall: true,
      serverExport: true,
      styleSkillMdZipAndTraversalDefense: true,
      crossPlatformAdaptation: true,
      sevenRatios: true,
      seedreamBase64AndUrl: true,
      providerVerificationArtifact: true,
      retryAndFatalStop: true,
      secretRedaction: true
    },
    counters
  }, null, 2));
} catch (error) {
  console.error(appOutput);
  console.error(error);
  process.exitCode = 1;
} finally {
  app.kill("SIGTERM");
  await new Promise((resolve) => mockServer.close(resolve));
  await rm(dataRoot, { recursive: true, force: true });
}

async function createTask(input) {
  return (await api("/api/commerce-image/tasks", { method: "POST", json: input })).task;
}

async function localPlannedTask(kind, ratio, productBytes, benchmarkBytes) {
  const task = await createTask({
    kind,
    title: `自动测试 · ${kind} · ${ratio}`,
    productName: "测试商品",
    model: "doubao-seedream-5-0-pro-260628",
    ratio,
    generationSetCount: 1,
    brief: { sellingPoints: "真实卖点", retouchOperation: "white_background", strategy: "auto", cardCount: 4 }
  });
  if (benchmarkBytes) await uploadImage(task.id, benchmarkBytes, "benchmark_reference", "benchmark.png");
  await uploadImage(task.id, productBytes, "front", "product.png");
  await api(`/api/commerce-image/tasks/${task.id}/plan`, { method: "POST", json: {} });
  return (await api(`/api/commerce-image/tasks/${task.id}/approve`, { method: "POST" })).task;
}

async function uploadImage(taskId, bytes, role, name) {
  const form = new FormData();
  form.set("role", role);
  form.set("saveToProductProfile", "false");
  form.append("images", new Blob([bytes], { type: "image/png" }), name);
  return api(`/api/commerce-image/tasks/${taskId}/assets`, { method: "POST", body: form });
}

async function uploadDocument(taskId, name, content) {
  const form = new FormData();
  form.append("documents", new Blob([content], { type: name.endsWith(".md") ? "text/markdown" : "text/plain" }), name);
  return api(`/api/commerce-image/tasks/${taskId}/documents`, { method: "POST", body: form });
}

async function configureSeedream(baseUrl) {
  return api("/api/commerce-image/providers", {
    method: "PATCH",
    json: { provider: "seedream", apiKey: "mock-seedream-key", baseUrl, modelId: "doubao-seedream-5-0-pro-260628" }
  });
}

async function waitForTask(taskId, statuses, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let task;
  while (Date.now() < deadline) {
    task = (await api(`/api/commerce-image/tasks/${taskId}`)).task;
    if (statuses.includes(task.status)) return task;
    await new Promise((resolve) => setTimeout(resolve, 120));
  }
  throw new Error(`等待任务超时：${taskId}，最后状态 ${task?.status}`);
}

/** 后台质检在任务完成后才异步回填，这里轮询到指定画面的质检结论落盘为止。 */
async function waitForPanelQuality(taskId, panelIds, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  let task;
  while (Date.now() < deadline) {
    task = (await api(`/api/commerce-image/tasks/${taskId}`)).task;
    const panels = task.panels.filter((panel) => panelIds.includes(panel.id));
    if (panels.length === panelIds.length && panels.every((panel) => panel.quality?.checkedAt)) return task;
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error(`等待质检回填超时：${taskId}`);
}

async function api(pathname, options = {}) {
  const response = await fetch(`${baseUrl}${pathname}`, {
    method: options.method || "GET",
    headers: options.json ? { "Content-Type": "application/json" } : undefined,
    body: options.json ? JSON.stringify(options.json) : options.body,
    signal: AbortSignal.timeout(30_000)
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.success === false) throw new Error(`${pathname}: ${payload.message || response.status}`);
  return payload;
}

async function waitForServer(url) {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch { /* 等待启动 */ }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error("测试服务启动超时");
}

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const port = server.address().port;
      server.close(() => resolve(port));
    });
  });
}

function readBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    request.on("data", (chunk) => chunks.push(chunk));
    request.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    request.on("error", reject);
  });
}

function json(response, status, value) {
  response.writeHead(status, { "Content-Type": "application/json" });
  response.end(JSON.stringify(value));
}

function solidPng(width, height, color) {
  return sharp({ create: { width, height, channels: 4, background: color } }).png().toBuffer();
}
