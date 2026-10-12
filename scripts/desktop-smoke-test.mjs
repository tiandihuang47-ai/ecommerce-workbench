const baseUrl = process.env.SMOKE_BASE_URL || "http://127.0.0.1:3010";
const routes = [
  { name: "工作台", path: "/" },
  { name: "AI 对话", path: "/ai-chat" },
  { name: "脚本", path: "/script-generator" },
  { name: "拆片", path: "/deconstruction" },
  { name: "生图", path: "/image-generator" },
  { name: "数据复盘", path: "/reviews" },
];

const results = [];

for (const route of routes) {
  const url = `${baseUrl}${route.path}`;
  const startedAt = Date.now();

  try {
    const response = await fetch(url, {
      headers: { Accept: "text/html" },
      signal: AbortSignal.timeout(15000),
    });
    const body = await response.text();
    const success = response.status === 200 && body.includes("<html");

    results.push({
      name: route.name,
      path: route.path,
      status: response.status,
      success,
      durationMs: Date.now() - startedAt,
      error: success ? "" : "页面没有返回正常 HTML",
    });
  } catch (error) {
    results.push({
      name: route.name,
      path: route.path,
      status: 0,
      success: false,
      durationMs: Date.now() - startedAt,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

const success = results.every((result) => result.success);
console.log(JSON.stringify({ success, baseUrl, results }, null, 2));

if (!success) {
  console.error("\n核心页面检查失败。请先确认桌面服务已启动，再查看上方失败页面。");
  process.exit(1);
}

console.log("\n核心页面检查通过。");
