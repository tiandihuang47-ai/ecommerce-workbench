import { denyIfUnauthenticated } from "@/lib/auth/guard";
import { readFile } from "node:fs/promises";
import { NextResponse } from "next/server";
import { resolveCommerceImageStyleSkillAsset } from "@/lib/commerce-image-style-skills";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const deny = await denyIfUnauthenticated(request);
  if (deny) return deny;
  const url = new URL(request.url);
  const asset = await resolveCommerceImageStyleSkillAsset(url.searchParams.get("skillId") || "", url.searchParams.get("assetId") || "");
  if (!asset) return NextResponse.json({ success: false, code: "STYLE_ASSET_NOT_FOUND", category: "validation", retryable: false, message: "Skill 素材不存在。" }, { status: 404 });
  const bytes = await readFile(asset.path);
  return new NextResponse(bytes, { headers: { "Content-Type": asset.mimeType, "Cache-Control": "private, max-age=3600", "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(asset.name)}` } });
}
