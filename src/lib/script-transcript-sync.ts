"use client";

import { storageGet } from "@/lib/web-storage";
import { getScriptRecords, mergeScriptTranscriptRecords, type ScriptTranscriptMergeInput } from "@/lib/pipeline-storage";

const WORKBENCH_DRAFT_KEY = "director-platform.scriptWorkbenchDraft";
const BATCH_LAST_KEY = "director-platform.batch-transcript.last";

interface DraftShape {
  douyinTranscript?: {
    status?: string;
    link?: string;
    transcript?: string;
    title?: string;
    authorName?: string;
    awemeId?: string;
  } | null;
}

interface BatchShape {
  items?: Array<{
    status?: string;
    url?: string;
    transcript?: string;
    title?: string;
    authorName?: string;
    awemeId?: string;
  }>;
}

/**
 * 把散落在各处的逐字稿并入「逐字稿库」，让"解析过就能引用"不依赖解析时的版本与入口：
 * 1) 脚本工作台当前草稿（最近一次解析、可能还没生成脚本的逐字稿，旧版本解析的也在这里）；
 * 2) 已保存脚本记录里带的逐字稿（旧版只有生成脚本后才随记录持久化）；
 * 3) 批量扒稿的历史结果。
 * 幂等：已在库里的记录跳过，重复执行不产生重复条目、不抖动排序。
 */
export function syncScriptTranscriptLibrary(): void {
  const inputs: ScriptTranscriptMergeInput[] = [];

  try {
    const raw = storageGet(WORKBENCH_DRAFT_KEY);
    if (raw) {
      const draft = JSON.parse(raw) as DraftShape;
      const state = draft.douyinTranscript;
      if (state && state.status === "done" && (state.transcript || "").trim()) {
        inputs.push({
          awemeId: state.awemeId,
          link: state.link || "",
          title: state.title || "",
          authorName: state.authorName || "",
          transcript: state.transcript || "",
          fallbackId: "transcript_workbench_draft"
        });
      }
    }
  } catch {
    // 草稿解析失败不影响其他来源
  }

  try {
    for (const record of getScriptRecords()) {
      const douyin = record.douyinSource;
      if (douyin?.transcript?.trim()) {
        inputs.push({
          awemeId: douyin.awemeId,
          link: douyin.url || "",
          title: record.title || "",
          authorName: "",
          transcript: douyin.transcript,
          fallbackId: `transcript_src_${record.id}`
        });
      } else if (record.sourceTranscript?.trim()) {
        inputs.push({
          awemeId: "",
          link: record.sourceUrl || "",
          title: record.title || "",
          authorName: "",
          transcript: record.sourceTranscript,
          fallbackId: `transcript_src_${record.id}`
        });
      }
    }
  } catch {
    // 脚本记录读取失败不影响其他来源
  }

  try {
    const raw = storageGet(BATCH_LAST_KEY);
    if (raw) {
      const batch = JSON.parse(raw) as BatchShape;
      for (const item of batch.items || []) {
        if (item.status !== "done" || !(item.transcript || "").trim() || !item.url) continue;
        inputs.push({
          awemeId: item.awemeId,
          link: item.url,
          title: item.title || "",
          authorName: item.authorName || "",
          transcript: item.transcript || ""
        });
      }
    }
  } catch {
    // 批量结果读取失败不影响其他来源
  }

  try {
    mergeScriptTranscriptRecords(inputs);
  } catch {
    // 自愈失败不影响 AI 对话本身
  }
}
