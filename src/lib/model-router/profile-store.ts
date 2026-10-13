import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

// Local profiles contain YAML registries plus a separate, private credential file.
// One atomic pointer selects a complete revision for all server workers.
export function profileRoot() {
  return process.env.MODEL_ROUTER_PROFILE_DIR || path.join(process.env.DIRECTOR_RUNTIME_DIR || path.join(process.cwd(), ".director-platform-data"), "model-router");
}

export function baseConfigDir() {
  return process.env.MODEL_CONFIG_DIR || path.join(process.cwd(), "config");
}

export function activeProfileDir(): string | null {
  if (process.env.MODEL_CONFIG_DIR && !process.env.MODEL_ROUTER_PROFILE_DIR) return null;
  const pointer = path.join(profileRoot(), "active.json");
  if (!existsSync(pointer)) return null;
  const value = JSON.parse(readFileSync(pointer, "utf8"));
  if (typeof value.revision !== "string" || !/^[a-f0-9-]{36}$/.test(value.revision)) throw new Error("本机 API 配置损坏，请恢复配置备份。");
  return path.join(profileRoot(), "revisions", value.revision);
}

export function effectiveConfigDir() { return activeProfileDir() || baseConfigDir(); }

export function configSignature() {
  const dir = effectiveConfigDir();
  return [dir, ...["models.yaml", "model-routing.yaml"].map((name) => {
    const stat = statSync(path.join(dir, name));
    return `${stat.mtimeMs}:${stat.size}`;
  })].join("|");
}

export function localConnectionKey(store: string | undefined): string | undefined {
  if (!store?.startsWith("local:")) return undefined;
  const dir = activeProfileDir();
  if (!dir) throw new Error("找不到本机 API 连接配置。");
  const state = JSON.parse(readFileSync(path.join(dir, "connections.json"), "utf8"));
  const connection = state.connections?.find((item: { id: string }) => item.id === store.slice(6));
  if (!connection) throw new Error("模型引用的本机 API 连接不存在。");
  return connection.apiKey || "";
}

export function redactLocalSecrets(value: string) {
  const dir = activeProfileDir();
  if (!dir) return value;
  const state = JSON.parse(readFileSync(path.join(dir, "connections.json"), "utf8"));
  for (const c of state.connections || []) if (c.apiKey) value = value.split(c.apiKey).join("[已隐藏]");
  return value;
}
