import { denyIfUnauthenticated } from "@/lib/auth/guard";
import path from "node:path";
import { NextResponse } from "next/server";
import mammoth from "mammoth";

export const runtime = "nodejs";
export const maxDuration = 60;

const maxUploadBytes = 20 * 1024 * 1024;

export async function POST(request: Request) {
  const deny = await denyIfUnauthenticated(request);
  if (deny) return deny;
  let formData: FormData;

  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json({ success: false, message: "上传请求格式不正确。" }, { status: 400 });
  }

  const file = formData.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ success: false, message: "请先选择要上传的文件。" }, { status: 400 });
  }

  if (file.size > maxUploadBytes) {
    return NextResponse.json({ success: false, message: "文件超过 20MB，请精简后再上传。" }, { status: 400 });
  }

  const extension = path.extname(file.name).toLowerCase();
  const buffer = Buffer.from(await file.arrayBuffer());

  if (extension === ".txt") {
    return NextResponse.json({
      success: true,
      kind: "text",
      text: buffer.toString("utf8")
    });
  }

  if (extension === ".docx") {
    try {
      const result = await mammoth.extractRawText({ buffer });
      return NextResponse.json({
        success: true,
        kind: "text",
        text: result.value
      });
    } catch {
      return NextResponse.json(
        { success: false, message: "这个 DOCX 文档无法读取，请另存为标准 DOCX 后重试。" },
        { status: 422 }
      );
    }
  }

  return NextResponse.json(
    {
      success: false,
      message: extension === ".pdf"
        ? "暂不支持 PDF，请导出为 DOCX 或 TXT 后上传。"
        : "暂只支持 TXT 和 DOCX 文件。"
    },
    { status: 422 }
  );
}
