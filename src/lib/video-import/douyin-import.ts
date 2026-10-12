import { spawn, execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream, existsSync, readFileSync } from "node:fs";
import { mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { generateReplicaVideoThumbnail, persistReplicaVideoFileSource } from "@/lib/replica-cache";
import type { ReplicaVideoMetadata } from "@/lib/replica-types";

const execFileAsync = promisify(execFile);
const browserUserAgent =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36";
const sidecarTimeoutMs = Number(process.env.DOUYIN_SIDECAR_TIMEOUT_MS || 5 * 60_000);
const maxVideoBytes = 1024 * 1024 * 1024;

export type DouyinImportStage =
  | "INVALID_URL" | "URL_RESOLVE_FAILED" | "VIDEO_ID_NOT_FOUND" | "METADATA_FAILED"
  | "UNSUPPORTED_CONTENT" | "AUTH_REQUIRED" | "DOWNLOAD_URL_NOT_FOUND" | "DOWNLOAD_FAILED"
  | "VIDEO_VALIDATION_FAILED" | "NETWORK_ERROR" | "TIMEOUT" | "SIDECAR_NOT_FOUND"
  | "SIDECAR_PERMISSION_DENIED" | "SIDECAR_START_FAILED" | "STORAGE_FAILED";

export interface DouyinImportResult {
  videoPath: string;
  thumbnailPath: string;
  videoHash: string;
  metadata: ReplicaVideoMetadata;
  source: {
    sourceUrl: string;
    resolvedUrl: string;
    awemeId: string;
    title: string;
    authorName: string;
    importedAt: string;
  };
}

export interface DouyinProbeResult {
  duration: number;
  width: number;
  height: number;
  fps: number;
  hasAudio: boolean;
  videoCodec: string;
  audioCodec: string;
  fileSize: number;
}

interface SidecarSuccess {
  ok: true;
  sourceUrl: string;
  resolvedUrl: string;
  awemeId: string;
  title: string;
  author: string;
  durationMs: number;
  width: number;
  height: number;
  coverUrl: string;
  localVideoPath: string;
}

interface SidecarFailure {
  ok: false;
  stage: string;
  code: DouyinImportStage | string;
  message: string;
}

type SidecarPayload = SidecarSuccess | SidecarFailure;

export class DouyinImportError extends Error {
  stage: DouyinImportStage;
  constructor(stage: DouyinImportStage, message: string) {
    super(message);
    this.name = "DouyinImportError";
    this.stage = stage;
  }
}

function logStage(stage: string, status: "SUCCESS" | "FAILED" | "TRUE", detail = "") {
  console.info(`[DOUYIN_IMPORT] ${stage} ${status}${detail ? ` ${detail}` : ""}`);
}

function findProjectRoot(): string {
  let current = process.cwd();
  for (let depth = 0; depth < 6; depth += 1) {
    if (existsSync(path.join(current, "package.json"))
      && existsSync(path.join(current, "external-tools", "douyin-importer", "douyin_importer.py"))) {
      return current;
    }
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return process.cwd();
}

function findSidecar(): { command: string; args: string[] } {
  const override = process.env.DIRECTOR_DOUYIN_IMPORTER;
  if (override && existsSync(override)) return { command: override, args: [] };

  const resourcesPath = (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath || "";
  const resourceBinary = path.join(resourcesPath, "douyin-importer", "douyin-importer");
  if (resourcesPath && existsSync(resourceBinary)) return { command: resourceBinary, args: [] };

  const projectRoot = findProjectRoot();
  const devScript = path.join(projectRoot, "external-tools", "douyin-importer", "douyin_importer.py");
  const python = process.env.DIRECTOR_DOUYIN_PYTHON || "python3";
  if (existsSync(devScript)) return { command: python, args: [devScript] };

  const resourceScript = path.join(resourcesPath, "douyin-importer", "douyin_importer.py");
  if (resourcesPath && existsSync(resourceScript)) return { command: python, args: [resourceScript] };

  throw new DouyinImportError("SIDECAR_NOT_FOUND", "抖音导入组件启动失败，请重新启动应用。");
}

function runSidecar(input: string): Promise<SidecarSuccess> {
  let command: string;
  let args: string[];
  try {
    const resolved = findSidecar();
    command = resolved.command;
    args = resolved.args;
  } catch (error) {
    logStage("SIDECAR_PATH", "FAILED", "not_found");
    throw error;
  }
  logStage("SIDECAR_PATH", "SUCCESS", path.basename(command));

  return new Promise<SidecarSuccess>((resolve, reject) => {
    let settled = false;
    let workDir = "";
    let child: ReturnType<typeof spawn> | null = null;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child?.kill("SIGKILL");
      reject(new DouyinImportError("TIMEOUT", "视频导入超时，请重试。"));
    }, sidecarTimeoutMs);

    void (async () => {
      workDir = await mkdtemp(path.join(tmpdir(), "director-douyin-"));
      child = spawn(command, [...args, "--input", input, "--output", workDir], {
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true
      });
      let stdout = "";
      child.stdout?.on("data", (chunk: Buffer) => { stdout = `${stdout}${chunk}`; });
      child.stderr?.on("data", (chunk: Buffer) => {
        chunk.toString().split(/\r?\n/).filter(Boolean).forEach((line) => {
          if (line.startsWith("[DOUYIN_IMPORT]") || line.includes("APIClient - ERROR")) {
            console.info(line.replace(/([?&](?:cookie|token|sign)=)[^&\s]+/gi, "$1<redacted>"));
          }
        });
      });
      child.on("error", (error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        logStage("SIDECAR_START", "FAILED", error.name);
        reject(new DouyinImportError("SIDECAR_START_FAILED", "抖音导入组件启动失败，请重新启动应用。"));
      });
      child.on("close", (code) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        logStage("SIDECAR_EXIT", code === 0 ? "SUCCESS" : "FAILED", `code=${code}`);
        let payload: SidecarPayload | null = null;
        try {
          const resultPath = path.join(workDir, "result.json");
          if (existsSync(resultPath)) {
            logStage("SIDECAR_RESULT_PATH_READ", "SUCCESS", resultPath);
            payload = JSON.parse(readFileSync(resultPath, "utf8")) as SidecarPayload;
          } else {
            payload = JSON.parse(stdout.trim().split(/\r?\n/).filter(Boolean).pop() || "") as SidecarPayload;
          }
        } catch (error) {
          payload = null;
          logStage("SIDECAR_RESULT", "FAILED", `stdout_length=${stdout.length}, stdout_tail=${stdout.slice(-240).replace(/\s+/g, " ")}`);
        }
        if (payload && payload.ok) {
          resolve(payload);
          return;
        }
        const stage = normalizeStage(payload?.code || payload?.stage || "");
        const message = payload?.message || (code === 0 ? "视频导入失败，请稍后重试。" : "抖音导入组件启动失败，请重新启动应用。");
        logStage("FAILED", "TRUE", `stage=${stage} message=${message}`);
        reject(new DouyinImportError(stage, message));
      });
    })().catch((error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(error instanceof DouyinImportError ? error : new DouyinImportError("SIDECAR_START_FAILED", "抖音导入组件启动失败，请重新启动应用。"));
    });
  });
}

function normalizeStage(value: string): DouyinImportStage {
  const allowed: DouyinImportStage[] = [
    "INVALID_URL", "URL_RESOLVE_FAILED", "VIDEO_ID_NOT_FOUND", "METADATA_FAILED",
    "UNSUPPORTED_CONTENT", "AUTH_REQUIRED", "DOWNLOAD_URL_NOT_FOUND", "DOWNLOAD_FAILED",
    "VIDEO_VALIDATION_FAILED", "NETWORK_ERROR", "TIMEOUT", "SIDECAR_NOT_FOUND",
    "SIDECAR_PERMISSION_DENIED", "SIDECAR_START_FAILED", "STORAGE_FAILED"
  ];
  return allowed.includes(value as DouyinImportStage) ? value as DouyinImportStage : "METADATA_FAILED";
}

export async function importDouyinVideo(input: string): Promise<DouyinImportResult> {
  logStage("INPUT_RECEIVED", "SUCCESS", `length=${String(input || "").length}`);
  const sidecar = await runSidecar(input);
  logStage("SIDECAR_RESULT", "SUCCESS", `awemeId=${sidecar.awemeId}, localVideoPath=${sidecar.localVideoPath}, durationMs=${sidecar.durationMs}, sizeUnknown=true`);
  logStage("URL_EXTRACTED", "SUCCESS", sidecar.awemeId);
  logStage("URL_RESOLVED", "SUCCESS", safeHost(sidecar.resolvedUrl));
  logStage("VIDEO_ID", "SUCCESS", sidecar.awemeId);
  logStage("METADATA_OK", "SUCCESS", sidecar.awemeId);
  logStage("DOWNLOAD_OK", "SUCCESS", sidecar.localVideoPath);

  const downloadedPath = sidecar.localVideoPath;
  const fileStat = await stat(downloadedPath);
  if (fileStat.size < 16 * 1024) throw new DouyinImportError("VIDEO_VALIDATION_FAILED", "视频已识别，但下载失败，请重试。");
  if (fileStat.size > maxVideoBytes) throw new DouyinImportError("VIDEO_VALIDATION_FAILED", "视频文件超过 1GB，请先压缩或分段后再导入。");

  const probe = await probeDownloadedVideo(downloadedPath, fileStat.size);
  const videoHash = await hashFile(downloadedPath);
  const videoPath = await persistReplicaVideoFileSource({
    sourcePath: downloadedPath,
    hash: videoHash,
    extension: path.extname(downloadedPath).toLowerCase() || ".mp4"
  });
  const thumbnailPath = await prepareThumbnail({
    videoPath,
    videoHash,
    coverUrl: sidecar.coverUrl,
    workDir: path.dirname(downloadedPath)
  });
  logStage("ASSET_IMPORTED", "SUCCESS", `hash=${videoHash}, size=${fileStat.size}`);

  // 清理 sidecar 临时工作目录：视频已持久化到本模块缓存目录，临时目录不再被引用
  const workDir = path.dirname(downloadedPath);
  if (workDir.startsWith(tmpdir()) && path.basename(workDir).startsWith("director-douyin-")) {
    void rm(workDir, { recursive: true, force: true }).catch(() => undefined);
  }

  return {
    videoPath,
    thumbnailPath,
    videoHash,
    metadata: probe,
    source: {
      sourceUrl: sidecar.sourceUrl,
      resolvedUrl: sidecar.resolvedUrl,
      awemeId: sidecar.awemeId,
      title: sidecar.title,
      authorName: sidecar.author,
      importedAt: new Date().toISOString()
    }
  };
}

export async function probeDownloadedVideo(videoPath: string, fileSize: number): Promise<DouyinProbeResult> {
  try {
    const { stdout } = await execFileAsync("ffprobe", [
      "-v", "error", "-print_format", "json", "-show_format", "-show_streams", videoPath
    ], { timeout: 30_000, maxBuffer: 4 * 1024 * 1024 });
    const parsed = JSON.parse(stdout) as {
      format?: { duration?: string };
      streams?: Array<{
        codec_type?: string;
        codec_name?: string;
        width?: number;
        height?: number;
        avg_frame_rate?: string;
      }>;
    };
    const videoStream = parsed.streams?.find((item) => item.codec_type === "video");
    const audioStream = parsed.streams?.find((item) => item.codec_type === "audio");
    const duration = Number(parsed.format?.duration || 0);
    if (!videoStream || !duration || duration <= 0 || !videoStream.width || !videoStream.height) {
      throw new Error("invalid video");
    }
    logStage("FFPROBE_OK", "SUCCESS", `duration=${duration.toFixed(3)}, width=${videoStream.width}, height=${videoStream.height}`);
    return {
      duration,
      width: videoStream.width,
      height: videoStream.height,
      fps: parseFps(videoStream.avg_frame_rate || ""),
      hasAudio: Boolean(audioStream),
      videoCodec: videoStream.codec_name || "",
      audioCodec: audioStream?.codec_name || "",
      fileSize
    };
  } catch (error) {
    logStage("FFPROBE_OK", "FAILED", error instanceof Error ? error.message : "unknown");
    throw new DouyinImportError("VIDEO_VALIDATION_FAILED", "下载内容不是可读取的视频文件，已取消导入。");
  }
}

function parseFps(value: string) {
  const [numerator, denominator] = value.split("/").map(Number);
  if (!numerator || !denominator) return 0;
  return Number((numerator / denominator).toFixed(3));
}

async function hashFile(filePath: string) {
  return new Promise<string>((resolve, reject) => {
    const hash = createHash("sha256");
    const stream = createReadStream(filePath);
    stream.on("error", reject);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("end", () => resolve(hash.digest("hex")));
  });
}

async function prepareThumbnail(options: { videoPath: string; videoHash: string; coverUrl: string; workDir: string }) {
  if (options.coverUrl) {
    try {
      const coverPath = await downloadCover(options.coverUrl, options.workDir);
      const thumbnailPath = path.join(path.dirname(options.videoPath), "thumbnail.jpg");
      await execFileAsync("ffmpeg", ["-y", "-i", coverPath, "-frames:v", "1", "-vf", "scale=480:-2", "-q:v", "2", thumbnailPath], { timeout: 30_000, maxBuffer: 1024 * 1024 });
      logStage("THUMBNAIL", "SUCCESS", "metadata_cover");
      return thumbnailPath;
    } catch {
      logStage("THUMBNAIL", "FAILED", "metadata_cover_fallback");
    }
  }
  const thumbnailPath = await generateReplicaVideoThumbnail({ videoPath: options.videoPath, hash: options.videoHash });
  logStage("THUMBNAIL", "SUCCESS", "ffmpeg_fallback");
  return thumbnailPath;
}

async function downloadCover(coverUrl: string, workDir: string) {
  const response = await fetch(coverUrl, {
    headers: { "User-Agent": browserUserAgent, Referer: "https://www.douyin.com/" },
    signal: AbortSignal.timeout(20_000)
  });
  if (!response.ok) throw new Error(`cover_http_${response.status}`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength < 1024 || !isImage(bytes)) throw new Error("invalid_cover");
  const coverPath = path.join(workDir, "metadata-cover");
  await writeFile(coverPath, bytes);
  return coverPath;
}

function isImage(bytes: Uint8Array) {
  return (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff)
    || (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47)
    || (bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46
      && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50);
}

function safeHost(url: string) {
  try { return new URL(url).hostname; } catch { return ""; }
}
