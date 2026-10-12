import { cp, lstat, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { skillRuntimeConfig } from "@/lib/skills/config";
import {
  ensureNodeEnvironment,
  ensurePythonEnvironment,
  npmInstall,
  pipInstall,
  pythonExecutable,
  runProcess
} from "@/lib/skills/dependency-resolver";
import {
  resolveInside,
  skillNodeDirectory,
  skillOriginalDirectory,
  skillPythonDirectory,
  skillWorkDirectory
} from "@/lib/skills/paths";
import type { SkillEntrypoint, SkillManifest } from "@/lib/skills/types";

/**
 * Skill Runtime Manager（§16）。
 * 负责准备隔离环境、加载 Manifest、提供工具、执行 Skill、管理超时与错误、返回结果。
 */

export interface SkillExecutionResult {
  ok: boolean;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  blocked: boolean;
  message: string;
}

const verificationEnv: Record<string, string> = {
  DIRECTOR_SKILL_MODE: "verify",
  DIRECTOR_SKILL_DRY_RUN: "1",
  DIRECTOR_SKILL_RUNTIME: "director-platform/1"
};

/**
 * 准备隔离运行目录：把原始 Skill 复制进 runtime/work（**原始文件永不改动**，§8）。
 */
export async function prepareSkillRuntime(manifest: SkillManifest) {
  const original = skillOriginalDirectory(manifest.skillId);
  const work = skillWorkDirectory(manifest.skillId);
  await rm(work, { recursive: true, force: true });
  await mkdir(work, { recursive: true });
  await cp(original, work, { recursive: true, force: true });

  const needsPython = manifest.entrypoints.some((item) => item.runtime === "python") || manifest.runtimeType === "python" || manifest.runtimeType === "hybrid";
  const needsNode = manifest.entrypoints.some((item) => item.runtime === "node") || manifest.runtimeType === "node" || manifest.runtimeType === "hybrid";

  if (needsPython) await ensurePythonEnvironment(manifest.skillId);
  if (needsNode) {
    await ensureNodeEnvironment(manifest.skillId);
    await linkIsolatedNodeModules(manifest.skillId);
  }

  return { work, needsPython, needsNode };
}

/**
 * Node 的隔离依赖装在 runtime/node/node_modules，但 Skill 脚本跑在 runtime/work。
 * 因为 Node 只按目录向上查找 node_modules（ESM 也不认 NODE_PATH），
 * 所以这里在工作目录里做一个指向隔离依赖目录的软链接 —— 依赖只装一次，之后复用（§56）。
 */
export async function linkIsolatedNodeModules(skillId: string) {
  const work = skillWorkDirectory(skillId);
  const target = path.join(skillNodeDirectory(skillId), "node_modules");
  const link = path.join(work, "node_modules");

  try {
    await lstat(link);
    return link;
  } catch {
    // 还没有链接，继续创建
  }

  try {
    await mkdir(target, { recursive: true });
    await symlink(target, link, process.platform === "win32" ? "junction" : "dir");
    return link;
  } catch {
    // 链接失败不致命：后续依赖检查会给出明确结论。
    return "";
  }
}

export async function readOriginalText(manifest: SkillManifest, relativePath: string) {
  try {
    const target = resolveInside(skillOriginalDirectory(manifest.skillId), relativePath);
    return await readFile(target, "utf8");
  } catch {
    return "";
  }
}

export function primaryEntrypoint(manifest: SkillManifest): SkillEntrypoint | null {
  return manifest.entrypoints.find((item) => item.primary) || manifest.entrypoints[0] || null;
}

/* ------------------------------------------------------------------ 安全检查 */

export function containsBlockedCommand(text: string) {
  const lowered = text.toLowerCase();
  return skillRuntimeConfig.blockedCommandPatterns.some((pattern) => lowered.includes(pattern.toLowerCase()));
}

/**
 * 判断「真实执行验证」是否有明显副作用风险（§25）。
 * 命中时只做依赖加载与语法检查，不跑脚本本体，避免真的发邮件 / 发内容 / 删数据。
 */
export function assessSideEffectRisk(text: string) {
  const risky = [
    /smtplib|sendgrid|nodemailer|send_mail|send_email/i,
    /requests\.post|http\.client.*POST|axios\.post|fetch\([^)]*method:\s*['"]POST/i,
    /git\s+push|git\s+commit|gh\s+pr/i,
    /shutil\.rmtree|os\.remove|unlink|rm\s+-rf/i,
    /publish|upload|webhook|stripe|payment|refund/i,
    /\.delete\(|\.destroy\(/i
  ];
  const hits = risky.filter((pattern) => pattern.test(text)).map((pattern) => String(pattern));
  return { risky: hits.length > 0, hits };
}

/* ------------------------------------------------------------------ 检查与执行 */

export async function compileCheck(manifest: SkillManifest, entry: SkillEntrypoint) {
  const work = skillWorkDirectory(manifest.skillId);
  const cwd = path.dirname(path.join(work, entry.path));

  if (entry.runtime === "python") {
    const { python } = await ensurePythonEnvironment(manifest.skillId);
    const result = await runProcess({
      command: python,
      args: ["-m", "py_compile", path.join(work, entry.path)],
      cwd,
      timeoutMs: skillRuntimeConfig.verificationTimeoutMs
    });
    return { ok: result.code === 0, output: (result.stderr || result.stdout).trim() };
  }

  await ensureNodeEnvironment(manifest.skillId);
  const result = await runProcess({
    command: process.execPath,
    args: ["--check", path.join(work, entry.path)],
    cwd,
    timeoutMs: skillRuntimeConfig.verificationTimeoutMs
  });
  return { ok: result.code === 0, output: (result.stderr || result.stdout).trim() };
}

/** Python：用 ast 收集 import，再真实 import 第三方模块（不执行 Skill 本体，零副作用）。 */
export async function pythonDependencyCheck(manifest: SkillManifest, entryPath: string) {
  const { python } = await ensurePythonEnvironment(manifest.skillId);
  const work = skillWorkDirectory(manifest.skillId);
  const target = path.join(work, entryPath);
  const script = [
    "import ast, importlib, sys, json",
    "path = sys.argv[1]",
    "source = open(path, 'r', encoding='utf-8', errors='ignore').read()",
    "tree = ast.parse(source)",
    "names = set()",
    "for node in ast.walk(tree):",
    "    if isinstance(node, ast.Import):",
    "        for alias in node.names:",
    "            names.add(alias.name.split('.')[0])",
    "    elif isinstance(node, ast.ImportFrom):",
    "        if node.level == 0 and node.module:",
    "            names.add(node.module.split('.')[0])",
    "stdlib = set(getattr(sys, 'stdlib_module_names', ()))",
    "missing = []",
    "for name in sorted(names):",
    "    if name in stdlib or name in ('__future__',):",
    "        continue",
    "    try:",
    "        importlib.import_module(name)",
    "    except Exception as error:",
    "        missing.append(name + '::' + type(error).__name__ + '::' + str(error))",
    "print(json.dumps({'missing': missing, 'checked': sorted(names)}))"
  ].join(String.fromCharCode(10));

  const result = await runProcess({
    command: python,
    args: ["-c", script, target],
    cwd: path.dirname(target),
    timeoutMs: skillRuntimeConfig.verificationTimeoutMs
  });

  if (result.code !== 0) {
    return { ok: false, missing: [] as string[], output: (result.stderr || result.stdout).trim() };
  }
  try {
    const parsed = JSON.parse(result.stdout.trim().split(String.fromCharCode(10)).pop() || "{}") as { missing?: string[]; checked?: string[] };
    const missing = parsed.missing || [];
    return { ok: missing.length === 0, missing, output: JSON.stringify({ checked: parsed.checked || [] }) };
  } catch {
    return { ok: false, missing: [], output: result.stdout.slice(-500) };
  }
}

/** Node：收集裸模块名并真实 require.resolve（不执行 Skill 本体）。 */
export async function nodeDependencyCheck(manifest: SkillManifest, entryPath: string) {
  await ensureNodeEnvironment(manifest.skillId);
  const work = skillWorkDirectory(manifest.skillId);
  const target = path.join(work, entryPath);
  const script = [
    "const fs = require('fs');",
    "const path = require('path');",
    "const { builtinModules } = require('module');",
    "const target = process.env.DIRECTOR_DEP_TARGET;",
    "const source = fs.readFileSync(target, 'utf8');",
    "const names = new Set();",
    "for (const m of source.matchAll(/require\\(\\s*['\"]([^'\"]+)['\"]\\s*\\)/g)) names.add(m[1]);",
    "for (const m of source.matchAll(/from\\s+['\"]([^'\"]+)['\"]/g)) names.add(m[1]);",
    "const builtins = new Set(builtinModules);",
    "const missing = [];",
    "for (const raw of names) {",
    "  if (raw.startsWith('.') || raw.startsWith('node:') || raw.startsWith('/')) continue;",
    "  const name = raw.startsWith('@') ? raw.split('/').slice(0, 2).join('/') : raw.split('/')[0];",
    "  if (builtins.has(name)) continue;",
    "  try { require.resolve(name, { paths: [path.dirname(target)] }); }",
    "  catch (e) { missing.push(name); }",
    "}",
    "console.log(JSON.stringify({ missing }));"
  ].join(String.fromCharCode(10));

  const result = await runProcess({
    command: process.execPath,
    args: ["-e", script],
    cwd: path.dirname(target),
    timeoutMs: skillRuntimeConfig.verificationTimeoutMs,
    env: { DIRECTOR_DEP_TARGET: target }
  });

  if (result.code !== 0) {
    return { ok: false, missing: [] as string[], output: (result.stderr || result.stdout).trim() };
  }
  try {
    const parsed = JSON.parse(result.stdout.trim().split(String.fromCharCode(10)).pop() || "{}") as { missing?: string[] };
    const missing = parsed.missing || [];
    return { ok: missing.length === 0, missing, output: JSON.stringify(parsed) };
  } catch {
    return { ok: false, missing: [], output: result.stdout.slice(-500) };
  }
}

/** 真实执行 Skill 入口（用户调用 / 验证阶段）。 */
export async function executeSkillEntry(
  manifest: SkillManifest,
  entry: SkillEntrypoint,
  input: unknown,
  options: { timeoutMs?: number; mode?: "verify" | "run" } = {}
): Promise<SkillExecutionResult> {
  const work = skillWorkDirectory(manifest.skillId);
  const absolute = resolveInside(work, entry.path);
  const cwd = path.dirname(absolute);
  const payload = JSON.stringify(input ?? {});
  const mode = options.mode || "run";
  const env = mode === "verify" ? verificationEnv : { DIRECTOR_SKILL_MODE: "run", DIRECTOR_SKILL_RUNTIME: "director-platform/1" };

  if (containsBlockedCommand(payload)) {
    return { ok: false, exitCode: null, stdout: "", stderr: "", timedOut: false, blocked: true, message: "输入包含被禁止的操作，已阻止执行。" };
  }

  const command = entry.runtime === "python" ? pythonExecutable(manifest.skillId) : process.execPath;
  const args = entry.runtime === "python" ? [absolute, payload] : [absolute, payload];

  const result = await runProcess({
    command,
    args,
    cwd,
    timeoutMs: options.timeoutMs || skillRuntimeConfig.executionTimeoutMs,
    env,
    input: payload
  });

  return {
    ok: result.code === 0 && !result.timedOut,
    exitCode: result.code,
    stdout: result.stdout,
    stderr: result.stderr,
    timedOut: result.timedOut,
    blocked: false,
    message: result.timedOut ? "执行超时" : result.code === 0 ? "执行成功" : "执行失败"
  };
}

/* ------------------------------------------------------------------ 能力适配器 */

export async function capabilityReadFile(manifest: SkillManifest, relativePath: string) {
  const work = skillWorkDirectory(manifest.skillId);
  const target = resolveInside(work, relativePath);
  return readFile(target, "utf8");
}

export async function capabilityWriteFile(manifest: SkillManifest, relativePath: string, content: string) {
  const work = skillWorkDirectory(manifest.skillId);
  const target = resolveInside(work, relativePath);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, content, "utf8");
  return target;
}

export async function capabilityHttpRequest(input: { url: string; method?: string; body?: string; headers?: Record<string, string> }) {
  const url = String(input.url || "");
  if (!/^https?:\/\//i.test(url)) throw new Error("只允许 http/https 请求。");
  if (containsBlockedCommand(url)) throw new Error("URL 包含被禁止的内容。");
  const response = await fetch(url, {
    method: (input.method || "GET").toUpperCase(),
    headers: input.headers,
    body: input.body,
    signal: AbortSignal.timeout(skillRuntimeConfig.executionTimeoutMs)
  });
  const text = await response.text();
  return { status: response.status, body: text.slice(0, skillRuntimeConfig.maxOutputChars) };
}

export async function capabilityShellRun(manifest: SkillManifest, command: string) {
  if (containsBlockedCommand(command)) {
    return { ok: false, output: "命令包含被禁止的操作，已阻止。" };
  }
  const work = skillWorkDirectory(manifest.skillId);
  const result = await runProcess({
    command: process.platform === "win32" ? "cmd" : "sh",
    args: process.platform === "win32" ? ["/c", command] : ["-lc", command],
    cwd: work,
    timeoutMs: skillRuntimeConfig.executionTimeoutMs
  });
  return { ok: result.code === 0, output: (result.stdout + result.stderr).slice(0, skillRuntimeConfig.maxOutputChars) };
}

/** 依赖安装的收口，供修复流程调用。 */
export async function installExtraPackages(manifest: SkillManifest, pip: string[], npm: string[]) {
  const outputs: string[] = [];
  if (pip.length) {
    const { python } = await ensurePythonEnvironment(manifest.skillId);
    const result = await pipInstall(manifest.skillId, python, pip);
    outputs.push(`pip ${pip.join(" ")} -> ${result.code}`);
    if (result.code !== 0) outputs.push((result.stderr || result.stdout).slice(-500));
    else return { ok: true, output: outputs.join(String.fromCharCode(10)) };
  }
  if (npm.length) {
    const result = await npmInstall(manifest.skillId, npm);
    outputs.push(`npm ${npm.join(" ")} -> ${result.code}`);
    if (result.code !== 0) outputs.push((result.stderr || result.stdout).slice(-500));
    else return { ok: true, output: outputs.join(String.fromCharCode(10)) };
  }
  return { ok: false, output: outputs.join(String.fromCharCode(10)) };
}

export function pythonRuntimePath(skillId: string) {
  return skillPythonDirectory(skillId);
}

export function nodeRuntimePath(skillId: string) {
  return skillNodeDirectory(skillId);
}
