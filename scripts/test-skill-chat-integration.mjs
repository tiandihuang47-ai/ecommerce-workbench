#!/usr/bin/env node
/**
 * Universal Skill Runtime V1 —— AI 对话集成测试（真实 App + 真实模型）
 *
 * 覆盖 §53 / §54：
 *   Skill 中心出现 Skill → 点击使用 → 跳 AI 对话 → 顶部显示已启用
 *   → 提问 → Skill 规则真的影响回答 → 关闭 Skill → 再问 → 不再生效
 *   → 多 Skill 同时启用 → 关闭其一，另一个保留
 *
 * 用法：SKILL_UI_URL=http://127.0.0.1:3311 node scripts/test-skill-chat-integration.mjs
 * 需要目标服务已运行；会真实调用模型；需要 Electron（devDependency）。
 */

import { readdir, readFile, stat } from "node:fs/promises";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { app, BrowserWindow } from "electron";

app.commandLine.appendSwitch("no-sandbox");
app.commandLine.appendSwitch("disable-gpu");
app.commandLine.appendSwitch("disable-dev-shm-usage");
app.commandLine.appendSwitch("disable-setuid-sandbox");
app.commandLine.appendSwitch("in-process-gpu");

const here = path.dirname(fileURLToPath(import.meta.url));
const fixturesRoot = path.join(here, "fixtures", "skills");
const baseUrl = (process.env.SKILL_UI_URL || "http://127.0.0.1:3311").replace(/\/$/, "");
const outDir = process.env.SKILL_UI_OUT || path.join("tmp", "skills-shots");

const results = [];
const logs = [];
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function record(name, ok, detail) {
  results.push({ name, ok });
  console.log((ok ? "  PASS  " : "  FAIL  ") + name + (detail ? " — " + detail : ""));
}

async function collectFiles(root, current = root, out = []) {
  for (const entry of await readdir(current)) {
    const absolute = path.join(current, entry);
    const info = await stat(absolute);
    if (info.isDirectory()) await collectFiles(root, absolute, out);
    else out.push({ relativePath: path.relative(root, absolute).split(path.sep).join("/"), absolute });
  }
  return out;
}

async function importFixture(folder) {
  const root = path.join(fixturesRoot, folder);
  const files = await collectFiles(root);
  const form = new FormData();
  form.set("sourceName", folder);
  form.set("sourceType", "folder");
  form.set("paths", JSON.stringify(files.map((item) => folder + "/" + item.relativePath)));
  for (const item of files) form.append("files", new Blob([await readFile(item.absolute)]), item.relativePath);
  const response = await fetch(baseUrl + "/api/skills", { method: "POST", body: form });
  const data = await response.json();
  if (!response.ok || !data.success) throw new Error(data.message || "导入失败");
  return data.skill?.skillId || "";
}

async function waitReady(skillId, timeoutMs = 300000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const list = await (await fetch(baseUrl + "/api/skills", { cache: "no-store" })).json();
    const skill = (list.skills || []).find((item) => item.skillId === skillId);
    if (skill && skill.publicStatus === "ready") return true;
    if (skill && skill.publicStatus !== "preparing") return false;
    await sleep(2000);
  }
  return false;
}

function collectChipsExpr() {
  return "Array.from(document.querySelectorAll('span[title]')).map((n) => n.textContent.trim()).filter((t) => t.length > 0 && t.length < 40)";
}

async function openWindow() {
  const win = new BrowserWindow({
    width: 1440,
    height: 940,
    show: false,
    backgroundColor: "#ffffff",
    webPreferences: { offscreen: true, contextIsolation: true, nodeIntegration: false }
  });
  win.webContents.setFrameRate(10);
  win.__lastFrame = null;
  win.webContents.on("paint", (event, dirty, image) => { win.__lastFrame = image; });
  win.webContents.on("console-message", (event, level, message) => {
    if (level >= 2 && !String(message).includes("Electron Security Warning")) logs.push("[" + level + "] " + message);
  });
  return win;
}

async function shot(win, name) {
  const image = win.__lastFrame || await win.webContents.capturePage();
  writeFileSync(path.join(outDir, name + ".png"), image.toPNG());
}

async function sendMessage(win, text) {
  return win.webContents.executeJavaScript(
    "(() => {" +
    "  const ta = document.querySelector('textarea');" +
    "  if (!ta) return 'no-textarea';" +
    "  const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;" +
    "  setter.call(ta, " + JSON.stringify(text) + ");" +
    "  ta.dispatchEvent(new Event('input', { bubbles: true }));" +
    "  const button = Array.from(document.querySelectorAll('button')).find((n) => n.textContent.trim() === '发送');" +
    "  if (!button) return 'no-send';" +
    "  button.click();" +
    "  return 'sent';" +
    "})()"
  );
}

async function waitForReply(win, timeoutMs = 90000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    await sleep(700);
    const state = await win.webContents.executeJavaScript(
      "(() => {" +
      "  const busy = Array.from(document.querySelectorAll('button')).some((n) => n.textContent.includes('停止生成'));" +
      "  const blocks = Array.from(document.querySelectorAll('.md-body'));" +
      "  const last = blocks[blocks.length - 1];" +
      "  return { busy, text: last ? last.innerText : '' };" +
      "})()"
    );
    if (!state.busy && state.text && state.text.length > 5) return state.text;
  }
  return "";
}

async function openSkillPicker(win) {
  await win.webContents.executeJavaScript(
    "(() => { const b = Array.from(document.querySelectorAll('button')).find((x) => x.textContent.includes('启用 Skill')); if (b) b.click(); return true; })()"
  );
  await sleep(650);
}

async function pickSkill(win, name) {
  await win.webContents.executeJavaScript(
    "(() => { const items = Array.from(document.querySelectorAll('button')).filter((b) => b.textContent.includes(" + JSON.stringify(name) + ")); const t = items[items.length - 1]; if (t) t.click(); return true; })()"
  );
  await sleep(900);
}

async function closeSkill(win, name) {
  const selector = "button[aria-label=" + JSON.stringify("关闭 Skill " + name) + "]";
  const result = await win.webContents
    .executeJavaScript("(() => { const b = document.querySelector(" + JSON.stringify(selector) + "); if (!b) return 'missing'; b.click(); return 'closed'; })()")
    .catch((error) => { logs.push("close-skill: " + String(error && error.message)); return "error"; });
  await sleep(900);
  return result;
}

async function chips(win) {
  return win.webContents.executeJavaScript(collectChipsExpr());
}

/** 轮询等待条件成立（离屏渲染下首屏较慢，固定 sleep 不可靠）。 */
async function waitFor(win, expression, timeoutMs = 25000, intervalMs = 500) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const ok = await win.webContents.executeJavaScript("Boolean(" + expression + ")").catch(() => false);
    if (ok) return true;
    await sleep(intervalMs);
  }
  return false;
}

async function waitForChip(win, name, present, timeoutMs = 20000) {
  return waitFor(
    win,
    "Array.from(document.querySelectorAll('span[title]')).map((n) => n.textContent.trim())." + (present ? "includes" : "includes") + "(" + JSON.stringify(name) + ") === " + String(present),
    timeoutMs
  );
}

async function run() {
  mkdirSync(outDir, { recursive: true });

  const fingerprintId = await importFixture("rule-fingerprint");
  const promptId = await importFixture("prompt-sellpoint");
  const ready = (await waitReady(fingerprintId)) && (await waitReady(promptId));
  record("前置：两个 Skill 自动准备完成", ready, "卖点雷达 + 商品卖点分析");

  const win = await openWindow();
  try {
    await win.loadURL(baseUrl + "/skills");
    await waitFor(win, "document.querySelectorAll('article').length >= 2", 30000);
    const center = await win.webContents.executeJavaScript(
      "(() => {" +
      "  const cards = Array.from(document.querySelectorAll('article'));" +
      "  return {" +
      "    cardCount: cards.length," +
      "    names: cards.map((c) => { const h = c.querySelector('h3'); return h ? h.innerText.trim() : ''; })," +
      "    hasImportButton: document.body.innerText.includes('导入 Skill')" +
      "  };" +
      "})()"
    );
    await shot(win, "skills-center");
    record("1. Skill 中心出现已安装的 Skill", center.cardCount >= 2 && center.names.includes("卖点雷达") && center.hasImportButton, JSON.stringify(center));

    await win.webContents.executeJavaScript(
      "(() => { const card = Array.from(document.querySelectorAll('article')).find((c) => c.innerText.includes('卖点雷达')); const b = card ? Array.from(card.querySelectorAll('button')).find((x) => x.textContent.trim() === '使用') : null; if (b) b.click(); return Boolean(b); })()"
    ).catch((error) => { logs.push("click-use: " + String(error && error.message)); });
    await waitFor(win, "location.pathname === '/ai-chat'", 20000);
    await waitForChip(win, "卖点雷达", true, 20000);
    const afterUse = await win.webContents.executeJavaScript("({ path: location.pathname })");
    const activeChips = await chips(win);
    await shot(win, "chat-active-skill");
    record("2/3/4. 使用 → 跳 AI 对话 → 顶部显示已启用", afterUse.path === "/ai-chat" && activeChips.includes("卖点雷达"), JSON.stringify({ path: afterUse.path, chips: activeChips }));

    await sendMessage(win, "用一句话告诉我今天该穿什么。");
    const firstReply = await waitForReply(win);
    record("5/6. Skill 规则真的影响回答（回答出现指纹）", firstReply.includes("【卖点雷达】") && firstReply.includes("✅"), firstReply.slice(0, 80));

    const closed = await closeSkill(win, "卖点雷达");
    await waitForChip(win, "卖点雷达", false, 15000);
    const afterClose = await chips(win);
    record("7. 关闭 Skill 后顶部不再显示", closed === "closed" && !afterClose.includes("卖点雷达"), JSON.stringify(afterClose));

    await sendMessage(win, "再用一句话告诉我今天该穿什么。");
    const secondReply = await waitForReply(win);
    record("8/9. 关闭后再问，Skill 不再生效", !secondReply.includes("【卖点雷达】") && !secondReply.includes("✅"), secondReply.slice(0, 80));

    await openSkillPicker(win);
    await pickSkill(win, "卖点雷达");
    await openSkillPicker(win);
    await pickSkill(win, "商品卖点分析");
    await waitFor(win, "Array.from(document.querySelectorAll('span[title]')).filter((n) => n.textContent.trim() === '商品卖点分析').length > 0", 20000);
    const twoActive = await chips(win);
    await shot(win, "chat-two-skills");
    record("10. 一个会话可同时启用多个 Skill", twoActive.includes("卖点雷达") && twoActive.includes("商品卖点分析"), JSON.stringify(twoActive));

    await closeSkill(win, "卖点雷达");
    await waitForChip(win, "卖点雷达", false, 15000);
    const afterCloseOne = await chips(win);
    record("11. 关闭一个 Skill 不影响其他 Skill", !afterCloseOne.includes("卖点雷达") && afterCloseOne.includes("商品卖点分析"), JSON.stringify(afterCloseOne));
  } finally {
    win.destroy();
  }

  for (const skillId of [fingerprintId, promptId].filter(Boolean)) {
    await fetch(baseUrl + "/api/skills/" + encodeURIComponent(skillId), { method: "DELETE" }).catch(() => undefined);
  }

  writeFileSync(path.join(outDir, "ui-report.json"), JSON.stringify({ results, logs }, null, 2));
  const failed = results.filter((item) => !item.ok);
  console.log("");
  console.log("AI 对话集成测试：" + (results.length - failed.length) + "/" + results.length + " 项通过");
  if (logs.length) console.log("页面控制台：" + JSON.stringify(logs.slice(0, 5)));
  if (failed.length) console.log("未通过：" + failed.map((item) => item.name).join(", "));
  app.quit();
  process.exitCode = failed.length ? 1 : 0;
}

app.whenReady().then(() => {
  run().catch((error) => {
    console.error("测试异常：" + (error && error.stack ? error.stack : error));
    if (logs.length) console.error("渲染进程日志：" + JSON.stringify(logs.slice(0, 8), null, 1));
    app.quit();
    process.exitCode = 1;
  });
});
