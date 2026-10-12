import { access, readdir, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export interface ChromeProfileInfo {
  name: string;
  path: string;
  hasCookies: boolean;
  cookiesPath: string;
}

export async function detectChromeProfiles(): Promise<ChromeProfileInfo[]> {
  const chromeRoot = path.join(os.homedir(), "Library/Application Support/Google/Chrome");

  try {
    const entries = await readdir(chromeRoot);
    const candidates = entries.filter((entry) => entry === "Default" || /^Profile \d+$/.test(entry));
    const profiles = await Promise.all(candidates.map((name) => inspectProfile(chromeRoot, name)));
    return profiles
      .filter((profile): profile is ChromeProfileInfo => Boolean(profile))
      .sort((a, b) => profileSortWeight(a.name) - profileSortWeight(b.name));
  } catch {
    return [];
  }
}

async function inspectProfile(chromeRoot: string, name: string): Promise<ChromeProfileInfo | null> {
  const profilePath = path.join(chromeRoot, name);
  const networkCookiesPath = path.join(profilePath, "Network", "Cookies");
  const legacyCookiesPath = path.join(profilePath, "Cookies");

  try {
    const profileStat = await stat(profilePath);
    if (!profileStat.isDirectory()) return null;
  } catch {
    return null;
  }

  const cookiesPath = await exists(networkCookiesPath) ? networkCookiesPath : legacyCookiesPath;
  return {
    name,
    path: profilePath,
    hasCookies: await exists(cookiesPath),
    cookiesPath
  };
}

async function exists(filePath: string) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

function profileSortWeight(name: string) {
  if (name === "Default") return 0;
  const match = name.match(/^Profile (\d+)$/);
  return match ? Number(match[1]) : 999;
}
