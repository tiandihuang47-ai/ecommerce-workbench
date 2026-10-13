#!/usr/bin/env node
// Real HTTP regression checks against a production build and disposable data.
// No model calls, third-party scripts, real accounts or real credentials are used.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHmac, randomBytes } from "node:crypto";
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const root = await mkdtemp(path.join(tmpdir(), "director-api-privacy-"));
const base = "http://127.0.0.1:4328";
const secret = randomBytes(32);
const skillId = "skill_privacy_fixture";
const marker = "PRIVATE_BUSINESS_FIXTURE";
const users = [
  { id: "u_privacy_owner", username: "privacy_owner", role: "admin" },
  { id: "u_privacy_staff", username: "privacy_staff", role: "user" }
].map((user) => ({ ...user, nickname: user.username, status: "active", passwordHash: "", createdAt: "", updatedAt: "" }));
const reads = ["/api/skills", `/api/skills/${skillId}`, "/api/commerce-image/profile", "/api/commerce-image/style-skills", "/api/commerce-image/assistants", "/api/marketing-learning/experiments"];
let server;
let log = "";
let passed = 0;

async function jsonFile(relative, value) {
  const file = path.join(root, relative);
  await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  await writeFile(file, JSON.stringify(value), { mode: 0o600 });
}
function cookie(user, exp = Math.floor(Date.now() / 1000) + 3600) {
  const payload = Buffer.from(JSON.stringify({ uid: user.id, username: user.username, role: user.role, exp })).toString("base64url");
  return `director_session=${payload}.${createHmac("sha256", secret).update(payload).digest("base64url")}`;
}
async function stop() {
  if (!server) return;
  const child = server;
  server = undefined;
  if (child.exitCode !== null) return;
  const exited = new Promise((resolve) => child.once("exit", resolve));
  child.kill("SIGTERM");
  await exited;
}
async function start(mode = "web") {
  await stop();
  log = "";
  server = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "-H", "127.0.0.1", "-p", "4328"], {
    env: { ...process.env, NODE_ENV: "production", DIRECTOR_RUNTIME_DIR: root, COMMERCE_IMAGE_DATA_DIR: path.join(root, "commerce-image"), DIRECTOR_WEB_AUTH_DISABLED: mode === "desktop" ? "1" : "0", DIRECTOR_LOCAL_ACCESS_USERNAME: mode === "local" ? users[0].username : "", DIRECTOR_REQUIRE_LOGIN: mode === "local" ? "0" : "1" },
    stdio: ["ignore", "pipe", "pipe"]
  });
  server.stdout.on("data", (d) => { log += d; });
  server.stderr.on("data", (d) => { log += d; });
  for (let i = 0; i < 150; i += 1) {
    if (server.exitCode !== null) throw new Error(`Test server stopped: ${log.slice(-1000)}`);
    try { if ((await fetch(`${base}/api/auth/me`)).ok) return; } catch { /* starting */ }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("Test server did not become ready");
}
async function check(name, fn) {
  await fn();
  passed += 1;
  console.log(`PASS: ${name}`);
}
async function call(url, expected, options = {}) {
  const response = await fetch(base + url, options);
  const body = await response.text();
  assert.equal(response.status, expected, `${url}: ${body.slice(0, 250)}`);
  if (expected === 401 || expected === 403) assert.equal(body.includes(marker), false);
  return body;
}
const admin = { cookie: cookie(users[0]) };
const staff = { cookie: cookie(users[1]) };
const skillDir = path.join(root, "skills", skillId);
try {
  await jsonFile("auth/users.json", users);
  await writeFile(path.join(root, "auth/secret"), secret.toString("hex") + "\n", { mode: 0o600 });
  await jsonFile("skills/registry.json", [{ skillId, name: marker, description: marker, sourceName: "fixture.md", sourceType: "file", version: "1", importedAt: "", updatedAt: "", enabled: true, skillType: "prompt_skill", installStatus: "ready", verificationStatus: "passed", authorization: { required: false }, requiresAuthorization: false, requiredCapabilities: [], entrypoints: [], requiredTools: [], requiredPackages: [], environmentRequirements: [], permissions: {}, toolMappings: [], runtimeType: "prompt", lastVerificationSummary: marker }]);
  await jsonFile("commerce-image/profiles/brand.json", { brandName: marker, styleNotes: marker });
  await jsonFile("commerce-image/style-skills/index.json", [{ id: "commerce_image_skill_fixture", name: marker, description: marker, instructions: marker, enabled: true, updatedAt: "", referenceAssets: [], platforms: [], tags: [] }]);
  await mkdir(skillDir, { recursive: true });
  await writeFile(path.join(skillDir, "sentinel.txt"), marker);
  await start();

  for (const url of reads) {
    for (const [name, headers] of [["anonymous", {}], ["forged session", { cookie: "director_session=forged.signature" }], ["expired session", { cookie: cookie(users[0], 1) }]]) {
      await check(`${name}: ${url} → 401`, () => call(url, 401, { headers }));
    }
    await check(`signed-in staff: ${url} → 200`, () => call(url, 200, { headers: staff }));
    await check(`administrator: ${url} → 200`, () => call(url, 200, { headers: admin }));
  }
  for (const [name, headers, status] of [["anonymous", {}, 401], ["staff", staff, 403], ["cross-origin admin", { ...admin, origin: "https://untrusted.example" }, 403]]) {
    await check(`${name}: Skill cleanup rejected without deleting fixture`, async () => {
      await call(`/api/skills?skillId=${skillId}`, status, { method: "DELETE", headers });
      assert.equal(await readFile(path.join(skillDir, "sentinel.txt"), "utf8"), marker);
    });
    for (const method of ["PATCH", "POST", "DELETE"]) {
      await check(`${name}: global API configuration ${method} rejected`, () => call("/api/commerce-image/assistants?provider=text", status, { method, headers: { ...headers, "Content-Type": "application/json" }, body: method === "DELETE" ? undefined : JSON.stringify({ provider: "text", baseUrl: "http://127.0.0.1:1", apiKey: "fixture-unused-value" }) }));
    }
    await check(`${name}: local-file diagnostics rejected`, () => call("/api/video/debug-transcript", status, { method: "POST", headers: { ...headers, "Content-Type": "application/json" }, body: JSON.stringify({ sourceType: "upload", filePath: path.join(skillDir, "sentinel.txt") }) }));
  }
  await check("administrator: local diagnostics manual path still works", () => call("/api/video/debug-transcript", 200, { method: "POST", headers: { ...admin, "Content-Type": "application/json" }, body: JSON.stringify({ sourceType: "manual", transcript: "Privacy fixture transcript" }) }));
  await check("administrator: global API configuration save still works", () => call("/api/commerce-image/assistants", 200, { method: "PATCH", headers: { ...admin, "Content-Type": "application/json" }, body: JSON.stringify({ provider: "text", baseUrl: "http://127.0.0.1:1", apiKey: "fixture-unused-value" }) }));
  await check("administrator: global API configuration delete still works", () => call("/api/commerce-image/assistants?provider=text", 200, { method: "DELETE", headers: admin }));
  await check("administrator: Skill cleanup still works", async () => {
    await call(`/api/skills?skillId=${skillId}`, 200, { method: "DELETE", headers: admin });
    await assert.rejects(access(skillDir));
  });
  for (const mode of ["local", "desktop"]) {
    await start(mode);
    for (const url of reads) await check(`${mode}: ${url} still works without cookies`, () => call(url, 200));
    await check(`${mode}: local diagnostics still work`, () => call("/api/video/debug-transcript", 200, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sourceType: "manual", transcript: "Privacy fixture transcript" }) }));
  }
  console.log(`Privacy regression: ${passed} checks passed; no paid API calls.`);
} finally {
  await stop();
  await rm(root, { recursive: true, force: true });
}
