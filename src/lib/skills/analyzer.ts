import { parse as parseYaml } from "yaml";
import { mapToolsToCapabilities } from "@/lib/skills/tool-mapping";
import { skillRuntimeConfig } from "@/lib/skills/config";
import type {
  SkillEntrypoint,
  SkillPermissionSet,
  SkillRequiredPackage,
  SkillRuntimeType,
  SkillToolMapping,
  SkillType
} from "@/lib/skills/types";

/**
 * Skill Analyzer（§12）。
 * 输入：一份已解压 / 已扫描的文件清单（纯内存，不写盘）。
 * 输出：内部统一 Manifest 的分析结果。
 * 这里只回答「这是什么 Skill、它想干什么、需要什么」，不装依赖、不执行、不验证。
 */

export interface SkillFileInput {
  relativePath: string;
  bytes: Uint8Array;
}

export interface AnalyzedSkill {
  name: string;
  description: string;
  version: string;
  skillType: SkillType;
  runtimeType: SkillRuntimeType;
  instructions: string;
  systemPrompt: string;
  examples: Array<{ name: string; content: string }>;
  inputSchema: Record<string, unknown> | null;
  outputSchema: Record<string, unknown> | null;
  entrypoints: SkillEntrypoint[];
  requiredCapabilities: string[];
  requiredTools: string[];
  requiredPackages: SkillRequiredPackage[];
  requiredFiles: string[];
  environmentRequirements: string[];
  toolMappings: SkillToolMapping[];
  permissions: SkillPermissionSet;
  requiresAuthorization: boolean;
  authorization: { required: boolean; reason: string; provider?: string; envKeys?: string[] };
  metadata: Record<string, unknown>;
  mainDocPath: string;
}

const ignoredPathSegments = [
  "node_modules/", "/.git/", ".git/", "__pycache__/", ".venv/", "venv/",
  "dist/", "build/", ".next/", "coverage/", ".DS_Store"
];

const textExtensions = new Set([
  ".md", ".markdown", ".txt", ".json", ".yaml", ".yml", ".toml", ".ini", ".cfg", ".csv", ".tsv",
  ".py", ".js", ".mjs", ".cjs", ".ts", ".tsx", ".jsx", ".sh", ".bash", ".zsh", ".ps1",
  ".html", ".css", ".sql", ".env", ".example", ".gitignore", ".xml", ".rst"
]);

const mainDocCandidates = [
  "SKILL.md", "skill.md", "instructions.md", "prompt.md", "rules.md", "AGENTS.md",
  "agent.md", "README.md", "readme.md", "index.md", "manifest.md", "skill.txt"
];

const pythonEntryCandidates = ["main.py", "skill.py", "run.py", "cli.py", "app.py", "agent.py", "execute.py", "__main__.py", "index.py"];
const nodeEntryCandidates = ["index.js", "index.mjs", "index.cjs", "main.js", "main.mjs", "cli.js", "run.js", "skill.js", "index.ts", "main.ts"];

/** Python 导入名 -> pip 包名（自动修复时用得到）。 */
export const pythonImportAlias: Record<string, string> = {
  PIL: "Pillow",
  cv2: "opencv-python",
  yaml: "PyYAML",
  bs4: "beautifulsoup4",
  dotenv: "python-dotenv",
  dateutil: "python-dateutil",
  skimage: "scikit-image",
  sklearn: "scikit-learn",
  serial: "pyserial",
  jwt: "PyJWT",
  OpenSSL: "pyOpenSSL",
  fitz: "PyMuPDF",
  docx: "python-docx",
  pptx: "python-pptx",
  openpyxl: "openpyxl",
  requests: "requests",
  httpx: "httpx",
  pandas: "pandas",
  numpy: "numpy",
  matplotlib: "matplotlib",
  tenacity: "tenacity",
  tqdm: "tqdm",
  rich: "rich",
  pydantic: "pydantic",
  aiohttp: "aiohttp"
};

const pythonStdlib = new Set([
  "os", "sys", "re", "json", "math", "random", "time", "datetime", "pathlib", "typing", "collections",
  "itertools", "functools", "subprocess", "shutil", "tempfile", "argparse", "logging", "csv", "io",
  "textwrap", "urllib", "http", "hashlib", "base64", "uuid", "dataclasses", "enum", "abc", "copy",
  "glob", "zipfile", "tarfile", "gzip", "sqlite3", "asyncio", "concurrent", "threading", "queue",
  "string", "statistics", "decimal", "fractions", "unicodedata", "html", "xml", "email", "smtplib",
  "socket", "ssl", "secrets", "platform", "traceback", "warnings", "contextlib", "inspect", "importlib",
  "unittest", "pdb", "venv", "site", "sysconfig", "signal", "errno", "struct", "codecs", "locale"
]);

const nodeBuiltin = new Set([
  "fs", "path", "os", "util", "http", "https", "crypto", "url", "stream", "events", "child_process",
  "zlib", "assert", "buffer", "net", "tls", "dns", "readline", "querystring", "string_decoder",
  "timers", "tty", "v8", "vm", "worker_threads", "perf_hooks", "async_hooks", "cluster", "module",
  "process", "console", "constants", "repl", "inspector", "test"
]);

export function decodeText(bytes: Uint8Array) {
  const sample = bytes.subarray(0, Math.min(bytes.length, 4096));
  for (const byte of sample) {
    if (byte === 0) return null;
  }
  return new TextDecoder("utf-8", { fatal: false }).decode(bytes);
}

export function isIgnoredPath(relativePath: string) {
  const normalized = relativePath.replace(/\\/g, "/");
  if (normalized.startsWith("._") || normalized.includes("/._")) return true;
  return ignoredPathSegments.some((segment) => normalized.includes(segment) || normalized.startsWith(segment.replace(/^\//, "")));
}

export function extensionOf(relativePath: string) {
  const name = relativePath.split("/").pop() || "";
  const dot = name.lastIndexOf(".");
  if (dot <= 0) return "";
  return name.slice(dot).toLowerCase();
}

export function isScriptExtension(value: string) {
  return value === ".js" || value === ".mjs" || value === ".cjs" || value === ".ts" || value === ".tsx";
}

/* ------------------------------------------------------------------ 入口分析 */

export function analyzeSkillFiles(files: SkillFileInput[], fallbackName: string): AnalyzedSkill {
  const usable = files.filter((file) => !isIgnoredPath(file.relativePath));
  const texts = new Map<string, string>();
  for (const file of usable) {
    const extension = extensionOf(file.relativePath);
    const name = file.relativePath.split("/").pop() || "";
    if (!textExtensions.has(extension) && !name.startsWith(".")) continue;
    if (file.bytes.byteLength > skillRuntimeConfig.maxFileBytes) continue;
    const decoded = decodeText(file.bytes);
    if (decoded !== null) texts.set(file.relativePath, decoded);
  }

  const mainDocPath = pickMainDoc(Array.from(texts.keys()), fallbackName);
  const mainDoc = mainDocPath ? texts.get(mainDocPath) || "" : "";
  const frontmatter = parseFrontmatter(mainDoc);
  const body = frontmatter.body;

  const name = cleanName(firstString(frontmatter.data.name, frontmatter.data.title, firstHeading(body))) || fallbackName;
  const description = cleanInline(firstString(frontmatter.data.description, frontmatter.data.summary, firstParagraph(body))) || ("来自 " + fallbackName + " 的 Skill");
  const version = cleanInline(firstString(frontmatter.data.version, packageVersion(texts), ""));

  const declaredTools = collectDeclaredTools(frontmatter.data, body);
  const codeSignals = collectCodeSignals(texts);
  const toolNameSet = new Set<string>([...declaredTools, ...codeSignals.toolNames]);
  const mapped = mapToolsToCapabilities(Array.from(toolNameSet));

  const requiredPackages = collectRequiredPackages(texts);
  const entrypoints = collectEntrypoints(texts);
  const schemas = collectSchemas(texts, frontmatter.data);
  const examples = collectExamples(texts, body);

  const skillType = decideSkillType({ texts, entrypoints });
  const runtimeType = decideRuntimeType(skillType);

  const capabilitySet = new Set(mapped.capabilities);
  if (codeSignals.python && entrypoints.some((item) => item.runtime === "python")) capabilitySet.add("python.run");
  if (codeSignals.node && entrypoints.some((item) => item.runtime === "node")) capabilitySet.add("node.run");
  if (codeSignals.http) capabilitySet.add("http.request");
  if (codeSignals.shell) capabilitySet.add("shell.run");
  if (skillType === "prompt_skill" || skillType === "structured_skill") capabilitySet.add("model.text");

  const permissions = buildPermissions(capabilitySet, codeSignals);
  const authorization = detectAuthorization(texts, frontmatter.data, body);
  const environmentRequirements = collectEnvironmentRequirements(frontmatter.data, texts, codeSignals, entrypoints);
  const instructions = body.trim();
  const systemPrompt = buildSystemPrompt(name, description, instructions, examples);

  return {
    name,
    description,
    version,
    skillType,
    runtimeType,
    instructions,
    systemPrompt,
    examples,
    inputSchema: schemas.input,
    outputSchema: schemas.output,
    entrypoints,
    requiredCapabilities: Array.from(capabilitySet).sort(),
    requiredTools: Array.from(toolNameSet).filter(Boolean).sort(),
    requiredPackages,
    requiredFiles: usable
      .filter((file) => /^(assets|references|resources|data|templates)["'\/]/i.test(file.relativePath))
      .map((file) => file.relativePath)
      .slice(0, 60),
    environmentRequirements,
    toolMappings: mapped.mappings,
    permissions,
    requiresAuthorization: authorization.required,
    authorization,
    metadata: {
      fileCount: usable.length,
      mainDocPath,
      frontmatter: frontmatter.data,
      codeFolders: {
        hasPython: codeSignals.python,
        hasNode: codeSignals.node,
        hasShell: codeSignals.shell
      }
    },
    mainDocPath
  };
}

/* ------------------------------------------------------------------ 主说明文件 */

function pickMainDoc(paths: string[], fallbackName: string) {
  const lower = new Map(paths.map((item) => [item.toLowerCase(), item]));
  for (const candidate of mainDocCandidates) {
    const hit = lower.get(candidate.toLowerCase());
    if (hit) return hit;
  }
  const sameName = lower.get(fallbackName.toLowerCase() + ".md");
  if (sameName) return sameName;
  const semantic = paths.find((item) => /(^|\/)(skill|instructions?|prompt|rules?|agent)[^\/]*\.md$/i.test(item));
  if (semantic) return semantic;
  const markdown = paths
    .filter((item) => /\.md$/i.test(item))
    .sort((a, b) => a.split("/").length - b.split("/").length || a.length - b.length);
  if (markdown.length) return markdown[0];
  return paths.find((item) => /\.(txt|json|ya?ml)$/i.test(item)) || "";
}

function parseFrontmatter(content: string): { data: Record<string, unknown>; body: string } {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(content);
  if (!match) {
    const alt = /^\+\+\+\r?\n([\s\S]*?)\r?\n\+\+\+\r?\n?/.exec(content);
    if (alt) {
      try {
        const data = parseYaml(alt[1]) as Record<string, unknown>;
        if (data && typeof data === "object") return { data, body: content.slice(alt[0].length) };
      } catch {
        /* ignore */
      }
    }
    return { data: {}, body: content };
  }
  try {
    const data = parseYaml(match[1]);
    if (data && typeof data === "object" && !Array.isArray(data)) {
      return { data: data as Record<string, unknown>, body: content.slice(match[0].length) };
    }
  } catch {
    /* 解析失败就当没有 frontmatter，不影响导入 */
  }
  return { data: {}, body: content.slice(match[0].length) };
}

function firstHeading(body: string) {
  const match = /^\s*#\s+(.+)$/m.exec(body);
  return match ? match[1] : "";
}

function firstParagraph(body: string) {
  const cleaned = body
    .replace(/^\s*#.*$/gm, "")
    .split(/\n\s*\n/)
    .map((item) => item.replace(/\s+/g, " ").trim())
    .filter((item) => item.length > 12 && !item.startsWith("-") && !item.startsWith("*"));
  return cleaned[0] || "";
}

function packageVersion(texts: Map<string, string>) {
  for (const [file, content] of texts) {
    if (file.endsWith("package.json")) {
      try {
        const parsed = JSON.parse(content) as { version?: string };
        if (parsed.version) return parsed.version;
      } catch {
        /* ignore */
      }
    }
    if (file.endsWith("pyproject.toml")) {
      const match = /^\s*version\s*=\s*["']([^"']+)["']/m.exec(content);
      if (match) return match[1];
    }
  }
  return "";
}

function cleanName(value: string) {
  return value.replace(/[\r\n]+/g, " ").replace(/^#+\s*/, "").trim().slice(0, 80);
}

function cleanInline(value: string) {
  return value.replace(/\s+/g, " ").trim().slice(0, 300);
}

function firstString(...values: unknown[]) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
    if (Array.isArray(value) && value.length && typeof value[0] === "string") return String(value[0]).trim();
  }
  return "";
}

/* ------------------------------------------------------------------ 工具声明 */

function collectDeclaredTools(frontmatter: Record<string, unknown>, body: string) {
  const names = new Set<string>();
  const keys = ["allowed-tools", "allowed_tools", "tools", "tool", "capabilities", "capability", "mcp", "servers", "required-tools"];

  for (const key of keys) {
    const value = frontmatter[key];
    if (!value) continue;
    if (typeof value === "string") {
      value.split(/[,\n]/).forEach((item) => addToolName(names, item));
    } else if (Array.isArray(value)) {
      value.forEach((item) => {
        if (typeof item === "string") addToolName(names, item);
        else if (item && typeof item === "object") {
          const record = item as Record<string, unknown>;
          addToolName(names, firstString(record.name, record.tool, record.id));
        }
      });
    } else if (value && typeof value === "object") {
      Object.keys(value as Record<string, unknown>).forEach((item) => addToolName(names, item));
      Object.values(value as Record<string, unknown>).forEach((item) => {
        if (typeof item === "string") addToolName(names, item);
      });
    }
  }

  const toolSection = /(?:^|\n)#{1,4}\s*(?:tools?|工具|能力|allowed tools)[^\n]*\n([\s\S]{0,4000})/i.exec(body);
  if (toolSection) {
    for (const match of toolSection[1].matchAll(/`([a-zA-Z][\w.:/-]{2,60})`/g)) {
      addToolName(names, match[1]);
    }
  }

  return Array.from(names);
}

function addToolName(set: Set<string>, raw: string) {
  const value = raw.replace(/[`*]/g, "").trim();
  if (!value || value.length > 80) return;
  if (/^(true|false|null|none|all|auto)$/i.test(value)) return;
  if (/^(readme|skill|md|python|node|json|yaml)$/i.test(value)) return;
  set.add(value);
}

/* ------------------------------------------------------------------ 代码信号 */

function collectCodeSignals(texts: Map<string, string>) {
  let python = false;
  let node = false;
  let shell = false;
  let http = false;
  const toolNames = new Set<string>();

  for (const [file, content] of texts) {
    const extension = extensionOf(file);
    if (extension === ".py") {
      python = true;
      if (/(import\s+requests|import\s+httpx|import\s+aiohttp|from\s+requests|urlopen|urllib\.request)/.test(content)) http = true;
      if (/(subprocess|os\.system|shutil\.which)/.test(content)) shell = true;
    } else if (isScriptExtension(extension)) {
      node = true;
      if (/(axios|node-fetch|undici|got|fetch\()/.test(content)) http = true;
      if (/(child_process|execSync|spawnSync)/.test(content)) shell = true;
    } else if (extension === ".sh" || extension === ".bash" || extension === ".zsh") {
      shell = true;
    }
  }

  return { python, node, shell, http, toolNames: Array.from(toolNames) };
}

/* ------------------------------------------------------------------ 依赖 */

function collectRequiredPackages(texts: Map<string, string>): SkillRequiredPackage[] {
  const packages = new Map<string, SkillRequiredPackage>();

  for (const [file, content] of texts) {
    const base = file.split("/").pop() || "";
    if (base === "requirements.txt") {
      content.split(/\r?\n/).forEach((line) => {
        const cleaned = line.split("#")[0].trim();
        if (!cleaned || cleaned.startsWith("-")) return;
        const match = /^([A-Za-z0-9_.\-\[\]]+)\s*([<>=!~].*)?$/.exec(cleaned);
        if (!match) return;
        const name = match[1].replace(/\[.*\]/, "");
        packages.set("pip:" + name.toLowerCase(), { name, version: (match[2] || "").trim(), manager: "pip", origin: "declared" });
      });
    }

    if (base === "pyproject.toml") {
      const block = /dependencies\s*=\s*\[([\s\S]*?)\]/.exec(content);
      if (block) {
        for (const match of block[1].matchAll(/"([^"]+)"|'([^']+)'/g)) {
          const spec = match[1] || match[2];
          const name = spec.split(/[<>=!~ ;\[]/)[0].trim();
          if (name) packages.set("pip:" + name.toLowerCase(), { name, manager: "pip", origin: "declared" });
        }
      }
    }

    if (base === "package.json") {
      try {
        const parsed = JSON.parse(content) as { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
        Object.entries(parsed.dependencies || {}).forEach(([name, version]) => {
          packages.set("npm:" + name, { name, version, manager: "npm", origin: "declared" });
        });
        Object.entries(parsed.devDependencies || {}).forEach(([name, version]) => {
          packages.set("npm:" + name, { name, version, manager: "npm", origin: "declared" });
        });
      } catch {
        /* ignore */
      }
    }
  }

  for (const [file, content] of texts) {
    if (extensionOf(file) !== ".py") continue;
    for (const match of content.matchAll(/^\s*(?:from|import)\s+([A-Za-z_][\w.]*)/gm)) {
      const root = match[1].split(".")[0];
      if (!root || pythonStdlib.has(root) || root.startsWith("_")) continue;
      const key = "pip:" + root.toLowerCase();
      if (packages.has(key)) continue;
      const mappedName = pythonImportAlias[root];
      if (mappedName) packages.set("pip:" + mappedName.toLowerCase(), { name: mappedName, manager: "pip", origin: "inferred" });
    }
  }

  for (const [file, content] of texts) {
    if (!isScriptExtension(extensionOf(file))) continue;
    const specifiers = new Set<string>();
    for (const match of content.matchAll(/require\(\s*["']([^"']+)["']\s*\)/g)) specifiers.add(match[1]);
    for (const match of content.matchAll(/from\s+["']([^"']+)["']/g)) specifiers.add(match[1]);
    for (const match of content.matchAll(/import\(\s*["']([^"']+)["']\s*\)/g)) specifiers.add(match[1]);
    for (const specifier of specifiers) {
      if (specifier.startsWith(".") || specifier.startsWith("node:") || specifier.startsWith("data:")) continue;
      const name = specifier.startsWith("@") ? specifier.split("/").slice(0, 2).join("/") : specifier.split("/")[0];
      if (nodeBuiltin.has(name)) continue;
      const key = "npm:" + name;
      if (packages.has(key)) continue;
      packages.set(key, { name, manager: "npm", origin: "inferred" });
    }
  }

  return Array.from(packages.values()).sort((a, b) => a.name.localeCompare(b.name));
}

/* ------------------------------------------------------------------ 入口 */

function collectEntrypoints(texts: Map<string, string>): SkillEntrypoint[] {
  const paths = Array.from(texts.keys());
  const entrypoints: SkillEntrypoint[] = [];

  const pythonCandidates = paths.filter((item) => extensionOf(item) === ".py");
  const nodeCandidates = paths.filter((item) => isScriptExtension(extensionOf(item)));

  for (const [file, content] of texts) {
    if (!file.endsWith("package.json")) continue;
    try {
      const parsed = JSON.parse(content) as { main?: string; bin?: string | Record<string, string> };
      const binPath = typeof parsed.bin === "string" ? parsed.bin : parsed.bin ? Object.values(parsed.bin)[0] : "";
      const candidate = binPath || parsed.main || "";
      if (candidate) {
        const normalized = candidate.replace(/^\.\//, "");
        const hit = paths.find((item) => item === normalized || item.endsWith("/" + normalized));
        if (hit) entrypoints.push({ path: hit, runtime: "node", primary: true });
      }
    } catch {
      /* ignore */
    }
  }

  // 常见候选名（main.py / skill.py / index.mjs …）优先
  const primaryPython = pickByPriority(pythonCandidates, pythonEntryCandidates);
  if (primaryPython) entrypoints.push({ path: primaryPython, runtime: "python", primary: !entrypoints.some((item) => item.primary) });

  const primaryNode = pickByPriority(nodeCandidates, nodeEntryCandidates);
  if (primaryNode && !entrypoints.some((item) => item.path === primaryNode)) {
    entrypoints.push({ path: primaryNode, runtime: "node", primary: !entrypoints.some((item) => item.primary) });
  }

  // 兜底（§7：不要假设外部 Skill 有固定目录结构）：
  // 没有任何候选名命中时，如果整个 Skill 只有一个脚本文件，就把它当作入口。
  if (!primaryPython && pythonCandidates.length === 1) {
    entrypoints.push({ path: pythonCandidates[0], runtime: "python", primary: !entrypoints.some((item) => item.primary) });
  }
  if (!primaryNode && nodeCandidates.length === 1 && !entrypoints.some((item) => item.path === nodeCandidates[0])) {
    entrypoints.push({ path: nodeCandidates[0], runtime: "node", primary: !entrypoints.some((item) => item.primary) });
  }

  for (const [, content] of texts) {
    for (const match of content.matchAll(/python3?\s+([\w./-]+\.py)/g)) {
      const hit = paths.find((item) => item.endsWith(match[1]));
      if (hit && !entrypoints.some((item) => item.path === hit)) entrypoints.push({ path: hit, runtime: "python", primary: false });
    }
    for (const match of content.matchAll(/node\s+([\w./-]+\.(?:mjs|cjs|js))/g)) {
      const hit = paths.find((item) => item.endsWith(match[1]));
      if (hit && !entrypoints.some((item) => item.path === hit)) entrypoints.push({ path: hit, runtime: "node", primary: false });
    }
  }

  return entrypoints.slice(0, 8);
}

function pickByPriority(paths: string[], candidates: string[]) {
  const lower = new Map(paths.map((item) => [item.toLowerCase(), item]));
  const rootOnly = paths.filter((item) => !item.includes("/"));

  for (const candidate of candidates) {
    const hit = rootOnly.find((item) => item.toLowerCase() === candidate.toLowerCase()) || lower.get(candidate.toLowerCase());
    if (hit) return hit;
  }
  for (const candidate of candidates) {
    const base = candidate.replace(/\.(py|mjs|cjs|js|ts)$/i, "").toLowerCase();
    const hit = paths.find((item) => {
      const name = (item.split("/").pop() || "").toLowerCase();
      return name.startsWith(base + ".");
    });
    if (hit) return hit;
  }
  return "";
}

/* ------------------------------------------------------------------ Schema */

function collectSchemas(texts: Map<string, string>, frontmatter: Record<string, unknown>) {
  let input: Record<string, unknown> | null = null;
  let output: Record<string, unknown> | null = null;

  const frontmatterInput = frontmatter.input || frontmatter.input_schema || frontmatter.inputSchema;
  const frontmatterOutput = frontmatter.output || frontmatter.output_schema || frontmatter.outputSchema;
  if (frontmatterInput && typeof frontmatterInput === "object") input = frontmatterInput as Record<string, unknown>;
  if (frontmatterOutput && typeof frontmatterOutput === "object") output = frontmatterOutput as Record<string, unknown>;

  for (const [file, content] of texts) {
    const lower = file.toLowerCase();
    const looksLikeSchema = lower.endsWith(".schema.json") || lower.endsWith("schema.json") || lower.endsWith(".schema.yaml") || lower.endsWith(".schema.yml");
    if (!looksLikeSchema && !/schemas?\//.test(lower)) continue;
    try {
      const parsed = lower.endsWith(".json") ? JSON.parse(content) : parseYaml(content);
      if (!parsed || typeof parsed !== "object") continue;
      const record = parsed as Record<string, unknown>;
      if (!input && (lower.includes("input") || record.properties)) input = record;
      if (!output && lower.includes("output")) output = record;
    } catch {
      /* ignore */
    }
  }

  return { input, output };
}

/* ------------------------------------------------------------------ 示例 */

function collectExamples(texts: Map<string, string>, body: string) {
  const examples: Array<{ name: string; content: string }> = [];

  for (const [file, content] of texts) {
    if (!/examples?\//i.test(file) && !/examples?\./i.test(file)) continue;
    if (examples.length >= 8) break;
    const extension = extensionOf(file);
    if (extension === ".md" || extension === ".txt") {
      examples.push({ name: file.split("/").pop() || file, content: content.slice(0, skillRuntimeConfig.maxExampleChars) });
    }
  }

  const section = /(?:^|\n)#{1,4}\s*(?:examples?|示例|例子)[^\n]*\n([\s\S]{0,3000})/i.exec(body);
  if (section && examples.length < 8) {
    examples.push({ name: "正文示例", content: section[1].slice(0, skillRuntimeConfig.maxExampleChars) });
  }

  return examples;
}

/* ------------------------------------------------------------------ 分类 */

function decideSkillType(input: { texts: Map<string, string>; entrypoints: SkillEntrypoint[] }): SkillType {
  const keys = Array.from(input.texts.keys());
  const hasPython = input.entrypoints.some((item) => item.runtime === "python") || keys.some((item) => extensionOf(item) === ".py");
  const hasNode = input.entrypoints.some((item) => item.runtime === "node") || keys.some((item) => isScriptExtension(extensionOf(item)));
  const hasSchema = keys.some((item) => /schema\.(json|ya?ml)$/i.test(item));

  if (hasPython && hasNode) return "hybrid_skill";
  if (hasPython && hasSchema) return "hybrid_skill";
  if (hasPython) return "python_skill";
  if (hasNode) return "node_skill";
  if (hasSchema) return "structured_skill";
  return "prompt_skill";
}

function decideRuntimeType(skillType: SkillType): SkillRuntimeType {
  if (skillType === "python_skill") return "python";
  if (skillType === "node_skill") return "node";
  if (skillType === "hybrid_skill") return "hybrid";
  return "prompt";
}

/* ------------------------------------------------------------------ 权限 */

function buildPermissions(capabilities: Set<string>, signals: { shell: boolean; http: boolean }): SkillPermissionSet {
  const has = (id: string) => capabilities.has(id);
  const needsNetwork = has("http.request") || has("web.search") || has("web.fetch") || has("image.generate") || has("model.text") || signals.http;
  const needsShell = has("shell.run") || signals.shell;
  const needsFiles = has("file.read") || has("file.write") || has("document.read");
  return {
    network: needsNetwork,
    filesystem: needsFiles,
    shell: needsShell,
    externalAuthorization: false,
    paidApi: false
  };
}

/* ------------------------------------------------------------------ 授权检测（§28 / §29） */

const authorizationKeywords: Array<{ pattern: RegExp; provider: string }> = [
  { pattern: /(notion)/i, provider: "Notion" },
  { pattern: /(feishu|lark|飞书)/i, provider: "飞书" },
  { pattern: /(google|gmail|google drive|google calendar)/i, provider: "Google" },
  { pattern: /(douyin|抖音|tiktok)/i, provider: "抖音" },
  { pattern: /(xiaohongshu|小红书)/i, provider: "小红书" },
  { pattern: /(wechat|微信|公众号)/i, provider: "微信" },
  { pattern: /(slack|discord|telegram)/i, provider: "Slack / Discord / Telegram" },
  { pattern: /(shopify|amazon|淘宝|天猫|拼多多)/i, provider: "电商平台" },
  { pattern: /(github)/i, provider: "GitHub" },
  { pattern: /(openai|anthropic|claude|gemini|tikhub|轻抖|midjourney)/i, provider: "第三方模型 / 数据服务" }
];

const credentialKeywords = /(api[ _-]?key|access[ _-]?token|secret|oauth|client[ _-]?id|bearer|credential|授权|鉴权|登录|账号)/i;
const envKeyRegex = /(?:^|[^A-Z0-9_])([A-Z][A-Z0-9_]{3,}(?:_KEY|_TOKEN|_SECRET|_ID|_URL|_CLIENT|_SECRET_KEY))(?:[^A-Z0-9_]|$)/g;

function detectAuthorization(
  texts: Map<string, string>,
  frontmatter: Record<string, unknown>,
  body: string
) {
  const reasons: string[] = [];
  let provider = "";
  const envKeys = new Set<string>();

  const frontmatterEnv = frontmatter.env || frontmatter.environment || frontmatter.credentials || frontmatter.secrets;
  if (frontmatterEnv) {
    if (Array.isArray(frontmatterEnv)) frontmatterEnv.forEach((item) => { if (typeof item === "string") envKeys.add(item); });
    else if (typeof frontmatterEnv === "object") Object.keys(frontmatterEnv as Record<string, unknown>).forEach((key) => envKeys.add(key));
    else if (typeof frontmatterEnv === "string") frontmatterEnv.split(/[,\s]+/).forEach((item) => { if (item) envKeys.add(item); });
  }

  if (Array.isArray(frontmatter.requires)) {
    (frontmatter.requires as unknown[]).forEach((item) => {
      if (typeof item === "string" && /key|token|oauth|auth|credential/i.test(item)) reasons.push(item);
    });
  }

  const haystack = [body, ...Array.from(texts.values())].join("\n").slice(0, 200000);
  for (const match of haystack.matchAll(envKeyRegex)) envKeys.add(match[1]);

  const hasCredentialWords = credentialKeywords.test(haystack);
  if (envKeys.size > 0 && hasCredentialWords) {
    reasons.push("需要配置环境变量：" + Array.from(envKeys).slice(0, 5).join("、"));
  }

  if (hasCredentialWords) {
    for (const item of authorizationKeywords) {
      if (item.pattern.test(haystack)) {
        provider = provider || item.provider;
        reasons.push("依赖 " + item.provider + " 账号或授权");
        break;
      }
    }
    if (!provider && /oauth/i.test(haystack)) provider = "第三方 OAuth";
    if (!provider && envKeys.size > 0) provider = "用户自己的 API Key";
  }

  if (/mcp/i.test(haystack) && /credential|token|api[ _-]?key|授权/i.test(haystack)) {
    reasons.push("依赖外部 MCP 服务的凭证");
  }

  const required = reasons.length > 0;
  return {
    required,
    reason: required ? Array.from(new Set(reasons)).slice(0, 3).join("；") : "",
    provider: provider || undefined,
    envKeys: envKeys.size ? Array.from(envKeys).slice(0, 8) : undefined
  };
}

/* ------------------------------------------------------------------ 环境要求 */

function collectEnvironmentRequirements(
  frontmatter: Record<string, unknown>,
  texts: Map<string, string>,
  signals: { python: boolean; node: boolean },
  entrypoints: SkillEntrypoint[]
) {
  const requirements: string[] = [];

  const declared = frontmatter.requires || frontmatter.requirements || frontmatter.environment;
  if (typeof declared === "string") requirements.push(declared);
  if (Array.isArray(declared)) declared.forEach((item) => { if (typeof item === "string") requirements.push(item); });

  if (signals.python || entrypoints.some((item) => item.runtime === "python")) requirements.push("需要 Python 运行时（系统自动建立隔离环境）");
  if (signals.node || entrypoints.some((item) => item.runtime === "node")) requirements.push("需要 Node 运行时（系统自动建立隔离环境）");

  for (const [file, content] of texts) {
    const base = file.split("/").pop() || "";
    if (base === "package.json") {
      try {
        const parsed = JSON.parse(content) as { engines?: { node?: string } };
        if (parsed.engines?.node) requirements.push("Node " + parsed.engines.node);
      } catch {
        /* ignore */
      }
    }
    if (base === "pyproject.toml") {
      const match = /requires-python\s*=\s*["']([^"']+)["']/.exec(content);
      if (match) requirements.push("Python " + match[1]);
    }
  }

  return Array.from(new Set(requirements)).slice(0, 8);
}

/* ------------------------------------------------------------------ 提示词组装 */

function buildSystemPrompt(name: string, description: string, instructions: string, examples: Array<{ name: string; content: string }>) {
  const parts: string[] = [
    "你现在使用「" + name + "」这个 Skill 来完成任务。",
    description ? "Skill 目标：" + description : ""
  ];
  if (instructions.trim()) {
    parts.push("", "【Skill 指令】", instructions.trim().slice(0, skillRuntimeConfig.maxInstructionsChars));
  }
  const usableExamples = examples.slice(0, skillRuntimeConfig.maxExamples).filter((item) => item.content.trim());
  if (usableExamples.length) {
    parts.push("", "【参考示例】");
    usableExamples.forEach((item) => {
      parts.push("— " + item.name + " —", item.content.trim().slice(0, skillRuntimeConfig.maxExampleChars));
    });
  }
  return parts.filter(Boolean).join(String.fromCharCode(10));
}
