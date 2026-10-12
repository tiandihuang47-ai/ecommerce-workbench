import path from "node:path";

/**
 * 认证与用户数据的根目录。
 * 与 product-asset-store 的 runtimeRoot 保持同一套解析规则：
 * 桌面端通过 DIRECTOR_RUNTIME_DIR 指向用户数据目录；网页服务默认落在项目内。
 */
export const authRuntimeRoot = process.env.DIRECTOR_RUNTIME_DIR
  ? process.env.DIRECTOR_RUNTIME_DIR
  : path.join(process.cwd(), ".director-platform-data");

export function authDataDir() {
  return path.join(authRuntimeRoot, "auth");
}

/** 按账号隔离的个人数据根目录：users/<userId>/ */
export function userScopedDataDir(userId: string) {
  return path.join(authRuntimeRoot, "users", userId);
}
