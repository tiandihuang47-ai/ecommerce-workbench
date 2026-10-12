const input = process.argv.slice(2).join(" ").trim();
const transcriptEndpoint = process.env.DEBUG_TRANSCRIPT_ENDPOINT || "http://localhost:3010/api/video/debug-transcript";
const commentsEndpoint = process.env.DEBUG_COMMENTS_ENDPOINT || "http://localhost:3010/api/video/debug-comments";

if (!input) {
  console.error("请传入视频链接，例如：npm run debug:deconstruction -- \"https://www.douyin.com/video/7649234254945144074\"");
  process.exit(1);
}

const output = {
  success: false,
  input,
  cleanUrl: "",
  platform: "unknown",
  transcript: {
    success: false,
    stage: "",
    preview: "",
    suggestion: ""
  },
  comments: {
    success: false,
    videoId: "",
    commentsCount: 0,
    topComments: [],
    suggestion: ""
  }
};

try {
  const transcriptResponse = await fetch(transcriptEndpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sourceType: "link", url: input })
  });
  const transcriptPayload = await transcriptResponse.json().catch(() => ({}));
  output.cleanUrl = transcriptPayload.cleanUrl || "";
  output.platform = transcriptPayload.platform || "unknown";
  output.transcript = {
    success: Boolean(transcriptPayload.success),
    stage: Array.isArray(transcriptPayload.steps) ? transcriptPayload.steps.find((step) => step.status === "failed")?.name || "完成" : "",
    preview: transcriptPayload.transcriptPreview || "",
    suggestion: transcriptPayload.suggestion || ""
  };

  const commentsResponse = await fetch(commentsEndpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url: input })
  });
  const commentsPayload = await commentsResponse.json().catch(() => ({}));
  output.comments = {
    success: Boolean(commentsPayload.success),
    videoId: commentsPayload.videoId || "",
    commentsCount: commentsPayload.commentsCount || 0,
    topComments: (commentsPayload.topComments || []).slice(0, 10).map((item) => ({
      content: item.content,
      likeCount: item.likeCount
    })),
    suggestion: commentsPayload.suggestion || ""
  };

  output.success = output.transcript.success || output.comments.success;
  console.log(JSON.stringify(output, null, 2));
  process.exit(output.success ? 0 : 1);
} catch (error) {
  console.error(JSON.stringify({
    success: false,
    input,
    message: error instanceof Error ? error.message : "debug-deconstruction 请求失败。",
    suggestion: "请确认 Next.js 开发服务已启动：npm run dev -- --port 3010"
  }, null, 2));
  process.exit(1);
}
