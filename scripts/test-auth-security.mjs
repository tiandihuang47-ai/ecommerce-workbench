#!/usr/bin/env node
/**
 * 鉴权安全自动化测试（不调用任何真实模型、不产生费用）。
 *
 * 需要先 `npm run build`，然后本脚本会：
 *   1. 在临时目录准备一套隔离的认证数据（管理员 + 普通员工，均为测试账号）；
 *   2. 以该目录启动 `next start`（生产构建，仅监听本地端口）；
 *   3. 逐项验证：
 *      - 无 Cookie / 伪造 Cookie / 过期 Cookie → 401，且响应来自中间件（业务未执行）；
 *      - 普通员工访问管理员接口（员工管理 / Skill 导入 / 风格库导入 / 品牌档案写入）→ 403；
 *      - 跨账号资源隔离（/api/storage 按用户隔离；link-analyzer job 归属校验）；
 *      - 跨站 Origin 的写请求 → 403；
 *      - 登录失败限速（连续失败后 429）；
 *      - 管理员与桌面关键流程仍可用（登录、读技能列表、读模型路由总览）。
 *
 * 用法：node scripts/test-auth-security.mjs
 */
import { spawn } from "node:child_process";
import { randomBytes, scryptSync } from "node:crypto";
import { mkdirSync, writeFileSync, rmSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const PORT = 4319;
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

function hashPassword(password) {
  const salt = randomBytes(16);
  const derived = scryptSync(password, salt, 64, { N: 16384, r: 8, p: 1 });
  return ["scrypt", 16384, 8, 1, salt.toString("hex"), derived.toString("hex")].join("$");
}

async function main() {
  const runtimeDir = mkdtempSync(path.join(tmpdir(), "director-auth-test-"));
  const authDir = path.join(runtimeDir, "auth");
  mkdirSync(authDir, { recursive: true });

  // 会话签名密钥（测试专用）
  const secret = randomBytes(32).toString("hex");
  writeFileSync(path.join(authDir, "secret"), secret + "\n", { mode: 0o600 });

  // 测试账号：管理员 + 普通员工
  const adminId = "u_test_admin_0001";
  const staffId = "u_test_staff_0001";
  const now = new Date().toISOString();
  const users = [
    { id: adminId, username: "admin_test", nickname: "测试管理员", role: "admin", status: "active", passwordHash: hashPassword("admin-pass-123"), createdAt: now, updatedAt: now },
    { id: staffId, username: "staff_test", nickname: "测试员工", role: "user", status: "active", passwordHash: hashPassword("staff-pass-123"), createdAt: now, updatedAt: now }
  ];
  writeFileSync(path.join(authDir, "users.json"), JSON.stringify(users, null, 2), { mode: 0o600 });

  console.log(`[auth-test] 隔离运行数据：${runtimeDir}`);
  console.log("[auth-test] 启动 next start …");

  const server = spawn("npx", ["next", "start", "-p", String(PORT)], {
    cwd: process.cwd(),
    env: { ...process.env, DIRECTOR_RUNTIME_DIR: runtimeDir, NODE_ENV: "production" },
    stdio: ["ignore", "pipe", "pipe"],
    detached: true
  });
  let serverLog = "";
  server.stdout.on("data", (d) => { serverLog += d; });
  server.stderr.on("data", (d) => { serverLog += d; });

  const waitForServer = async () => {
    for (let i = 0; i < 120; i += 1) {
      try {
        const res = await fetch(`${BASE}/api/auth/me`);
        if (res.status < 500) return true;
      } catch { /* not ready */ }
      await new Promise((r) => setTimeout(r, 1000));
    }
    return false;
  };

  try {
    const ready = await waitForServer();
    if (!ready) {
      console.error("[auth-test] 服务未能在 120 秒内就绪，输出：\n" + serverLog.slice(-2000));
      process.exit(1);
    }

    /* ---------- 1. 无 Cookie / 伪造 / 过期会话 ---------- */
    console.log("\n[1] 未认证请求必须被拒绝");
    let res = await fetch(`${BASE}/api/commerce-image/tasks`, { method: "GET" });
    check("无 Cookie 访问任务列表 → 401", res.status === 401, `实际 ${res.status}`);

    res = await fetch(`${BASE}/api/ai-chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages: [{ role: "user", content: "hi" }] })
    });
    check("无 Cookie 调用 AI 对话（收费入口）→ 401", res.status === 401, `实际 ${res.status}`);

    res = await fetch(`${BASE}/api/commerce-image/tasks`, {
      headers: { cookie: "director_session=forged.signature.value" }
    });
    check("伪造 Cookie → 401", res.status === 401, `实际 ${res.status}`);

    // 过期但签名正确的 token：用测试密钥手工构造
    const { createHmac } = await import("node:crypto");
    const expiredPayload = Buffer.from(JSON.stringify({
      uid: adminId, username: "admin_test", role: "admin", exp: Math.floor(Date.now() / 1000) - 3600
    })).toString("base64url");
    const expiredSig = createHmac("sha256", Buffer.from(secret, "hex")).update(expiredPayload).digest("base64url");
    res = await fetch(`${BASE}/api/commerce-image/tasks`, {
      headers: { cookie: `director_session=${expiredPayload}.${expiredSig}` }
    });
    check("过期 Cookie（签名正确）→ 401", res.status === 401, `实际 ${res.status}`);

    // 错误密钥签名（另一台机器伪造）
    const badSig = createHmac("sha256", Buffer.from(randomBytes(32))).update(expiredPayload).digest("base64url");
    res = await fetch(`${BASE}/api/commerce-image/tasks`, {
      headers: { cookie: `director_session=${expiredPayload}.${badSig}` }
    });
    check("错误密钥签名 → 401", res.status === 401, `实际 ${res.status}`);

    // 未登录访问页面 → 跳转登录
    res = await fetch(`${BASE}/`, { redirect: "manual" });
    check("未登录访问首页 → 跳转 /login", res.status === 307 || res.status === 302, `实际 ${res.status}`);

    /* ---------- 2. 登录与角色边界 ---------- */
    console.log("\n[2] 登录、角色与管理员边界");

    // 员工登录失败限速：连续 6 次错误密码
    let saw429 = false;
    for (let i = 0; i < 6; i += 1) {
      const r = await fetch(`${BASE}/api/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: "staff_test", password: "wrong-password" })
      });
      if (r.status === 429) saw429 = true;
    }
    check("连续登录失败触发限速 → 429", saw429, "未观察到 429");

    // 员工正确密码仍被限速（同用户名）
    res = await fetch(`${BASE}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "staff_test", password: "staff-pass-123" })
    });
    check("限速窗口内正确密码也被拒绝", res.status === 429, `实际 ${res.status}`);

    // 换用户名不受该用户名限速影响（员工2号不存在 → 401 而非 429）
    res = await fetch(`${BASE}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "admin_test", password: "admin-pass-123" })
    });
    check("管理员登录正常（不同用户名不受影响）", res.status === 200, `实际 ${res.status}`);
    const adminCookie = (res.headers.getSetCookie?.() || []).map((c) => c.split(";")[0]).find((c) => c.startsWith("director_session=")) || "";

    // 员工登录被限速（限速按用户名隔离、内存态），员工会话改用测试密钥直接构造合法 token。
    // 注意：这个 token 由服务端同款 HMAC 算法构造，等于“合法登录”，不是伪造。
    const { createHmac: hmac } = await import("node:crypto");
    const staffPayload = Buffer.from(JSON.stringify({
      uid: staffId, username: "staff_test", role: "user", exp: Math.floor(Date.now() / 1000) + 3600
    })).toString("base64url");
    const staffSig = hmac("sha256", Buffer.from(secret, "hex")).update(staffPayload).digest("base64url");
    const staffCookie = `director_session=${staffPayload}.${staffSig}`;

    const authed = (extra = {}) => ({ headers: { cookie: adminCookie, ...extra }, ...{} });
    const staffAuthed = (extra = {}) => ({ headers: { cookie: staffCookie, ...extra }, ...{} });

    // 员工访问管理员接口 → 403
    res = await fetch(`${BASE}/api/admin/users`, staffAuthed());
    check("员工读员工管理 → 403", res.status === 403, `实际 ${res.status}`);

    res = await fetch(`${BASE}/api/admin/users`, {
      method: "POST",
      ...staffAuthed({ "Content-Type": "application/json" }),
      body: JSON.stringify({ username: "hacker", password: "123456" })
    });
    check("员工创建账号 → 403", res.status === 403, `实际 ${res.status}`);

    res = await fetch(`${BASE}/api/skills`, {
      method: "POST",
      ...staffAuthed({ "Content-Type": "application/json" }),
      body: JSON.stringify({})
    });
    check("员工导入 Skill → 403", res.status === 403, `实际 ${res.status}`);

    res = await fetch(`${BASE}/api/commerce-image/style-skills`, {
      method: "POST",
      ...staffAuthed(),
      body: "not-a-form"
    });
    check("员工导入生图风格 Skill → 403", res.status === 403, `实际 ${res.status}`);

    res = await fetch(`${BASE}/api/commerce-image/profile`, {
      method: "PUT",
      ...staffAuthed({ "Content-Type": "application/json" }),
      body: JSON.stringify({ brandName: "x" })
    });
    check("员工改品牌档案 → 403", res.status === 403, `实际 ${res.status}`);

    res = await fetch(`${BASE}/api/skills`, staffAuthed());
    check("员工仍可读 Skill 列表 → 200", res.status === 200, `实际 ${res.status}`);

    res = await fetch(`${BASE}/api/settings/model-routing`, staffAuthed());
    check("员工可读模型路由总览（只读、无密钥）→ 200", res.status === 200, `实际 ${res.status}`);

    /* ---------- 3. 跨站写请求防护 ---------- */
    console.log("\n[3] 同源 / CSRF 防护");
    res = await fetch(`${BASE}/api/admin/users`, {
      method: "POST",
      headers: { cookie: adminCookie, "Content-Type": "application/json", origin: "https://evil.example" },
      body: JSON.stringify({ username: "hacker", password: "123456" })
    });
    check("跨站 Origin 的写请求 → 403", res.status === 403, `实际 ${res.status}`);

    res = await fetch(`${BASE}/api/admin/users`, {
      method: "POST",
      headers: { cookie: adminCookie, "Content-Type": "application/json", origin: BASE },
      body: JSON.stringify({ username: "hacker_x", password: "123456", nickname: "x" })
    });
    check("同源 Origin 的写请求正常放行", res.status === 200 || res.status === 400, `实际 ${res.status}`);

    /* ---------- 4. 跨账号资源隔离 ---------- */
    console.log("\n[4] 跨账号资源隔离");
    // A（管理员）写入自己的存储键
    res = await fetch(`${BASE}/api/storage/test-ownership-key`, {
      method: "PUT",
      headers: { cookie: adminCookie, "Content-Type": "text/plain" },
      body: "admin-secret-value"
    });
    check("A 写入自己的存储键 → 200", res.status === 200, `实际 ${res.status}`);

    res = await fetch(`${BASE}/api/storage/test-ownership-key`, staffAuthed());
    const staffData = await res.json().catch(() => ({}));
    check("B 读不到 A 的存储键（404 或 null）", res.status === 404 || staffData.value === null, `实际 ${res.status} ${JSON.stringify(staffData).slice(0, 80)}`);

    res = await fetch(`${BASE}/api/storage/test-ownership-key`, authed());
    const adminData = await res.json();
    check("A 能读到自己的存储键", adminData.value === "admin-secret-value", `实际 ${JSON.stringify(adminData).slice(0, 80)}`);

    // link-analyzer job 归属：员工 A 创建 job，员工 B 凭 id 不可读
    res = await fetch(`${BASE}/api/link-analyzer/jobs`, {
      method: "POST",
      ...staffAuthed({ "Content-Type": "application/json" }),
      body: JSON.stringify({ url: "https://example.com/video/1" })
    });
    const jobBody = await res.json();
    const jobId = jobBody?.job?.id || "";
    check("员工创建链接分析任务成功", Boolean(jobId), `实际 ${res.status}`);
    if (jobId) {
      res = await fetch(`${BASE}/api/link-analyzer/jobs/${jobId}`, authed());
      check("他人凭 id 读取链接分析任务 → 404", res.status === 404, `实际 ${res.status}`);
      res = await fetch(`${BASE}/api/link-analyzer/jobs/${jobId}`, staffAuthed());
      check("本人可读取自己的任务 → 200", res.status === 200, `实际 ${res.status}`);
    }

    /* ---------- 5. 未认证时模型调用次数为零（结构性验证） ---------- */
    console.log("\n[5] 拒绝请求不触达业务（模型调用次数为零）");
    // 中间件在业务路由之前拒绝：以上所有 401/403 响应都来自 middleware/guard，
    // 不可能触发 model-router。这里再用一个“未认证也必须 401”的收费入口做代表并记录耗时，
    // 结构上 middleware 返回 401 时请求不会进入 route handler。
    const started = Date.now();
    res = await fetch(`${BASE}/api/script/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: "x" })
    });
    const elapsed = Date.now() - started;
    check("未认证调用脚本生成 → 401 且未进入业务", res.status === 401 && elapsed < 3000, `实际 ${res.status}，${elapsed}ms`);

    /* ---------- 6. 管理员核心流程仍可用 ---------- */
    console.log("\n[6] 管理员与桌面核心流程");
    res = await fetch(`${BASE}/api/admin/users`, authed());
    check("管理员读员工列表 → 200", res.status === 200, `实际 ${res.status}`);

    res = await fetch(`${BASE}/api/auth/me`, { headers: { cookie: adminCookie } });
    check("管理员会话有效 → 200", res.status === 200, `实际 ${res.status}`);

    /* ---------- 7. 存储版本、冲突与迁移语义 ---------- */
    console.log("\n[7] 存储版本与冲突");
    const kv = (key) => `${BASE}/api/storage/${encodeURIComponent(key)}`;
    res = await fetch(kv("test-version-key"), staffAuthed());
    check("读取不存在的键 → 404（迁移依赖该语义）", res.status === 404, `实际 ${res.status}`);

    res = await fetch(kv("test-version-key"), {
      method: "PUT",
      ...staffAuthed({ "Content-Type": "text/plain" }),
      body: "v1-content"
    });
    const put1 = await res.json();
    check("首次写入返回 version=1", res.status === 200 && put1.version === 1, `实际 ${JSON.stringify(put1)}`);

    res = await fetch(kv("test-version-key"), {
      method: "PUT",
      ...staffAuthed({ "Content-Type": "text/plain", "If-Match": "1" }),
      body: "v2-content"
    });
    const put2 = await res.json();
    check("携带正确 If-Match 再次写入 version=2", res.status === 200 && put2.version === 2, `实际 ${JSON.stringify(put2)}`);

    res = await fetch(kv("test-version-key"), {
      method: "PUT",
      ...staffAuthed({ "Content-Type": "text/plain", "If-Match": "1" }),
      body: "stale-content"
    });
    const conflictBody = await res.json();
    check("旧版本号写入 → 409 且带服务器版本", res.status === 409 && conflictBody.version === 2, `实际 ${res.status} ${JSON.stringify(conflictBody)}`);

    // 旧请求不能覆盖较新的修改：stale-content 不应成为最终值
    res = await fetch(kv("test-version-key"), staffAuthed());
    const finalValue = await res.json();
    check("冲突写入未生效（最终值仍是 v2）", finalValue.value === "v2-content", `实际 ${finalValue.value}`);

    // 删除后，迟到的旧版本保存不能“恢复”数据
    res = await fetch(kv("test-delete-key"), {
      method: "PUT",
      ...staffAuthed({ "Content-Type": "text/plain" }),
      body: "to-be-deleted"
    });
    const delPut = await res.json();
    res = await fetch(kv("test-delete-key"), { method: "DELETE", ...staffAuthed() });
    check("删除键成功", res.status === 200, `实际 ${res.status}`);
    res = await fetch(kv("test-delete-key"), {
      method: "PUT",
      ...staffAuthed({ "Content-Type": "text/plain", "If-Match": String(delPut.version || 1) }),
      body: "late-save"
    });
    check("删除后旧版本迟到保存 → 409（不会被恢复）", res.status === 409, `实际 ${res.status}`);
    res = await fetch(kv("test-delete-key"), staffAuthed());
    check("删除后读取仍为 404", res.status === 404, `实际 ${res.status}`);

    // 内容超限 → 413
    res = await fetch(kv("test-huge-key"), {
      method: "PUT",
      ...staffAuthed({ "Content-Type": "text/plain" }),
      body: "x".repeat(8 * 1024 * 1024 + 1)
    });
    const hugeBody = await res.text();
    check("超过 8MB 的内容 → 413", res.status === 413, `实际 ${res.status} ${hugeBody.slice(0, 120)}`);
    if (res.status !== 413) {
      // 提取错误页标题，帮助定位是哪一层拦截
      const titleMatch = hugeBody.match(/<title[^>]*>([^<]*)<\/title>/i);
      console.log(`  [debug] 错误页标题：${titleMatch?.[1] || "（无）"}`);
    }
  } finally {
    try { process.kill(-server.pid, "SIGTERM"); } catch { server.kill("SIGTERM"); }
    await new Promise((r) => setTimeout(r, 500));
    try { rmSync(runtimeDir, { recursive: true, force: true }); } catch { /* ignore */ }
  }

  console.log(`\n结果：${passed} 通过，${failed} 失败`);
  if (failed > 0) {
    console.log("失败项：");
    for (const item of failures) console.log(`  - ${item}`);
    console.log("---- 服务端日志（最后 40 行）----");
    console.log(serverLog.split("\n").slice(-40).join("\n"));
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
