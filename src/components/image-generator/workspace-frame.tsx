"use client";

import { ChevronLeft, Database, FileText, History, Plus, Settings } from "lucide-react";
import type { ReactNode } from "react";
import type {
  CommerceImageAssetRole,
  CommerceImageModel,
  CommerceImagePanel,
  CommerceImageTask,
  CommerceImageVersion
} from "@/lib/commerce-image-types";
import type { SelectedProductInfo } from "@/components/image-generator/product-selection";
import type { GenerationSettingsValue } from "@/components/image-generator/generation-settings";

export type ComposerControl = {
  key: string;
  label: string;
  value: string;
  options: Array<{ value: string; label: string }>;
  onChange: (value: string) => void;
  disabled?: boolean;
};

export type ImageWorkspaceProps = {
  task: CommerceImageTask;
  busy: string;
  prompt: string;
  onPromptChange: (value: string) => void;
  onBack: () => void;
  onOpenHistory: () => void;
  onOpenSettings: () => void;
  /** 明确新建一个空白任务：只有点它才会新建，进入页面默认恢复最近任务。 */
  onNewTask: () => void;
  /** 查看这次生成真正用到的提示词（用户原话 + 最终发往模型的 Prompt）。 */
  onOpenPrompt: () => void;
  onOpenLearning: (panel?: CommerceImagePanel, version?: CommerceImageVersion) => void;
  onUploadAssets: (files: File[], role: CommerceImageAssetRole) => void;
  onRemoveAsset: (assetId: string) => void;
  onUploadDocuments: (files: File[]) => void;
  onRemoveDocument: (documentId: string) => void;
  /* ---- 产品资产：选择已有产品，自动带出图片与资料 ---- */
  selectedProduct: SelectedProductInfo | null;
  productModelLimit: number;
  onOpenProductPicker: () => void;
  onCreateProduct: () => void;
  onEditProduct: () => void;
  onDetachProduct: () => void;
  onProductImageMode: (mode: "all" | "selected") => void;
  onToggleProductImage: (imageId: string) => void;
  onSelectAllProductImages: () => void;
  onClearProductImages: () => void;
  onGenerate: () => void;
  onStop: () => void;
  generating: boolean;
  /** 生成请求正在提交（点完按钮到服务端受理之间），用于立刻显示进度。 */
  submitting: boolean;
  canGenerate: boolean;
  banner?: ReactNode;
  onDownload: (panel: CommerceImagePanel, version: CommerceImageVersion) => void;
  onRegenerate: (panelId: string) => void;
  /** 重试本次失败的画面（失败横幅上的「重试」）。 */
  onRetryFailed: () => void;
  onSelectVersion: (panel: CommerceImagePanel, versionId: string) => void;
  composerControls: ComposerControl[];
  composerHint: string;
  /** 生图设置（比例 / 分辨率 / 数量）——由底部组合控件统一修改。 */
  settings: GenerationSettingsValue;
  onSettingsChange: (next: GenerationSettingsValue) => void;
  settingsModel: CommerceImageModel;
};

export function WorkspaceFrame(props: {
  title: string;
  subtitle: string;
  onBack: () => void;
  onOpenHistory: () => void;
  onOpenSettings: () => void;
  onNewTask: () => void;
  onOpenPrompt: () => void;
  onOpenLearning: () => void;
  headerExtra?: ReactNode;
  children: ReactNode;
  composer: ReactNode;
}) {
  return (
    <div className="ig-root flex min-h-[calc(100dvh-56px)] flex-col lg:h-[calc(100dvh-56px)] lg:min-h-[620px]">
      <header className="flex shrink-0 flex-wrap items-center gap-3 pb-4">
        <button
          type="button"
          onClick={props.onBack}
          className="inline-flex items-center gap-1 rounded-lg px-1.5 py-1 text-[13px] text-ink-3 transition-colors duration-150 hover:bg-surface-2 hover:text-ink-1"
        >
          <ChevronLeft className="h-3.5 w-3.5" strokeWidth={2} />返回
        </button>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-[22px] font-medium tracking-[-0.015em] text-ink-1">{props.title}</h1>
          <p className="mt-0.5 truncate text-[12.5px] text-ink-3">{props.subtitle}</p>
        </div>
        {props.headerExtra}
        <div className="flex shrink-0 items-center gap-1">
          <HeaderButton label="查看生成提示词" onClick={props.onOpenPrompt}><FileText className="h-3.5 w-3.5" strokeWidth={1.8} />生成提示词</HeaderButton>
          <HeaderButton label="营销记录" onClick={props.onOpenLearning}><Database className="h-3.5 w-3.5" strokeWidth={1.8} />营销记录</HeaderButton>
          <HeaderButton label="历史记录" onClick={props.onOpenHistory}><History className="h-3.5 w-3.5" strokeWidth={1.8} />历史记录</HeaderButton>
          <HeaderButton label="模型设置" onClick={props.onOpenSettings}><Settings className="h-3.5 w-3.5" strokeWidth={1.8} />模型设置</HeaderButton>
          <button
            type="button"
            onClick={props.onNewTask}
            className="ml-1 inline-flex items-center gap-1.5 rounded-lg border border-line px-2.5 py-1.5 text-[12.5px] text-ink-2 transition-colors duration-150 hover:bg-surface-2 hover:text-ink-1"
          >
            <Plus className="h-3.5 w-3.5" strokeWidth={1.9} />新建
          </button>
        </div>
      </header>

      <div className="flex min-h-0 flex-1 flex-col gap-4 lg:flex-row">
        {props.children}
      </div>

      <div className="mt-4 shrink-0">{props.composer}</div>
    </div>
  );
}

function HeaderButton(props: { label: string; onClick: () => void; children: ReactNode }) {
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
