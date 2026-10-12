import { execFile } from "node:child_process";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { callReplicaVisionJson, type ReplicaVisionContent } from "@/lib/replica-ai";
import { getReplicaConfig, formatTimestamp, parseTimestamp } from "@/lib/replica-config";
import { extractAudioFromVideo } from "@/lib/audio-extractor";
import { transcribeAudio, type AsrResult } from "@/lib/doubao-asr";
import { replicaVideoSchemaVersion } from "@/lib/replica-types";
import type { ReplicaAnalysisProgress } from "@/lib/replica-types";
import type {
  ReplicaActionDNA,
  ReplicaAudioDNA,
  ReplicaBlockingDNA,
  ReplicaCameraDNA,
  ReplicaCharacterDNA,
  ReplicaDialogueDNA,
  ReplicaEnvironmentDNA,
  ReplicaFaceDNA,
  ReplicaFrameObservation,
  ReplicaProductMapping,
  ReplicaRhythmDNA,
  ReplicaShotDNA,
  VideoDNA,
  ReplicaVideoMetadata
} from "@/lib/replica-types";

const execFileAsync = promisify(execFile);

interface FrameSample {
  timestamp: number;
  shotId: string;
  filePath: string;
}

interface ProbePayload {
  format?: { duration?: string; size?: string };
  streams?: Array<{
    codec_type?: string;
    codec_name?: string;
    width?: number;
    height?: number;
    avg_frame_rate?: string;
    r_frame_rate?: string;
  }>;
}

export async function analyzeReplicaVideo(options: {
  videoPath: string;
  videoHash: string;
  sourceFileName: string;
  onProgress?: (progress: Partial<ReplicaAnalysisProgress> & { stage: string; stageLabel: string }) => void | Promise<void>;
}): Promise<VideoDNA> {
  const config = getReplicaConfig();
  const report = options.onProgress;
  const startedAt = new Date().toISOString();
  let stageStartedAt = startedAt;
  const timings: Record<string, number> = {};

  async function reportStage(stage: string, stageLabel: string, extra: Partial<ReplicaAnalysisProgress> = {}) {
    await report?.({
      status: "running",
      stage,
      stageLabel,
      startedAt,
      stageStartedAt,
      updatedAt: new Date().toISOString(),
      lastHeartbeatAt: new Date().toISOString(),
      timings,
      ...extra
    });
  }

  async function startStage(stage: string, stageLabel: string, extra: Partial<ReplicaAnalysisProgress> = {}) {
    stageStartedAt = new Date().toISOString();
    await reportStage(stage, stageLabel, extra);
  }

  function recordTiming(key: string, started: number) {
    timings[key] = Number(((Date.now() - started) / 1000).toFixed(2));
    console.info(`[VIDEO_ANALYSIS_TIMING] ${key} duration=${timings[key]}s`);
  }

  await startStage("VIDEO_READING", "正在读取视频信息");
  let started = Date.now();
  const metadata = await probeVideo(options.videoPath);
  recordTiming("ffprobe", started);
  if (!metadata.duration || !metadata.width || !metadata.height) {
    throw new Error("无法读取视频的时长或画面尺寸，请换一个可正常播放的 MP4/MOV 文件。");
  }

  await startStage("SHOT_DETECTION", "正在提取镜头");
  started = Date.now();
  const boundaries = await detectShotBoundaries(options.videoPath, metadata.duration, config.shotBoundaryThreshold);
  recordTiming("shotDetect", started);

  await startStage("FRAME_EXTRACTION", "正在抽取关键帧", {
    detail: `预计最多 ${config.maxFrames} 帧`
  });
  started = Date.now();
  const frameInterval = chooseFrameInterval(metadata.duration, config.maxFrames);
  const frames = await extractFrameSamples(options.videoPath, options.videoHash, metadata, frameInterval, boundaries);
  recordTiming("frameExtract", started);
  if (frames.length < 4) {
    throw new Error("视频关键帧抽取不足，无法建立可靠的视觉时间轴，请尝试更清晰或更长的视频。");
  }

  await startStage("AUDIO_EXTRACTION", "正在提取音频");
  started = Date.now();
  const audioResult = await extractAudioFromVideo(options.videoPath).catch(() => ({ success: false, audioPath: "", message: "音频提取失败。" }));
  recordTiming("audioExtract", started);

  await startStage("ASR", "正在转写语音");
  const asrCheckpointPath = path.join(config.cacheRoot, "videos", options.videoHash, "analysis", "asr.json");
  let asr: AsrResult;
  try {
    asr = JSON.parse(await readFile(asrCheckpointPath, "utf8")) as AsrResult;
    await reportStage("ASR", "正在转写语音", { detail: "已复用语音识别检查点" });
  } catch {
    started = Date.now();
    asr = audioResult.success
      ? await transcribeAudio(audioResult.audioPath).catch((error) => ({
        success: false,
        transcript: "",
        segments: [],
        duration: 0,
        message: error instanceof Error ? error.message : "语音识别失败。"
      } satisfies AsrResult))
      : { success: false, transcript: "", segments: [], duration: 0, message: audioResult.message } satisfies AsrResult;
    recordTiming("asr", started);
    try {
      await mkdir(path.dirname(asrCheckpointPath), { recursive: true });
      await writeFile(asrCheckpointPath, JSON.stringify(asr, null, 2), "utf8");
    } catch { /* checkpoint is best-effort */ }
  }

  await startStage("AUDIO_ANALYSIS", "正在分析音频节奏");
  started = Date.now();
  const silenceWindows = audioResult.success ? await detectSilenceWindows(audioResult.audioPath, metadata.duration) : [];
  const signal = audioResult.success ? await measureAudioSignal(audioResult.audioPath) : { meanVolume: "未测得", maxVolume: "未测得" };
  recordTiming("audioAnalysis", started);

  const totalBatches = Math.ceil(frames.length / config.batchSize);
  await startStage("SHOT_ANALYSIS", "正在分析镜头", {
    completedUnits: 0,
    totalUnits: totalBatches,
    percent: 0,
    detail: `共 ${frames.length} 个关键帧`
  });
  started = Date.now();
  const analysisDirectory = path.join(config.cacheRoot, "videos", options.videoHash, "analysis");
  await mkdir(analysisDirectory, { recursive: true });
  const observations = await analyzeFrameSamples(frames, metadata, boundaries, {
    cacheDirectory: analysisDirectory,
    onBatchProgress: async (completedBatches) => {
      await reportStage("SHOT_ANALYSIS", "正在分析镜头", {
        completedUnits: completedBatches,
        totalUnits: totalBatches,
        percent: Math.round((completedBatches / totalBatches) * 100),
        detail: "等待模型返回"
      });
    }
  });
  recordTiming("shotAnalysis", started);

  await startStage("DNA_ASSEMBLY", "正在整理 Video DNA", {
    detail: `${Math.max(0, boundaries.length - 1)} 个镜头 · ${frames.length} 张关键帧 · ${observations.length} 条视觉观察`
  });
  started = Date.now();
  const dialogue = buildDialogueTimeline(asr, silenceWindows, metadata.duration);
  const synthesized = await synthesizeVideoDNA({
    metadata,
    boundaries,
    observations,
    dialogue,
    transcript: asr.transcript,
    fileName: options.sourceFileName
  });
  recordTiming("dnaAssembly", started);

  const warnings = [
    ...(asr.success ? [] : [`逐字稿暂不可用：${asr.message}`]),
    ...(metadata.hasAudio && silenceWindows.length === 0 ? ["没有检测到可靠的语音停顿窗口，台词时间采用字符长度对齐。"] : []),
    ...(observations.length < frames.length ? [`有 ${frames.length - observations.length} 个关键帧未返回结构化观察。`] : [])
  ];

  await startStage("VALIDATION", "正在校验 Video DNA");
  const synthesizedAudio = asRecord(synthesized.audio);
  const dna = normalizeVideoDNA({
    synthesized,
    metadata,
    boundaries,
    observations,
    dialogue,
    videoHash: options.videoHash,
    sourceFileName: options.sourceFileName,
    audio: {
      voice: asr.success ? "有人声，已完成豆包语音转写" : "未确认人声",
      environment: metadata.hasAudio ? "含音频轨，环境声需按原片保留" : "无音频轨",
      music: "由原片生成时保留；未把音乐误写成新音乐",
      soundEffects: stringArray(synthesizedAudio.soundEffects),
      beatChanges: stringArray(synthesizedAudio.beatChanges),
      volumeChanges: stringArray(synthesizedAudio.volumeChanges),
      silenceWindows,
      keySync: stringArray(synthesizedAudio.keySync),
      meanVolume: signal.meanVolume,
      maxVolume: signal.maxVolume
    },
    warnings,
    frameInterval,
    transcriptSource: asr.success ? "豆包语音转写" : "未获得可靠逐字稿",
    alignmentMethod: silenceWindows.length ? "静音窗口 + 标点分段 + 字符长度微调" : "视频时长 + 字符长度估算"
  });

  await report?.({
    status: "completed",
    stage: "COMPLETED",
    stageLabel: "分析完成",
    startedAt,
    stageStartedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    lastHeartbeatAt: new Date().toISOString(),
    detail: `${dna.shots.length} 个镜头 · ${frames.length} 张关键帧 · ${dna.frameObservations.length} 条视觉观察`,
    timings
  });
  return dna;
}

async function probeVideo(videoPath: string): Promise<ReplicaVideoMetadata> {
  try {
    const result = await execFileAsync("ffprobe", [
      "-v", "error",
      "-show_entries", "format=duration,size",
      "-show_entries", "stream=codec_type,codec_name,width,height,avg_frame_rate,r_frame_rate",
      "-of", "json",
      videoPath
    ], { timeout: 120000, maxBuffer: 1024 * 1024 * 4 });
    const parsed = JSON.parse(result.stdout) as ProbePayload;
    const streams = parsed.streams || [];
    const video = streams.find((stream) => stream.codec_type === "video") || {};
    const audio = streams.find((stream) => stream.codec_type === "audio") || {};
    return {
      duration: Number(parsed.format?.duration || 0),
      width: Number(video.width || 0),
      height: Number(video.height || 0),
      fps: parseRate(video.avg_frame_rate || video.r_frame_rate || "0/1"),
      hasAudio: streams.some((stream) => stream.codec_type === "audio"),
      videoCodec: String(video.codec_name || ""),
      audioCodec: String(audio.codec_name || ""),
      fileSize: Number(parsed.format?.size || 0)
    };
  } catch (error) {
    throw new Error(`ffprobe 无法读取视频：${error instanceof Error ? error.message.replace(/\s+/g, " ").slice(0, 260) : "未知错误"}`);
  }
}

async function detectShotBoundaries(videoPath: string, duration: number, threshold: number) {
  const detected = new Set<number>([0, roundTime(duration)]);
  try {
    const result = await execFileAsync("ffmpeg", [
      "-hide_banner", "-i", videoPath,
      "-filter:v", `select='gt(scene,${threshold})',showinfo`,
      "-f", "null", "-"
    ], { timeout: 1000 * 60 * 15, maxBuffer: 1024 * 1024 * 12 });
    const output = `${result.stderr || ""}\n${result.stdout || ""}`;
    const matches = output.matchAll(/pts_time:([0-9]+(?:\.[0-9]+)?)/g);
    for (const match of matches) {
      const value = Number(match[1]);
      if (value > 0.08 && value < duration - 0.08) detected.add(roundTime(value));
    }
  } catch {
    // A video with no detectable hard cuts still gets one continuous shot.
  }
  const values = [...detected].sort((a, b) => a - b);
  const cleaned: number[] = [];
  for (const value of values) {
    if (!cleaned.length || value - cleaned[cleaned.length - 1] >= 0.12) cleaned.push(value);
  }
  if (cleaned[cleaned.length - 1] !== roundTime(duration)) cleaned.push(roundTime(duration));
  return cleaned;
}

function chooseFrameInterval(duration: number, maxFrames: number) {
  const preferred = duration <= 20 ? 0.25 : duration <= 45 ? 0.35 : duration <= 90 ? 0.55 : 1;
  return Math.max(0.12, preferred, duration / Math.max(4, maxFrames - 1));
}

async function extractFrameSamples(videoPath: string, videoHash: string, metadata: ReplicaVideoMetadata, interval: number, boundaries: number[]) {
  const directory = path.join(getReplicaConfig().cacheRoot, "videos", videoHash, "frames");
  await mkdir(directory, { recursive: true });
  let names = (await readdir(directory)).filter((name) => name.endsWith(".jpg")).sort();
  if (names.length < 4) {
    const outputPattern = path.join(directory, "frame_%05d.jpg");
    await execFileAsync("ffmpeg", [
      "-y", "-hide_banner", "-loglevel", "error", "-i", videoPath,
      "-vf", `fps=1/${interval},scale=960:-2:force_original_aspect_ratio=decrease`,
      "-q:v", "5", outputPattern
    ], { timeout: 1000 * 60 * 15, maxBuffer: 1024 * 1024 * 4 });
    names = (await readdir(directory)).filter((name) => name.endsWith(".jpg")).sort();
  }

  const samples = names.map((name, index): FrameSample => {
    const timestamp = Math.min(metadata.duration, roundTime(index * interval));
    return { timestamp, shotId: shotIdAt(timestamp, boundaries), filePath: path.join(directory, name) };
  });
  if (samples.length < 4) return samples;
  const unique = new Map<string, FrameSample>();
  for (const sample of samples) unique.set(`${sample.timestamp.toFixed(3)}:${sample.shotId}`, sample);
  return [...unique.values()].sort((a, b) => a.timestamp - b.timestamp).slice(0, getReplicaConfig().maxFrames);
}

async function analyzeFrameSamples(frames: FrameSample[], metadata: ReplicaVideoMetadata, boundaries: number[], options: {
  cacheDirectory: string;
  onBatchProgress?: (completedBatches: number) => void | Promise<void>;
}) {
  const config = getReplicaConfig();
  await mkdir(options.cacheDirectory, { recursive: true });
  const batches: FrameSample[][] = [];
  for (let start = 0; start < frames.length; start += config.batchSize) {
    const batch = frames.slice(start, start + config.batchSize);
    batches.push(batch);
  }
  const batchResults: ReplicaFrameObservation[][] = [];
  let completedBatches = 0;
  for (let start = 0; start < batches.length; start += 4) {
    const waveResults = await Promise.all(batches.slice(start, start + 4).map(async (batch, batchIndex) => {
      const batchNumber = start + batchIndex + 1;
      const checkpointPath = path.join(options.cacheDirectory, `batch-${String(batchNumber).padStart(2, "0")}.json`);
      try {
        const cached = JSON.parse(await readFile(checkpointPath, "utf8")) as unknown[];
        if (Array.isArray(cached) && cached.length) {
          completedBatches += 1;
          await options.onBatchProgress?.(completedBatches);
          return cached.map((item, index) => normalizeObservation(item, batch[index]?.timestamp || batch[0]?.timestamp || 0, boundaries));
        }
      } catch { /* 没有检查点，继续真实分析 */ }
      const buffers = await Promise.all(batch.map((frame) => readFile(frame.filePath)));
      const content: ReplicaVisionContent[] = [{
        type: "text",
        text: [
          "这是原视频的连续关键帧批次。必须把画面当作真实视觉证据，不要只根据文件名或台词猜测。",
          `视频尺寸 ${metadata.width}x${metadata.height}，时长 ${metadata.duration.toFixed(3)} 秒。`,
          "逐帧输出 JSON：{observations:[{timestamp,visualSummary,subjects,actions,facialExpression,gaze,blocking,camera,product,environment,continuity,confidence}]}。",
          "timestamp 必须使用下面给出的时间，动作要描述头部、肩膀、上半身、手臂、手掌、手指、腿脚、重心和方向；表情要单独描述眉眼嘴和情绪过渡；camera 要写景别、角度、构图和运镜。",
          ...batch.map((frame) => `${frame.shotId} @ ${formatTimestamp(frame.timestamp)}`)
        ].join("\n")
      }];
      batch.forEach((frame, index) => {
        content.push({ type: "text", text: `下面这一帧的唯一时间标签是 ${formatTimestamp(frame.timestamp)}。` });
        content.push({ type: "image_url", image_url: { url: `data:image/jpeg;base64,${buffers[index].toString("base64")}`, detail: "high" } });
      });
      const observations: ReplicaFrameObservation[] = [];
      try {
        const raw = await callReplicaVisionJson({
          route: "video_understanding",
          system: "你是电影摄影、人体动作、微表情和视频连续性分析专家。只输出合法 JSON，不输出 Markdown。宁愿写‘不确定’，也不要编造画外信息。",
          content,
          temperature: 0.05,
          maxTokens: 7500,
          purpose: `frame_visual_analysis_batch_${batchNumber}`
        }) as { observations?: unknown[] };
        if (Array.isArray(raw.observations)) {
          observations.push(...raw.observations.map((item, index) => normalizeObservation(item, batch[index]?.timestamp || batch[0]?.timestamp || 0, boundaries)));
          await writeFile(checkpointPath, JSON.stringify(observations, null, 2), "utf8");
        }
      } catch (error) {
        // Retry the batch once with a shorter request before treating it as a warning.
        try {
          const retryContent: ReplicaVisionContent[] = [
            { type: "text", text: `请只分析以下 ${batch.length} 张按时间排序的画面并返回 JSON 数组 observations。每张都要有 timestamp、actions、facialExpression、gaze、camera、blocking。时间：${batch.map((frame) => formatTimestamp(frame.timestamp)).join("、")}` },
            ...buffers.map((buffer, index) => ({
              type: "image_url" as const,
              image_url: { url: `data:image/jpeg;base64,${buffer.toString("base64")}`, detail: "high" as const }
            }))
          ];
          const raw = await callReplicaVisionJson({ system: "只输出合法 JSON。", content: retryContent, temperature: 0, maxTokens: 4500, purpose: `frame_visual_analysis_retry_${batchNumber}` }) as { observations?: unknown[] };
          if (Array.isArray(raw.observations)) {
            observations.push(...raw.observations.map((item, index) => normalizeObservation(item, batch[index]?.timestamp || 0, boundaries)));
            await writeFile(checkpointPath, JSON.stringify(observations, null, 2), "utf8");
          }
        } catch {
          // The final synthesis receives the missing-frame warning and can bridge a small gap.
          void error;
        }
      }
      if (observations.length) {
        completedBatches += 1;
        await options.onBatchProgress?.(completedBatches);
      }
      return observations;
    }));
    batchResults.push(...waveResults);
  }
  return batchResults.flat().sort((a, b) => a.timestamp - b.timestamp);
}

function synthesizeVideoDNA(input: {
  metadata: ReplicaVideoMetadata;
  boundaries: number[];
  observations: ReplicaFrameObservation[];
  dialogue: ReplicaDialogueDNA[];
  transcript: string;
  fileName: string;
}): Record<string, unknown> {
  // Final assembly is deterministic. Frame batches already contain the expensive
  // multimodal semantics; re-sending all of them to an LLM caused timeouts and
  // large JSON truncation without adding reliable evidence.
  const environments = uniqueStrings(input.observations.map((item) => item.environment).filter(Boolean));
  const products = uniqueStrings(input.observations.map((item) => item.product).filter(Boolean));
  const subjects = uniqueStrings(input.observations.flatMap((item) => item.subjects));
  const continuity = uniqueStrings(input.observations.map((item) => item.continuity).filter(Boolean));

  return {
    shots: [],
    characters: subjects.length ? subjects.slice(0, 8).map((subject, index) => ({
      id: `character_${String(index + 1).padStart(2, "0")}`,
      role: index === 0 ? "主要人物" : "辅助人物",
      agePresentation: "画面呈现年龄段未能确认",
      genderPresentation: "画面呈现性别未能确认",
      heightProportion: "保持原比例",
      build: "保持原身材比例",
      hair: "保持原发型",
      clothing: "除目标产品外全部锁定",
      initialPosition: "保持原初始位置",
      orientation: "保持原初始朝向",
      cameraDistance: "保持原距离",
      relationToOthers: "保持原人物关系",
      entrance: 0,
      exit: input.metadata.duration
    })) : [],
    dialogue: input.dialogue,
    audio: {
      soundEffects: [],
      beatChanges: [],
      volumeChanges: [],
      keySync: input.transcript ? ["台词时间轴已由 ASR 对齐"] : []
    },
    environment: {
      sceneType: environments[0] || "沿用原场景",
      elements: environments.slice(0, 20),
      props: products.slice(0, 20),
      backgroundPeople: "按原片保留",
      subjectEnvironmentRelation: "保持主体与环境原关系"
    },
    productMapping: {
      sourceCandidates: products,
      sourceLocations: uniqueStrings(input.observations.filter((item) => item.product).map((item) => formatTimestamp(item.timestamp))),
      replacementInstruction: "仅替换原视频中的目标产品，其余人物、动作、镜头和环境锁定。",
      visibilityMoments: input.observations.filter((item) => item.product).map((item) => formatTimestamp(item.timestamp)),
      occlusionRules: ["遮挡时保持原轮廓与持拿方式，不改变产品结构。"],
      consistencyRules: ["产品颜色、版型、材质、结构、Logo、文字、图案和细节以用户上传产品图为最高事实来源。"]
    },
    rhythm: {},
    continuity: continuity.length
      ? continuity.slice(0, 40)
      : ["保持相邻镜头中人物、产品、光线、方向和道具连续。"]
  };
}

function normalizeVideoDNA(input: {
  synthesized: Record<string, unknown>;
  metadata: ReplicaVideoMetadata;
  boundaries: number[];
  observations: ReplicaFrameObservation[];
  dialogue: ReplicaDialogueDNA[];
  videoHash: string;
  sourceFileName: string;
  audio: ReplicaAudioDNA;
  warnings: string[];
  frameInterval: number;
  transcriptSource: string;
  alignmentMethod: string;
}): VideoDNA {
  const shots = normalizeShots(input.synthesized.shots, input.boundaries, input.observations, input.dialogue);
  const characters = normalizeCharacters(input.synthesized.characters, input.metadata.duration);
  const dialogue = normalizeDialogue(input.synthesized.dialogue, input.dialogue);
  const environment = normalizeEnvironment(input.synthesized.environment);
  const productMapping = normalizeProductMapping(input.synthesized.productMapping);
  const rhythm = normalizeRhythm(input.synthesized.rhythm, shots, input.metadata.duration);
  const continuity = stringArray(input.synthesized.continuity);
  return {
    schemaVersion: replicaVideoSchemaVersion,
    videoHash: input.videoHash,
    sourceFileName: input.sourceFileName,
    metadata: input.metadata,
    shotBoundaries: input.boundaries,
    shots,
    frameObservations: input.observations,
    characters,
    dialogue,
    audio: input.audio,
    environment,
    productMapping,
    rhythm,
    continuity: continuity.length ? continuity : ["保持相邻镜头中人物、产品、光线、方向和道具连续。"],
    analysisMeta: {
      visionModel: getReplicaConfig().visionModel,
      frameInterval: input.frameInterval,
      frameCount: input.observations.length,
      shotBoundaryThreshold: getReplicaConfig().shotBoundaryThreshold,
      transcriptSource: input.transcriptSource,
      alignmentMethod: input.alignmentMethod,
      createdAt: new Date().toISOString(),
      warnings: input.warnings
    }
  };
}

function normalizeObservation(value: unknown, fallbackTimestamp: number, boundaries: number[]): ReplicaFrameObservation {
  const item = asRecord(value);
  const timestamp = parseTimestamp(item.timestamp, fallbackTimestamp);
  return {
    timestamp,
    shotId: stringValue(item.shotId) || shotIdAt(timestamp, boundaries),
    visualSummary: stringValue(item.visualSummary) || "画面内容未能确认。",
    subjects: stringArray(item.subjects),
    actions: stringArray(item.actions),
    facialExpression: stringValue(item.facialExpression) || "画面未能确认微表情。",
    gaze: stringValue(item.gaze) || "画面未能确认眼神方向。",
    blocking: stringValue(item.blocking) || "场面调度未能确认。",
    camera: stringValue(item.camera) || "镜头参数未能确认。",
    product: stringValue(item.product) || "目标产品未能确认。",
    environment: stringValue(item.environment) || "环境细节未能确认。",
    continuity: stringValue(item.continuity) || "保持与前后帧连续。",
    confidence: clamp(Number(item.confidence || 0.6), 0, 1)
  };
}

function normalizeShots(value: unknown, boundaries: number[], observations: ReplicaFrameObservation[], dialogue: ReplicaDialogueDNA[]): ReplicaShotDNA[] {
  const candidates = Array.isArray(value) ? value : [];
  const shots: ReplicaShotDNA[] = [];
  for (let index = 0; index < boundaries.length - 1; index += 1) {
    const start = boundaries[index];
    const end = boundaries[index + 1];
    const candidate = asRecord(candidates[index]);
    const isLastShot = index === boundaries.length - 2;
    const shotObservations = observations.filter((item) => item.timestamp >= start && (isLastShot ? item.timestamp <= end : item.timestamp < end));
    const camera = normalizeCamera(candidate.camera, shotObservations);
    const actions = normalizeActions(candidate.actions, shotObservations, start, end);
    const faces = normalizeFaces(candidate.facialExpressions, shotObservations, start, end);
    const blocking = normalizeBlocking(candidate.blocking, shotObservations, start, end);
    const dialogueIds = dialogue.filter((item) => item.start < end && item.end > start).map((item) => item.id);
    shots.push({
      id: `shot_${String(index + 1).padStart(2, "0")}`,
      index: index + 1,
      start,
      end,
      duration: roundTime(end - start),
      purpose: stringValue(candidate.purpose) || "保持原镜头在原时间区间内的叙事功能。",
      camera,
      subjects: stringArray(candidate.subjects).length ? stringArray(candidate.subjects) : uniqueStrings(shotObservations.flatMap((item) => item.subjects)),
      actions,
      facialExpressions: faces,
      blocking,
      events: stringArray(candidate.events).length ? stringArray(candidate.events) : shotObservations.map((item) => `${formatTimestamp(item.timestamp)}：${item.visualSummary}`),
      props: stringArray(candidate.props).length ? stringArray(candidate.props) : uniqueStrings(shotObservations.flatMap((item) => item.product ? [item.product] : [])).slice(0, 12),
      environment: stringValue(candidate.environment) || uniqueStrings(shotObservations.map((item) => item.environment).filter(Boolean)).slice(0, 6).join("；") || "沿用原视频环境。",
      dialogueIds,
      audioCues: stringArray(candidate.audioCues),
      continuity: stringArray(candidate.continuity).length ? stringArray(candidate.continuity) : ["镜头起止姿态与前后镜头连续。"]
    });
  }
  return shots;
}

function normalizeCamera(value: unknown, observations: ReplicaFrameObservation[]): ReplicaCameraDNA {
  const item = asRecord(value);
  const evidence = uniqueStrings(observations.map((observation) => observation.camera).filter(Boolean)).slice(0, 6);
  const fallback = evidence.length ? `${evidence.join("；")}${evidence.length >= 6 ? "（后续帧保持同一镜头逻辑或按相邻帧连续过渡）" : ""}` : "";
  return {
    shotSize: stringValue(item.shotSize) || fallback || "景别未能确认，保持原片比例。",
    cameraHeight: stringValue(item.cameraHeight) || "保持原机位高度。",
    horizontalAngle: stringValue(item.horizontalAngle) || "保持原水平角度。",
    pitchAngle: stringValue(item.pitchAngle) || "保持原俯仰角。",
    lensFeel: stringValue(item.lensFeel) || "保持原焦段感与透视关系。",
    subjectFraming: stringValue(item.subjectFraming) || "主体构图沿用原片。",
    subjectScale: stringValue(item.subjectScale) || "主体占画面比例沿用原片。",
    foreground: stringValue(item.foreground) || "前景沿用原片。",
    midground: stringValue(item.midground) || "中景沿用原片。",
    background: stringValue(item.background) || "背景沿用原片。",
    depthOfField: stringValue(item.depthOfField) || "景深沿用原片。",
    focusPoint: stringValue(item.focusPoint) || "焦点沿用原片主体。",
    composition: stringValue(item.composition) || "构图、留白、主体位置全部锁定。",
    movement: stringValue(item.movement) || "保持原运镜方式。",
    movementDirection: stringValue(item.movementDirection) || "保持原运镜方向。",
    movementSpeed: stringValue(item.movementSpeed) || "保持原运镜速度。",
    stability: stringValue(item.stability) || "保持原稳定程度。",
    cutTransition: stringValue(item.cutTransition) || "保持原切镜方式。"
  };
}

function normalizeActions(value: unknown, observations: ReplicaFrameObservation[], start: number, end: number): ReplicaActionDNA[] {
  const candidates = Array.isArray(value) ? value : [];
  if (candidates.length) return candidates.map((item, index) => normalizeAction(item, start, end, index));
  if (!observations.length) return [normalizeAction({}, start, end, 0)];
  return observations.map((observation, index) => {
    const evidence = observation.actions.length
      ? observation.actions.join("；")
      : `该时间点未识别到明确肢体位移；画面证据：${observation.visualSummary}`;
    return {
      start: observation.timestamp,
      end: observationEventEnd(observations, index, end),
      subjectId: observation.subjects[0] || "画面主体",
      head: observation.actions.length ? evidence : "未见明确头部动作；锁定该帧头部角度，不新增转头、点头或抬头。",
      shoulders: "锁定该帧双肩高低、朝向和跟随顺序；无证据时不得新增耸肩。",
      torso: "锁定上半身朝向、旋转与前后倾；按相邻帧连续过渡。",
      arms: "按该帧可见手臂位置和轨迹复刻；被遮挡部分不臆造动作。",
      hands: "按该帧可见手掌朝向、位置和接触关系复刻；无证据时保持静止。",
      fingers: "保持可见手指张合与抓握状态；细节不可见时不得添加新手势。",
      legs: "保持腿部屈伸、步幅与左右腿关系；未见位移时锁定原姿态。",
      feet: "保持脚尖方向、落点和站位；不得无依据添加脚步。",
      weight: "保持原重心落点及转移节奏。",
      lean: "保持身体原倾斜角度及变化方向。",
      speed: observation.actions.length ? "按相邻亚秒帧的真实位移速度连续过渡。" : "静止或极低速保持，不额外加速。",
      amplitude: observation.actions.length ? "严格匹配相邻帧可见动作幅度。" : "零或极小幅度。",
      direction: observation.actions.length ? "严格匹配相邻帧可见方向。" : "无新增位移方向。",
      sequence: `动作观察 ${index + 1}：${evidence}`
    };
  });
}

function normalizeAction(value: unknown, start: number, end: number, index: number): ReplicaActionDNA {
  const item = asRecord(value);
  return {
    start: parseTimestamp(item.start, start), end: parseTimestamp(item.end, end), subjectId: stringValue(item.subjectId) || "画面主体",
    head: stringValue(item.head) || "锁定原头部角度；证据不足时不新增头部动作。",
    shoulders: stringValue(item.shoulders) || "锁定原肩部姿态和跟随顺序。",
    torso: stringValue(item.torso) || "锁定原上半身朝向、旋转和倾斜。",
    arms: stringValue(item.arms) || "锁定原手臂位置与轨迹。",
    hands: stringValue(item.hands) || "锁定原手掌位置、朝向与接触关系。",
    fingers: stringValue(item.fingers) || "锁定可见手指状态；不可见时不添加手势。",
    legs: stringValue(item.legs) || "锁定原腿部姿态和步幅。",
    feet: stringValue(item.feet) || "锁定原脚步、脚尖方向和落点。",
    weight: stringValue(item.weight) || "锁定原重心及转移节奏。",
    lean: stringValue(item.lean) || "锁定原身体倾斜。",
    speed: stringValue(item.speed) || "按原片相邻帧速度连续过渡。",
    amplitude: stringValue(item.amplitude) || "按原片动作幅度。",
    direction: stringValue(item.direction) || "按原片动作方向。",
    sequence: stringValue(item.sequence) || "没有可靠动作证据时保持原姿态，不新增动作。"
  };
}

function normalizeFaces(value: unknown, observations: ReplicaFrameObservation[], start: number, end: number): ReplicaFaceDNA[] {
  const candidates = Array.isArray(value) ? value : [];
  if (candidates.length) return candidates.map((item, index) => normalizeFace(item, start, end, index));
  return observations.filter((observation) => observation.facialExpression || observation.gaze).map((observation, index) => ({
    start: observation.timestamp,
    end: observationEventEnd(observations, index, end),
    subjectId: observation.subjects[0] || "画面主体",
    emotion: observation.facialExpression,
    change: "按相邻关键帧平滑过渡。",
    eyeOpenness: "保持原眼睛睁开程度。",
    gazeDirection: observation.gaze,
    gazeTarget: "保持原视线目标。",
    eyebrows: "按原帧眉毛状态。",
    lips: "按原帧嘴唇状态。",
    mouthCorners: "按原帧嘴角状态。",
    chin: "保持原下巴方向。",
    headAngle: "保持原头部角度。",
    blinking: "不额外添加眨眼。",
    intensity: "自然、克制，不夸张。",
    transitionSpeed: "按原帧变化速度。"
  }));
}

function normalizeFace(value: unknown, start: number, end: number, index: number): ReplicaFaceDNA {
  const item = asRecord(value);
  return {
    start: parseTimestamp(item.start, start), end: parseTimestamp(item.end, end), subjectId: stringValue(item.subjectId) || "画面主体",
    emotion: stringValue(item.emotion) || "保持原情绪；画面不足时不新增夸张表情。", change: stringValue(item.change) || "按原片相邻帧平滑过渡。", eyeOpenness: stringValue(item.eyeOpenness) || "保持原眼睛睁开程度。", gazeDirection: stringValue(item.gazeDirection) || "保持原视线方向。", gazeTarget: stringValue(item.gazeTarget) || "保持原视线目标。", eyebrows: stringValue(item.eyebrows) || "保持原眉毛位置与动作。", lips: stringValue(item.lips) || "保持原嘴唇开合。", mouthCorners: stringValue(item.mouthCorners) || "保持原嘴角状态。", chin: stringValue(item.chin) || "保持原下巴方向。", headAngle: stringValue(item.headAngle) || "保持原头部角度。", blinking: stringValue(item.blinking) || "不额外添加眨眼。", intensity: stringValue(item.intensity) || "保持原情绪强度。", transitionSpeed: stringValue(item.transitionSpeed) || "保持原情绪过渡速度。"
  };
}

function normalizeBlocking(value: unknown, observations: ReplicaFrameObservation[], start: number, end: number): ReplicaBlockingDNA[] {
  const candidates = Array.isArray(value) ? value : [];
  if (candidates.length) return candidates.map((item, index) => normalizeBlock(item, start, end, index));
  return observations.map((observation, index) => ({
    start: observation.timestamp, end: observationEventEnd(observations, index, end), subjectId: observation.subjects[0] || "画面主体",
    entry: "沿用原片入场关系。", exit: "沿用原片离场关系。", position: observation.blocking || "保持原站位。", facing: "保持原朝向。", distanceToCamera: "保持原距离。", distanceToOthers: "保持与其他人物的原距离。", movement: observation.blocking || "保持原调度。", occlusion: "保持原遮挡关系。", propRelation: "保持与道具的原关系。", environmentRelation: "保持与环境的原关系。"
  }));
}

function normalizeBlock(value: unknown, start: number, end: number, index: number): ReplicaBlockingDNA {
  const item = asRecord(value);
  return { start: parseTimestamp(item.start, start), end: parseTimestamp(item.end, end), subjectId: stringValue(item.subjectId) || "画面主体", entry: stringValue(item.entry) || "保持原入场时间和方向。", exit: stringValue(item.exit) || "保持原离场时间和方向。", position: stringValue(item.position) || "保持原画面站位。", facing: stringValue(item.facing) || "保持原朝向。", distanceToCamera: stringValue(item.distanceToCamera) || "保持原摄像机距离。", distanceToOthers: stringValue(item.distanceToOthers) || "保持人物原距离关系。", movement: stringValue(item.movement) || "保持原调度轨迹和速度。", occlusion: stringValue(item.occlusion) || "保持原遮挡关系。", propRelation: stringValue(item.propRelation) || "保持与道具的原关系。", environmentRelation: stringValue(item.environmentRelation) || "保持与环境的原关系。" };
}

function observationEventEnd(observations: ReplicaFrameObservation[], index: number, shotEnd: number) {
  const start = observations[index]?.timestamp || 0;
  const next = observations[index + 1]?.timestamp;
  return roundTime(Math.max(start, Math.min(shotEnd, typeof next === "number" ? next : shotEnd)));
}

function normalizeCharacters(value: unknown, duration: number): ReplicaCharacterDNA[] {
  if (!Array.isArray(value) || value.length === 0) {
    return [{ id: "character_01", role: "主要人物", agePresentation: "画面呈现年龄段未能确认", genderPresentation: "画面呈现性别未能确认", heightProportion: "保持原比例", build: "保持原身材比例", hair: "保持原发型", clothing: "除目标产品外全部锁定", initialPosition: "保持原初始位置", orientation: "保持原初始朝向", cameraDistance: "保持原距离", relationToOthers: "保持原人物关系", entrance: 0, exit: duration }];
  }
  return value.map((entry, index) => {
    const item = asRecord(entry);
    return {
      id: stringValue(item.id) || `character_${String(index + 1).padStart(2, "0")}`,
      role: stringValue(item.role) || "主要人物",
      agePresentation: stringValue(item.agePresentation) || "画面呈现年龄段未能确认",
      genderPresentation: stringValue(item.genderPresentation) || "画面呈现性别未能确认",
      heightProportion: stringValue(item.heightProportion) || "保持原比例",
      build: stringValue(item.build) || "保持原身材比例",
      hair: stringValue(item.hair) || "保持原发型",
      clothing: stringValue(item.clothing) || "除目标产品外全部锁定",
      initialPosition: stringValue(item.initialPosition) || "保持原初始位置",
      orientation: stringValue(item.orientation) || "保持原初始朝向",
      cameraDistance: stringValue(item.cameraDistance) || "保持原距离",
      relationToOthers: stringValue(item.relationToOthers) || "保持原人物关系",
      entrance: parseTimestamp(item.entrance, 0),
      exit: parseTimestamp(item.exit, duration)
    };
  });
}

function normalizeDialogue(value: unknown, fallback: ReplicaDialogueDNA[]) {
  if (!Array.isArray(value) || value.length === 0) return fallback;
  return value.map((entry, index) => {
    const item = asRecord(entry);
    const original = fallback[index];
    return { id: stringValue(item.id) || original?.id || `dialogue_${String(index + 1).padStart(2, "0")}`, speaker: stringValue(item.speaker) || original?.speaker || "说话者未确认", start: parseTimestamp(item.start, original?.start || 0), end: parseTimestamp(item.end, original?.end || 0), text: stringValue(item.text) || original?.text || "", speakingRate: stringValue(item.speakingRate) || original?.speakingRate || "自然语速", pauses: stringValue(item.pauses), emphasis: stringValue(item.emphasis), emotion: stringValue(item.emotion), offscreen: Boolean(item.offscreen), interruption: stringValue(item.interruption), gapFromPrevious: Number(item.gapFromPrevious || original?.gapFromPrevious || 0), syncWithAction: stringValue(item.syncWithAction) || original?.syncWithAction || "与原动作保持同步" };
  });
}

function normalizeEnvironment(value: unknown): ReplicaEnvironmentDNA {
  const item = asRecord(value);
  return { sceneType: stringValue(item.sceneType) || "沿用原场景", time: stringValue(item.time) || "沿用原时间", weather: stringValue(item.weather) || "沿用原天气", lighting: stringValue(item.lighting) || "沿用原光线逻辑", colorTemperature: stringValue(item.colorTemperature) || "沿用原色温", lightDirection: stringValue(item.lightDirection) || "沿用原光线方向", contrast: stringValue(item.contrast) || "沿用原光比", elements: stringArray(item.elements), props: stringArray(item.props), backgroundPeople: stringValue(item.backgroundPeople), architecture: stringValue(item.architecture), ground: stringValue(item.ground), ceiling: stringValue(item.ceiling), depth: stringValue(item.depth), subjectEnvironmentRelation: stringValue(item.subjectEnvironmentRelation) || "保持主体与环境原关系" };
}

function normalizeProductMapping(value: unknown): ReplicaProductMapping {
  const item = asRecord(value);
  return { sourceCandidates: stringArray(item.sourceCandidates), sourceLocations: stringArray(item.sourceLocations), replacementInstruction: stringValue(item.replacementInstruction) || "仅替换原视频中的目标产品，其余人物、动作、镜头和环境锁定。", visibilityMoments: stringArray(item.visibilityMoments), occlusionRules: stringArray(item.occlusionRules), consistencyRules: stringArray(item.consistencyRules).length ? stringArray(item.consistencyRules) : ["产品颜色、版型、材质、结构、Logo、文字、图案和细节以用户上传产品图为最高事实来源。"] };
}

function normalizeRhythm(value: unknown, shots: ReplicaShotDNA[], duration: number): ReplicaRhythmDNA {
  const item = asRecord(value);
  const average = shots.length ? shots.reduce((sum, shot) => sum + shot.duration, 0) / shots.length : duration;
  return { averageShotLength: Number(item.averageShotLength || average), pace: stringValue(item.pace) || "按原片快慢变化", hookTime: parseTimestamp(item.hookTime, 0), emotionalPeakTime: parseTimestamp(item.emotionalPeakTime, duration / 2), productInfoTime: numberArray(item.productInfoTime), priceInfoTime: numberArray(item.priceInfoTime), turnTime: parseTimestamp(item.turnTime, duration / 2), ctaTime: parseTimestamp(item.ctaTime, Math.max(0, duration - 2)), cutRhythm: stringValue(item.cutRhythm) || "按原镜头切换节奏", actionDialogueRelationship: stringValue(item.actionDialogueRelationship) || "动作与台词按原片同步推动节奏" };
}

function buildDialogueTimeline(asr: AsrResult, silenceWindows: Array<{ start: number; end: number }>, duration: number): ReplicaDialogueDNA[] {
  const text = asr.transcript.trim();
  if (!text) return [];
  const chunks = text.split(/(?<=[。！？!?；;])\s*|\n+/).map((item) => item.trim()).filter(Boolean);
  const windows = speechWindows(silenceWindows, duration, chunks.length);
  const totalChars = chunks.reduce((sum, chunk) => sum + chunk.replace(/\s/g, "").length, 0) || 1;
  return chunks.map((chunk, index) => {
    const window = windows[index] || windows[windows.length - 1] || { start: 0, end: duration };
    const share = chunk.replace(/\s/g, "").length / totalChars;
    const span = Math.max(0.25, (window.end - window.start) * Math.min(1, share * chunks.length));
    const start = index === 0 ? window.start : Math.max(window.start, window.end - span);
    return { id: `dialogue_${String(index + 1).padStart(2, "0")}`, speaker: "说话者未确认", start: roundTime(start), end: roundTime(Math.min(window.end, start + span)), text: chunk, speakingRate: `${Math.max(1, Math.round(chunk.replace(/\s/g, "").length / Math.max(0.25, span)))} 字/秒（估算）`, pauses: "按原音频停顿窗口", emphasis: "按原音频重音", emotion: "按画面与原音频语气保持", offscreen: false, interruption: "无明确打断证据", gapFromPrevious: index === 0 ? 0 : roundTime(Math.max(0, start - (windows[index - 1]?.end || 0))), syncWithAction: "与同时间段动作、眼神、表情保持同步" };
  });
}

function speechWindows(silenceWindows: Array<{ start: number; end: number }>, duration: number, count: number) {
  if (!silenceWindows.length) return [{ start: 0, end: duration }];
  const windows: Array<{ start: number; end: number }> = [];
  let cursor = 0;
  for (const silence of silenceWindows) {
    if (silence.start - cursor >= 0.16) windows.push({ start: cursor, end: silence.start });
    cursor = Math.max(cursor, silence.end);
  }
  if (duration - cursor >= 0.16) windows.push({ start: cursor, end: duration });
  if (windows.length >= count) return windows;
  return windows.length ? windows : [{ start: 0, end: duration }];
}

async function detectSilenceWindows(audioPath: string, duration: number) {
  try {
    const result = await execFileAsync("ffmpeg", ["-hide_banner", "-i", audioPath, "-af", "silencedetect=noise=-35dB:d=0.18", "-f", "null", "-"], { timeout: 1000 * 60 * 10, maxBuffer: 1024 * 1024 * 8 });
    const output = result.stderr || "";
    const starts = [...output.matchAll(/silence_start: ([0-9.]+)/g)].map((match) => Number(match[1]));
    const ends = [...output.matchAll(/silence_end: ([0-9.]+)/g)].map((match) => Number(match[1]));
    return starts.map((start, index) => ({ start: roundTime(start), end: roundTime(Math.min(duration, ends[index] ?? start)) })).filter((item) => item.end > item.start);
  } catch {
    return [];
  }
}

async function measureAudioSignal(audioPath: string) {
  try {
    const result = await execFileAsync("ffmpeg", ["-hide_banner", "-i", audioPath, "-af", "volumedetect", "-f", "null", "-"], { timeout: 1000 * 60 * 10, maxBuffer: 1024 * 1024 * 8 });
    const output = result.stderr || "";
    return { meanVolume: output.match(/mean_volume:\s*([-0-9.]+ dB)/)?.[1] || "未测得", maxVolume: output.match(/max_volume:\s*([-0-9.]+ dB)/)?.[1] || "未测得" };
  } catch {
    return { meanVolume: "未测得", maxVolume: "未测得" };
  }
}

function parseRate(value: string) {
  const [top, bottom] = value.split("/").map(Number);
  return bottom ? top / bottom : Number(value) || 0;
}

function shotIdAt(timestamp: number, boundaries: number[]) {
  const index = Math.max(0, boundaries.findIndex((boundary, idx) => timestamp >= boundary && timestamp <= (boundaries[idx + 1] ?? Infinity)));
  return `shot_${String(index + 1).padStart(2, "0")}`;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => {
    if (typeof item === "string") return item.trim();
    if (!item || typeof item !== "object" || Array.isArray(item)) return String(item || "").trim();
    return Object.entries(item as Record<string, unknown>)
      .filter(([, field]) => typeof field === "string" || typeof field === "number" || typeof field === "boolean")
      .map(([key, field]) => `${key}: ${String(field).trim()}`)
      .filter((field) => !field.endsWith(": "))
      .join("；");
  }).filter(Boolean);
}

function numberArray(value: unknown): number[] {
  return Array.isArray(value) ? value.map((item) => Number(item)).filter((item) => Number.isFinite(item)) : [];
}

function uniqueStrings(values: string[]) {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function roundTime(value: number) {
  return Math.round(Math.max(0, value) * 1000) / 1000;
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}
