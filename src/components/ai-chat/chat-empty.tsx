"use client";

import { BarChart3, FileSearch, ImagePlus, MessageCircle, Sparkles, Wand2 } from "lucide-react";
import type { LucideIcon } from "lucide-react";

const emptyGroups: Array<{ label: string; items: Array<{ title: string; hint: string; prompt: string; icon: LucideIcon }> }> = [
  {
    label: "写内容",
    items: [
      {
        title: "带货口播脚本",
        hint: "30 秒，能直接开拍",
        icon: Wand2,
        prompt: "我要写一条 30 秒带货口播脚本。先问我 3 个必须确认的信息（产品、核心卖点、目标人群），我回答后你再给完整脚本。"
      },
      {
        title: "小红书图文",
        hint: "标题 + 正文 + 标签",
        icon: MessageCircle,
        prompt: "帮我写一篇小红书图文种草笔记。先问我 3 个必须确认的信息（产品、使用场景、目标人群），再按小红书的口语风格输出标题、正文和标签。"
      },
      {
        title: "直播切片话术",
        hint: "15 秒讲清一个卖点",
        icon: Sparkles,
        prompt: "帮我写一段直播间切片话术，要求 15 秒内讲清一个卖点。先问我产品和一个主推卖点。"
      }
    ]
  },
  {
    label: "拆爆款",
    items: [
      {
        title: "拆解一条爆款",
        hint: "结构、钩子、可迁移点",
        icon: FileSearch,
        prompt: "我要拆解一条爆款视频。请先告诉我需要提供哪些信息（逐字稿、标题、数据），然后按「核心主题 → 开头钩子 → 爆款元素 → 内容结构 → 可迁移结构」给我结构化拆解。"
      },
      {
        title: "改写我这条脚本",
        hint: "保留事实，改得更犀利",
        icon: Wand2,
        prompt: "帮我把一条旧脚本改得更犀利。请先让我把脚本正文贴给你，然后给出改写版和「改了什么」的对照说明。"
      },
      {
        title: "评论区选题",
        hint: "从真实疑问里挖 10 条",
        icon: BarChart3,
        prompt: "根据我的产品，从评论区常见疑问里挖 10 个短视频选题。请先问我产品是什么，以及评论区里最常出现的问题。"
      }
    ]
  },
  {
    label: "做画面",
    items: [
      {
        title: "生图提示词",
        hint: "封面 / 场景图",
        icon: ImagePlus,
        prompt: "帮我写一条短视频封面图的生图提示词。先问我产品、画面场景和想突出的卖点，再给出可直接使用的中文提示词。"
      },
      {
        title: "分镜与拍摄建议",
        hint: "逐句拆成分镜",
        icon: Sparkles,
        prompt: "帮我把一条脚本拆成分镜和拍摄提醒。先让我把脚本正文贴给你，再输出逐句分镜、画中画建议和拍摄注意事项。"
      },
      {
        title: "卖点提炼",
        hint: "资料里没有就不编",
        icon: MessageCircle,
        prompt: "帮我把产品资料提炼成能直接拍摄的卖点。先问我产品是什么；资料里没有的信息直接说没有依据，不要编造。"
      }
    ]
  }
];

export function ChatEmpty({ onPick, disabled }: { onPick: (prompt: string) => void; disabled?: boolean }) {
  return (
    <div className="mx-auto w-full max-w-[760px] py-10 anim-fade-up">
      <div className="text-center">
        <div className="mx-auto flex h-11 w-11 items-center justify-center rounded-xl bg-brand-soft text-brand">
          <Sparkles className="h-5 w-5" strokeWidth={1.8} />
        </div>
        <h2 className="mt-4 text-[19px] font-semibold tracking-[-0.01em] text-ink-1">今天想让 AI 帮你处理什么内容？</h2>
        <p className="mt-1.5 text-[13px] text-ink-3">点一张卡片直接开始，也可以在下面自己描述。</p>
      </div>

      <div className="mt-7 space-y-5">
        {emptyGroups.map((group) => (
          <section key={group.label}>
            <h3 className="mb-2 text-[11.5px] font-medium tracking-[0.04em] text-ink-3">{group.label}</h3>
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {group.items.map((item) => {
                const Icon = item.icon;
                return (
                  <button
                    key={item.title}
                    type="button"
                    disabled={disabled}
                    onClick={() => onPick(item.prompt)}
                    className="group flex flex-col gap-1.5 rounded-xl border border-line bg-surface-2 p-3 text-left transition-colors duration-150 hover:border-brand-ring hover:bg-brand-soft disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <Icon className="h-4 w-4 text-ink-3 transition-colors duration-150 group-hover:text-brand" strokeWidth={1.8} />
                    <span className="text-[13.5px] font-medium text-ink-1">{item.title}</span>
                    <span className="text-[11.5px] text-ink-3">{item.hint}</span>
                  </button>
                );
              })}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
