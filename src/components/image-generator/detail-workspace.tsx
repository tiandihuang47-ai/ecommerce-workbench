"use client";

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

export function CommerceDetailWorkspace(props: ImageWorkspaceProps) {
  const benchmarks = props.task.sourceAssets.filter((asset) => asset.role === "benchmark_reference" || asset.role === "reference_segment");
  const ownedAssets = props.task.sourceAssets.filter((asset) => ["front", "side", "back", "detail", "package", "on_body", "other"].includes(asset.role));

  return (
    <WorkspaceFrame
      title="对标详情图复刻"
      subtitle="保留对标图的版式与营销结构，把商品换成你自己的。"
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
        <PanelSection title="我的产品" requirement="必填" hint="选一个已有产品，商品图和产品资料会自动带过来。">
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

        <PanelSection title="对标详情图" requirement="必填" hint="上传你要复刻的详情长图或切片。">
          {benchmarks.length ? (
            <div className="space-y-2">
              {benchmarks.map((asset) => (
                <BenchmarkPreview key={asset.id} asset={asset} onRemove={props.onRemoveAsset} />
              ))}
              <UploadTile compact label="更换 / 继续添加" accept="image/*" multiple busy={props.busy === "upload:benchmark_reference"} onFiles={(files) => props.onUploadAssets(files, "benchmark_reference")} />
            </div>
          ) : (
            <UploadTile
              label="上传对标详情图"
              hint="PNG / JPG，支持长图"
              accept="image/*"
              multiple
              busy={props.busy === "upload:benchmark_reference"}
              onFiles={(files) => props.onUploadAssets(files, "benchmark_reference")}
            />
          )}
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
        placeholder="选好产品和本次参考图片，上传对标详情图，底部写下要求，然后点击生成图片。"
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
