import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export interface ToolCheckResult {
  name: "yt-dlp" | "ffmpeg";
  installed: boolean;
  version: string;
  message: string;
  installCommand: string;
}

export interface RequiredToolsResult {
  ok: boolean;
  tools: ToolCheckResult[];
  message: string;
}

export async function checkYtDlpInstalled() {
  return checkCommand("yt-dlp", ["--version"], "brew install yt-dlp");
}

export async function checkFfmpegInstalled() {
  return checkCommand("ffmpeg", ["-version"], "brew install ffmpeg");
}

export async function checkRequiredTools(): Promise<RequiredToolsResult> {
  const tools = await Promise.all([checkYtDlpInstalled(), checkFfmpegInstalled()]);
  const missing = tools.filter((tool) => !tool.installed);

  return {
    ok: missing.length === 0,
    tools,
    message: missing.length
      ? missing.map((tool) => tool.message).join("\n")
      : "本地工具环境正常，已检测到 yt-dlp 和 ffmpeg。"
  };
}

async function checkCommand(
  command: ToolCheckResult["name"],
  args: string[],
  installCommand: string
): Promise<ToolCheckResult> {
  try {
    const { stdout, stderr } = await execFileAsync(command, args, { timeout: 5000 });
    const output = `${stdout || stderr}`.split("\n")[0]?.trim() || "已安装";
    return {
      name: command,
      installed: true,
      version: output,
      message: `${command} 已安装。`,
      installCommand
    };
  } catch {
    return {
      name: command,
      installed: false,
      version: "",
      message: `${command} 未安装，请在终端执行：${installCommand}`,
      installCommand
    };
  }
}
