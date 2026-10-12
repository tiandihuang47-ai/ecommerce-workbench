const input = process.argv.slice(2).join(" ").trim();
const endpoint = process.env.DEBUG_TRANSCRIPT_ENDPOINT || "http://localhost:3010/api/video/debug-transcript";

if (!input) {
  console.error("请传入视频链接，例如：npm run debug:transcript -- \"https://www.douyin.com/video/7649234254945144074\"");
  process.exit(1);
}

try {
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sourceType: "link", url: input })
  });
  const payload = await response.json().catch(() => ({}));
  console.log(JSON.stringify(simplify(payload), null, 2));
  process.exit(response.ok && payload.success ? 0 : 1);
} catch (error) {
  console.error(JSON.stringify({
    success: false,
    message: error instanceof Error ? error.message : "debug-transcript 请求失败。",
    suggestion: "请确认 Next.js 开发服务已启动：npm run dev -- --port 3010"
  }, null, 2));
  process.exit(1);
}

function simplify(payload) {
  return {
    success: Boolean(payload.success),
    sourceType: payload.sourceType || "link",
    cleanUrl: payload.cleanUrl || "",
    platform: payload.platform || "unknown",
    videoPath: payload.videoPath || "",
    audioPath: payload.audioPath || "",
    transcriptOk: Boolean(payload.transcript),
    transcriptPreview: payload.transcriptPreview || "",
    currentStage: Array.isArray(payload.steps) ? payload.steps.find((step) => step.status === "failed")?.name || "完成" : "",
    steps: payload.steps || [],
    rawError: payload.rawError || "",
    suggestion: payload.suggestion || ""
  };
}
