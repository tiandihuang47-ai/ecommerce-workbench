#!/usr/bin/env node
/**
 * Universal Skill Runtime V1 —— Integration Test
 *
 * 真实跑完整闭环：导入 → 后台准备 → 静默验证 →（必要时自动修复）→ 真实执行。
 * 覆盖：Prompt Skill / Python Skill / Node Skill / Tool Mapping Skill / 失败自动修复 / 需要授权。
 *
 * 用法：
 *   node scripts/test-skill-runtime.mjs                 # 默认 http://127.0.0.1:3311
 *   SKILL_TEST_URL=http://127.0.0.1:3010 node scripts/test-skill-runtime.mjs
 */

import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const fixturesRoot = path.join(here, "fixtures", "skills");
const baseUrl = (process.env.SKILL_TEST_URL || "http://127.0.0.1:3311").replace(/\/$/, "");

const results = [];

function record(name, ok, detail) {
  results.push({ name, ok, detail });
  console.log((ok ? "  PASS  " : "  FAIL  ") + name + (detail ? " — " + detail : ""));
}

async function collectFiles(root, current = root, out = []) {
  const entries = await readdir(current);
  for (const entry of entries) {
    const absolute = path.join(current, entry);
    const info = await stat(absolute);
    if (info.isDirectory()) {
      await collectFiles(root, absolute, out);
      continue;
    }
    out.push({ relativePath: path.relative(root, absolute).split(path.sep).join("/"), absolute });
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
  for (const item of files) {
    const bytes = await readFile(item.absolute);
    form.append("files", new Blob([bytes]), item.relativePath);
  }
  const response = await fetch(baseUrl + "/api/skills", { method: "POST", body: form });
  const data = await response.json();
  if (!response.ok || !data.success) throw new Error(data.message || "导入失败");
  return data.skill?.skillId || "";
}

async function listSkills() {
  const response = await fetch(baseUrl + "/api/skills", { cache: "no-store" });
  const data = await response.json();
  return data.skills || [];
}

async function waitForSettled(skillId, timeoutMs = 300000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const skills = await listSkills();
    const skill = skills.find((item) => item.skillId === skillId);
    if (skill && skill.publicStatus !== "preparing") return skill;
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
  return null;
}

async function detail(skillId) {
  const response = await fetch(baseUrl + "/api/skills/" + encodeURIComponent(skillId), { cache: "no-store" });
  const data = await response.json();
  return data.skill || null;
}

async function logEntries(skillId) {
  const response = await fetch(baseUrl + "/api/skills/" + encodeURIComponent(skillId) + "/logs?limit=400", { cache: "no-store" });
  const data = await response.json();
  return data.entries || [];
}

async function runSkill(skillId, input) {
  const response = await fetch(baseUrl + "/api/skills/" + encodeURIComponent(skillId) + "/run", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ input })
  });
  const data = await response.json();
  return { ok: response.ok && data.success, output: String(data.output || "") };
}

function parseJsonish(text) {
  const trimmed = text.trim();
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start < 0 || end < 0) return null;
  try {
    return JSON.parse(trimmed.slice(start, end + 1));
  } catch {
    return null;
  }
}

async function main() {
  console.log("Skill Runtime Integration Test @ " + baseUrl);

  try {
    const health = await fetch(baseUrl + "/api/skills", { cache: "no-store" });
    if (!health.ok) throw new Error("HTTP " + health.status);
  } catch (error) {
    console.log("服务不可达：" + (error && error.message));
    process.exit(2);
  }

  /* ---------- Fixture A：纯 Markdown Prompt Skill ---------- */
  const promptId = await importFixture("prompt-sellpoint");
  const promptSkill = await waitForSettled(promptId);
  record("A. Prompt Skill 导入后可用", promptSkill?.publicStatus === "ready", promptSkill?.statusDetail || "状态：" + (promptSkill?.publicStatus || "超时未完成"));

  /* ---------- Fixture B：Python Skill（真实第三方依赖） ---------- */
  const pythonId = await importFixture("python-csv-insight");
  const pythonSkill = await waitForSettled(pythonId);
  record("B. Python Skill 自动建环境 + 装依赖 + 可用", pythonSkill?.publicStatus === "ready", pythonSkill?.statusDetail || "状态：" + (pythonSkill?.publicStatus || "超时未完成"));

  if (pythonSkill?.publicStatus === "ready") {
    const run = await runSkill(pythonId, { rows: [["指标", "数值"], ["播放量", "12.4 万"], ["完播率", "38%"]] });
    const parsed = parseJsonish(run.output);
    record("B2. Python Skill 真实执行有结果", run.ok && Boolean(parsed && parsed.table), run.output.slice(0, 120));
  } else {
    record("B2. Python Skill 真实执行有结果", false, "Skill 未就绪，跳过");
  }

  /* ---------- Fixture C：Node Skill（真实 npm 依赖） ---------- */
  const nodeId = await importFixture("node-duration-tool");
  const nodeSkill = await waitForSettled(nodeId);
  record("C. Node Skill 自动装依赖 + 可用", nodeSkill?.publicStatus === "ready", nodeSkill?.statusDetail || "状态：" + (nodeSkill?.publicStatus || "超时未完成"));

  if (nodeSkill?.publicStatus === "ready") {
    const run = await runSkill(nodeId, { durations: [1500, 92000] });
    const parsed = parseJsonish(run.output);
    record("C2. Node Skill 真实执行有结果", run.ok && Boolean(parsed && Array.isArray(parsed.human)), run.output.slice(0, 120));
  } else {
    record("C2. Node Skill 真实执行有结果", false, "Skill 未就绪，跳过");
  }

  /* ---------- Fixture D：Tool Mapping ---------- */
  const toolId = await importFixture("tool-mapping");
  const toolSkill = await waitForSettled(toolId);
  const toolDetail = toolSkill ? await detail(toolId) : null;
  const mappings = toolDetail?.toolMappings || [];
  const mappedRead = mappings.some((item) => item.externalName === "read_file" && item.matched);
  const mappedDoc = mappings.some((item) => item.externalName === "read_document" && item.matched);
  record("D. 外部工具别名映射到内部能力", mappedRead && mappedDoc, mappings.map((item) => item.externalName + "→" + (item.matched ? item.capabilityLabel : "未识别")).join(", ").slice(0, 200));
  record("D2. Tool Mapping Skill 可用", toolSkill?.publicStatus === "ready", toolSkill?.statusDetail || "");
  if (toolSkill?.publicStatus === "ready") {
    const run = await runSkill(toolId, { input: "雅鹿羽绒服对标素材" });
    const parsed = parseJsonish(run.output);
    record("D3. Tool Mapping Skill 真实执行有结果", run.ok && Boolean(parsed && Array.isArray(parsed.plan)), run.output.slice(0, 120));
  } else {
    record("D3. Tool Mapping Skill 真实执行有结果", false, "Skill 未就绪，跳过");
  }

  /* ---------- Fixture G：依赖本平台暂未提供的能力 ---------- */
  const webId = await importFixture("needs-web-search");
  const webSkill = await waitForSettled(webId);
  record("G. 本平台没有的能力会被如实标注", webSkill?.publicStatus === "unavailable", webSkill?.statusDetail || "");
  record("G2. 缺少能力时不会误报为可用", webSkill?.usable !== true, "usable=" + String(webSkill?.usable));

  /* ---------- Fixture E：失败 → 自动修复 ---------- */
  const repairId = await importFixture("repair-missing-dep");
  const repairSkill = await waitForSettled(repairId);
  const repairLogs = await logEntries(repairId);
  const repairEntries = repairLogs.filter((entry) => entry.stage === "repair" && entry.message.includes("自动安装"));
  record("E. 缺依赖的 Skill 自动修复后可用", repairSkill?.publicStatus === "ready", repairSkill?.statusDetail || "状态：" + (repairSkill?.publicStatus || "超时未完成"));
  record("E2. 修复过程真实发生过（有 repair 日志）", repairEntries.length > 0, repairEntries.map((entry) => entry.message).join(" | ").slice(0, 200));

  if (repairSkill?.publicStatus === "ready") {
    const run = await runSkill(repairId, { comments: ["可机洗 显瘦", "显瘦 保暖", "保暖"] });
    const parsed = parseJsonish(run.output);
    record("E3. 修复后的 Skill 能真实执行", run.ok && Boolean(parsed && parsed.table), run.output.slice(0, 120));
  } else {
    record("E3. 修复后的 Skill 能真实执行", false, "Skill 未就绪，跳过");
  }

  /* ---------- Fixture F：需要授权 ---------- */
  const authId = await importFixture("requires-auth");
  const authSkill = await waitForSettled(authId);
  record("F. 需要授权的 Skill 被正确识别", authSkill?.publicStatus === "requires_authorization", authSkill?.statusDetail || "状态：" + (authSkill?.publicStatus || "超时未完成"));
  record("F2. 需要授权时不会被误报为可用", authSkill?.usable !== true, "usable=" + String(authSkill?.usable));

  /* ---------- 安全清理：只删本测试导入的 Skill ---------- */
  const importedIds = [promptId, pythonId, nodeId, toolId, repairId, authId, webId].filter(Boolean);
  for (const skillId of importedIds) {
    await fetch(baseUrl + "/api/skills/" + encodeURIComponent(skillId), { method: "DELETE" }).catch(() => undefined);
  }

  const failed = results.filter((item) => !item.ok);
  console.log("");
  console.log("结果：" + (results.length - failed.length) + "/" + results.length + " 项通过");
  if (failed.length) {
    console.log("未通过：" + failed.map((item) => item.name).join(", "));
    process.exit(1);
  }
  process.exit(0);
}

main().catch((error) => {
  console.error("测试异常：" + (error && error.stack ? error.stack : error));
  process.exit(1);
});
