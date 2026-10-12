import { createHash, randomUUID } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { once } from "node:events";
import { Readable } from "node:stream";

/**
 * 视频上传的流式落盘：请求体按块写入临时文件并同步计算哈希，
 * 不再把整份视频读进内存（替代 request.arrayBuffer() 的做法）。
 *
 * 客户端约定：POST 原始字节流（Content-Type: application/octet-stream），
 * 文件名放在 x-file-name 头（encodeURIComponent）。超出大小上限立即中断并清理。
 */

export class UploadTooLargeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UploadTooLargeError";
  }
}

export type StreamUploadResult = {
  tempPath: string;
  hash: string;
  size: number;
  fileName: string;
  extension: string;
};

function sanitizeFileName(raw: string) {
  const decoded = (() => {
    try {
      return decodeURIComponent(raw);
    } catch {
      return raw;
    }
  })();
  return decoded.replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_").slice(0, 180) || "video.mp4";
}

export async function saveRawUploadToTemp(
  request: Request,
  options: { maxBytes: number; allowedExtensions: Set<string>; tempDir: string }
): Promise<StreamUploadResult> {
  const fileName = sanitizeFileName(request.headers.get("x-file-name") || "video.mp4");
  const extension = path.extname(fileName).toLowerCase();
  if (!options.allowedExtensions.has(extension)) {
    throw new Error("暂只支持 MP4、MOV、M4V、WEBM 视频格式。");
  }
  const declaredSize = Number(request.headers.get("content-length") || 0);
  if (Number.isFinite(declaredSize) && declaredSize > options.maxBytes) {
    throw new UploadTooLargeError(`视频文件超过 ${Math.round(options.maxBytes / 1024 / 1024)}MB，请压缩后再上传。`);
  }
  if (!request.body) {
    throw new Error("请求没有携带视频内容，请重新上传。");
  }

  await mkdir(options.tempDir, { recursive: true, mode: 0o700 });
  const tempPath = path.join(options.tempDir, `upload_${Date.now()}_${randomUUID()}.part`);
  const hash = createHash("sha256");
  let size = 0;

  const writer = createWriteStream(tempPath, { mode: 0o600 });
  const source = Readable.fromWeb(request.body as Parameters<typeof Readable.fromWeb>[0]);
  try {
    for await (const chunk of source) {
      const buffer = chunk as Buffer;
      size += buffer.length;
      if (size > options.maxBytes) {
        source.destroy();
        throw new UploadTooLargeError(`视频文件超过 ${Math.round(options.maxBytes / 1024 / 1024)}MB，请压缩后再上传。`);
      }
      hash.update(buffer);
      if (!writer.write(buffer)) {
        await once(writer, "drain");
      }
    }
    writer.end();
    await once(writer, "close");
  } catch (error) {
    await rm(tempPath, { force: true }).catch(() => undefined);
    throw error;
  }

  return { tempPath, hash: hash.digest("hex"), size, fileName, extension };
}

/** 把 temp 目录里的扩展名转成 persistReplicaVideoFileSource 需要的格式 */
export function normalizeExtension(extension: string) {
  return extension.startsWith(".") ? extension : `.${extension}`;
}
