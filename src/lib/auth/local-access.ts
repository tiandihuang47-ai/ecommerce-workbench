import { findUserByUsername, listUsers, type AuthUserRecord } from "@/lib/auth/users";

/** Local browser access is enabled by default. The server must bind to loopback. */
export function isLocalAccessHost(host: string | null): boolean {
  if (process.env.DIRECTOR_REQUIRE_LOGIN === "1" || !host) return false;
  try {
    const url = new URL(`http://${host}`);
    return !url.username && !url.password && url.host === host
      && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  } catch {
    return false;
  }
}

export async function getLocalAccessUser(host: string | null, origin: string | null = null): Promise<AuthUserRecord | null> {
  if (!isLocalAccessHost(host)) return null;
  if (origin) {
    try {
      if (new URL(origin).host !== host) return null;
    } catch {
      return null;
    }
  }
  const selectedUsername = process.env.DIRECTOR_LOCAL_ACCESS_USERNAME?.trim();
  if (selectedUsername) {
    const user = await findUserByUsername(selectedUsername);
    return user?.status === "active" && user.role === "admin" ? user : null;
  }
  const users = await listUsers();
  // Reuse the original first active administrator so existing content keeps its owner.
  // An existing database with no active administrator must never be silently promoted.
  if (users.length) return users.find((user) => user.role === "admin" && user.status === "active") ?? null;

  // A fresh personal workspace needs a stable storage owner, not a login credential.
  // Do not create an account/password or persist anything merely for opening a page.
  return {
    id: "u_local_workspace", username: "local_workspace", nickname: "本机工作区",
    role: "admin", status: "active", passwordHash: "", createdAt: "", updatedAt: ""
  };
}
