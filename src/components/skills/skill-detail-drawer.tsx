"use client";

import { useState } from "react";
import { ChevronDown, X } from "lucide-react";
import type { SkillDetail } from "@/lib/skills-client";
import { cn } from "@/lib/utils";

/** 详情：默认只讲用户能懂的事；技术信息折叠在最后（§31 / §68）。 */
export function SkillDetailDrawer({
  skill,
  open,
  onClose
}: {
  skill: SkillDetail | null;
  open: boolean;
  onClose: () => void;
}) {
  const [developerOpen, setDeveloperOpen] = useState(false);
  if (!open || !skill) return null;

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <aside className="relative flex h-full w-full max-w-[440px] flex-col overflow-y-auto border-l border-line bg-surface p-5 scrollbar-subtle anim-fade-in">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="truncate text-[17px] font-medium text-ink-1">{skill.name}</h2>
            <p className="mt-1 text-[12.5px] text-ink-3">{skill.sourceName}</p>
          </div>
          <button
            type="button"
            aria-label="关闭"
            onClick={onClose}
            className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-ink-3 transition-colors duration-150 hover:bg-surface-2 hover:text-ink-1"
          >
            <X className="h-4 w-4" strokeWidth={1.8} />
          </button>
        </div>

        <section className="mt-5">
          <h3 className="text-[11.5px] tracking-[0.04em] text-ink-3">它能做什么</h3>
          <p className="mt-1.5 text-[13px] leading-6 text-ink-2">{skill.detail.whatItDoes || skill.description}</p>
        </section>

        <section className="mt-5">
          <h3 className="text-[11.5px] tracking-[0.04em] text-ink-3">需要什么</h3>
          <ul className="mt-1.5 space-y-1">
            {skill.detail.whatItNeeds.map((item) => (
              <li key={item} className="text-[13px] leading-6 text-ink-2">· {item}</li>
            ))}
          </ul>
          {skill.requiresAuthorization ? (
            <p className="mt-2 rounded-lg bg-warn-soft px-3 py-2 text-[12.5px] leading-5 text-warn">
              这个 Skill 需要你提供授权信息后才能使用。当前版本只做识别，不会伪造任何密钥。
            </p>
          ) : null}
          {skill.publicStatus === "unavailable" ? (
            <p className="mt-2 rounded-lg bg-danger-soft px-3 py-2 text-[12.5px] leading-5 text-danger">
              自检没有通过，暂时无法使用。系统会保留原始文件，等能力升级后可以重新验证。
            </p>
          ) : null}
        </section>

        <section className="mt-5 grid grid-cols-2 gap-3">
          <Info label="来源" value={skill.sourceType === "zip" ? "压缩包" : skill.sourceType === "folder" ? "文件夹" : "文件"} />
          <Info label="版本" value={skill.version} />
          <Info label="导入时间" value={formatTime(skill.importedAt)} />
          <Info label="状态" value={skill.statusDetail || "—"} />
        </section>

        <section className="mt-6 border-t border-line pt-4">
          <button
            type="button"
            onClick={() => setDeveloperOpen((value) => !value)}
            className="inline-flex items-center gap-1.5 text-[12px] text-ink-3 transition-colors duration-150 hover:text-ink-1"
          >
            <ChevronDown className={cn("h-3.5 w-3.5 transition-transform duration-150", developerOpen && "rotate-180")} strokeWidth={1.8} />
            技术信息（开发者）
          </button>

          {developerOpen ? (
            <div className="mt-3 space-y-3 text-[12px] leading-5 text-ink-3">
              <div>
                <div className="text-ink-2">运行方式</div>
                <div>{skill.runtimeType}｜入口 {skill.entrypointCount} 个｜工具 {skill.toolCount} 个</div>
              </div>
              <div>
                <div className="text-ink-2">环境要求</div>
                {(skill.environmentRequirements.length ? skill.environmentRequirements : ["无额外要求"]).map((item) => (
                  <div key={item}>· {item}</div>
                ))}
              </div>
              <div>
                <div className="text-ink-2">依赖</div>
                {(skill.developerSummary.requiredPackages.length ? skill.developerSummary.requiredPackages : ["无"]).map((item) => (
                  <div key={item}>· {item}</div>
                ))}
              </div>
              <div>
                <div className="text-ink-2">工具映射</div>
                {(skill.toolMappings.length ? skill.toolMappings : [{ externalName: "无", matched: false, capabilityLabel: "" }]).map((item) => (
                  <div key={item.externalName}>· {item.externalName} → {item.matched ? item.capabilityLabel : "未识别"}</div>
                ))}
              </div>
              <div>
                <div className="text-ink-2">最近一次自检</div>
                <div>{skill.developerSummary.summary || "—"}</div>
              </div>
            </div>
          ) : null}
        </section>
      </aside>
    </div>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-surface-2 px-3 py-2">
      <div className="text-[11px] text-ink-3">{label}</div>
      <div className="mt-0.5 truncate text-[12.5px] text-ink-1" title={value}>{value}</div>
    </div>
  );
}

function formatTime(value: string) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return `${date.getFullYear()}/${date.getMonth() + 1}/${date.getDate()}`;
}
