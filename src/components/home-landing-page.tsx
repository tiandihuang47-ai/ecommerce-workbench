"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowRight,
  FileSearch,
  ImagePlus,
  Package,
  Sparkles,
  TextQuote,
  WandSparkles,
  type LucideIcon
} from "lucide-react";
import { prepareAssetReuse } from "@/lib/asset-reuse-client";
import { handOffToAIChat } from "@/lib/ai-chat-bridge";
import { getRecentAssets, type ContentAsset } from "@/lib/stores/asset-store";
import { BatchTranscriptDialog } from "@/components/batch-transcript-dialog";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

const quickActions: Array<{
  title: string;
  description: string;
  action: string;
  href: string;
  icon: LucideIcon;
  /** 有值时不跳转页面，改为打开对应弹窗。 */
  dialog?: "batch-transcript";
}> = [
  {
    title: "写脚本",
    description: "根据产品、卖点和内容方向生成可直接拍摄的短视频脚本。",
    action: "开始写脚本",
    href: "/script-generator",
    icon: WandSparkles
  },
  {
    title: "爆款复刻",
    description: "上传爆款视频和产品图，尽可能复刻原片结构与节奏。",
    action: "开始复刻",
    href: "/deconstruction",
    icon: FileSearch
  },
  {
    title: "批量扒稿",
    description: "粘贴一批抖音链接，自动排队提取全部视频逐字稿。",
    action: "开始扒稿",
    href: "#batch-transcript",
    icon: TextQuote,
    dialog: "batch-transcript"
  },
  {
    title: "AI 生图",
    description: "基于产品资料和已有资产生成短视频参考图。",
    action: "开始生图",
    href: "/image-generator",
    icon: ImagePlus
  },
  {
    title: "产品资料",
    description: "沉淀产品卖点、参数、人群和内容素材，让 AI 后续直接调用。",
    action: "添加产品",
    href: "/products",
    icon: Package
  }
];

const assetTypeLabels: Record<string, string> = {
  script: "脚本",
  deconstruction: "拆片",
  image_prompt: "生图",
  image_project: "生图项目",
  ai_chat: "AI 对话",
  comment_insight: "评论洞察",
  review: "复盘",
  product: "产品资料"
};

const assetStatusLabels: Record<string, string> = {
  draft: "草稿",
  completed: "已完成",
  failed: "失败",
  archived: "已归档"
};

function formatRelativeTime(value: string) {
  if (!value) return "";
  const time = new Date(value).getTime();
  if (Number.isNaN(time)) return "";
  const diff = Date.now() - time;
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return "刚刚";
  if (minutes < 60) return `${minutes} 分钟前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} 小时前`;
  const days = Math.floor(hours / 24);
  if (days < 7) return days === 1 ? "昨天" : `${days} 天前`;
  const date = new Date(time);
  return `${date.getMonth() + 1}月${date.getDate()}日`;
}

function formatAssetTitle(value: string) {
  if (!value) return value;
  let text = value.trim();

  // 1. 去掉文件扩展名（只影响展示，不修改原始数据）
  text = text.replace(/\.(mp4|mov|m4v|webm|mkv|avi|flv|wmv|ts|mp3|wav|m4a|aac|txt|md|markdown|doc|docx|pdf|srt|vtt|ass|png|jpe?g|webp|gif|zip)$/i, "");

  // 2. 去掉开头的 YYYY-MM-DD_ 日期
  text = text.replace(/^\d{4}[-_.]\d{1,2}[-_.]\d{1,2}(?:[-_\s]+|$)/, "");

  // 3. 去掉末尾明显的长数字 ID
  text = text.replace(/[-_\s]*\d{9,}$/, "");

  // 4. 按下划线等分隔符拆段，优先提取真正有意义的标题段
  const parts = text.split(/[_\s｜|]+/).map((item) => item.trim()).filter(Boolean);
  if (parts.length === 0) return text || "未命名内容";
  const first = parts[0];
  if (first.length >= 4) return first;
  return parts.join(" ");
}

export function HomeLandingPage() {
  const router = useRouter();
  const [prompt, setPrompt] = useState("");
  const [recent, setRecent] = useState<ContentAsset[]>([]);
  const [batchDialogOpen, setBatchDialogOpen] = useState(false);

  useEffect(() => {
    setRecent(getRecentAssets(6));
  }, []);

  function submitPrompt() {
    const text = prompt.trim();
    if (!text) return;
    // 直接交给 AI 并自动发送，不用进去再点一次「发送」。
    router.push(handOffToAIChat({ prompt: text, autoSend: true }));
  }

  function continueAsset(asset: ContentAsset) {
    if (asset.type === "script" || asset.type === "image_prompt" || asset.type === "image_project" || asset.type === "deconstruction") {
      const result = prepareAssetReuse(asset);
      if (result.success) {
        window.location.assign(result.href);
        return;
      }
    }
    router.push("/assets");
  }

  return (
    <div className="mx-auto w-full max-w-[1280px]">
      <header className="pt-2 md:pt-6">
        <h1 className="text-2xl font-semibold leading-tight tracking-[-0.015em] text-foreground md:text-[26px]">
          今天准备做什么？
        </h1>
        <p className="mt-1.5 text-sm text-muted-foreground">从脚本、爆款拆解或现有内容继续。</p>
      </header>

      <div className="mt-7">
        <div className="flex items-center gap-3 rounded-xl border border-border bg-card px-4 shadow-[0_1px_2px_rgba(15,23,42,0.04),0_2px_8px_rgba(15,23,42,0.03)] transition-colors focus-within:border-ring/50 dark:bg-card dark:shadow-none">
          <Sparkles className="h-4 w-4 shrink-0 text-accent" />
          <Input
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                submitPrompt();
              }
            }}
            placeholder="告诉 AI 你今天想完成什么内容任务…"
            className="h-12 flex-1 border-0 bg-transparent px-0 text-[15px] shadow-none focus-visible:ring-0"
          />
          <button
            type="button"
            onClick={submitPrompt}
            disabled={!prompt.trim()}
            className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-lg bg-brand px-3.5 text-sm font-medium text-brand-foreground transition-colors hover:bg-brand/85 disabled:cursor-not-allowed disabled:opacity-50"
          >
            开始
            <ArrowRight className="h-3.5 w-3.5" />
          </button>
        </div>
        <p className="mt-2 text-xs text-muted-foreground/70">
          例如：给雅鹿羽绒服写一条反季促销脚本 · 拆解这条爆款视频 · 根据产品资料生成短视频脚本
        </p>
      </div>

      <section className="mt-9">
        <h2 className="text-[11px] font-medium tracking-[0.08em] text-muted-foreground/70">开始创作</h2>
        <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {quickActions.map((item) => {
            const Icon = item.icon;

            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={item.dialog ? (event) => { event.preventDefault(); setBatchDialogOpen(true); } : undefined}
                className="group flex flex-col justify-between rounded-xl border border-border bg-card p-4 shadow-[0_1px_2px_rgba(15,23,42,0.04),0_2px_8px_rgba(15,23,42,0.03)] transition-all duration-150 hover:-translate-y-px hover:border-input hover:shadow-[0_6px_20px_rgba(15,23,42,0.08)] dark:bg-card dark:shadow-none dark:hover:border-white/15 dark:hover:shadow-none"
              >
                <div>
                  <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent/10 text-accent transition-colors group-hover:bg-accent/15">
                    <Icon className="h-4 w-4" />
                  </div>
                  <div className="mt-3 text-sm font-semibold text-foreground">{item.title}</div>
                  <p className="mt-1 line-clamp-2 text-xs leading-5 text-muted-foreground">{item.description}</p>
                </div>
                <div className="mt-4 flex items-center gap-1 text-xs font-medium text-muted-foreground transition-colors group-hover:text-foreground">
                  {item.action}
                  <ArrowRight className="h-3.5 w-3.5 transition-transform duration-150 group-hover:translate-x-0.5" />
                </div>
              </Link>
            );
          })}
        </div>
      </section>

      <section className="mt-9 pb-4">
        <div className="flex items-center justify-between">
          <h2 className="text-[11px] font-medium tracking-[0.08em] text-muted-foreground/70">最近内容</h2>
          <Link href="/assets" className="text-xs text-muted-foreground/70 transition-colors hover:text-foreground">
            查看全部 →
          </Link>
        </div>

        {recent.length === 0 ? (
          <div className="mt-3 rounded-xl border border-dashed border-border px-6 py-10 text-center">
            <p className="text-sm font-medium text-foreground">还没有最近内容</p>
            <p className="mt-1 text-xs text-muted-foreground">从脚本、拆片或生图开始你的第一次创作。</p>
            <Link
              href="/script-generator"
              className="mt-4 inline-flex h-8 items-center gap-1.5 rounded-lg bg-brand px-3 text-xs font-medium text-brand-foreground transition-colors hover:bg-brand/85"
            >
              开始写脚本
              <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </div>
        ) : (
          <div className="mt-3 overflow-hidden rounded-xl border border-border bg-card shadow-[0_1px_2px_rgba(15,23,42,0.04),0_2px_8px_rgba(15,23,42,0.03)] dark:shadow-none">
            {recent.map((asset, index) => (
              <div
                key={asset.id}
                className={cn(
                  "flex items-center gap-3 px-4 py-3 transition-colors hover:bg-muted/40",
                  index > 0 && "border-t border-border/70"
                )}
              >
                <span className="shrink-0 whitespace-nowrap rounded-md bg-muted px-2 py-1 text-[11px] font-medium text-muted-foreground">
                  {assetTypeLabels[asset.type] || "内容"}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium text-foreground" title={asset.title}>
                    {formatAssetTitle(asset.title)}
                  </div>
                  <div className="mt-0.5 text-xs text-muted-foreground/80">{formatRelativeTime(asset.updatedAt)}</div>
                </div>
                <span className="hidden shrink-0 text-xs text-muted-foreground/80 sm:block">
                  {assetStatusLabels[asset.status] || asset.status}
                </span>
                <button
                  type="button"
                  onClick={() => continueAsset(asset)}
                  className="inline-flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                >
                  继续
                  <ArrowRight className="h-3 w-3" />
                </button>
              </div>
            ))}
          </div>
        )}
      </section>

      <BatchTranscriptDialog open={batchDialogOpen} onOpenChange={setBatchDialogOpen} />
    </div>
  );
}
