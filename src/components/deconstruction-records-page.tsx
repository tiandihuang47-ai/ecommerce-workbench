"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { Archive, Bot, Copy, Heart, PenLine, Search, Star, Trash2 } from "lucide-react";
import { EmptyState, PageHeader } from "@/components/design-system";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import {
  deleteDeconstructionRecord,
  getDeconstructionRecords,
  saveDeconstructionRecord,
  toggleFavoriteDeconstructionRecord
} from "@/lib/deconstruction-store";
import { nowIso, saveScriptRecord } from "@/lib/pipeline-storage";
import type { SimpleDeconstructionRecord } from "@/lib/pipeline-types";
import { platformLabels } from "@/lib/video-link-parser";
import { deconstructionToScriptRecord } from "@/services/simpleContentService";
import { cn } from "@/lib/utils";

const sourceOptions = [
  { label: "全部来源", value: "全部" },
  { label: "链接", value: "link" },
  { label: "上传", value: "upload" },
  { label: "手动", value: "manual" }
];

const statusOptions = [
  { label: "全部状态", value: "全部" },
  { label: "成功", value: "completed" },
  { label: "失败", value: "failed" },
  { label: "分析中", value: "analyzing" }
];

export function DeconstructionRecordsPage() {
  const router = useRouter();
  const [records, setRecords] = useState<SimpleDeconstructionRecord[]>(() => getDeconstructionRecords());
  const [keyword, setKeyword] = useState("");
  const [platform, setPlatform] = useState("全部");
  const [sourceType, setSourceType] = useState("全部");
  const [status, setStatus] = useState("全部");
  const [favorite, setFavorite] = useState("全部");
  const [selectedId, setSelectedId] = useState(records[0]?.id || "");
  const selected = records.find((record) => record.id === selectedId) || records[0] || null;

  const platformOptions = useMemo(() => {
    const values = Array.from(new Set(records.map((item) => item.platform || "unknown")));
    return [{ label: "全部平台", value: "全部" }, ...values.map((value) => ({ label: platformLabels[value] || value, value }))];
  }, [records]);

  const filtered = useMemo(() => {
    const key = keyword.trim();
    return records.filter((item) => {
      const text = [
        item.sourceTitle,
        item.title,
        item.sourceUrl,
        item.targetProduct,
        item.targetAudience,
        item.transcript,
        item.coreTheme,
        item.rewrittenTitle,
        item.rewrittenScript,
        item.tags
      ].join(" ");
      return (
        (!key || text.includes(key)) &&
        (platform === "全部" || item.platform === platform) &&
        (sourceType === "全部" || item.sourceType === sourceType) &&
        (status === "全部" || item.status === status) &&
        (favorite === "全部" || (favorite === "已收藏" ? item.favorite : !item.favorite))
      );
    });
  }, [favorite, keyword, platform, records, sourceType, status]);

  function refresh(nextSelectedId?: string) {
    const next = getDeconstructionRecords();
    setRecords(next);
    if (nextSelectedId) {
      setSelectedId(nextSelectedId);
    } else if (!next.some((item) => item.id === selectedId)) {
      setSelectedId(next[0]?.id || "");
    }
  }

  function remove(id: string) {
    deleteDeconstructionRecord(id);
    refresh();
  }

  function toggleFavorite(id: string) {
    const updated = toggleFavoriteDeconstructionRecord(id);
    refresh(updated?.id);
  }

  function saveAsScript(record: SimpleDeconstructionRecord) {
    const script = deconstructionToScriptRecord(record);
    saveScriptRecord(script);
    const updated = saveDeconstructionRecord({ ...record, savedScriptId: script.id, updatedAt: nowIso() });
    refresh(updated.id);
  }

  return (
    <div>
      <PageHeader
        eyebrow="AI 内容中台 / 资产库 / 拆片资产"
        title="拆片资产"
        description="查看历史拆解、复制逐字稿和仿写脚本，也可以重新打开到拆片页面继续工作。"
        action={<Button asChild><Link href="/deconstruction"><Archive className="h-4 w-4" />新建拆片</Link></Button>}
      />

      <Card className="mb-6">
        <CardContent className="grid gap-3 p-4 lg:grid-cols-[minmax(0,1fr)_150px_150px_150px_150px]">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <Input className="pl-9" value={keyword} onChange={(event) => setKeyword(event.target.value)} placeholder="搜索标题、链接、产品、人群、脚本内容" />
          </div>
          <Select value={platform} onChange={(event) => setPlatform(event.target.value)} options={platformOptions} />
          <Select value={sourceType} onChange={(event) => setSourceType(event.target.value)} options={sourceOptions} />
          <Select value={status} onChange={(event) => setStatus(event.target.value)} options={statusOptions} />
          <Select value={favorite} onChange={(event) => setFavorite(event.target.value)} options={["全部", "已收藏", "未收藏"].map((value) => ({ label: value, value }))} />
        </CardContent>
      </Card>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)] xl:items-start">
        <div className="space-y-3 xl:max-h-[calc(100vh-230px)] xl:overflow-y-auto xl:pr-2 scrollbar-subtle">
          {filtered.length === 0 ? <EmptyState text="没有找到拆片资产。完成一次拆片后会自动保存到这里。" actionText="新建拆片" onAction={() => router.push("/deconstruction")} /> : null}
          {filtered.map((item) => (
            <RecordCard
              key={item.id}
              item={item}
              active={selected?.id === item.id}
              onOpen={() => setSelectedId(item.id)}
              onDelete={() => remove(item.id)}
              onFavorite={() => toggleFavorite(item.id)}
              onCopy={() => copyText(formatRecord(item))}
              onSaveScript={() => saveAsScript(item)}
            />
          ))}
        </div>

        <div className="xl:sticky xl:top-8 xl:max-h-[calc(100vh-230px)] xl:overflow-y-auto xl:pr-2 scrollbar-subtle">
          {selected ? (
            <RecordDetail
              item={selected}
              onDelete={() => remove(selected.id)}
              onFavorite={() => toggleFavorite(selected.id)}
              onSaveScript={() => saveAsScript(selected)}
            />
          ) : (
            <EmptyState text="请选择一条拆片记录查看详情。" />
          )}
        </div>
      </div>
    </div>
  );
}

function RecordCard({
  item,
  active,
  onOpen,
  onDelete,
  onFavorite,
  onCopy,
  onSaveScript
}: {
  item: SimpleDeconstructionRecord;
  active: boolean;
  onOpen: () => void;
  onDelete: () => void;
  onFavorite: () => void;
  onCopy: () => void;
  onSaveScript: () => void;
}) {
  return (
    <Card className={cn("transition-colors", active && "ring-1 ring-slate-400 dark:ring-slate-500")}>
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <button type="button" onClick={onOpen} className="min-w-0 text-left">
            <CardTitle className="line-clamp-2">{item.sourceTitle || item.rewrittenTitle || item.title || item.sourceUrl || "未命名拆片"}</CardTitle>
            <CardDescription className="mt-2">
              {platformLabels[item.platform || "unknown"]}｜{sourceLabel(item.sourceType)}｜{item.targetProduct || "未填写产品"}｜{formatDateTime(item.createdAt)}
            </CardDescription>
          </button>
          <Button size="icon" variant="ghost" onClick={onFavorite} title={item.favorite ? "取消收藏" : "收藏"}>
            <Star className={cn("h-4 w-4", item.favorite ? "fill-amber-400 text-amber-500" : "text-slate-400")} />
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap gap-2">
          <Badge variant={item.status === "failed" ? "secondary" : "default"}>{statusLabel(item.status)}</Badge>
          <Badge variant={item.savedScriptId ? "default" : "secondary"}>{item.savedScriptId ? "已保存脚本" : "未保存脚本"}</Badge>
          {item.favorite ? <Badge variant="secondary">已收藏</Badge> : null}
        </div>
        <p className="line-clamp-2 text-sm leading-6 text-slate-600 dark:text-slate-300">{item.reusableStructure || item.coreTheme || item.errorMessage || "点击查看完整拆片内容。"}</p>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" onClick={onOpen}><PenLine className="h-4 w-4" />查看</Button>
          <Button size="sm" variant="outline" onClick={onCopy}><Copy className="h-4 w-4" />复制</Button>
          <Button size="sm" variant="outline" asChild><Link href={`/deconstruction?record=${item.id}`}>重新打开</Link></Button>
          <Button size="sm" variant="outline" onClick={onSaveScript} disabled={!item.rewrittenScript}><Bot className="h-4 w-4" />保存为脚本</Button>
          <Button size="sm" variant="destructive" onClick={onDelete}><Trash2 className="h-4 w-4" />删除</Button>
        </div>
      </CardContent>
    </Card>
  );
}

function RecordDetail({ item, onDelete, onFavorite, onSaveScript }: { item: SimpleDeconstructionRecord; onDelete: () => void; onFavorite: () => void; onSaveScript: () => void }) {
  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-4">
          <div>
            <CardTitle>{item.sourceTitle || item.rewrittenTitle || item.title || "拆片详情"}</CardTitle>
            <CardDescription>{platformLabels[item.platform || "unknown"]}｜{sourceLabel(item.sourceType)}｜{formatDateTime(item.createdAt)}</CardDescription>
          </div>
          <div className="flex gap-2">
            <Button size="icon" variant="ghost" onClick={onFavorite}><Heart className={cn("h-4 w-4", item.favorite ? "fill-rose-500 text-rose-500" : "text-slate-400")} /></Button>
            <Button size="icon" variant="ghost" onClick={onDelete}><Trash2 className="h-4 w-4" /></Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <DetailBlock title="原视频信息" value={[
          `链接：${item.sourceUrl || item.cleanUrl || "无"}`,
          `作者：${item.sourceAuthor || "未解析到"}`,
          `描述：${item.sourceDescription || "未解析到"}`,
          `解析策略：${item.parseStrategy || "未记录"}`,
          `失败原因：${item.errorMessage || "无"}`
        ].join("\n")} />
        <DetailBlock title="逐字稿" value={item.transcript || item.rawText || "未记录"} copyable />
        <DetailBlock title="拆片结果" value={formatDeconstruction(item)} copyable />
        <DetailBlock title="仿写结果" value={formatRewrite(item)} copyable />
        <div className="flex flex-wrap gap-2">
          <Button asChild><Link href={`/deconstruction?record=${item.id}`}>重新打开到拆片</Link></Button>
          <Button variant="outline" onClick={onSaveScript} disabled={!item.rewrittenScript}><Bot className="h-4 w-4" />保存到脚本资产</Button>
          <Button variant="outline" onClick={() => copyText(formatRecord(item))}><Copy className="h-4 w-4" />复制全部</Button>
        </div>
      </CardContent>
    </Card>
  );
}

function DetailBlock({ title, value, copyable = false }: { title: string; value: string; copyable?: boolean }) {
  return (
    <div className="rounded-2xl border border-slate-200/70 bg-slate-50/70 p-4 dark:border-slate-800 dark:bg-slate-950/40">
      <div className="mb-2 flex items-center justify-between gap-3">
        <div className="text-sm font-semibold text-slate-950 dark:text-slate-100">{title}</div>
        {copyable ? <Button size="sm" variant="ghost" onClick={() => copyText(value)}><Copy className="h-4 w-4" />复制</Button> : null}
      </div>
      <div className="max-h-72 overflow-y-auto whitespace-pre-wrap pr-2 text-sm leading-7 text-slate-600 dark:text-slate-300 scrollbar-subtle">{value || "未记录"}</div>
    </div>
  );
}

function formatDeconstruction(item: SimpleDeconstructionRecord) {
  return item.analysisMarkdown || [
    `视频核心主题：${item.coreTheme}`,
    `开头钩子：${item.hook}`,
    `爆款元素：${item.viralElements}`,
    `内容结构：\n${item.structure}`,
    `情绪变化：\n${item.emotionFlow}`,
    `节奏设计：\n${item.visualRhythm}`,
    `转化路径：${item.conversionPoint}`,
    `可复用结构：\n${item.reusableStructure}`
  ].join("\n\n");
}

function formatRewrite(item: SimpleDeconstructionRecord) {
  return item.rewriteMarkdown || [
    `新选题：${item.rewrittenTopic}`,
    `新标题：${item.rewrittenTitle}`,
    `开头 3 秒钩子：${item.rewrittenHook}`,
    `完整口播脚本：\n${item.rewrittenScript}`,
    `分镜建议：\n${item.shotSuggestions}`,
    `画中画建议：\n${item.overlaySuggestions}`,
    `拍摄提醒：\n${item.shootingTips}`,
    `结尾转化话术：${item.endingCTA}`,
    `延展选题：\n${item.extendedTopics}`
  ].join("\n\n");
}

function formatRecord(item: SimpleDeconstructionRecord) {
  return [
    "【原视频信息】",
    `标题：${item.sourceTitle || item.title}`,
    `平台：${platformLabels[item.platform || "unknown"]}`,
    `链接：${item.sourceUrl || item.cleanUrl || ""}`,
    "",
    "【逐字稿】",
    item.transcript || item.rawText || "未记录",
    "",
    "【拆片结果】",
    formatDeconstruction(item),
    "",
    "【仿写结果】",
    formatRewrite(item)
  ].join("\n");
}

function sourceLabel(value?: string) {
  if (value === "link") return "链接";
  if (value === "upload") return "上传";
  if (value === "manual") return "手动";
  return "未知来源";
}

function statusLabel(status?: SimpleDeconstructionRecord["status"]) {
  if (status === "failed") return "失败";
  if (status === "analyzing") return "分析中";
  return "成功";
}

function formatDateTime(value?: string) {
  if (!value) return "未知时间";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}

function copyText(value: string) {
  if (typeof navigator === "undefined") return;
  void navigator.clipboard.writeText(value);
}
