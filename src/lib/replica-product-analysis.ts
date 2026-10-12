import { execFile } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import mammoth from "mammoth";
import { callReplicaVisionJson, type ReplicaVisionContent } from "@/lib/replica-ai";
import { getReplicaConfig } from "@/lib/replica-config";
import { replicaSchemaVersion, type ReplicaProductUnderstanding } from "@/lib/replica-types";

const execFileAsync = promisify(execFile);

export interface ReplicaProductImageInput {
  name: string;
  type: string;
  buffer: Uint8Array;
}

export async function extractReplicaDocumentText(file: { name: string; type: string; buffer: Uint8Array }) {
  const extension = path.extname(file.name).toLowerCase();
  if (extension === ".txt" || extension === ".md" || extension === ".markdown") {
    return Buffer.from(file.buffer).toString("utf8").slice(0, 80000);
  }
  if (extension === ".docx" || extension === ".doc") {
    try {
      const result = await mammoth.extractRawText({ buffer: Buffer.from(file.buffer) });
      return result.value.trim().slice(0, 80000);
    } catch (docxError) {
      if (extension === ".doc") {
        // .doc is the old binary format; try extracting readable text
        const text = extractTextFromBinaryDoc(Buffer.from(file.buffer));
        if (text.trim()) return text.slice(0, 80000);
        throw new Error("无法读取 .doc 文件内容，请用 Word 另存为 .docx 格式后重新上传。");
      }
      throw new Error(`Word 文档读取失败：${docxError instanceof Error ? docxError.message.slice(0, 200) : "未知错误"}`);
    }
  }
  if (extension === ".pdf") {
    const tempPath = path.join(os.tmpdir(), `replica-doc-${Date.now()}-${Math.random().toString(36).slice(2)}.pdf`);
    try {
      await writeFile(tempPath, file.buffer);
      const result = await execFileAsync("pdftotext", ["-layout", tempPath, "-"], { timeout: 120000, maxBuffer: 1024 * 1024 * 4 });
      return result.stdout.trim().slice(0, 80000);
    } catch {
      throw new Error("暂时无法读取 PDF 产品文档，请另存为标准 DOCX 或 TXT 后再添加。");
    }
  }
  throw new Error("产品文档支持 Word（.docx / .doc）、Markdown 或 TXT。");
}


function extractTextFromBinaryDoc(buffer: Buffer): string {
  // Extract readable ASCII/UTF-8 text from .doc binary format
  const text = buffer.toString("utf8");
  // Remove non-printable characters, keep Chinese + ASCII + common punctuation
  const cleaned = text
    .replace(/[\x00-\x08\x0e-\x1f\x7f]/g, " ")
    .replace(/\s{3,}/g, "\n")
    .trim();
  // Only return if we got meaningful text (> 20 chars after cleanup)
  return cleaned.length > 20 ? cleaned : "";
}

export async function analyzeReplicaProduct(options: {
  images: ReplicaProductImageInput[];
  documentText: string;
}): Promise<ReplicaProductUnderstanding> {
  const config = getReplicaConfig();
  const images = options.images.slice(0, config.maxProductImages);
  if (!images.length) throw new Error("请至少上传一张产品图片，才能建立产品替换约束。");
  const content: ReplicaVisionContent[] = [{
    type: "text",
    text: [
      "以下图片是用户自己的真实产品参考图，必须作为产品事实最高来源。",
      `一共 ${images.length} 张图，按顺序标记为 PRODUCT_REF_01...。综合正面、侧面、背面和细节图，不要把背景或模特误认为产品事实。`,
      "只输出 JSON：{name,category,color,silhouette,material,construction,logo,textAndPattern,details,imageEvidence,facts,uncertainties,consistencyConstraints}。",
      "必须明确颜色、版型/轮廓、材质、结构、Logo、文字图案和不能变形的细节；看不清就写不确定。",
      options.documentText ? `【产品文档文字，仅用于补充事实】\n${options.documentText}` : "未添加产品文档。"
    ].join("\n")
  }];
  for (let index = 0; index < images.length; index += 1) {
    const image = images[index];
    content.push({ type: "text", text: `PRODUCT_REF_${String(index + 1).padStart(2, "0")}：${image.name}` });
    const mime = image.type || mimeFromName(image.name);
    content.push({ type: "image_url", image_url: { url: `data:${mime};base64,${Buffer.from(image.buffer).toString("base64")}`, detail: "high" } });
  }

  const raw = await callReplicaVisionJson({
    system: "你是电商产品视觉一致性专家。只输出合法 JSON，不夸大、不猜测未展示的参数。",
    content,
    temperature: 0.05,
    maxTokens: 5000
  }) as Record<string, unknown>;
  const productHash = String(raw.productHash || "");
  return {
    schemaVersion: replicaSchemaVersion,
    productHash,
    imageCount: images.length,
    name: stringValue(raw.name) || "用户上传产品",
    category: stringValue(raw.category) || "品类未确认",
    color: stringValue(raw.color) || "以产品参考图颜色为准",
    silhouette: stringValue(raw.silhouette) || "以产品参考图轮廓为准",
    material: stringValue(raw.material) || "以产品参考图材质表现为准",
    construction: stringValue(raw.construction) || "以产品参考图结构为准",
    logo: stringValue(raw.logo) || "Logo 以产品参考图为准，不新增或重绘",
    textAndPattern: stringValue(raw.textAndPattern) || "文字与图案以产品参考图为准，不改写",
    details: stringArray(raw.details),
    imageEvidence: stringArray(raw.imageEvidence),
    facts: uniqueStrings([...stringArray(raw.facts), ...(options.documentText ? ["产品文档已作为补充事实输入。"] : [])]),
    uncertainties: stringArray(raw.uncertainties),
    consistencyConstraints: stringArray(raw.consistencyConstraints).length ? stringArray(raw.consistencyConstraints) : ["所有镜头使用同一产品外观，禁止颜色漂移、版型变形、Logo 变形和材质跳变。"],
    analyzedAt: new Date().toISOString()
  };
}

function mimeFromName(name: string) {
  const extension = path.extname(name).toLowerCase();
  if (extension === ".png") return "image/png";
  if (extension === ".webp") return "image/webp";
  return "image/jpeg";
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function stringArray(value: unknown) {
  return Array.isArray(value) ? value.map((item) => typeof item === "string" ? item.trim() : String(item || "").trim()).filter(Boolean) : [];
}

function uniqueStrings(values: string[]) {
  return [...new Set(values.filter(Boolean))];
}
