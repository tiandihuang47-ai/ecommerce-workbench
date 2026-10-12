"use client";

import Link from "next/link";
import { ChevronRight, Database, History, Settings } from "lucide-react";
import { DetailModeVisual, ModeCard, SocialModeVisual } from "@/components/image-generator/image-mode-card";

export function ImageGeneratorHome(props: {
  /** 上次该模式的任务标题：有值时卡片变成「继续创作」，进入即恢复，不会新建。 */
  resume?: { detail: string; social: string };
  onSelectDetail: () => void;
  onSelectSocial: () => void;
  onOpenHistory: () => void;
  onOpenSettings: () => void;
  onOpenLearning: () => void;
  busy: boolean;
}) {
  return (
    <div className="ig-root flex min-h-[calc(100dvh-56px)] flex-col">
      <nav className="flex items-center gap-1.5 text-[12.5px] text-ink-3">
        <Link href="/" className="transition-colors duration-150 hover:text-ink-2">AI 内容中台</Link>
        <ChevronRight className="h-3 w-3" strokeWidth={1.8} />
        <span className="text-ink-2">AI 生图</span>
      </nav>

      <header className="mt-5 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-[32px] font-semibold leading-[1.15] tracking-[-0.02em] text-ink-1">AI 生图</h1>
          <p className="mt-2 text-[14px] text-ink-2">为电商生成真正能用的营销图片</p>
        </div>
        <div className="flex shrink-0 items-center gap-1 pt-1">
          <HomeAction label="营销记录" onClick={props.onOpenLearning}><Database className="h-3.5 w-3.5" strokeWidth={1.8} />营销记录</HomeAction>
          <HomeAction label="历史记录" onClick={props.onOpenHistory}><History className="h-3.5 w-3.5" strokeWidth={1.8} />历史记录</HomeAction>
          <HomeAction label="模型设置" onClick={props.onOpenSettings}><Settings className="h-3.5 w-3.5" strokeWidth={1.8} />模型设置</HomeAction>
        </div>
      </header>

      <div className="mt-8 grid min-h-0 flex-1 grid-cols-1 gap-4 lg:grid-cols-2 lg:gap-5">
        <ModeCard
          badge="成交型"
          title="对标详情图复刻"
          description={"上传对标详情图和自己的商品图，\n保留原图版式、构图和营销结构，\n生成属于自己商品的版本。"}
          cta={props.resume?.detail ? "继续创作" : "开始创作"}
          footer={<ResumeHint title={props.resume?.detail} />}
          disabled={props.busy}
          onClick={props.onSelectDetail}
          visual={<DetailModeVisual />}
        />
        <ModeCard
          badge="流量型"
          title="电商图文"
          description={"围绕商品卖点和传播逻辑，\n生成带卖点文案的流量型电商图文。"}
          cta={props.resume?.social ? "继续创作" : "开始创作"}
          footer={<ResumeHint title={props.resume?.social} />}
          disabled={props.busy}
          onClick={props.onSelectSocial}
          visual={<SocialModeVisual />}
        />
      </div>
    </div>
  );
}

/** 「继续上次」提示：说明点这张卡片会回到上次的任务，而不是开新的。 */
function ResumeHint(props: { title?: string }) {
  if (!props.title) return null;
  return (
    <p className="flex items-center gap-1.5 text-[12px] text-ink-3">
      <span className="inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--ui-brand)]" />
      <span className="min-w-0 truncate">继续上次：{props.title}</span>
    </p>
  );
}

function HomeAction(props: { label: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      title={props.label}
      onClick={props.onClick}
      className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-[12.5px] text-ink-3 transition-colors duration-150 hover:bg-surface-2 hover:text-ink-1"
    >
      {props.children}
    </button>
  );
}
