"use client";

import { FileText, Loader2, Sparkles, Square } from "lucide-react";
import { GenerationSettings, type GenerationSettingsValue } from "@/components/image-generator/generation-settings";
import { cn } from "@/lib/utils";
import type { CommerceImageModel } from "@/lib/commerce-image-types";

export function CreationComposer(props: {
  value: string;
  onChange: (value: string) => void;
  onGenerate: () => void;
  onStop: () => void;
  generating: boolean;
  canGenerate: boolean;
  hint?: string;
  /** 打开「查看生成提示词」：这次用了哪句原话、最终发给模型的又是什么。 */
  onOpenPrompt?: () => void;
  showPromptEntry?: boolean;
  /** 只包含模型选择（比例/分辨率/数量已并入下面的组合设置控件）。 */
  controls: Array<{ key: string; label: string; value: string; options: Array<{ value: string; label: string }>; onChange: (value: string) => void; disabled?: boolean }>;
  settings: GenerationSettingsValue;
  onSettingsChange: (next: GenerationSettingsValue) => void;
  /** 用于把「分辨率」换算成真实请求像素。 */
  settingsModel: CommerceImageModel;
}) {
  return (
    <div className="shrink-0 rounded-2xl border border-line bg-surface p-3.5">
      <textarea
        value={props.value}
        onChange={(event) => props.onChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && (event.metaKey || event.ctrlKey) && props.canGenerate) {
            event.preventDefault();
            props.onGenerate();
          }
        }}
        rows={2}
        placeholder="告诉 AI 这次想怎么做……"
        className={cn(
          "max-h-[132px] min-h-[52px] w-full resize-none bg-transparent px-1.5 py-1 text-[14px] leading-6 text-ink-1",
          "placeholder:text-ink-3 focus:outline-none"
        )}
      />

      <div className="mt-2.5 flex flex-wrap items-center gap-2">
        <GenerationSettings
          value={props.settings}
          onChange={props.onSettingsChange}
          model={props.settingsModel}
          disabled={props.generating}
        />

        {props.controls.map((control) => (
          <label key={control.key} className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-surface-2 px-2 py-1">
            <span className="text-[11.5px] text-ink-3">{control.label}</span>
            <select
              value={control.value}
              disabled={control.disabled}
              onChange={(event) => control.onChange(event.target.value)}
              className="max-w-[132px] cursor-pointer appearance-none bg-transparent text-[12.5px] text-ink-1 focus:outline-none disabled:cursor-not-allowed disabled:opacity-50"
            >
              {control.options.map((option) => (
                <option key={option.value} value={option.value} className="bg-[var(--ui-surface)] text-ink-1">
                  {option.label}
                </option>
              ))}
            </select>
          </label>
        ))}

        <span className="min-w-0 flex-1 truncate px-1 text-[11.5px] text-ink-3">{props.hint}</span>

        {props.showPromptEntry ? (
          <button
            type="button"
            title="查看生成提示词"
            onClick={props.onOpenPrompt}
            className="inline-flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-[11.5px] text-ink-3 transition-colors duration-150 hover:bg-surface-2 hover:text-ink-1"
          >
            <FileText className="h-3 w-3" strokeWidth={1.8} />
            查看生成提示词
          </button>
        ) : null}

        {props.generating ? (
          <div className="flex items-center gap-2">
            {/* 生成中：主按钮进入 loading + disabled（防重复提交），文案变成「生成中…」；
                原来的「停止生成」保留为次级操作，不做其它交互改动。 */}
            <button
              type="button"
              disabled
              aria-busy
              className="inline-flex h-9 cursor-default items-center gap-2 rounded-lg bg-brand-solid px-4 text-[13px] font-medium text-white opacity-70"
            >
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              生成中…
            </button>
            <button
              type="button"
              onClick={props.onStop}
              className="inline-flex h-9 items-center gap-2 rounded-lg border border-line-strong bg-surface-2 px-3 text-[12.5px] text-ink-2 transition-colors duration-150 hover:bg-surface hover:text-ink-1"
            >
              <Square className="h-3.5 w-3.5" />停止
            </button>
          </div>
        ) : (
          <button
            type="button"
            disabled={!props.canGenerate}
            onClick={props.onGenerate}
            className={cn(
              "inline-flex h-9 items-center gap-2 rounded-lg bg-brand-solid px-4 text-[13px] font-medium text-white",
              "transition-[background-color,transform] duration-150 ease-out hover:bg-[var(--ui-brand-hover)] active:translate-y-px",
              "disabled:pointer-events-none disabled:opacity-45"
            )}
          >
            <Sparkles className="h-3.5 w-3.5" strokeWidth={2} />生成图片
          </button>
        )}
      </div>
    </div>
  );
}

export function ComposerBusy() {
  return <Loader2 className="h-3.5 w-3.5 animate-spin text-ink-3" />;
}
