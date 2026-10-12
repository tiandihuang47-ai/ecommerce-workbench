const input = process.argv.slice(2).join(" ").trim();
const endpoint = process.env.DEBUG_COMMENTS_ENDPOINT || "http://localhost:3010/api/video/debug-comments";

if (!input) {
  console.error("请传入抖音链接，例如：npm run debug:comments -- \"https://v.douyin.com/oRwZUNqvDr8/\"");
  process.exit(1);
}

try {
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url: input })
  });
  const payload = await response.json().catch(() => ({}));
  console.log(JSON.stringify(payload, null, 2));
  process.exit(response.ok ? 0 : 1);
} catch (error) {
  console.error(JSON.stringify({
    success: false,
    message: error instanceof Error ? error.message : "debug-comments 请求失败。",
    suggestion: "请确认 Next.js 开发服务已启动：npm run dev -- --port 3010"
  }, null, 2));
  process.exit(1);
}
