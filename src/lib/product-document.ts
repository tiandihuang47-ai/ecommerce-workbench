import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { unlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import mammoth from "mammoth";
import { getDeepSeekErrorMessage, safeJsonParse } from "@/lib/deepseek";
import { generateCopywritingText, isRouteConfigured } from "@/lib/copywriting-service";
import type { ProductRecordSaveInput } from "@/lib/pipeline-types";
import { formatFromFileName } from "@/lib/product-asset-store";
import type { ProductDocumentFormat } from "@/lib/product-assets-types";

/**
 * 产品文档解析与 AI 结构化。
 * 从 /api/products/import-word 抽出，供「导入产品」和「产品资产中心更新资料」共用，
 * 避免出现第二套产品理解系统。
 */

export const PRODUCT_DOCUMENT_MAX_BYTES = 10 * 1024 * 1024;
export const PRODUCT_DOCUMENT_MAX_STORED_TEXT = 200_000;
const maxAiTextLength = 30_000;

const zipSignatures = [
  Buffer.from([0x50, 0x4b, 0x03, 0x04]),
  Buffer.from([0x50, 0x4b, 0x05, 0x06]),
  Buffer.from([0x50, 0x4b, 0x07, 0x08])
];
const oleSignature = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);

export class DocumentImportError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly suggestion: string
  ) {
    super(message);
    this.name = "DocumentImportError";
  }
}

export type ExtractedDocument = {
  text: string;
  warnings: number;
  format: ProductDocumentFormat;
};

export async function extractProductDocument(fileName: string, bytes: Uint8Array): Promise<ExtractedDocument> {
  const format = formatFromFileName(fileName);
  if (!format) {
    throw new DocumentImportError(
      "UNSUPPORTED_FILE_TYPE",
      "暂只支持 Word（.docx / .doc）、Markdown（.md）和 TXT 文档。",
      "请在 Word 或 WPS 中另存为 .docx，Markdown 请保存为 .md 后重新上传。"
    );
  }
  if (bytes.byteLength === 0) {
    throw new DocumentImportError("EMPTY_DOCUMENT", "文档内容为空，请重新选择文件。", "请确认文件可以正常打开并包含文字内容。");
  }
  if (bytes.byteLength > PRODUCT_DOCUMENT_MAX_BYTES) {
    throw new DocumentImportError("DOCUMENT_TOO_LARGE", "文档超过 10MB，请精简图片或内容后再上传。", "可以把文档里的图片删掉后重新保存。");
  }

  const buffer = Buffer.from(bytes);
  if (format === "md" || format === "txt") {
    const text = normalizeText(buffer.toString("utf8"));
    if (text.length < 2) {
      throw new DocumentImportError("EMPTY_DOCUMENT", "没有从文档中读取到有效文字。", "请确认文件是 UTF-8 编码的纯文本或 Markdown。");
    }
    return { text, warnings: 0, format };
  }

  if (zipSignatures.some((signature) => buffer.subarray(0, signature.length).equals(signature))) {
    try {
      const result = await mammoth.extractRawText({ buffer });
      return { text: normalizeText(result.value), warnings: result.messages.length, format: "docx" };
    } catch {
      throw new DocumentImportError(
        "INVALID_DOCX",
        "这个 DOCX 文件结构不完整或已经损坏，系统无法读取。",
        "请先用 Word 或 WPS 打开该文件，确认内容正常，再选择“另存为 Word 文档（.docx）”后重新上传。"
      );
    }
  }

  if (buffer.subarray(0, oleSignature.length).equals(oleSignature)) {
    if (isWpsPrivateDocument(buffer)) {
      throw new DocumentImportError(
        "WPS_PRIVATE_DOCUMENT",
        "这个文件是 WPS 私密文档，系统无法直接读取其中的产品内容。",
        "请用 WPS 打开文件，关闭“私密文档/文档加密”，再通过“文件 → 另存为”保存为标准 Word 文档（.docx）后重新上传。"
      );
    }
    return extractLegacyWordDocument(buffer);
  }

  throw new DocumentImportError(
    "INVALID_WORD_DOCUMENT",
    "文件虽然使用了 Word 扩展名，但内容不是有效的 Word 文档。",
    "请在 Word 或 WPS 中打开原文件，选择“另存为 Word 文档（.docx）”，不要只修改文件名后缀。"
  );
}

export function buildFallbackProduct(fileName: string, text: string, importedAt: string): ProductRecordSaveInput {
  const labeledFields = parseLabeledFields(text);
  const firstLine = text.split("\n").map((line) => line.trim()).find(Boolean) || "";
  const fileBaseName = path.basename(fileName, path.extname(fileName)).trim();
  const name = textValue(labeledFields.name) || (
    firstLine.length <= 60 && !/产品资料|说明书|介绍$/i.test(firstLine)
      ? firstLine
      : fileBaseName || "导入产品"
  );

  return {
    ...labeledFields,
    name,
    sourceType: "word",
    productFacts: textValue(labeledFields.productFacts) || text,
    sourceDocumentName: fileName,
    sourceDocumentText: text,
    sourceDocumentImportedAt: importedAt
  };
}

export type ProductStructuringResult = {
  product: ProductRecordSaveInput;
  source: "ai" | "text-only";
  message: string;
};

export async function structureProductDocument(
  fileName: string,
  text: string,
  importedAt: string,
  options: { strict?: boolean } = {}
): Promise<ProductStructuringResult> {
  const fallback = buildFallbackProduct(fileName, text, importedAt);
  const storedText = text.slice(0, PRODUCT_DOCUMENT_MAX_STORED_TEXT);

  if (!isRouteConfigured("product_document_structure")) {
    return {
      product: fallback,
      source: "text-only",
      message: "已提取原文和常见标签；当前未配置 DeepSeek，已按文档内容自动保存基础资料。"
    };
  }

  try {
    const product = await structureProductWithAi(storedText, fallback);
    return { product, source: "ai", message: "产品资料已完成结构化解析。" };
  } catch (error) {
    /* 后台异步解析（strict）需要知道「真的失败了」：吞掉错误会让界面显示「已就绪」，
     * 而实际上只是本地兜底结果。同步导入的老入口仍然保持宽容，不阻塞用户。 */
    if (options.strict) throw error;
    return {
      product: fallback,
      source: "text-only",
      message: `${getDeepSeekErrorMessage(error)}，已保留原文和常见标签，并自动保存基础资料。`
    };
  }
}

async function structureProductWithAi(text: string, fallback: ProductRecordSaveInput): Promise<ProductRecordSaveInput> {
  const copy = await generateCopywritingText({
    purpose: "product_document_structure",
    temperature: 0.1,
    system: [
      "你是产品资料整理助手。请把产品资料原文整理成严格 JSON。",
      "只能使用原文明确提供的事实，缺失字段必须返回空字符串，禁止补编价格、销量、认证、效果或背书。",
      "不要输出 Markdown，不要解释。"
    ].join("\n"),
    user: JSON.stringify({
      schema: productSchemaHint(),
      documentText: text.slice(0, maxAiTextLength)
    }, null, 2)
  });

  const raw = copy.text;
  const parsed = safeJsonParse<ParsedProductFields>(stripJsonFence(raw));
  if (!parsed) throw new Error("DeepSeek 没有返回可写入的产品资料结构");

  return {
    ...fallback,
    ...normalizeParsedFields(parsed, fallback.name),
    sourceType: "word",
    sourceDocumentName: fallback.sourceDocumentName,
    sourceDocumentText: fallback.sourceDocumentText,
    sourceDocumentImportedAt: fallback.sourceDocumentImportedAt
  };
}

type ParsedProductFields = Partial<Pick<
  ProductRecordSaveInput,
  | "name" | "brandName" | "category" | "priceRange" | "productFacts" | "specifications" | "colors"
  | "coreSellingPoints" | "secondarySellingPoints" | "targetAudience" | "painPoints" | "objections"
  | "useScenarios" | "competitorComparison" | "buyerFeedback" | "faq" | "customerServiceScript"
  | "forbiddenWords" | "forbiddenClaims" | "proofMaterials" | "materialLinks" | "notes"
>>;

async function extractLegacyWordDocument(buffer: Buffer): Promise<ExtractedDocument> {
  if (process.platform !== "darwin") {
    throw new DocumentImportError(
      "LEGACY_DOC_UNSUPPORTED",
      "当前运行环境无法读取旧版 Word 文档（.doc）。",
      "请在 Word 或 WPS 中另存为标准 Word 文档（.docx）后重新上传。"
    );
  }

  const tempPath = path.join(os.tmpdir(), `director-product-${randomUUID()}.doc`);
  try {
    await writeFile(tempPath, buffer, { mode: 0o600 });
    const output = await runTextutil(tempPath);
    if (isWpsPrivateText(output)) {
      throw new DocumentImportError(
        "WPS_PRIVATE_DOCUMENT",
        "这个文件是 WPS 私密文档，系统无法直接读取其中的产品内容。",
        "请用 WPS 打开文件，关闭“私密文档/文档加密”，再通过“文件 → 另存为”保存为标准 Word 文档（.docx）后重新上传。"
      );
    }
    const text = normalizeText(output);
    if (text.length < 2) {
      throw new DocumentImportError("EMPTY_LEGACY_DOC", "没有从旧版 Word 文档中读取到有效文字。", "请确认文档不是扫描图片或加密文件，并另存为标准 Word 文档（.docx）后重新上传。");
    }
    return { text, warnings: 0, format: "doc" };
  } finally {
    await unlink(tempPath).catch(() => undefined);
  }
}

function runTextutil(filePath: string) {
  return new Promise<string>((resolve, reject) => {
    execFile(
      "/usr/bin/textutil",
      ["-convert", "txt", "-stdout", "-format", "doc", "--", filePath],
      { encoding: "utf8", maxBuffer: PRODUCT_DOCUMENT_MAX_BYTES * 2 },
      (error, stdout, stderr) => {
        if (error) {
          reject(new DocumentImportError(
            "LEGACY_DOC_PARSE_FAILED",
            "旧版 Word 文档解析失败。",
            "请用 Word 或 WPS 打开文档并另存为标准 Word 文档（.docx）后重新上传。"
          ));
          return;
        }
        resolve(`${stdout || ""}\n${stderr || ""}`.trim());
      }
    );
  });
}

function isWpsPrivateDocument(buffer: Buffer) {
  const utf16Content = buffer.toString("utf16le");
  return ["仅WPS能打开", "私密文档", "请使用WPS Office打开"].some((marker) => utf16Content.includes(marker));
}

function isWpsPrivateText(value: string) {
  return /仅WPS能打开|私密文档|请使用WPS Office打开/.test(value);
}

function parseLabeledFields(text: string): ParsedProductFields {
  const labelMap: Record<string, keyof ParsedProductFields> = {
    产品名称: "name", 产品名: "name", 品牌: "brandName", 品牌名称: "brandName",
    品类: "category", 产品品类: "category", 价格: "priceRange", 价格区间: "priceRange",
    产品基础信息: "productFacts", 产品事实: "productFacts", 规格: "specifications", 规格参数: "specifications",
    颜色: "colors", 颜色款式: "colors", 核心卖点: "coreSellingPoints", 次级卖点: "secondarySellingPoints",
    目标人群: "targetAudience", 用户痛点: "painPoints", 用户顾虑: "objections", 使用场景: "useScenarios",
    竞品对比: "competitorComparison", 买家反馈: "buyerFeedback", 常见问题: "faq", 客服话术: "customerServiceScript",
    禁忌词: "forbiddenWords", 不能承诺: "forbiddenClaims", 不能承诺的内容: "forbiddenClaims",
    证据材料: "proofMaterials", 素材链接: "materialLinks", 备注: "notes"
  };
  const fields: ParsedProductFields = {};

  for (const line of text.split("\n")) {
    const match = line.trim().match(/^([^：:]{1,20})[：:]\s*(.+)$/);
    if (!match) continue;
    const key = labelMap[match[1].trim()];
    const value = match[2].trim();
    if (!key || !value) continue;
    const current = textValue(fields[key]);
    fields[key] = current ? `${current}\n${value}` : value;
  }

  return fields;
}

function normalizeParsedFields(fields: ParsedProductFields, fallbackName: string): ParsedProductFields & { name: string } {
  return {
    name: textValue(fields.name) || fallbackName,
    brandName: textValue(fields.brandName),
    category: textValue(fields.category),
    priceRange: textValue(fields.priceRange),
    productFacts: textValue(fields.productFacts),
    specifications: textValue(fields.specifications),
    colors: textValue(fields.colors),
    coreSellingPoints: textValue(fields.coreSellingPoints),
    secondarySellingPoints: textValue(fields.secondarySellingPoints),
    targetAudience: textValue(fields.targetAudience),
    painPoints: textValue(fields.painPoints),
    objections: textValue(fields.objections),
    useScenarios: textValue(fields.useScenarios),
    competitorComparison: textValue(fields.competitorComparison),
    buyerFeedback: textValue(fields.buyerFeedback),
    faq: textValue(fields.faq),
    customerServiceScript: textValue(fields.customerServiceScript),
    forbiddenWords: textValue(fields.forbiddenWords),
    forbiddenClaims: textValue(fields.forbiddenClaims),
    proofMaterials: textValue(fields.proofMaterials),
    materialLinks: textValue(fields.materialLinks),
    notes: textValue(fields.notes)
  };
}

function productSchemaHint() {
  return {
    name: "产品名称", brandName: "品牌名称", category: "品类", priceRange: "价格或价格区间",
    productFacts: "产品基础事实", specifications: "规格参数", colors: "颜色款式",
    coreSellingPoints: "核心卖点", secondarySellingPoints: "次级卖点", targetAudience: "目标人群",
    painPoints: "用户痛点", objections: "用户顾虑", useScenarios: "使用场景",
    competitorComparison: "原文明确提供的竞品对比", buyerFeedback: "买家反馈", faq: "常见问题",
    customerServiceScript: "客服话术", forbiddenWords: "禁忌词",
    forbiddenClaims: "不能承诺或需要谨慎表达的内容", proofMaterials: "证据材料",
    materialLinks: "素材链接", notes: "其他备注"
  };
}

function textValue(value: unknown): string {
  if (Array.isArray(value)) return value.map(textValue).filter(Boolean).join("\n");
  return typeof value === "string" ? value.trim() : "";
}

function normalizeText(value: string) {
  return value.replace(/\r\n?/g, "\n").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

function stripJsonFence(value: string) {
  return value.replace(/^```json\s*/i, "").replace(/```$/i, "").trim();
}
