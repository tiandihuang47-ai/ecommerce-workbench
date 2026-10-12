import sharp from "sharp";
import JSZip from "jszip";
import path from "node:path";
import { getCommerceImageTask, readCommerceImageAssetBytes } from "@/lib/commerce-image-store";
import type { CommerceImageTask } from "@/lib/commerce-image-types";
import {
  renderCompositionTextOverlay,
  renderCompositionShapeOverlay,
  getMissingGlyphs
} from "@/lib/commerce-image-v4-render";

/* ---------------------------------------------------------------------------
 * V4 export: composites image + text + shape layers into final PNG/ZIP.
 * Uses the selected artifact revision, not "latest image + current text".
 * ------------------------------------------------------------------------- */

export interface V4ExportResult {
  bytes: Uint8Array;
  mimeType: string;
  fileName: string;
}

/** Render a single V4 panel: base image + shape overlay + text overlay. */
export async function renderV4Panel(
  taskId: string,
  panelId: string,
  planId: string
): Promise<{ bytes: Uint8Array; width: number; height: number; warnings: string[] } | null> {
  const task = await getCommerceImageTask(taskId);
  if (!task) return null;
  const panel = task.panels.find((p) => p.id === panelId);
  if (!panel?.versions.length) return null;
  const version = panel.versions.find((v) => v.setId === planId) || panel.versions[panel.versions.length - 1];
  const asset = await readCommerceImageAssetBytes(taskId, version.assetId);
  if (!asset) return null;

  const creative = task.creative;
  const plan = creative?.plans.find((p) => p.id === planId) || creative?.plans[creative.plans.length - 1];
  const v4Panel = plan?.panels.find((p) => p.id === panelId);
  const layers = v4Panel?.composition.layers || [];
  const bg = v4Panel?.composition.background || "#ffffff";

  const image = sharp(asset.bytes, { failOn: "error" });
  const metadata = await image.metadata();
  const width = metadata.width || version.width;
  const height = metadata.height || version.height;
  if (!width || !height) throw new Error(`${panel.title}的图片尺寸不可用。`);

  const shapeSvg = renderCompositionShapeOverlay(layers as unknown as Record<string, unknown>[], width, height);
  const textSvg = renderCompositionTextOverlay(layers as unknown as Record<string, unknown>[], width, height);

  const composites: Array<{ input: Buffer }> = [];
  if (shapeSvg) composites.push({ input: Buffer.from(shapeSvg) });
  if (textSvg) composites.push({ input: Buffer.from(textSvg) });

  // Check for missing glyphs in text layers
  const warnings: string[] = [];
  for (const layer of layers) {
    if (layer.type === "text" && layer.visible !== false) {
      const missing = getMissingGlyphs(String(layer.text || ""), String(layer.fontFamily || "sans"));
      if (missing.length) warnings.push(`文字层缺少字形：${missing.join("")}`);
    }
  }

  const pngBuffer = composites.length
    ? await image.composite(composites).png().toBuffer()
    : await image.png().toBuffer();

  return { bytes: new Uint8Array(pngBuffer), width, height, warnings };
}

/** Export a single panel as PNG using the selected artifact revision. */
export async function exportV4PanelPng(options: {
  taskId: string;
  panelId: string;
  planId?: string;
}): Promise<V4ExportResult> {
  const task = await getCommerceImageTask(options.taskId);
  if (!task) throw new Error("生图项目不存在。");
  const creative = task.creative;
  const planId = options.planId || creative?.activePlanId || creative?.plans[0]?.id;
  if (!planId) throw new Error("没有可导出的创作方案。");
  const rendered = await renderV4Panel(options.taskId, options.panelId, planId);
  if (!rendered) throw new Error("所选页面还没有可导出的图片。");
  return {
    bytes: rendered.bytes,
    mimeType: "image/png",
    fileName: `${safeName(task.title)}-${panelIndex(task, options.panelId) + 1}.png`
  };
}

/** Export all panels as ZIP with publish copy and version manifest. */
export async function exportV4Zip(options: {
  taskId: string;
  planId?: string;
}): Promise<V4ExportResult> {
  const task = await getCommerceImageTask(options.taskId);
  if (!task) throw new Error("生图项目不存在。");
  const creative = task.creative;
  const plan = creative?.plans.find((p) => p.id === (options.planId || creative.activePlanId)) || creative?.plans[0];
  if (!plan) throw new Error("没有可导出的创作方案。");

  const zip = new JSZip();
  const rendered: Array<{ panelId: string; bytes: Uint8Array; index: number }> = [];
  const allWarnings: string[] = [];

  for (const panel of [...plan.panels].sort((a, b) => a.order - b.order)) {
    const result = await renderV4Panel(options.taskId, panel.id, plan.id);
    if (!result) continue;
    rendered.push({ panelId: panel.id, bytes: result.bytes, index: panel.order });
    allWarnings.push(...result.warnings);
  }
  if (!rendered.length) throw new Error("方案中还没有可导出的图片。");

  for (const item of rendered) {
    zip.file(`images/${String(item.index + 1).padStart(2, "0")}.png`, item.bytes);
  }

  // Publish copy if available
  if (task.publishPackage?.title) {
    zip.file("发布文案.md", [
      `# ${task.publishPackage.title}`,
      "",
      task.publishPackage.body,
      "",
      task.publishPackage.tags.map((t) => `#${t}`).join(" "),
      ...(task.publishPackage.complianceWarnings.length ? ["\n> 合规提醒：" + task.publishPackage.complianceWarnings.join("；")] : [])
    ].join("\n"));
  }

  // Version manifest
  zip.file("版本清单.json", JSON.stringify({
    schemaVersion: 4,
    workflowVersion: "conversation-v4",
    planId: plan.id,
    planRevision: plan.revision,
    intent: plan.intent,
    visualDirection: plan.visualDirection,
    panels: plan.panels.map((p) => ({ id: p.id, order: p.order, purpose: p.purpose, renderMode: p.renderMode })),
    artifactRevisions: creative?.artifacts || [],
    warnings: allWarnings,
    exportedAt: new Date().toISOString()
  }, null, 2));

  // Unverified quality notice
  if (allWarnings.length) {
    zip.file("未验证提示.txt", allWarnings.join("\n"));
  }

  zip.file("项目说明.md", [
    `# ${task.title}`,
    "",
    `创作需求：${plan.intent.request}`,
    `目标人群：${plan.intent.audienceHypothesis}`,
    `购买理由：${plan.intent.purchaseReason}`,
    `视觉方向：${plan.visualDirection.description}`,
    `张数：${plan.intent.count}（来源：${plan.intent.countSource === "user" ? "用户指定" : "AI 推荐"}）`,
    `比例：${plan.intent.ratio}`,
    "",
    ...(allWarnings.length ? ["> ⚠️ 未验证项：", ...allWarnings.map((w) => `- ${w}`)] : [])
  ].join("\n"));

  const buffer = await zip.generateAsync({ type: "uint8array", compression: "DEFLATE", compressionOptions: { level: 6 } });
  return { bytes: buffer, mimeType: "application/zip", fileName: `${safeName(task.title)}.zip` };
}

function panelIndex(task: CommerceImageTask, panelId: string) {
  return task.panels.findIndex((p) => p.id === panelId);
}
function safeName(value: string) {
  return value.replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_").slice(0, 120) || "image";
}
