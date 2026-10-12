import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pythonImportAlias } from "@/lib/skills/analyzer";
import { skillRuntimeConfig } from "@/lib/skills/config";
import { skillNodeDirectory, skillPythonDirectory } from "@/lib/skills/paths";
import type { SkillManifest } from "@/lib/skills/types";

/**
 * Dependency Resolver（§19 / §20）。
 * 全部在 Skill 自己的隔离环境里完成：Skill A 的依赖不会影响 Skill B，也不会污染项目本身。
 */

export interface DependencyResolution {
  ok: boolean;
  installed: string[];
  failed: string[];
  pythonAvailable: boolean;
  nodeAvailable: boolean
  message: string;
  output: string;
}

export function pythonExecutable(skillId: string) {
  const venv = skillPythonDirectory(skillId);
  return process.platform === "win32" ? path.join(venv, "Scripts", "python.exe") : path.join(venv, "bin", "python");
}

export async function runProcess(options: {
  command: string;
  args: string[];
  cwd: string;
  timeoutMs: number;
  env?: Record<string, string>;
  input?: string;
}) {
  return new Promise<{ code: number | null; stdout: string; stderr: string; timedOut: boolean }>((resolve) => {
    const child = spawn(options.command, options.args, {
      cwd: options.cwd,
      env: buildSafeEnv(options.cwd, options.env),
      stdio: ["pipe", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const limit = skillRuntimeConfig.maxOutputChars;

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, options.timeoutMs);

    child.stdout.on("data", (chunk: Buffer) => {
      if (stdout.length < limit) stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk: Buffer) => {
      if (stderr.length < limit) stderr += chunk.toString("utf8");
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      resolve({ code: -1, stdout, stderr: stderr + String(error), timedOut });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr, timedOut });
    });

    if (options.input !== undefined) {
      child.stdin.write(options.input);
      child.stdin.end();
    } else {
      child.stdin.end();
    }
  });
}

/**
 * 只把最小必要的环境变量交给外部 Skill（§26：Secrets 不自动暴露）。
 */
function buildSafeEnv(cwd: string, extra?: Record<string, string>): NodeJS.ProcessEnv {
  const base: NodeJS.ProcessEnv = {
    NODE_ENV: process.env.NODE_ENV || "production",
    PATH: process.env.PATH || "",
    HOME: process.env.HOME || cwd,
    LANG: process.env.LANG || "en_US.UTF-8",
    LC_ALL: process.env.LC_ALL || "",
    TMPDIR: process.env.TMPDIR || "",
    PYTHONIOENCODING: "utf-8",
    PYTHONDONTWRITEBYTECODE: "1",
    PYTHONUNBUFFERED: "1",
    NODE_OPTIONS: "",
    GIT_TERMINAL_PROMPT: "0",
    npm_config_cache: path.join(cwd, ".npm-cache"),
    npm_config_audit: "false",
    npm_config_fund: "false",
    npm_config_update_notifier: "false"
  };
  if (extra) Object.assign(base, extra);
  return base;
}

export async function ensurePythonEnvironment(skillId: string) {
  const venv = skillPythonDirectory(skillId);
  const python = pythonExecutable(skillId);

  try {
    await readFile(python);
    return { created: false, python };
  } catch {
    // 不存在，创建
  }

  await mkdir(path.dirname(venv), { recursive: true });
  const created = await runProcess({
    command: process.env.SKILL_PYTHON_BIN || "python3",
    args: ["-m", "venv", venv],
    cwd: path.dirname(venv),
    timeoutMs: skillRuntimeConfig.installTimeoutMs
  });

  if (created.code !== 0) {
    throw new Error("Python 隔离环境创建失败：" + (created.stderr || created.stdout).slice(0, 400));
  }
  return { created: true, python };
}

export async function ensureNodeEnvironment(skillId: string) {
  const directory = skillNodeDirectory(skillId);
  await mkdir(directory, { recursive: true });
  const packageFile = path.join(directory, "package.json");
  try {
    await readFile(packageFile);
  } catch {
    await writeFile(packageFile, JSON.stringify({ name: `skill-${skillId}`, private: true, version: "1.0.0" }, null, 2), "utf8");
  }
  return { directory, packageFile };
}

export function pipPackagesOf(manifest: SkillManifest) {
  return manifest.requiredPackages.filter((item) => item.manager === "pip").map((item) => item.name);
}

export function npmPackagesOf(manifest: SkillManifest) {
  return manifest.requiredPackages.filter((item) => item.manager === "npm").map((item) => item.name);
}

/**
 * 安装声明的依赖。缺哪个装哪个，装完的会记在返回里。
 */
export async function installDeclaredDependencies(manifest: SkillManifest): Promise<DependencyResolution> {
  const installed: string[] = [];
  const failed: string[] = [];
  const outputs: string[] = [];

  const pip = pipPackagesOf(manifest);
  const npm = npmPackagesOf(manifest);

  if (pip.length) {
    const { python } = await ensurePythonEnvironment(manifest.skillId);
    for (const name of pip) {
      const result = await pipInstall(manifest.skillId, python, [name]);
      outputs.push(`pip install ${name} -> ${result.code}`);
      if (result.code === 0 && !result.timedOut) installed.push(`pip:${name}`);
      else failed.push(`pip:${name}`);
      if (result.code !== 0) outputs.push((result.stderr || result.stdout).slice(-600));
    }
  }

  if (npm.length) {
    const result = await npmInstall(manifest.skillId, npm);
    outputs.push(`npm install ${npm.join(" ")} -> ${result.code}`);
    if (result.code === 0 && !result.timedOut) npm.forEach((name) => installed.push(`npm:${name}`));
    else {
      npm.forEach((name) => failed.push(`npm:${name}`));
      outputs.push((result.stderr || result.stdout).slice(-600));
    }
  }

  return {
    ok: failed.length === 0,
    installed,
    failed,
    pythonAvailable: pip.length > 0,
    nodeAvailable: npm.length > 0,
    message: failed.length ? `有 ${failed.length} 个依赖没能自动安装` : installed.length ? `已自动准备 ${installed.length} 个依赖` : "无需额外依赖",
    output: outputs.join(String.fromCharCode(10))
  };
}

export async function pipInstall(skillId: string, python: string, packages: string[]) {
  const venv = skillPythonDirectory(skillId);
  return runProcess({
    command: python,
    args: ["-m", "pip", "install", "--disable-pip-version-check", "--no-cache-dir", "--quiet", ...packages],
    cwd: venv,
    timeoutMs: skillRuntimeConfig.installTimeoutMs
  });
}

export async function npmInstall(skillId: string, packages: string[]) {
  const { directory } = await ensureNodeEnvironment(skillId);
  return runProcess({
    command: process.platform === "win32" ? "npm.cmd" : "npm",
    args: ["install", "--no-audit", "--no-fund", "--loglevel=error", ...packages],
    cwd: directory,
    timeoutMs: skillRuntimeConfig.installTimeoutMs
  });
}

/**
 * 从运行期报错里推断缺失的依赖（§20 / §21）。
 */
export function inferMissingPythonPackage(text: string) {
  // 1) Dependency Resolver 自己给出的结构化条目：module::ErrorType::message
  const structured = /(?:^|[\s"\[{,])([A-Za-z_][\w.]*)::(?:ModuleNotFoundError|ImportError)/.exec(text);
  // 2) 原始 Python 报错文本
  const raw = /(?:ModuleNotFoundError|ImportError):\s*(?:No module named\s*)?['"]?([A-Za-z_][\w.]*)['"]?/.exec(text);
  const name = (structured && structured[1]) || (raw && raw[1]) || "";
  if (!name) return "";
  const root = name.split(".")[0];
  if (!root) return "";
  return pythonImportAlias[root] || root;
}

export function inferMissingNodePackage(text: string) {
  // 1) Dependency Resolver 自己给出的结构化结果：{"missing":["ms"]}
  const structured = /"missing"\s*:\s*\[\s*"([^"]+)"/.exec(text);
  // 2) 原始 Node 报错
  const raw = /Cannot find module ['"]([^'"]+)['"]/.exec(text) || /Cannot find package ['"]([^'"]+)['"]/.exec(text);
  const match = structured || raw;
  if (!match) return "";
  const specifier = match[1];
  if (specifier.startsWith(".") || specifier.startsWith("node:") || specifier.startsWith("/")) return "";
  return specifier.startsWith("@") ? specifier.split("/").slice(0, 2).join("/") : specifier.split("/")[0];
}
