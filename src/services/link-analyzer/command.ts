import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export async function runCommand(command: string, args: string[], timeout = 60000) {
  const result = await execFileAsync(command, args, {
    timeout,
    maxBuffer: 1024 * 1024 * 32
  });

  return {
    stdout: result.stdout || "",
    stderr: result.stderr || "",
    command: sanitizeCommand([command, ...args])
  };
}

export function summarizeProcessError(error: unknown) {
  if (!error || typeof error !== "object") {
    return "命令执行失败";
  }

  const record = error as Record<string, unknown>;
  const message = error instanceof Error ? error.message : "";
  const stderr = typeof record.stderr === "string" ? record.stderr : "";
  const stdout = typeof record.stdout === "string" ? record.stdout : "";
  return summarize([message, stderr, stdout].filter(Boolean).join(" "));
}

export function summarize(value: string) {
  const text = value.replace(/\s+/g, " ").trim();
  if (text.length <= 700) return text;
  return `${text.slice(0, 260)} ... ${text.slice(-420)}`;
}

function sanitizeCommand(parts: string[]) {
  return parts.map((part, index) => {
    const previous = parts[index - 1];
    if (previous === "--cookies") return "<cookies.txt路径已隐藏>";
    return part;
  }).join(" ");
}
