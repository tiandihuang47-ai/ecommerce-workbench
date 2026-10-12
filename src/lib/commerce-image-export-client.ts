"use client";

import type { CommerceImagePanel, CommerceImageTask } from "@/lib/commerce-image-types";

type ZipEntry = { name: string; bytes: Uint8Array };

export async function exportCommerceImageProject(task: CommerceImageTask) {
  const completed = task.panels.filter((panel) => selectedImageUrl(panel));
  if (!completed.length) throw new Error("还没有可导出的生成结果。 ");
  const rendered = await Promise.all(completed.map(async (panel, index) => ({
    panel,
    bytes: await renderPanelPng(panel),
    index
  })));
  const entries: ZipEntry[] = [];
  const folder = task.kind === "detail_page" ? "详情页切片" : task.kind === "retouch" ? "精修结果" : "发布图片";
  rendered.forEach(({ panel, bytes, index }) => {
    entries.push({ name: `${folder}/${String(index + 1).padStart(2, "0")}-${safeName(panel.title)}.png`, bytes });
  });
  if (task.kind === "detail_page") {
    entries.push({ name: "详情页长图.png", bytes: await renderLongImage(rendered.map((item) => item.bytes)) });
  }
  entries.push({ name: "项目说明.txt", bytes: textBytes(buildProjectText(task)) });
  if (task.kind === "douyin_post" || task.kind === "xiaohongshu_post") {
    entries.push({ name: "发布文案.txt", bytes: textBytes(buildPublishText(task)) });
  }
  entries.push({
    name: "manifest.json",
    bytes: textBytes(JSON.stringify({
      exportedAt: new Date().toISOString(),
      taskId: task.id,
      title: task.title,
      kind: task.kind,
      model: task.model,
      resolvedModelId: task.resolvedModelId,
      panelCount: completed.length
    }, null, 2))
  });
  const zip = createStoredZip(entries);
  downloadBlob(zip, `${safeName(task.title || "电商视觉项目")}.zip`, "application/zip");
}

export async function downloadCommerceImagePanel(task: CommerceImageTask, panel: CommerceImagePanel) {
  const bytes = await renderPanelPng(panel);
  downloadBlob(bytes, `${safeName(task.productName || task.title)}-${safeName(panel.title)}.png`, "image/png");
}

async function renderPanelPng(panel: CommerceImagePanel) {
  const selected = panel.versions.find((version) => version.id === panel.selectedVersionId) || panel.versions.at(-1);
  if (!selected?.imageUrl) throw new Error(`${panel.title}没有可导出的图片。`);
  const image = await loadImage(selected.imageUrl);
  const width = selected.width || image.naturalWidth;
  const height = selected.height || image.naturalHeight;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("当前浏览器不支持图片导出。 ");
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  drawFittedImage(context, image, width, height, panel.imageFit);
  if (panel.overlay.visible && (panel.overlay.title || panel.overlay.body)) drawOverlay(context, panel, width, height);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png", 1));
  if (!blob) throw new Error("图片导出失败。 ");
  return new Uint8Array(await blob.arrayBuffer());
}

async function renderLongImage(images: Uint8Array[]) {
  const loaded = await Promise.all(images.map((bytes) => loadImage(URL.createObjectURL(new Blob([Uint8Array.from(bytes).buffer], { type: "image/png" })))));
  try {
    const width = Math.max(...loaded.map((image) => image.naturalWidth));
    const heights = loaded.map((image) => Math.round(image.naturalHeight * width / image.naturalWidth));
    const height = heights.reduce((sum, item) => sum + item, 0);
    if (width > 8192 || height > 32767 || width * height > 120_000_000) throw new Error("详情页长图尺寸过大，请减少画面或分批导出。 ");
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("当前浏览器不支持长图导出。 ");
    let y = 0;
    loaded.forEach((image, index) => {
      context.drawImage(image, 0, y, width, heights[index]);
      y += heights[index];
    });
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png", 1));
    if (!blob) throw new Error("长图导出失败。 ");
    return new Uint8Array(await blob.arrayBuffer());
  } finally {
    loaded.forEach((image) => URL.revokeObjectURL(image.src));
  }
}

function drawFittedImage(context: CanvasRenderingContext2D, image: HTMLImageElement, width: number, height: number, fit: "cover" | "contain") {
  if (fit === "contain") {
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, width, height);
  }
  const scale = fit === "contain"
    ? Math.min(width / image.naturalWidth, height / image.naturalHeight)
    : Math.max(width / image.naturalWidth, height / image.naturalHeight);
  const drawWidth = image.naturalWidth * scale;
  const drawHeight = image.naturalHeight * scale;
  context.drawImage(image, (width - drawWidth) / 2, (height - drawHeight) / 2, drawWidth, drawHeight);
}

function drawOverlay(context: CanvasRenderingContext2D, panel: CommerceImagePanel, width: number, height: number) {
  const padding = Math.round(width * 0.075);
  const blockHeight = Math.round(height * 0.34);
  const atBottom = panel.overlay.position === "bottom";
  const y = atBottom ? height - blockHeight : 0;
  const gradient = context.createLinearGradient(0, y, 0, y + blockHeight);
  if (atBottom) {
    gradient.addColorStop(0, "rgba(0,0,0,0)");
    gradient.addColorStop(1, "rgba(0,0,0,0.72)");
  } else {
    gradient.addColorStop(0, "rgba(0,0,0,0.62)");
    gradient.addColorStop(1, "rgba(0,0,0,0)");
  }
  context.fillStyle = gradient;
  context.fillRect(0, y, width, blockHeight);
  const titleSize = Math.max(34, Math.round(width * 0.056));
  const bodySize = Math.max(22, Math.round(width * 0.03));
  const startY = atBottom ? height - padding - bodySize * 2.1 : padding + titleSize;
  context.textAlign = panel.overlay.align;
  context.textBaseline = "alphabetic";
  const x = panel.overlay.align === "center" ? width / 2 : padding;
  context.fillStyle = panel.overlay.textColor;
  context.font = `700 ${titleSize}px -apple-system, BlinkMacSystemFont, "PingFang SC", sans-serif`;
  const titleLines = wrapText(context, panel.overlay.title, width - padding * 2, 2);
  let cursor = startY;
  titleLines.forEach((line) => {
    context.fillText(line, x, cursor);
    cursor += titleSize * 1.18;
  });
  if (panel.overlay.body) {
    context.fillStyle = panel.overlay.accentColor || panel.overlay.textColor;
    context.font = `500 ${bodySize}px -apple-system, BlinkMacSystemFont, "PingFang SC", sans-serif`;
    wrapText(context, panel.overlay.body, width - padding * 2, 2).forEach((line) => {
      context.fillText(line, x, cursor + bodySize * 0.35);
      cursor += bodySize * 1.35;
    });
  }
}

function wrapText(context: CanvasRenderingContext2D, text: string, maxWidth: number, maxLines: number) {
  const lines: string[] = [];
  let line = "";
  for (const character of text.trim()) {
    const next = line + character;
    if (line && context.measureText(next).width > maxWidth) {
      lines.push(line);
      line = character;
      if (lines.length === maxLines) break;
    } else {
      line = next;
    }
  }
  if (line && lines.length < maxLines) lines.push(line);
  if (lines.length === maxLines && lines.join("").length < text.length) {
    lines[maxLines - 1] = `${lines[maxLines - 1].slice(0, -1)}…`;
  }
  return lines;
}

function selectedImageUrl(panel: CommerceImagePanel) {
  return panel.versions.find((version) => version.id === panel.selectedVersionId)?.imageUrl || panel.versions.at(-1)?.imageUrl || "";
}

async function loadImage(url: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("图片读取失败，请刷新后重试。"));
    image.src = url;
  });
}

function buildProjectText(task: CommerceImageTask) {
  return [
    `项目：${task.title}`,
    `商品：${task.productName || "未填写"}`,
    `任务：${task.kind}`,
    `模型：${task.resolvedModelId || task.model}`,
    `导出时间：${new Date().toLocaleString("zh-CN")}`,
    "",
    ...task.panels.map((panel, index) => `${index + 1}. ${panel.title}\n${panel.description}`),
    task.warnings.length ? `\n风险提醒：\n${task.warnings.map((item) => `- ${item}`).join("\n")}` : ""
  ].filter(Boolean).join("\n");
}

function buildPublishText(task: CommerceImageTask) {
  return [
    task.publishPackage.title,
    "",
    task.publishPackage.body,
    "",
    task.publishPackage.tags.map((tag) => `#${tag.replace(/^#/, "")}`).join(" "),
    task.publishPackage.complianceWarnings.length ? `\n发布前检查：\n${task.publishPackage.complianceWarnings.map((item) => `- ${item}`).join("\n")}` : ""
  ].filter(Boolean).join("\n");
}

function createStoredZip(entries: ZipEntry[]) {
  const localParts: Uint8Array[] = [];
  const centralParts: Uint8Array[] = [];
  let offset = 0;
  entries.forEach((entry) => {
    const name = textBytes(entry.name);
    const crc = crc32(entry.bytes);
    const { date, time } = dosDateTime(new Date());
    const local = concatBytes([
      uint32(0x04034b50), uint16(20), uint16(0x0800), uint16(0), uint16(time), uint16(date),
      uint32(crc), uint32(entry.bytes.length), uint32(entry.bytes.length), uint16(name.length), uint16(0), name, entry.bytes
    ]);
    localParts.push(local);
    centralParts.push(concatBytes([
      uint32(0x02014b50), uint16(20), uint16(20), uint16(0x0800), uint16(0), uint16(time), uint16(date),
      uint32(crc), uint32(entry.bytes.length), uint32(entry.bytes.length), uint16(name.length), uint16(0), uint16(0),
      uint16(0), uint16(0), uint32(0), uint32(offset), name
    ]));
    offset += local.length;
  });
  const local = concatBytes(localParts);
  const central = concatBytes(centralParts);
  const end = concatBytes([
    uint32(0x06054b50), uint16(0), uint16(0), uint16(entries.length), uint16(entries.length),
    uint32(central.length), uint32(local.length), uint16(0)
  ]);
  return concatBytes([local, central, end]);
}

function crc32(bytes: Uint8Array) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let index = 0; index < 8; index += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function uint16(value: number) {
  return new Uint8Array([value & 0xff, (value >>> 8) & 0xff]);
}

function uint32(value: number) {
  return new Uint8Array([value & 0xff, (value >>> 8) & 0xff, (value >>> 16) & 0xff, (value >>> 24) & 0xff]);
}

function concatBytes(parts: Uint8Array[]) {
  const result = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.length;
  }
  return result;
}

function textBytes(value: string) {
  return new TextEncoder().encode(value);
}

function dosDateTime(value: Date) {
  const year = Math.max(1980, value.getFullYear());
  return {
    date: ((year - 1980) << 9) | ((value.getMonth() + 1) << 5) | value.getDate(),
    time: (value.getHours() << 11) | (value.getMinutes() << 5) | Math.floor(value.getSeconds() / 2)
  };
}

function downloadBlob(value: BlobPart, name: string, type: string) {
  const url = URL.createObjectURL(new Blob([value], { type }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function safeName(value: string) {
  return value.replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_").trim().slice(0, 80) || "image";
}
