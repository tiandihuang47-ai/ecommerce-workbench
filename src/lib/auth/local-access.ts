import { findUserByUsername, type AuthUserRecord } from "@/lib/auth/users";

/** Explicit local browser mode. The server must also bind to 127.0.0.1. */
export function isLocalAccessHost(host: string | null): boolean {
  if (!process.env.DIRECTOR_LOCAL_ACCESS_USERNAME || !host) return false;
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
  const user = await findUserByUsername(process.env.DIRECTOR_LOCAL_ACCESS_USERNAME!);
  if (!user || user.status !== "active" || user.role !== "admin") {
    return null;
  }
  return user;
}
