"use client";

import { Link2 } from "lucide-react";
import { ImageWorkspaceProps, WorkspaceFrame } from "@/components/image-generator/workspace-frame";
import { CreationComposer } from "@/components/image-generator/creation-composer";
import { GenerationCanvas } from "@/components/image-generator/generation-canvas";
import { ProductReferencePicker, ProductSummaryCard } from "@/components/image-generator/product-selection";
import {
  BenchmarkPreview,
  MaterialPanel,
  PanelSection,
  ThumbStrip,
  UploadTile
} from "@/components/image-generator/material-panel";

export type SocialGoal = "traffic" | "conversion";

export function SocialCommerceWorkspace(props: ImageWorkspaceProps & {
  referenceLink: string;
  onReferenceLinkChange: (value: string) => void;
  onSaveReferenceLink: () => void;
}) {
  const ownedAssets = props.task.sourceAssets.filter((asset) => ["front", "side", "back", "detail", "package", "on_body", "other"].includes(asset.role));
  const reference = props.task.sourceAssets.find((asset) => asset.role === "benchmark_reference");

  return (
    <WorkspaceFrame
      title="电商图文"
      subtitle="上传或选择参考图，写下你想要什么，直连 Image 2.5 出图。"
      onBack={props.onBack}
      onOpenHistory={props.onOpenHistory}
      onOpenSettings={props.onOpenSettings}
      onNewTask={props.onNewTask}
      onOpenPrompt={props.onOpenPrompt}
      onOpenLearning={() => props.onOpenLearning()}
      composer={
        <CreationComposer
          value={props.prompt}
          onChange={props.onPromptChange}
          onGenerate={props.onGenerate}
          onStop={props.onStop}
          generating={props.generating}
          canGenerate={props.canGenerate}
          hint={props.composerHint}
          onOpenPrompt={props.onOpenPrompt}
          showPromptEntry
          controls={props.composerControls}
          settings={props.settings}
          onSettingsChange={props.onSettingsChange}
          settingsModel={controlsModel(props.composerControls, props.settings)}
        />
      }
    >
      <MaterialPanel>
        <PanelSection title="我的产品" requirement="必填" hint="选一个已有产品，商品图和产品资料会自动带过来，不用每次重新上传。">
          <ProductSummaryCard
            product={props.selectedProduct}
            busy={Boolean(props.busy)}
            onPick={props.onOpenProductPicker}
            onCreate={props.onCreateProduct}
            onEdit={props.onEditProduct}
            onDetach={props.onDetachProduct}
          />
        </PanelSection>

        {props.selectedProduct ? (
          <PanelSection title="本次参考图片" hint={`产品里共 ${props.selectedProduct.imageCount} 张，决定这次给 AI 看哪些。`}>
            <ProductReferencePicker
              product={props.selectedProduct}
              modelLimit={props.productModelLimit}
              onMode={props.onProductImageMode}
              onToggle={props.onToggleProductImage}
              onSelectAll={props.onSelectAllProductImages}
              onClear={props.onClearProductImages}
              busy={Boolean(props.busy)}
            />
          </PanelSection>
        ) : ownedAssets.length ? (
          <PanelSection title="本次参考图片" hint="也可以先临时上传几张，稍后再归属到产品。">
            <div className="space-y-2">
              <ThumbStrip assets={ownedAssets} onRemove={props.onRemoveAsset} />
              <UploadTile compact label="继续添加商品图" accept="image/*" multiple busy={props.busy === "upload:front"} onFiles={(files) => props.onUploadAssets(files, "front")} />
            </div>
          </PanelSection>
        ) : null}

        <PanelSection title="对标内容" requirement="可选" hint="上传对标图，或粘贴内容链接作为辅助参考。">
          <div className="space-y-2">
            {reference ? (
              <BenchmarkPreview asset={reference} onRemove={props.onRemoveAsset} />
            ) : (
              <UploadTile compact label="上传参考图" accept="image/*" multiple busy={props.busy === "upload:benchmark_reference"} onFiles={(files) => props.onUploadAssets(files, "benchmark_reference")} />
            )}
            <div className="flex items-center gap-2 rounded-lg border border-line bg-surface-2 px-2.5 py-1.5">
              <Link2 className="h-3.5 w-3.5 shrink-0 text-ink-3" strokeWidth={1.8} />
              <input
                value={props.referenceLink}
                onChange={(event) => props.onReferenceLinkChange(event.target.value)}
                placeholder="粘贴内容链接（可选）"
                className="min-w-0 flex-1 bg-transparent text-[12.5px] text-ink-1 placeholder:text-ink-3 focus:outline-none"
              />
              <button
                type="button"
                disabled={!props.referenceLink.trim()}
                onClick={props.onSaveReferenceLink}
                className="shrink-0 rounded-md border border-line px-2 py-0.5 text-[11.5px] text-ink-2 transition-colors duration-150 hover:bg-surface hover:text-ink-1 disabled:opacity-40"
              >
                保存链接
              </button>
            </div>
            <p className="text-[11.5px] leading-5 text-ink-3">链接内容解析尚未接入，保存后会作为创作参考文本参与理解，不会伪造解析结果。</p>
          </div>
        </PanelSection>

        <PanelSection title="产品资料">
          <p className="rounded-lg border border-line bg-surface-2 px-2.5 py-2 text-[11.5px] leading-5 text-ink-3">
            {props.selectedProduct
              ? props.selectedProduct.hasDocument
                ? `已引用当前产品资料：${props.selectedProduct.documentName}。生成时自动使用，不需要在这里重复上传。`
                : "当前产品还没有产品资料；可以到「产品资料」里补一份，AI 就能引用真实卖点。"
              : "选择产品后会自动引用该产品的产品资料。"}
          </p>
        </PanelSection>
      </MaterialPanel>

      <GenerationCanvas
        task={props.task}
        busy={props.busy}
        submitting={props.submitting}
        onDownload={props.onDownload}
        onRegenerate={props.onRegenerate}
        onRetryFailed={props.onRetryFailed}
        onSelectVersion={props.onSelectVersion}
        onOpenLearning={(panel, version) => props.onOpenLearning(panel, version)}
        placeholder="左侧选择产品和本次参考图片，底部写下想怎么做，然后点击生成图片。"
        banner={props.banner}
      />
    </WorkspaceFrame>
  );
}

/** 组合设置控件需要知道当前模型，才能显示「真实请求像素」。 */
function controlsModel(controls: ImageWorkspaceProps["composerControls"], settings: ImageWorkspaceProps["settings"]) {
  const model = controls.find((control) => control.key === "model")?.value;
  return (model || "gpt-image-2.5") as ImageWorkspaceProps["settingsModel"];
}
