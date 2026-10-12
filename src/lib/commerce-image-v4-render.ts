import * as fontkit from "fontkit";
import path from "node:path";
import { existsSync, statSync } from "node:fs";
import { createHash } from "node:crypto";
import type { TTFFont } from "fontkit";

/* ---------------------------------------------------------------------------
 * V4 composition renderer
 *
 * Uses fontkit for real text measurement (glyph widths, line breaking)
 * instead of character-count estimation.
 * Shared between preview and export via SVG generation consumed by Sharp.
 * ------------------------------------------------------------------------- */

/** 字体不可用：不允许用“字符数估算”伪装排版成功，必须显式报错。 */
export class FontUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FontUnavailableError";
  }
}

/* Font resolution: bundled fonts → system fonts → error */

interface FontSource {
  fontFamily: "sans" | "serif" | "rounded";
  label: string;
  /** Candidate file paths in priority order. */
  candidates: string[];
  /** Resolved fontkit font instance (lazily loaded). */
  font: TTFFont | null;
  loaded: boolean;
  sourcePath: string;
  hash: string;
}

let bundledFontDir = path.resolve(process.cwd(), "assets", "fonts");
function bundledPath(fileName: string) { return path.join(bundledFontDir, fileName); }

const FONT_REGISTRY: Record<string, FontSource> = {
  sans: {
    fontFamily: "sans", label: "黑体", font: null, loaded: false, sourcePath: "", hash: "",
    candidates: [
      bundledPath("NotoSansSC-Regular.otf"),
      "/System/Library/Fonts/STHeiti Medium.ttc:0",
      "/System/Library/Fonts/PingFang.ttc:0",
      "C:/Windows/Fonts/msyh.ttc:0",
      "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc:0"
    ]
  },
  serif: {
    fontFamily: "serif", label: "宋体", font: null, loaded: false, sourcePath: "", hash: "",
    candidates: [
      bundledPath("NotoSerifSC-Regular.otf"),
      "/System/Library/Fonts/Supplemental/Songti.ttc:4",
      "/System/Library/Fonts/Supplemental/Songti.ttc:0",
      "C:/Windows/Fonts/simsun.ttc:0",
      "/usr/share/fonts/opentype/noto/NotoSerifCJK-Regular.ttc:0"
    ]
  },
  rounded: {
    fontFamily: "rounded", label: "圆体", font: null, loaded: false, sourcePath: "",
    hash: "",
    candidates: [
      bundledPath("NotoSansSC-Regular.otf"),
      "/System/Library/Fonts/STHeiti Medium.ttc:0",
      "/System/Library/Fonts/PingFang.ttc:0",
      "C:/Windows/Fonts/msyh.ttc:0"
    ]
  }
};

export function setFontDirectory(dir: string) {
  bundledFontDir = dir;
  for (const key of Object.keys(FONT_REGISTRY)) {
    FONT_REGISTRY[key].font = null;
    FONT_REGISTRY[key].loaded = false;
    FONT_REGISTRY[key].sourcePath = "";
    FONT_REGISTRY[key].hash = "";
  }
  FONT_REGISTRY.sans.candidates[0] = path.join(dir, "NotoSansSC-Regular.otf");
  FONT_REGISTRY.serif.candidates[0] = path.join(dir, "NotoSerifSC-Regular.otf");
  FONT_REGISTRY.rounded.candidates[0] = path.join(dir, "NotoSansSC-Regular.otf");
}

export function loadFont(key: string): TTFFont | null {
  const entry = FONT_REGISTRY[key] || FONT_REGISTRY.sans;
  if (entry.loaded) return entry.font;

  for (const candidate of entry.candidates) {
    const [filePath, indexStr] = candidate.split(":");
    const index = indexStr ? parseInt(indexStr, 10) : 0;
    try {
      if (!existsSync(filePath)) continue;
      // 缓存标识包含文件内容特征（大小 + 修改时间）：同路径换字体文件也能正确失效缓存
      const stat = statSync(filePath);
      const fingerprint = `${filePath}:${stat.size}:${Math.round(stat.mtimeMs)}`;
      const opened = fontkit.openSync(filePath);
      // TTC collections expose .fonts array
      if ("fonts" in opened && Array.isArray((opened as unknown as { fonts: unknown[] }).fonts)) {
        const collection = opened as unknown as { fonts: TTFFont[] };
        const font = collection.fonts[index] || collection.fonts[0];
        if (font) {
          entry.font = font;
          entry.loaded = true;
          entry.sourcePath = `${filePath}:${index}`;
          entry.hash = createHash("sha256").update(fingerprint).digest("hex").slice(0, 16);
          return entry.font;
        }
      } else if (opened && typeof (opened as TTFFont).layout === "function") {
        entry.font = opened as TTFFont;
        entry.loaded = true;
        entry.sourcePath = filePath;
        entry.hash = createHash("sha256").update(fingerprint).digest("hex").slice(0, 16);
        return entry.font;
      }
    } catch { continue; }
  }
  entry.loaded = true; // mark as attempted to avoid repeated I/O
  entry.font = null;
  return null;
}

export function getFontStatus(): Record<string, { available: boolean; source: string; label: string }> {
  return Object.fromEntries(
    Object.entries(FONT_REGISTRY).map(([key, entry]) => {
      const font = loadFont(key);
      return [key, { available: Boolean(font), source: entry.sourcePath || "未找到", label: entry.label }];
    })
  );
}

/* Text measurement and wrapping */

export function measureText(text: string, fontFamily: string, fontSizePx: number): number {
  const font = loadFont(fontFamily);
  if (!font) {
    throw new FontUnavailableError(
      `排版字体不可用（${fontFamily}）：本机既没有内置字体 assets/fonts/，也没有可用系统字体。请把 Noto Sans/Serif SC 的 OTF 文件放回 assets/fonts/ 后重试，导出已中止，不会生成排版可能错乱的图片。`
    );
  }
  const run = font.layout(text);
  return run.advanceWidth / font.unitsPerEm * fontSizePx;
}

export function wrapText(
  text: string,
  fontFamily: string,
  fontSizePx: number,
  maxWidthPx: number,
  lineHeight: number
): { lines: string[]; totalHeightPx: number; overflow: boolean; missingGlyphs: string[] } {
  const font = loadFont(fontFamily);
  if (!font) {
    throw new FontUnavailableError(
      `排版字体不可用（${fontFamily}）：请恢复 assets/fonts/ 下的内置字体后重试。`
    );
  }
  const lines: string[] = [];
  const missingGlyphs: string[] = [];

  for (const paragraph of text.split("\n")) {
    if (!paragraph) { lines.push(""); continue; }
    let currentLine = "";
    for (const char of paragraph) {
      if (font) {
        const cp = char.codePointAt(0) || 0;
        if (!font.hasGlyphForCodePoint(cp)) {
          if (!missingGlyphs.includes(char)) missingGlyphs.push(char);
        }
      }
      const candidate = currentLine + char;
      if (measureText(candidate, fontFamily, fontSizePx) > maxWidthPx && currentLine) {
        lines.push(currentLine);
        currentLine = char;
      } else {
        currentLine = candidate;
      }
    }
    lines.push(currentLine);
  }

  const lineHeightPx = fontSizePx * lineHeight;
  const totalHeightPx = lines.length * lineHeightPx;
  return { lines, totalHeightPx, overflow: false, missingGlyphs };
}

/* SVG rendering shared between preview and export */

export function renderTextLayerSvg(
  text: string,
  fontFamily: string,
  fontSizePx: number,
  fontWeight: number,
  lineHeight: number,
  align: "left" | "center" | "right",
  color: string,
  backgroundColor: string,
  backgroundOpacity: number,
  regionPx: { x: number; y: number; width: number; height: number }
): string {
  const { lines, totalHeightPx, missingGlyphs } = wrapText(text, fontFamily, fontSizePx, regionPx.width, lineHeight);
  void missingGlyphs;
  const lineHeightPx = fontSizePx * lineHeight;
  const fontWeightStr = fontWeight >= 700 ? "bold" : fontWeight >= 500 ? "600" : "normal";
  const anchor = align === "center" ? "middle" : align === "right" ? "end" : "start";
  const textX = align === "center"
    ? regionPx.x + regionPx.width / 2
    : align === "right" ? regionPx.x + regionPx.width : regionPx.x;

  const label = FONT_REGISTRY[fontFamily]?.label || "黑体";
  // 优先使用实际加载到的字体族名（内置 Noto），让 sharp/librsvg 按同一套字体渲染；
  // 找不到时回退到常用 CJK 字体名。
  const loadedFont = loadFont(fontFamily);
  const familyName = (loadedFont as unknown as { familyName?: string } | null)?.familyName || label;
  let tspanY = regionPx.y + fontSizePx * 0.86;
  const tspans = lines.map((line) => {
    const y = tspanY;
    tspanY += lineHeightPx;
    return `<tspan x="${textX.toFixed(1)}" y="${y.toFixed(1)}">${escapeXml(line)}</tspan>`;
  }).join("\n    ");

  const bgHeight = Math.max(totalHeightPx + fontSizePx * 0.3, regionPx.height);
  const bgRect = backgroundOpacity > 0
    ? `<rect x="${regionPx.x.toFixed(1)}" y="${regionPx.y.toFixed(1)}" width="${regionPx.width.toFixed(1)}" height="${bgHeight.toFixed(1)}" fill="${backgroundColor}" fill-opacity="${backgroundOpacity.toFixed(2)}" rx="${(fontSizePx * 0.15).toFixed(1)}"/>`
    : "";

  return `${bgRect}\n  <text font-family="'${escapeXml(familyName)}', '${label}', 'Noto Sans CJK SC', 'Noto Sans SC', sans-serif" font-size="${fontSizePx.toFixed(1)}" font-weight="${fontWeightStr}" fill="${color}" text-anchor="${anchor}" dominant-baseline="text-before-edge">\n    ${tspans}\n  </text>`;
}

/** Render non-text (shape) layers as SVG primitives. */
export function renderShapeLayerSvg(layer: Record<string, unknown>, canvasWidth: number, canvasHeight: number): string {
  const x = Math.round(Number(layer.x || 0) * canvasWidth);
  const y = Math.round(Number(layer.y || 0) * canvasHeight);
  const w = Math.round(Number(layer.width || 0) * canvasWidth);
  const h = Math.round(Number(layer.height || 0) * canvasHeight);
  if (layer.visible === false) return "";
  const fill = String(layer.fill || "#cccccc");
  const stroke = String(layer.stroke || "#000000");
  const sw = Number(layer.strokeWidth || 0) * canvasWidth;

  if (layer.shape === "rectangle") {
    return `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${fill}" stroke="${stroke}" stroke-width="${sw.toFixed(1)}"/>`;
  }
  if (layer.shape === "ellipse") {
    return `<ellipse cx="${(x + w / 2).toFixed(1)}" cy="${(y + h / 2).toFixed(1)}" rx="${(w / 2).toFixed(1)}" ry="${(h / 2).toFixed(1)}" fill="${fill}" stroke="${stroke}" stroke-width="${sw.toFixed(1)}"/>`;
  }
  if (layer.shape === "line") {
    return `<line x1="${x}" y1="${(y + h / 2).toFixed(1)}" x2="${x + w}" y2="${(y + h / 2).toFixed(1)}" stroke="${stroke}" stroke-width="${Math.max(1, sw).toFixed(1)}"/>`;
  }
  return "";
}

/** Render text layers of a composition as SVG overlay for Sharp composite. */
export function renderCompositionTextOverlay(
  layers: Array<Record<string, unknown>>,
  canvasWidth: number,
  canvasHeight: number
): string {
  const parts: string[] = [];
  for (const layer of layers) {
    if (layer.visible === false || layer.type !== "text") continue;
    const x = Math.round(Number(layer.x || 0) * canvasWidth);
    const y = Math.round(Number(layer.y || 0) * canvasHeight);
    const w = Math.round(Number(layer.width || 0) * canvasWidth);
    const h = Math.round(Number(layer.height || 0) * canvasHeight);
    const fontSizePx = Number(layer.fontSize || 0.05) * canvasWidth;
    if (fontSizePx < 1) continue;
    const svg = renderTextLayerSvg(
      String(layer.text || ""),
      String(layer.fontFamily || "sans"),
      fontSizePx,
      Number(layer.fontWeight || 700),
      Number(layer.lineHeight || 1.3),
      (layer.align as "left" | "center" | "right") || "left",
      String(layer.color || "#ffffff"),
      String(layer.backgroundColor || "#000000"),
      Number(layer.backgroundOpacity || 0),
      { x, y, width: w, height: h }
    );
    if (svg) parts.push(svg);
  }
  if (!parts.length) return "";
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${canvasWidth}" height="${canvasHeight}">\n  ${parts.join("\n  ")}\n</svg>`;
}

/** Render shape layers as SVG overlay. */
export function renderCompositionShapeOverlay(
  layers: Array<Record<string, unknown>>,
  canvasWidth: number,
  canvasHeight: number
): string {
  const parts: string[] = [];
  for (const layer of layers) {
    if (layer.type === "shape" && layer.visible !== false) {
      const svg = renderShapeLayerSvg(layer, canvasWidth, canvasHeight);
      if (svg) parts.push(svg);
    }
  }
  if (!parts.length) return "";
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${canvasWidth}" height="${canvasHeight}">\n  ${parts.join("\n  ")}\n</svg>`;
}

export function getFontHash(fontFamily: string): string {
  const entry = FONT_REGISTRY[fontFamily];
  if (entry?.hash) return entry.hash;
  loadFont(fontFamily);
  return FONT_REGISTRY[fontFamily]?.hash || "no-font";
}

export function getMissingGlyphs(text: string, fontFamily: string): string[] {
  const font = loadFont(fontFamily);
  if (!font) return [];
  const missing: string[] = [];
  for (const char of text) {
    const cp = char.codePointAt(0) || 0;
    if (cp > 0x20 && !font.hasGlyphForCodePoint(cp) && !missing.includes(char)) missing.push(char);
  }
  return missing;
}

export function getRenderCacheKey(
  text: string, fontFamily: string, fontSize: number, fontWeight: number,
  region: { x: number; y: number; width: number; height: number },
  lineHeight: number, align: string
): string {
  const fontHash = getFontHash(fontFamily);
  return createHash("sha256").update(
    [text, fontFamily, fontHash, fontSize, fontWeight, region.x, region.y, region.width, region.height, lineHeight, align, "v4-r1"].join("\0")
  ).digest("hex");
}

function escapeXml(value: string) {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}
