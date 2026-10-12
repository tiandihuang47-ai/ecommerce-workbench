import { NextResponse } from "next/server";
import { adminGuardFailure, requireAdminFromRequest } from "@/lib/auth/guard";
import { getCommerceBrandProfile, saveCommerceBrandProfile } from "@/lib/commerce-image-store";

export const runtime = "nodejs";

/** 品牌档案为全局共享：读放开给登录用户，写入仅管理员。 */
export async function GET() {
  return NextResponse.json({ success: true, profile: await getCommerceBrandProfile() });
}

export async function PUT(request: Request) {
  const adminFailure = await adminGuardFailure(await requireAdminFromRequest(request));
  if (adminFailure) return adminFailure;
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ success: false, message: "请求体必须是合法 JSON。" }, { status: 400 });
  }
  const profile = await saveCommerceBrandProfile({
    brandName: stringValue(body.brandName, 160),
    primaryColor: colorValue(body.primaryColor, "#7c3aed"),
    secondaryColor: colorValue(body.secondaryColor, "#f4f4f5"),
    fontStyle: stringValue(body.fontStyle, 160) || "简洁现代",
    styleNotes: stringValue(body.styleNotes, 2000)
  });
  return NextResponse.json({ success: true, profile });
}

function stringValue(value: unknown, max: number) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function colorValue(value: unknown, fallback: string) {
  return typeof value === "string" && /^#[0-9a-fA-F]{6}$/.test(value) ? value : fallback;
}
