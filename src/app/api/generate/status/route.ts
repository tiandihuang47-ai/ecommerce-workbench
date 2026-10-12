import { NextResponse } from "next/server";
import { denyIfUnauthenticated } from "@/lib/auth/guard";
import { isRouteConfigured } from "@/lib/copywriting-service";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const deny = await denyIfUnauthenticated(request);
  if (deny) return deny;
  return NextResponse.json({
    configured: isRouteConfigured("script_generation"),
    route: "script_generation"
  });
}
