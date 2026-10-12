import { randomUUID } from "node:crypto";
import { analyzePlatformLink, generateDeconstructionFromAnalysis } from "@/services/link-analyzer/analyzer";
import type { LinkAnalyzeJob, LinkAnalyzeJobInput, LinkAnalyzeStage } from "@/services/link-analyzer/types";

const globalJobStore = globalThis as typeof globalThis & {
  __directorLinkAnalyzeJobs?: Map<string, LinkAnalyzeJob>;
};

const jobs = globalJobStore.__directorLinkAnalyzeJobs || new Map<string, LinkAnalyzeJob>();
globalJobStore.__directorLinkAnalyzeJobs = jobs;

const progressTemplate: LinkAnalyzeJob["progress"] = [
  { stage: "platform_detect", label: "正在识别平台", status: "pending", message: "" },
  { stage: "parse_link", label: "正在解析链接", status: "pending", message: "" },
  { stage: "video_download", label: "正在下载视频", status: "pending", message: "" },
  { stage: "audio_extract", label: "正在提取音频", status: "pending", message: "" },
  { stage: "asr", label: "正在转文字", status: "pending", message: "" },
  { stage: "deconstruction", label: "正在拆解脚本", status: "pending", message: "" },
  { stage: "done", label: "分析完成", status: "pending", message: "" }
];

export function createLinkAnalyzeJob(input: LinkAnalyzeJobInput, ownerUserId?: string) {
  const now = new Date().toISOString();
  const job: LinkAnalyzeJob = {
    id: randomUUID(),
    status: "queued",
    createdAt: now,
    updatedAt: now,
    input,
    stage: "platform_detect",
    progress: progressTemplate.map((item) => ({ ...item })),
    result: null,
    deconstructionMarkdown: "",
    rewriteMarkdown: "",
    error: "",
    userId: ownerUserId
  };

  jobs.set(job.id, job);
  void runJob(job.id);
  return job;
}

export function getLinkAnalyzeJob(id: string) {
  return jobs.get(id) || null;
}

async function runJob(id: string) {
  const job = jobs.get(id);
  if (!job) return;

  updateJob(id, { status: "running", stage: "platform_detect" });
  setStage(id, "platform_detect", "running", "正在从输入内容里提取链接并识别平台。");

  try {
    setStage(id, "platform_detect", "done", "平台识别完成。");
    setStage(id, "parse_link", "running", "正在调用平台专用解析器和 fallback。");
    setStage(id, "video_download", "running", "如果平台支持，会尝试下载视频文件。");

    const result = await analyzePlatformLink(job.input);
    updateJob(id, { result });

    setStage(id, "parse_link", result.title || result.description || result.rawText ? "done" : "error", result.title ? `解析到标题：${result.title}` : result.error || "没有解析到完整元信息。");
    setStage(id, "video_download", result.videoPath ? "done" : "error", result.videoPath ? "视频文件已下载。" : "未下载到视频文件，可改用上传视频或手动输入。");
    setStage(id, "audio_extract", result.audioPath ? "done" : result.videoPath ? "error" : "pending", result.audioPath ? "音频文件已提取。" : result.videoPath ? "音频提取失败。" : "未进入音频提取。");
    setStage(id, "asr", result.transcript ? "done" : result.videoPath ? "error" : "pending", result.transcript ? "口播转文字完成。" : result.videoPath ? result.error || "语音转文字失败。" : "未进入语音识别。");

    if (result.transcript || result.rawText || result.description) {
      setStage(id, "deconstruction", "running", "正在调用 DeepSeek 拆片和原创仿写。");
      const ai = await generateDeconstructionFromAnalysis(result, job.input);
      if (ai.success) {
        updateJob(id, { deconstructionMarkdown: ai.content, rewriteMarkdown: ai.content });
        setStage(id, "deconstruction", "done", ai.message);
      } else {
        setStage(id, "deconstruction", "error", ai.message);
      }
    } else {
      setStage(id, "deconstruction", "pending", "缺少可拆解内容，请补充逐字稿或上传视频。");
    }

    const finalJob = jobs.get(id);
    const isUsable = Boolean(finalJob?.result?.transcript || finalJob?.result?.rawText || finalJob?.result?.title || finalJob?.deconstructionMarkdown);
    setStage(id, "done", isUsable ? "done" : "error", isUsable ? "分析完成。" : finalJob?.result?.error || "分析失败，请改用上传视频或手动输入。");
    updateJob(id, { status: isUsable ? "success" : "failed", error: isUsable ? "" : finalJob?.result?.error || "分析失败。" });
  } catch (error) {
    const message = error instanceof Error ? error.message : "链接分析任务异常。";
    setStage(id, "done", "error", message);
    updateJob(id, { status: "failed", error: message });
  }
}

function updateJob(id: string, patch: Partial<LinkAnalyzeJob>) {
  const job = jobs.get(id);
  if (!job) return;
  jobs.set(id, {
    ...job,
    ...patch,
    updatedAt: new Date().toISOString()
  });
}

function setStage(id: string, stage: LinkAnalyzeStage, status: LinkAnalyzeJob["progress"][number]["status"], message: string) {
  const job = jobs.get(id);
  if (!job) return;
  jobs.set(id, {
    ...job,
    stage,
    updatedAt: new Date().toISOString(),
    progress: job.progress.map((item) => item.stage === stage ? { ...item, status, message } : item)
  });
}
