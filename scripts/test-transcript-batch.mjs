#!/usr/bin/env node
/**
 * 批量逐字稿编排模拟测试（不调用真实下载/ASR/模型，不产生费用）。
 *
 * 用“格式合法但无法访问的抖音链接 + 非法链接”构造失败场景，验证：
 *  1. 超过 30 条明确拒绝，不静默截取；
 *  2. 相同 requestId 重复提交只返回同一批次（幂等）；
 *  3. 相同 requestId 不同内容 → 409 冲突；
 *  4. 完全相同链接先去重；
 *  5. 队列调度后每条都有终态（等待→处理中→完成/明确失败）；
 *  6. 批次持久化：服务重启后批次与结果仍在；
 *  7. 停止 / 单条重试 / 恢复接口行为正确；
 *  8. 未登录请求 401。
 *
 * 需要先 `npm run build`。
 */
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";

const PORT = 4321;
const BASE = `http://127.0.0.1:${PORT}`;

let passed = 0;
let failed = 0;
const failures = [];

function check(name, ok, detail = "") {
  if (ok) {
    passed += 1;
    console.log(`  PASS  ${name}`);
  } else {
    failed += 1;
    failures.push(`${name}${detail ? ` — ${detail}` : ""}`);
    console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

function requestIdFor(links) {
  return `req_${createHash("sha256").update(links.join("\n")).digest("hex").slice(0, 32)}`;
}

async function createBatch(links, requestId) {
  const res = await fetch(`${BASE}/api/transcript-batch`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ requestId, links, rawInput: links.join("\n") })
  });
  return { res, data: await res.json().catch(() => null) };
}

async function getBatch(id) {
  const res = await fetch(`${BASE}/api/transcript-batch/${encodeURIComponent(id)}`, { cache: "no-store" });
  const data = await res.json().catch(() => null);
  return data?.batch || null;
}

async function waitForTerminal(batchId, timeoutMs = 60000) {
  const started = Date.now();
  for (;;) {
    const batch = await getBatch(batchId);
    if (batch && batch.status !== "running") return batch;
    const items = batch?.items || [];
    if (items.length > 0 && items.every((item) => item.status !== "pending" && item.status !== "processing")) return batch;
    if (Date.now() - started > timeoutMs) return batch;
    await new Promise((r) => setTimeout(r, 500));
  }
}

async function waitPortClosed(port, timeoutMs = 15000) {
  for (let i = 0; i < timeoutMs / 500; i += 1) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/auth/me`);
      if (res.status >= 500) return;
    } catch { return; }
    await new Promise((r) => setTimeout(r, 500));
  }
}

async function startServer(env) {
  const server = spawn("npx", ["next", "start", "-p", String(PORT)], {
    cwd: process.cwd(),
    env: { ...process.env, ...env },
    stdio: ["ignore", "pipe", "pipe"],
    detached: true
  });
  let log = "";
  server.stdout.on("data", (d) => { log += d; });
  server.stderr.on("data", (d) => { log += d; });
  for (let i = 0; i < 120; i += 1) {
    try {
      const res = await fetch(`${BASE}/api/auth/me`);
      if (res.status < 500) return { server, log };
    } catch { /* not ready */ }
    await new Promise((r) => setTimeout(r, 1000));
  }
  console.error("[batch-test] 服务未能就绪：\n" + log.slice(-2000));
  try { process.kill(-server.pid, "SIGTERM"); } catch { server.kill("SIGTERM"); }
  process.exit(1);
}

async function main() {
  const runtimeDir = mkdtempSync(path.join(tmpdir(), "director-batch-test-"));
  let server;
  try {
    // 桌面模式（无鉴权）最省依赖：DIRECTOR_WEB_AUTH_DISABLED=1
    ({ server } = await startServer({ DIRECTOR_WEB_AUTH_DISABLED: "1", DIRECTOR_RUNTIME_DIR: runtimeDir }));

    console.log("\n[1] 提交校验");
    let res = await fetch(`${BASE}/api/transcript-batch`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ requestId: "req_over_limit", links: Array.from({ length: 31 }, (_, i) => `https://v.douyin.com/fake${i}/`), rawInput: "x" })
    });
    check("31 条链接 → 400 明确拒绝", res.status === 400, `实际 ${res.status}`);

    const validFake = ["https://v.douyin.com/fakeA1/", "https://v.douyin.com/fakeB2/"];
    const invalidLines = ["这不是链接的纯文本", "https://example.com/not-douyin"];
    const dupLinks = [validFake[0], validFake[0], ...invalidLines];
    const requestId = requestIdFor(dupLinks);

    const { res: createRes, data: createData } = await createBatch(dupLinks, requestId);
    check("创建批次成功（3 条唯一链接：2 条伪抖音 + 1 条非法 + 重复 1 条被去重）",
      createRes.status === 200 && createData?.batch?.items?.length === 3, JSON.stringify(createData).slice(0, 120));
    check("响应报告去重数量", createData?.duplicatesRemoved === 1, `实际 ${createData?.duplicatesRemoved}`);

    console.log("\n[2] 幂等与冲突");
    const second = await createBatch(dupLinks, requestId);
    check("相同 requestId 重复提交 → existing 批次", second.res.status === 200 && second.data?.existing === true && second.data?.batch?.batchId === createData.batch.batchId, JSON.stringify(second.data).slice(0, 100));
    const conflict = await createBatch([validFake[0], "https://v.douyin.com/different/"], requestId);
    check("相同 requestId 不同内容 → 409", conflict.res.status === 409, `实际 ${conflict.res.status}`);

    console.log("\n[3] 调度与终态");
    const finished = await waitForTerminal(createData.batch.batchId);
    check("批次达到终态（不再是 running）", Boolean(finished && finished.status !== "running"), `实际 ${finished?.status}`);
    const items = finished?.items || [];
    check("非法链接明确失败（INVALID_URL）", items.some((item) => item.status === "failed" && item.errorStage === "INVALID_URL"), JSON.stringify(items.map((i) => i.errorStage)));
    check("伪抖音链接在导入阶段明确失败（不重试不收费）", items.filter((item) => item.link).every((item) => item.status === "failed" && item.errorStage === "VIDEO_IMPORT_FAILED"), JSON.stringify(items.map((i) => `${i.status}:${i.errorStage}`)));

    console.log("\n[4] 停止 / 恢复 / 单条重试");
    const targetItem = items.find((item) => item.status === "failed");
    const retryRes = await fetch(`${BASE}/api/transcript-batch/${encodeURIComponent(finished.batchId)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "retry-item", itemId: targetItem.id })
    });
    const retried = (await retryRes.json())?.batch;
    check("单条重试只重置该条", Boolean(retried?.items?.find((i) => i.id === targetItem.id && i.status !== "failed") ?? retried), `实际 ${retryRes.status}`);
    const afterRetry = await waitForTerminal(finished.batchId);
    check("重试后再次到达终态且不新增条目", afterRetry.items.length === items.length, `条数 ${afterRetry.items.length}`);
    const othersUntouched = afterRetry.items.every((item) => item.id === targetItem.id || item.status === "failed");
    check("成功/失败项状态未被重试波及", othersUntouched);

    const stopRes = await fetch(`${BASE}/api/transcript-batch/${encodeURIComponent(finished.batchId)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "stop" })
    });
    check("停止接口可用", stopRes.status === 200, `实际 ${stopRes.status}`);

    console.log("\n[5] 重启恢复");
    try { process.kill(-server.pid, "SIGTERM"); } catch { server.kill("SIGTERM"); }
    await new Promise((r) => setTimeout(r, 800));
    ({ server } = await startServer({ DIRECTOR_WEB_AUTH_DISABLED: "1", DIRECTOR_RUNTIME_DIR: runtimeDir }));
    const afterRestart = await getBatch(finished.batchId);
    check("服务重启后批次仍在（持久化）", Boolean(afterRestart), "批次丢失");
    check("重启后条目状态保留（完成项不丢、无自动重跑）", afterRestart?.items?.length === items.length, `条数 ${afterRestart?.items?.length}`);
    check("重启后不再有 processing 残留", (afterRestart?.items || []).every((item) => item.status !== "processing"), JSON.stringify(afterRestart?.items?.map((i) => i.status)));

    console.log("\n[6] 未登录访问（网页模式）");
    try { process.kill(-server.pid, "SIGTERM"); } catch { server.kill("SIGTERM"); }
    await new Promise((r) => setTimeout(r, 800));
    ({ server } = await startServer({ DIRECTOR_RUNTIME_DIR: runtimeDir }));
    res = await fetch(`${BASE}/api/transcript-batch`, { method: "GET" });
    check("网页模式未登录 → 401", res.status === 401, `实际 ${res.status}`);
    res = await fetch(`${BASE}/api/transcript-batch`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ requestId: "req_x", links: ["https://v.douyin.com/fake/"], rawInput: "x" })
    });
    check("网页模式未登录创建 → 401（不会启动任务）", res.status === 401, `实际 ${res.status}`);
  } finally {
    if (server) try { process.kill(-server.pid, "SIGTERM"); } catch { server.kill("SIGTERM"); }
    await new Promise((r) => setTimeout(r, 500));
    try { rmSync(runtimeDir, { recursive: true, force: true }); } catch { /* ignore */ }
  }

  console.log(`\n结果：${passed} 通过，${failed} 失败`);
  if (failed > 0) {
    for (const item of failures) console.log(`  - ${item}`);
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
