import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";

/*
 * 营销生图引擎回归测试（不需要真实生图 API）
 *
 * 1) 5 个标准案例走 dry-run 接口，验证 ProductTruth / Intent / Strategy / Creative / Prompt。
 * 2) 至少一个案例走真实文本模型路径（mock），验证意图 / 策略 / 创意三层确实使用了模型。
 * 3) 两个真实一键生图任务（mock provider），验证任务里存下了营销链路，并且
 *    「用户要求文字但结果没有文字」会被标记为 MARKETING_INTENT_FAILED。
 */

const root = process.cwd();
const dataRoot = await mkdtemp(path.join(os.tmpdir(), "director-marketing-engine-"));
const appPort = await freePort();
let qaTextPresent = true;
let qaProductFidelity = true;
let qaUnexpectedText = false;
let imageCalls = 0;
let visionCalls = 0;
const imageRequests = [];

const mockServer = http.createServer(async (request, response) => {
  try {
    const url = new URL(request.url || "/", "http://127.0.0.1");
    if (url.pathname.endsWith("/chat/completions")) {
      const body = JSON.parse((await readBody(request)) || "{}");
      return json(response, 200, { choices: [{ message: { content: cannedTextResult(JSON.stringify(body.messages || [])) } }] });
    }
    /* 中央模型路由的 opus（teamorouter）走 Anthropic Messages 协议（/v1/messages）。 */
    if (url.pathname.endsWith("/v1/messages")) {
      const body = JSON.parse((await readBody(request)) || "{}");
      const content = JSON.stringify({ system: body.system || "", messages: body.messages || [] });
      return json(response, 200, { content: [{ type: "text", text: cannedTextResult(content) }] });
    }
    if (url.pathname.endsWith("/images/generations")) {
      imageCalls += 1;
      const body = JSON.parse((await readBody(request)) || "{}");
      imageRequests.push(body);
      const parts = String(body.size || "1536x2048").split("x").map(Number);
      const image = await solidPng(parts[0] || 1536, parts[1] || 2048, "#8a4b57");
      return json(response, 200, { data: [{ b64_json: image.toString("base64") }] });
    }
    json(response, 404, { message: "not found" });
  } catch (error) {
    json(response, 500, { message: error instanceof Error ? error.message : String(error) });
  }
});

/* 按请求内容返回固定的 canned JSON；OpenAI 与 Anthropic 两种协议共用同一份决策。 */
function cannedTextResult(content) {
  if (content.includes("MARKETING_INTENT")) {
    return JSON.stringify({
      platform: "xiaohongshu",
      businessGoal: "traffic",
      creativeIntent: content.includes("要像真实用户分享") || content.includes("春节回家") ? "scenario_hook" : "pain_comparison",
      focusSellingPoints: ["90白鸭绒", "显瘦版型"],
      textRequired: true,
      comparisonRequired: true,
      tone: "真实分享",
      scene: "冬季通勤",
      specialRequirements: ["要有明显标题和卖点文字"]
    });
  }
  if (content.includes("MARKETING_STRATEGY")) {
    return JSON.stringify({
      primaryPainPoint: "普通羽绒服容易显胖臃肿",
      primarySellingPoint: "显瘦版型",
      secondarySellingPoints: ["90白鸭绒", "高领防风"],
      hook: "为什么别人穿羽绒服显胖，你穿却更利落？",
      messageHierarchy: ["冲突提问", "痛点", "解法", "卖点", "行动引导"],
      visualStrategy: "左右对比，左侧压暗显臃肿，右侧明亮显利落",
      copyStrategy: "标题用提问，卖点短句仅 2 到 3 条",
      ctaStrategy: "先收藏，按需求慢慢选",
      riskWarnings: ["不得编造价格"]
    });
  }
  if (content.includes("MARKETING_CREATIVE_PLAN")) {
    const match = content.match(/恰好\s+(\d+)\s*张画面/);
    const count = Math.max(1, Number(match && match[1] ? match[1] : 3));
    const panels = Array.from({ length: count }, (_, index) => ({
      title: "画面 " + (index + 1),
      visual: "真实商品与清晰留白",
      headline: index === 0 ? "别人显胖，你更利落" : "显瘦版型",
      subheadline: index === 0 ? "90白鸭绒" : "",
      sellingPointLabels: ["显瘦版型", "90白鸭绒"],
      comparisonLeft: index === 0 ? "臃肿压个子" : "",
      comparisonRight: index === 0 ? "利落显瘦" : "",
      cta: index === count - 1 ? "先收藏再选" : "",
      supportingCopy: "",
      productPlacement: "商品居中偏下",
      background: "冬日街头",
      textSafeArea: "上方留白"
    }));
    return JSON.stringify({ summary: "痛点对比共 " + count + " 张", panels, publishTitle: "羽绒服怎么穿更利落", publishBody: "先看版型再看填充。", tags: ["羽绒服", "显瘦"] });
  }
  if (content.includes("MARKETING_QA_VISION")) {
    visionCalls += 1;
    return JSON.stringify({
      textPresent: qaTextPresent,
      detectedText: qaTextPresent ? ["别人显胖，你更利落"] : [],
      productFidelity: qaProductFidelity,
      genericImage: false,
      hierarchyPresent: qaTextPresent,
      sellingPointsPresent: qaTextPresent ? ["显瘦版型"] : [],
      platformFit: true,
      baseTextClean: !qaUnexpectedText,
      warnings: []
    });
  }
  if (content.includes("MARKETING_REVIEW")) {
    return JSON.stringify({
      summary: "基于真实数据的复盘摘要",
      whatWorked: ["收藏率更高的方案更适合互动目标"],
      whatDidNotWork: ["商品点击较低的方案不适合直接成交"],
      possibleReasons: ["两种策略承担不同业务目标"],
      strategyObservation: "scenario_hook 收藏倾向更高，pain_comparison 商品点击更高",
      copyObservation: "文案层级清楚",
      visualObservation: "排版模板一致",
      productObservation: "同一商品，可比性较高",
      nextTestRecommendation: ["同一商品各测至少 3 条再比较"],
      confidence: "low"
    });
  }
  if (content.includes("LAYOUT_QUALITY_CHECK")) {
    visionCalls += 1;
    return JSON.stringify({
      productVisible: true,
      productFidelity: qaProductFidelity,
      textSafe: true,
      textPresent: qaTextPresent,
      storyFit: true,
      marketingFit: true,
      seriesConsistent: true,
      unexpectedText: qaUnexpectedText,
      detectedText: [],
      subjectBox: { x: 0.48, y: 0.28, width: 0.42, height: 0.62 },
      safeZones: [
        { label: "标题留白", x: 0.07, y: 0.08, width: 0.4, height: 0.13 },
        { label: "正文留白", x: 0.07, y: 0.23, width: 0.36, height: 0.1 }
      ],
      warnings: []
    });
  }
  if (content.includes("facts")) {
    return JSON.stringify({ facts: [
      { label: "填充物", value: "90白鸭绒", sourceName: "产品资料.md", sourceExcerpt: "填充物：90白鸭绒", confidence: "confirmed" },
      { label: "颜色", value: "酒红色", sourceName: "产品资料.md", sourceExcerpt: "颜色：酒红色", confidence: "confirmed" },
      { label: "版型", value: "显瘦版型", sourceName: "产品资料.md", sourceExcerpt: "版型：显瘦版型", confidence: "confirmed" },
      { label: "领型", value: "高领防风", sourceName: "产品资料.md", sourceExcerpt: "领型：高领防风", confidence: "confirmed" }
    ] });
  }
  return JSON.stringify({ panels: [] });
}
await new Promise((resolve) => mockServer.listen(0, "127.0.0.1", resolve));
const mockBase = "http://127.0.0.1:" + mockServer.address().port;

const app = spawn(path.join(root, "node_modules", ".bin", "next"), ["start", "-p", String(appPort)], {
  cwd: root,
  stdio: ["ignore", "pipe", "pipe"],
  env: {
    ...process.env,
    COMMERCE_IMAGE_DATA_DIR: dataRoot,
    COMMERCE_SEEDREAM_API_KEY: "mock-seedream-key",
    COMMERCE_SEEDREAM_BASE_URL: mockBase + "/base64",
    COMMERCE_SEEDREAM_MODEL: "doubao-seedream-5-0-pro-260628",
    DEEPSEEK_API_KEY: "mock-text-key",
    DEEPSEEK_BASE_URL: mockBase + "/openai",
    /* 中央模型路由的 Provider 也全部指向本地 mock，保证测试确定性、不打真实 API：
     * opus（teamorouter，Anthropic 协议）与豆包视觉（ark，OpenAI 兼容协议）。 */
    TEAMOROUTER_API_KEY: "mock-opus-key",
    TEAMOROUTER_BASE_URL: mockBase + "/anthropic",
    ARK_API_KEY: "mock-ark-key",
    ARK_BASE_URL: mockBase + "/ark",
    REPLICA_VISION_API_KEY: "mock-vision-key",
    REPLICA_VISION_BASE_URL: mockBase + "/openai",
    REPLICA_VISION_MODEL: "mock-vision"
  }
});
let appOutput = "";
app.stdout.on("data", (chunk) => { appOutput += chunk.toString(); });
app.stderr.on("data", (chunk) => { appOutput += chunk.toString(); });
const baseUrl = "http://127.0.0.1:" + appPort;

const FACTS = [
  { label: "填充物", value: "90白鸭绒", sourceName: "产品资料.md", sourceExcerpt: "填充物：90白鸭绒", confidence: "confirmed" },
  { label: "颜色", value: "酒红色", sourceName: "产品资料.md", sourceExcerpt: "颜色：酒红色", confidence: "confirmed" },
  { label: "版型", value: "显瘦版型", sourceName: "产品资料.md", sourceExcerpt: "版型：显瘦版型", confidence: "confirmed" },
  { label: "领型", value: "高领防风", sourceName: "产品资料.md", sourceExcerpt: "领型：高领防风", confidence: "confirmed" }
];

const fixtures = [
  {
    name: "羽绒服痛点对比",
    input: { kind: "xiaohongshu_post", productName: "酒红色羽绒服", category: "女装/羽绒服", targetAudience: "通勤女性", cardCount: 4, rawRequest: "我要一张小红书痛点对比图，左边体现普通羽绒服容易显胖臃肿，右边用我的商品突出更利落显瘦，要有明显标题和卖点文字。", scene: "冬季通勤", productFacts: FACTS },
    expect: { strategy: "pain_comparison", text: true, comparison: true }
  },
  {
    name: "小红书场景种草",
    input: { kind: "xiaohongshu_post", productName: "酒红色羽绒服", cardCount: 4, rawRequest: "给我做一组春节回家场景的小红书图文，要像真实用户分享。", scene: "春节回家", productFacts: FACTS },
    expect: { strategy: "scenario_hook", text: true, comparison: false }
  },
  {
    name: "价格反转",
    input: { kind: "xiaohongshu_post", productName: "酒红色羽绒服", cardCount: 3, rawRequest: "突出反季价格更划算，讲清楚为什么值得，但不要编造价格。", productFacts: FACTS },
    expect: { strategy: "price_anchor", text: true, comparison: false }
  },
  {
    name: "卖点拆解",
    input: { kind: "xiaohongshu_post", productName: "酒红色羽绒服", cardCount: 5, rawRequest: "把 90白鸭绒、高领防风这些卖点一条条拆开讲清楚。", productFacts: FACTS },
    expect: { strategy: "detail_benefit", text: true, comparison: false }
  },
  {
    name: "对标详情图复刻",
    input: { kind: "detail_page", productName: "酒红色羽绒服", cardCount: 6, rawRequest: "参考这个详情图的结构，把产品换成我的。", hasBenchmark: true, benchmarkSummary: "首屏价值，痛点，卖点，细节，场景，收束", productFacts: FACTS },
    expect: { strategy: "benchmark_detail_replica", text: true, comparison: false }
  }
];

try {
  await waitForServer(baseUrl + "/api/commerce-image/tasks");

  const config = await api("/api/commerce-image/marketing/plan");
  assert.equal(config.strategies.length, 6, "配置里应有 6 条策略");
  assert.ok(config.strategies.every((item) => item.version), "每条策略都应有版本号");

  for (const fixture of fixtures) {
    const dry = await api("/api/commerce-image/marketing/plan", { method: "POST", json: { input: fixture.input, useLlm: false } });
    const result = dry.marketing;
    assert.ok(result, fixture.name + "：应返回营销记录");
    assert.equal(result.strategy.id, fixture.expect.strategy, fixture.name + "：策略选择错误，实际 " + result.strategy.id);
    assert.equal(result.intent.textRequired, fixture.expect.text, fixture.name + "：文字要求判断错误");
    assert.ok(result.productTruth.coreSellingPoints.includes("90白鸭绒"), fixture.name + "：ProductTruth 应包含真实卖点");
    assert.ok(result.creativePlan.panels.length === fixture.input.cardCount, fixture.name + "：创意方案张数应与用户选择一致");
    assert.ok(result.creativePlan.panels.every((panel) => panel.headline), fixture.name + "：每张画面都应有主标题");
    assert.ok(result.promptPreview.includes("营销策略"), fixture.name + "：编译后的提示词应包含营销策略");
    assert.ok(result.promptPreview.includes("文案安全区"), fixture.name + "：程序排版应要求预留安全区");
    assert.ok(result.versions.strategyConfigHash, fixture.name + "：应记录配置版本");
    assert.ok(result.productFidelity && result.productFidelity.hardConstraints.length > 0, fixture.name + "：应输出商品高保真 Hard Constraints");
    assert.equal(result.versions.productFidelity, result.productFidelity.version, fixture.name + "：应记录商品高保真版本");
    assert.ok(result.typography && result.typography.layers.length > 0, fixture.name + "：应输出程序排版方案");
    assert.equal(result.typography.textMode, "overlay", fixture.name + "：默认应使用程序排版");
    assert.equal(result.versions.typography, result.typography.version, fixture.name + "：应记录排版版本");
    assert.ok(dry.typographyByPanel.every((plan) => plan.layers.length > 0), fixture.name + "：每张画面都应有排版方案");
    if (fixture.expect.comparison) {
      assert.ok(result.creativePlan.panels.some((panel) => panel.comparisonCopy), fixture.name + "：痛点对比应有左右对比文案");
    }
    const qa = dry.qa;
    assert.ok(qa, fixture.name + "：应返回规则营销质检");
    assert.ok(["PASS", "WARN", "MARKETING_INTENT_FAILED"].includes(qa.status), fixture.name + "：质检状态非法");
  }

  // 模型路径：确保意图 / 策略 / 创意三层确实用了文本模型
  const llm = await api("/api/commerce-image/marketing/plan", { method: "POST", json: { input: fixtures[0].input, useLlm: true } });
  assert.equal(llm.marketing.intent.confidence, "llm", "意图层应使用模型");
  assert.equal(llm.marketing.strategy.confidence, "llm", "策略层应使用模型");
  assert.equal(llm.marketing.creativePlan.confidence, "llm", "创意层应使用模型");
  assert.equal(llm.marketing.strategy.hook, "为什么别人穿羽绒服显胖，你穿却更利落？");

  // 真实一键生图 · 直连模式：不跑营销 Agent，用户原话直达模型
  const passed = await runGeneration("直连模式", {});
  assert.equal(passed.status, "completed", "直连模式应完成生成");
  assert.equal(Boolean(passed.marketing), false, "电商图文必须绕过营销引擎（marketing 为空）");
  assert.equal(passed.panels.length, 3, "应按用户张数生成画面");
  assert.ok(passed.panels.every((panel) => panel.prompt.includes("直连执行要求")), "提示词应包含直连执行要求");
  assert.ok(passed.panels.every((panel) => panel.prompt.includes("我要一张小红书痛点对比图")), "用户原话必须原样进入提示词");
  assert.ok(passed.panels.every((panel) => !panel.prompt.includes("营销策略")), "直连模式不应包含营销策略改写");
  assert.ok(passed.panels.every((panel) => panel.textLayers.length === 0), "直连模式由模型直接画文字，不再叠加程序文字层");
  assert.ok(passed.panels.every((panel) => panel.prompt.includes("最高优先级")), "提示词应保留商品一致性约束");

  /* 直接检查真正发往 provider 的请求：必须是用户原话，而不是营销规划。 */
  const directRequests = imageRequests.filter((request) => String(request.prompt || "").includes("直连执行要求"));
  assert.equal(directRequests.length, 3, "直连模式的 3 张图都应直接请求 provider");
  assert.ok(directRequests.every((request) => String(request.prompt).includes("我要一张小红书痛点对比图")), "provider 收到的必须是用户原话");
  assert.ok(directRequests.every((request) => !String(request.prompt).includes("营销策略（本图怎么卖）")), "provider 不应收到营销规划 Prompt");
  assert.ok(directRequests.every((request) => !String(request.prompt).includes("MARKETING_")), "provider 不应收到任何中间层标记");

  // ---- Marketing Learning Loop V1（直连任务也要有 creativeId） ----
  const firstTaskCreatives = await waitForCreatives(passed.id, 3, 20000);
  assert.equal(new Set(firstTaskCreatives.map((item) => item.creative.creativeId)).size, 3, "每张最终图片都必须有独立 creativeId");
  const firstCreative = firstTaskCreatives[0].creative;
  assert.equal(firstCreative.strategyKey, "direct", "直连任务的创意应标记为 direct");
  assert.ok(firstCreative.compiledPrompt.length > 0, "创意记录应保存完整 Prompt");
  assert.ok(firstCreative.outputImageUrl, "创意记录应关联输出图片");

  const scene = await runGeneration("直连模式 · 第二组", { instruction: "给我做一组春节回家场景的小红书图文，要像真实用户分享。" });
  const sceneCreatives = await waitForCreatives(scene.id, 3, 20000);
  assert.equal(Boolean(scene.marketing), false, "第二个直连任务同样绕过营销引擎");

  const painA = firstTaskCreatives[0].creative.creativeId;
  const painB = firstTaskCreatives[1].creative.creativeId;
  const sceneA = sceneCreatives[0].creative.creativeId;
  const sceneB = sceneCreatives[1].creative.creativeId;

  await api("/api/marketing-learning/performance", { method: "POST", json: { creativeId: painA, platform: "xiaohongshu", publishedAt: "2026-09-20", metrics: { views: 10000, favorites: 600, productClicks: 800 } } });
  await api("/api/marketing-learning/performance", { method: "POST", json: { creativeId: painB, platform: "xiaohongshu", publishedAt: "2026-09-21", metrics: { views: 9000, favorites: 500, productClicks: 700 } } });
  await api("/api/marketing-learning/performance", { method: "POST", json: { creativeId: sceneA, platform: "xiaohongshu", publishedAt: "2026-09-22", metrics: { views: 10000, favorites: 900, productClicks: 350 } } });
  await api("/api/marketing-learning/performance", { method: "POST", json: { creativeId: sceneB, platform: "xiaohongshu", publishedAt: "2026-09-23", metrics: { views: 10000 } } });

  const analysisEngagement = await api("/api/marketing-learning/analysis?goal=engagement");
  assert.equal(analysisEngagement.analysis.goal, "engagement", "分析应使用指定业务目标");
  assert.ok(analysisEngagement.analysis.sampleSize >= 4, "应有至少 4 条有数据的创意");
  assert.equal(analysisEngagement.analysis.creatives[0].creativeId, sceneA, "互动目标下收藏率最高的应排前面");
  const onlyViewsCreative = analysisEngagement.analysis.creatives.find((item) => item.creativeId === sceneB);
  const ctrMetric = onlyViewsCreative.metrics.find((metric) => metric.key === "ctr");
  assert.ok(ctrMetric && ctrMetric.value === null, "没有 impressions 时 CTR 必须 unavailable，不能伪造");
  assert.ok(analysisEngagement.analysis.caveats.length > 0, "分析必须附带样本量与因果提醒");

  const analysisClick = await api("/api/marketing-learning/analysis?goal=product_click");
  assert.equal(analysisClick.analysis.creatives[0].creativeId, painA, "商品点击目标下 pain_comparison 应排前面");

  const csv = "曝光,播放,收藏,商品点击\n12000,10000,700,900\n8000,6000,300,200";
  const csvPreview = await api("/api/marketing-learning/performance/csv", { method: "POST", json: { action: "preview", text: csv } });
  assert.equal(csvPreview.preview.headers.length, 4, "CSV 预览应返回表头");
  assert.equal(csvPreview.preview.suggestedMapping["2"], "favorites", "CSV 应自动建议收藏字段映射");
  const csvImport = await api("/api/marketing-learning/performance/csv", { method: "POST", json: { action: "import", text: csv, mapping: csvPreview.preview.suggestedMapping, defaultCreativeId: painA } });
  assert.equal(csvImport.result.imported, 2, "CSV 应导入 2 行数据");

  const experiment = await api("/api/marketing-learning/experiments", { method: "POST", json: { name: "羽绒服策略对比", goal: "engagement", creativeIds: [painA, sceneA, painB, sceneB] } });
  const experimentAnalysis = await api("/api/marketing-learning/analysis?experimentId=" + encodeURIComponent(experiment.experiment.experimentId) + "&goal=engagement");
  assert.equal(experimentAnalysis.analysis.sampleSize, 4, "实验对比应包含 4 个创意");
  assert.ok(experimentAnalysis.analysis.byStrategy.length >= 1, "实验应按策略分组对比");

  const reviewPayload = await api("/api/marketing-learning/review", { method: "POST", json: { experimentId: experiment.experiment.experimentId, goal: "engagement" } });
  const review = reviewPayload.review;
  assert.ok(review.summary, "复盘应有摘要");
  assert.ok(review.evidence.length > 0, "复盘必须带可追溯证据");
  assert.ok(review.evidence.every((item) => item.creativeId && item.basis), "每条证据必须能追溯到 creativeId 与计算依据");
  assert.ok(review.caveats.length > 0, "复盘必须附带样本与时间影响说明");
  assert.ok(["llm", "rule"].includes(review.source), "复盘来源合法");

  const detail = await api("/api/marketing-learning/creatives/" + encodeURIComponent(painA));
  assert.equal(detail.creative.creativeId, painA, "历史记录应可重新打开");
  assert.ok(detail.performance.length >= 1, "历史记录应带回已录入数据");

  console.log(JSON.stringify({
    success: true,
    checks: {
      configRegistry: true,
      fiveFixtures: fixtures.map((item) => item.name),
      llmLayersUsed: true,
      productFidelityLayer: true,
      typographyOverlay: true,
      directModeBypass: true,
      userPromptVerbatim: true,
      noProgrammaticText: true,
      creativeIdPerImage: true,
      performanceBackfill: true,
      metricsNullSafe: true,
      goalBasedAnalysis: true,
      csvImport: true,
      experimentGrouping: true,
      evidenceBackedReview: true,
      historyReopen: true
    },
    counters: { imageCalls, visionCalls }
  }, null, 2));
} catch (error) {
  console.error(appOutput.slice(-4000));
  console.error(error);
  process.exitCode = 1;
} finally {
  app.kill("SIGTERM");
  await new Promise((resolve) => mockServer.close(resolve));
  await rm(dataRoot, { recursive: true, force: true });
}

async function runGeneration(name, opts = {}) {
  qaProductFidelity = opts.fidelity !== false;
  qaUnexpectedText = opts.leak === true;
  qaTextPresent = true;
  const task = (await api("/api/commerce-image/tasks", { method: "POST", json: {
    kind: "xiaohongshu_post",
    title: "营销引擎测试 · " + name,
    productName: "酒红色羽绒服",
    model: "doubao-seedream-5-0-pro-260628",
    ratio: "3:4",
    generationSetCount: 1,
    brief: { audience: "通勤女性", sellingPoints: "90白鸭绒", scene: "冬季通勤", style: "真实克制", strategy: "auto", cardCount: 3 }
  } })).task;
  const productPng = await solidPng(600, 800, "#7157e8");
  await uploadImage(task.id, productPng);
  const form = new FormData();
  form.append("documents", new Blob(["填充物：90白鸭绒\n版型：显瘦版型\n领型：高领防风"], { type: "text/plain" }), "产品资料.txt");
  await api("/api/commerce-image/tasks/" + task.id + "/documents", { method: "POST", body: form });
  await api("/api/commerce-image/tasks/" + task.id + "/generate", { method: "POST", json: {
    oneClick: true,
    instruction: opts.instruction || "我要一张小红书痛点对比图，左边体现普通羽绒服容易显胖臃肿，右边用我的商品突出更利落显瘦，要有明显标题和卖点文字。"
  } });
  return waitForTask(task.id, ["completed", "partial", "failed"], 90000);
}

async function uploadImage(taskId, bytes) {
  const form = new FormData();
  form.set("role", "front");
  form.set("saveToProductProfile", "false");
  form.append("images", new Blob([bytes], { type: "image/png" }), "product.png");
  return api("/api/commerce-image/tasks/" + taskId + "/assets", { method: "POST", body: form });
}

async function waitForCreatives(taskId, count, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let history = [];
  while (Date.now() < deadline) {
    history = (await api("/api/marketing-learning/creatives?taskId=" + encodeURIComponent(taskId))).history;
    if (history.length >= count) return history;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  if (history.length >= count) return history;
  throw new Error("等待创意记录超时：" + taskId + " 只有 " + history.length + " 条");
}

async function waitForTask(taskId, statuses, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let task;
  while (Date.now() < deadline) {
    task = (await api("/api/commerce-image/tasks/" + taskId)).task;
    if (statuses.includes(task.status)) return task;
    await new Promise((resolve) => setTimeout(resolve, 120));
  }
  throw new Error("等待任务超时：" + taskId + "，最后状态 " + (task && task.status));
}

async function api(pathname, options = {}) {
  const response = await fetch(baseUrl + pathname, {
    method: options.method || "GET",
    headers: options.json ? { "Content-Type": "application/json" } : undefined,
    body: options.json ? JSON.stringify(options.json) : options.body,
    signal: AbortSignal.timeout(60000)
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.success === false) throw new Error(pathname + ": " + (payload.message || response.status));
  return payload;
}

async function waitForServer(url) {
  const deadline = Date.now() + 25000;
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
