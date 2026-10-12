import { denyIfUnauthenticated } from "@/lib/auth/guard";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import { generateReplicaVideoThumbnail } from "@/lib/replica-cache";
import { patchReplicaTaskRecord } from "@/lib/replica-task-store";
import { getReplicaTaskRecord } from "@/lib/replica-task-store";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const deny = await denyIfUnauthenticated(request);
  if (deny) return deny;
  const url = new URL(request.url);
  const taskId = url.searchParams.get("taskId");
  const assetId = url.searchParams.get("assetId");
  if (!taskId || !assetId) return new NextResponse("缺少资产参数", { status: 400 });
  const task = await getReplicaTaskRecord(taskId);
  if (!task) return new NextResponse("任务不存在", { status: 404 });

  const thumbnailAssetId = task.video.thumbnailAssetId || `${task.video.assetId}_thumbnail`;
  if (assetId === thumbnailAssetId && task.video.path && !task.video.thumbnailPath) {
    try {
      const thumbnailPath = await generateReplicaVideoThumbnail({ videoPath: task.video.path, hash: task.video.hash });
      const updated = await patchReplicaTaskRecord(taskId, { video: { ...task.video, thumbnailAssetId, thumbnailPath } });
      if (updated) task.video = updated.video;
    } catch { /* 缩略图生成失败时返回占位 */ }
  }

  const assets = [
    task.video,
    ...(task.video.thumbnailPath ? [{ assetId: thumbnailAssetId, path: task.video.thumbnailPath, name: "thumbnail.jpg", type: "image/jpeg", size: 0 }] : []),
    ...task.products,
    ...(task.document ? [task.document] : [])
  ];
  const asset = assets.find((item) => item.assetId === assetId);
  if (!asset) return new NextResponse("资产不存在", { status: 404 });
  try {
    const data = await readFile(asset.path);
    const mime = asset.type || mimeFromPath(asset.name);
    return new NextResponse(new Uint8Array(data), {
      headers: {
        "Content-Type": mime,
        "Content-Length": String(data.byteLength),
        "Cache-Control": "private, max-age=31536000, immutable"
      }
    });
  } catch {
    return new NextResponse("资产文件缺失", { status: 410 });
  }
}

function mimeFromPath(name: string) {
  const extension = path.extname(name).toLowerCase();
  if (extension === ".png") return "image/png";
  if (extension === ".jpg" || extension === ".jpeg") return "image/jpeg";
  if (extension === ".webp") return "image/webp";
  if (extension === ".mov") return "video/quicktime";
  if (extension === ".webm") return "video/webm";
  if (extension === ".m4v") return "video/x-m4v";
  if (extension === ".mp4") return "video/mp4";
  return "application/octet-stream";
}
