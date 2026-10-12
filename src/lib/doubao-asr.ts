import { execFile } from "node:child_process";
import { resolveRoute } from "@/lib/model-router";
import { mkdir, readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

/**
 * 豆包（火山方舟 Ark）语音转写。
 *
 * 方舟没有独立的 ASR 模型，豆包多模态模型自带音频输入能力：
 *   音频（base64 + format）→ chat/completions → 直接返回转写文本。
 * 2026-09-23 实测：doubao-seed-2-0-lite-260428 用 input_audio 能准确转写 16k 单声道 mp3。
 *
 * 注意两点（踩过的坑）：
 * 1. input_audio.data 必须是**裸 base64**，带 "data:audio/mpeg;base64," 前缀会被判参数非法；
 * 2. input_audio.format 必填（mp3 / wav），缺了会报 MissingParameter。
 */

export type AsrFailureCode = "MODEL_NOT_OPEN" | "RATE_LIMIT" | "AUTH" | "MODEL" | "NETWORK" | "EMPTY" | "";

export interface AsrResult {
  success: boolean;
  transcript: string;
  segments: Array<Record<string, unknown>>;
  duration: number;
  message: string;
  code?: AsrFailureCode;
}

export interface AsrProviderStatus {
  configured: boolean;
  model: string;
  directModel: string;
  message: string;
}

/* 语音转写的模型 / Base URL / Key 都来自中央模型路由的 speech_to_text Route。 */
function asrRoute() {
  return resolveRoute("speech_to_text");
}
function arkBaseUrl() {
  return asrRoute().provider.baseUrl;
}
const directAudioLimit = Number(process.env.DOUBAO_ASR_DIRECT_MAX_BYTES || 10 * 1024 * 1024);
const tempDir = process.env.TEMP_FILE_DIR || "/tmp/director-platform";
const chunkSeconds = Math.max(30, Number(process.env.DOUBAO_ASR_CHUNK_SECONDS || 60));
const execFileAsync = promisify(execFile);

function arkApiKey() {
  return asrRoute().provider.apiKey;
}

function asrModel() {
  return asrRoute().modelId;
}

export function getAsrProviderStatus(): AsrProviderStatus {
  const configured = Boolean(arkApiKey());
  return {
    configured,
    model: asrModel(),
    directModel: asrModel(),
    message: configured
      ? `豆包语音转写已配置（${asrModel()}）。`
      : "未配置火山方舟 API Key，请在 .env.local 中配置 ARK_API_KEY"
  };
}

/** 把方舟返回的错误码翻译成可执行的提示。 */
export function classifyAsrFailure(message: string): AsrFailureCode {
  const text = String(message || "");
  if (/ModelNotOpen|not activated the model|未开通/i.test(text)) return "MODEL_NOT_OPEN";
  if (/RateLimitExceeded|RPM \(Requests Per Minute\)|TPM|throttl|429/i.test(text)) return "RATE_LIMIT";
  if (/AuthenticationError|invalid api[- ]?key|unauthorized|401|403/i.test(text)) return "AUTH";
  if (/InvalidEndpointOrModel|NotFound|does not exist/i.test(text)) return "MODEL";
  if (/InvalidParameter|MissingParameter/i.test(text)) return "MODEL";
  return "";
}

function friendlyMessage(code: AsrFailureCode, raw: string) {
  if (code === "MODEL_NOT_OPEN") return `火山方舟账号还没有开通模型 ${asrModel()}，请到方舟控制台「开通模型」后再试。`;
  if (code === "RATE_LIMIT") return "火山方舟限流了（每分钟请求数上限），等一会儿再试，或到控制台提升配额。";
  if (code === "AUTH") return "火山方舟 API Key 无效或已失效，请检查 .env.local 中的 ARK_API_KEY。";
  if (code === "MODEL") return `语音转写模型 ${asrModel()} 不可用：${raw}`;
  return raw;
}

export async function transcribeAudio(audioPath: string): Promise<AsrResult> {
  const status = getAsrProviderStatus();
  if (!status.configured) {
    return { success: false, transcript: "", segments: [], duration: 0, code: "AUTH", message: status.message };
  }
  if (!audioPath) {
    return { success: false, transcript: "", segments: [], duration: 0, code: "MODEL", message: "没有找到音频文件，无法进行语音识别。" };
  }

  const fileStat = await stat(audioPath);
  if (fileStat.size > directAudioLimit) {
    return transcribeChunkedAudio(audioPath, fileStat.size);
  }
  return transcribeSingleAudio(audioPath);
}

async function transcribeChunkedAudio(audioPath: string, originalSize: number): Promise<AsrResult> {
  const chunks = await splitAudioIntoChunks(audioPath);
  if (!chunks.success || chunks.files.length === 0) {
    return {
      success: false,
      transcript: "",
      segments: [],
      duration: 0,
      code: "MODEL",
      message: chunks.message || `音频约 ${formatSize(originalSize)}，超过单次直传上限 ${formatSize(directAudioLimit)}，自动分段失败。`
    };
  }

  const transcripts: string[] = [];
  const errors: string[] = [];
  let firstCode: AsrFailureCode = "";
  for (let index = 0; index < chunks.files.length; index += 1) {
    const result = await transcribeSingleAudio(chunks.files[index]);
    if (result.success && result.transcript.trim()) {
      transcripts.push(result.transcript.trim());
    } else {
      if (!firstCode) firstCode = result.code || "";
      errors.push(`第 ${index + 1} 段：${result.message}`);
    }
  }

  if (!transcripts.length) {
    return {
      success: false,
      transcript: "",
      segments: [],
      duration: 0,
      code: firstCode,
      message: `音频已切成 ${chunks.files.length} 段，但语音转写没有返回有效结果：${errors.join("；") || "未知错误"}`
    };
  }

  return {
    success: true,
    transcript: transcripts.join("\n"),
    segments: chunks.files.map((file, index) => ({ index, file })),
    duration: 0,
    message: errors.length
      ? `语音转写部分成功：已识别 ${transcripts.length}/${chunks.files.length} 段；失败段：${errors.join("；")}`
      : `语音转写成功：音频较长，已自动切成 ${chunks.files.length} 段识别。`
  };
}

async function splitAudioIntoChunks(audioPath: string): Promise<{ success: boolean; files: string[]; message: string }> {
  await mkdir(tempDir, { recursive: true });
  const parsed = path.parse(audioPath);
  const prefix = path.join(tempDir, `${parsed.name}_chunk_${Date.now()}`);
  const outputPattern = `${prefix}_%03d.mp3`;

  try {
    await execFileAsync(
      "ffmpeg",
      [
        "-y",
        "-i",
        audioPath,
        "-f",
        "segment",
        "-segment_time",
        String(chunkSeconds),
        "-reset_timestamps",
        "1",
        "-ac",
        "1",
        "-ar",
        "16000",
        "-codec:a",
        "libmp3lame",
        "-b:a",
        process.env.ASR_AUDIO_BITRATE || "24k",
        outputPattern
      ],
      { timeout: 1000 * 60 * 15, maxBuffer: 1024 * 1024 * 8 }
    );
    const names = await readdir(tempDir);
    const files = names
      .filter((name) => name.startsWith(path.basename(prefix)) && name.endsWith(".mp3"))
      .sort()
      .map((name) => path.join(tempDir, name));
    return {
      success: files.length > 0,
      files,
      message: files.length ? `已自动切分 ${files.length} 个音频片段。` : "ffmpeg 执行完成但没有生成音频片段。"
    };
  } catch (error) {
    return {
      success: false,
      files: [],
      message: `音频自动分段失败：${error instanceof Error ? error.message.replace(/\s+/g, " ").slice(0, 300) : "ffmpeg 执行失败"}`
    };
  }
}

async function transcribeSingleAudio(audioPath: string): Promise<AsrResult> {
  const apiKey = arkApiKey();
  const model = asrModel();
  const buffer = await readFile(audioPath);
  const ext = path.extname(audioPath).replace(".", "").toLowerCase() || "mp3";
  const format = ext === "wav" ? "wav" : "mp3";

  try {
    const response = await fetch(`${arkBaseUrl()}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model,
        messages: [
          {
            role: "user",
            content: [
              {
                type: "text",
                text: "把这段音频里的人声原样转写成中文文字。只输出转写结果本身，不要解释、不要总结、不要加标点以外的加工；听不清的地方用「听不清」占位。"
              },
              {
                type: "input_audio",
                input_audio: {
                  // 必须是裸 base64：带 data: 前缀会被方舟判为参数非法。
                  data: buffer.toString("base64"),
                  format
                }
              }
            ]
          }
        ],
        temperature: 0,
        max_tokens: 16000
      })
    });

    const payload = await response.json().catch(() => ({})) as Record<string, unknown>;
    if (!response.ok) {
      const raw = extractArkError(payload) || response.statusText;
      const code = classifyAsrFailure(raw) || (response.status === 429 ? "RATE_LIMIT" : "");
      return {
        success: false,
        transcript: "",
        segments: [],
        duration: 0,
        code,
        message: friendlyMessage(code, `豆包语音转写请求失败：${raw}`)
      };
    }

    const transcript = extractTranscript(payload);
    if (!transcript) {
      return {
        success: false,
        transcript: "",
        segments: [],
        duration: 0,
        code: "EMPTY",
        message: "豆包语音转写没有返回有效逐字稿，请检查音频是否清晰，或改用手动输入。"
      };
    }

    return { success: true, transcript, segments: [], duration: 0, message: "语音转文字成功。" };
  } catch (error) {
    return {
      success: false,
      transcript: "",
      segments: [],
      duration: 0,
      code: "NETWORK",
      message: `豆包语音转写请求失败：${error instanceof Error ? error.message : "网络或接口异常"}`
    };
  }
}

function extractArkError(payload: unknown): string {
  if (!payload || typeof payload !== "object") return "";
  const record = payload as Record<string, unknown>;
  const error = record.error;
  if (error && typeof error === "object") {
    const detail = error as Record<string, unknown>;
    const code = typeof detail.code === "string" ? detail.code : "";
    const message = typeof detail.message === "string" ? detail.message : "";
    return [code, message].filter(Boolean).join("：");
  }
  return typeof record.message === "string" ? record.message : "";
}

function extractTranscript(payload: unknown): string {
  if (!payload || typeof payload !== "object") return "";
  const record = payload as Record<string, unknown>;
  const choices = record.choices;
  if (Array.isArray(choices)) {
    const first = choices[0] as Record<string, unknown> | undefined;
    const message = first?.message as Record<string, unknown> | undefined;
    const content = message?.content;
    if (typeof content === "string") return content.trim();
    if (Array.isArray(content)) {
      const text = content
        .map((item) => (item && typeof item === "object" && typeof (item as Record<string, unknown>).text === "string"
          ? String((item as Record<string, unknown>).text)
          : ""))
        .join("")
        .trim();
      if (text) return text;
    }
  }
  const output = record.output as Record<string, unknown> | undefined;
  const text = output?.text || record.text;
  return typeof text === "string" ? text.trim() : "";
}

function formatSize(bytes: number) {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
