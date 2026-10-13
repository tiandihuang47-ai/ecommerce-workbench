import { type NextRequest } from "next/server";
import { isAuthDisabled } from "@/lib/auth/session";
import { getSessionUserFromRequest } from "@/lib/auth/guard";
import { hasAnyUser, toPublicUser } from "@/lib/auth/users";
import { isLocalAccessHost } from "@/lib/auth/local-access";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  if (isAuthDisabled()) {
    return Response.json({ authEnabled: false, initialized: true, user: null });
  }
  const user = await getSessionUserFromRequest(request);
  return Response.json({
    authEnabled: true,
    localAccess: Boolean(user) && isLocalAccessHost(request.headers.get("host")),
    initialized: user ? true : await hasAnyUser(),
    user: user ? toPublicUser(user) : null
  });
}
