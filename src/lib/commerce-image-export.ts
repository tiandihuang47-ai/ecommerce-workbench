import JSZip from "jszip";
import sharp from "sharp";
import { getCommerceImageTask, readCommerceImageAssetBytes } from "@/lib/commerce-image-store";
import type { CommerceImagePanel, CommerceImageTask, CommerceImageTextLayer } from "@/lib/commerce-image-types";

export interface CommerceImageExportResult {
  bytes: Uint8Array;
  mimeType: string;
  fileName: string;
}

export async function exportCommerceImageTask(options: {
  taskId: string;
  setId?: string;
  format?: "zip" | "long" | "panel";
  panelId?: string;
}): Promise<CommerceImageExportResult> {
  const task = await getCommerceImageTask(options.taskId);
  if (!task) throw new Error("生图项目不存在。");
  const setId = resolveSetId(task, options.setId);
  const format = options.format || "zip";
  const rendered = await renderTaskPanels(task, setId);
  if (!rendered.length) throw new Error("所选方案还没有可导出的图片。");
  if (format === "panel") {
    const panel = rendered.find((item) => item.panel.id === options.panelId) || rendered[0];
    return { bytes: panel.bytes, mimeType: "image/png", fileName: `${safeName(panel.panel.title)}.png` };
  }
  if (format === "long") {
    const bytes = await stitchRenderedPanels(rendered.map((item) => item.bytes));
    return { bytes, mimeType: "image/png", fileName: `${safeName(task.title)}-${setLabel(task, setId)}.png` };
  }

  const zip = new JSZip();
  const folder = task.kind === "detail_page" ? "modules" : "images";
  rendered.forEach((item, index) => {
    zip.file(`${folder}/${String(index + 1).padStart(2, "0")}-${safeName(item.panel.title)}.png`, item.bytes);
  });
  if (task.kind === "detail_page") {
    zip.file("detail-page.png", await stitchRenderedPanels(rendered.map((item) => item.bytes)));
  }
  if (task.kind === "douyin_post" || task.kind === "xiaohongshu_post") {
    zip.file("发布文案.md", publishMarkdown(task));
  }
  zip.file("项目说明.md", projectReadme(task, setId, rendered.length));
  zip.file("版本清单.json", JSON.stringify(versionManifest(task, setId), null, 2));
  const buffer = await zip.generateAsync({ type: "uint8array", compression: "DEFLATE", compressionOptions: { level: 6 } });
  return { bytes: buffer, mimeType: "application/zip", fileName: `${safeName(task.title)}-${setLabel(task, setId)}.zip` };
}

export async function renderCommerceImagePanel(task: CommerceImageTask, panel: CommerceImagePanel, setId: string) {
  const version = [...panel.versions].reverse().find((item) => item.setId === setId)
    || (setId === "legacy" ? panel.versions.find((item) => item.id === panel.selectedVersionId) : undefined);
  if (!version) return null;
  const asset = await readCommerceImageAssetBytes(task.id, version.assetId);
  if (!asset) return null;
  const image = sharp(asset.bytes, { failOn: "error" });
  const metadata = await image.metadata();
  const width = metadata.width || version.width;
  const height = metadata.height || version.height;
  if (!width || !height) throw new Error(`${panel.title}的图片尺寸不可用。`);
  const overlays = panel.textLayers
    .filter((layer) => layer.visible && layer.text.trim())
    .map((layer) => ({ input: Buffer.from(textLayerSvg(layer, width, height)) }));
  const bytes = new Uint8Array(await image.composite(overlays).png().toBuffer());
  return { panel, version, bytes, width, height };
}

async function renderTaskPanels(task: CommerceImageTask, setId: string) {
  const output: Array<NonNullable<Awaited<ReturnType<typeof renderCommerceImagePanel>>>> = [];
  for (const panel of [...task.panels].sort((a, b) => (a.order || 0) - (b.order || 0))) {
    const rendered = await renderCommerceImagePanel(task, panel, setId);
    if (rendered) output.push(rendered);
  }
  return output;
}

async function stitchRenderedPanels(images: Uint8Array[]) {
  const metadata = await Promise.all(images.map((bytes) => sharp(bytes).metadata()));
  const width = Math.max(...metadata.map((item) => item.width || 0));
  if (!width) throw new Error("无法读取导出图片尺寸。");
  const normalized: Array<{ input: Buffer; top: number; left: number }> = [];
  let top = 0;
  for (const [index, bytes] of images.entries()) {
    const info = metadata[index];
    const originalWidth = info.width || width;
    const buffer = originalWidth === width
      ? Buffer.from(bytes)
      : await sharp(bytes).resize({ width }).png().toBuffer();
    const resized = await sharp(buffer).metadata();
    normalized.push({ input: buffer, top, left: 0 });
    top += resized.height || info.height || 0;
  }
  if (!top) throw new Error("无法计算长图高度。");
  return new Uint8Array(await sharp({
    create: { width, height: top, channels: 4, background: { r: 255, g: 255, b: 255, alpha: 1 } }
  }).composite(normalized).png().toBuffer());
}

function textLayerSvg(layer: CommerceImageTextLayer, canvasWidth: number, canvasHeight: number) {
  const x = Math.round(layer.x * canvasWidth);
  const y = Math.round(layer.y * canvasHeight);
  const width = Math.max(1, Math.round(layer.width * canvasWidth));
  const height = Math.max(1, Math.round(layer.height * canvasHeight));
  const fontSize = Math.max(12, Math.round(layer.fontSize * canvasWidth));
  const lineHeight = Math.round(fontSize * layer.lineHeight);
  const charactersPerLine = Math.max(1, Math.floor(width / Math.max(1, fontSize * 0.92)));
  const lines = wrapText(layer.text, charactersPerLine).slice(0, Math.max(1, Math.floor(height / lineHeight)));
  const anchor = layer.align === "center" ? "middle" : layer.align === "right" ? "end" : "start";
  const textX = layer.align === "center" ? x + width / 2 : layer.align === "right" ? x + width : x;
  const family = layer.fontFamily === "serif" ? "Songti SC, Noto Serif CJK SC, serif" : layer.fontFamily === "rounded" ? "PingFang SC, Arial Rounded MT Bold, sans-serif" : "PingFang SC, Noto Sans CJK SC, sans-serif";
  const background = layer.backgroundOpacity > 0
    ? `<rect x="${x}" y="${y}" width="${width}" height="${height}" rx="${Math.round(fontSize * 0.18)}" fill="${xml(layer.backgroundColor)}" fill-opacity="${layer.backgroundOpacity}"/>`
    : "";
  const tspans = lines.map((line, index) => `<tspan x="${textX}" dy="${index === 0 ? fontSize : lineHeight}">${xml(line)}</tspan>`).join("");
  return `<svg width="${canvasWidth}" height="${canvasHeight}" xmlns="http://www.w3.org/2000/svg">
    ${background}
    <text x="${textX}" y="${y}" fill="${xml(layer.color)}" font-family="${xml(family)}" font-size="${fontSize}" font-weight="${layer.fontWeight}" text-anchor="${anchor}">${tspans}</text>
  </svg>`;
}

function wrapText(text: string, limit: number) {
  const lines: string[] = [];
  for (const paragraph of text.split(/\r?\n/)) {
    if (!paragraph) {
      lines.push("");
      continue;
    }
    let current = "";
    for (const character of [...paragraph]) {
      current += character;
      if ([...current].length >= limit) {
        lines.push(current);
        current = "";
      }
    }
    if (current) lines.push(current);
  }
  return lines;
}

function resolveSetId(task: CommerceImageTask, requested?: string) {
  if (requested && (requested === "legacy" || task.generationSets.some((set) => set.id === requested))) return requested;
  if (task.selectedSetId) return task.selectedSetId;
  return task.generationSets[0]?.id || "legacy";
}

function setLabel(task: CommerceImageTask, setId: string) {
  return safeName(task.generationSets.find((set) => set.id === setId)?.label || "当前方案");
}

function publishMarkdown(task: CommerceImageTask) {
  return [
    `# ${task.publishPackage.title || task.title}`,
    "",
    task.publishPackage.body,
    "",
    task.publishPackage.tags.map((tag) => `#${tag.replace(/^#/, "")}`).join(" "),
    "",
    "## 发布前合规提醒",
    ...task.publishPackage.complianceWarnings.map((item) => `- ${item}`)
  ].join("\n");
}

function projectReadme(task: CommerceImageTask, setId: string, imageCount: number) {
  return [
    `# ${task.title}`,
    "",
    `- 场景：${task.kind}`,
    `- 方案：${task.generationSets.find((set) => set.id === setId)?.label || "历史方案"}`,
    `- 图片数：${imageCount}`,
    `- 比例：${task.ratio}`,
    `- 逻辑模型：${task.resolvedModelId || task.model}`,
    `- 导出时间：${new Date().toISOString()}`,
    "",
    "底图由生图模型生成，文字为独立图层合成。请在发布前复核商品事实、品牌信息和平台合规要求。"
  ].join("\n");
}

function versionManifest(task: CommerceImageTask, setId: string) {
  return {
    schemaVersion: task.schemaVersion,
    taskId: task.id,
    setId,
    planRevision: task.planRevision,
    approvedPlanRevision: task.approvedPlanRevision,
    panels: task.panels.map((panel) => ({
      panelId: panel.id,
      title: panel.title,
      order: panel.order,
      textLayers: panel.textLayers,
      versions: panel.versions.filter((version) => version.setId === setId).map((version) => ({
        id: version.id,
        modelId: version.modelId,
        providerModelId: version.providerModelId,
        width: version.width,
        height: version.height,
        prompt: version.prompt,
        createdAt: version.createdAt
      }))
    }))
  };
}

function safeName(value: string) {
  return value.replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_").trim().slice(0, 80) || "commerce-image";
}

function xml(value: string) {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}
