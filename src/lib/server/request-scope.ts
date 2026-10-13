import { cookies, headers } from "next/headers";
import { getLocalAccessUser } from "@/lib/auth/local-access";
import { getSessionUser, isAuthDisabled, SESSION_COOKIE_NAME } from "@/lib/auth/session";

/**
 * 服务端数据的归属作用域。
 *
 * - web：网页请求且已登录，只能看到自己（userId）的数据；
 *   role 保留下来，便于“历史无归属数据只对管理员可见”的过渡判断。
 * - desktop：桌面端（鉴权关闭）或未登录兜底，只能看到没有归属标记的数据（历史桌面数据）；
 * - system：后台任务等非请求上下文（cookies() 不可用），不过滤，保证后台执行器能继续处理任务。
 */
export type OwnershipScope =
  | { kind: "web"; userId: string; role: string }
  | { kind: "desktop" }
  | { kind: "system" };

export async function ownershipScope(): Promise<OwnershipScope> {
  if (isAuthDisabled()) return { kind: "desktop" };
  try {
    const store = await cookies();
    const requestHeaders = await headers();
    const user = await getLocalAccessUser(requestHeaders.get("host"), requestHeaders.get("origin"))
      ?? await getSessionUser(store.get(SESSION_COOKIE_NAME)?.value);
    if (user) return { kind: "web", userId: user.id, role: user.role };
    // 理论上未登录请求已被 middleware 拦截；兜底给一个不可能匹配的 userId，默认全部不可见
    return { kind: "web", userId: "__anonymous__", role: "user" };
  } catch {
    return { kind: "system" };
  }
}

/** 判断一条带归属标记（可能没有标记=历史数据）的记录对当前作用域是否可见 */
export function recordBelongsToScope(recordUserId: string | undefined | null, scope: OwnershipScope): boolean {
  if (scope.kind === "system") return true;
  if (scope.kind === "web") return recordUserId === scope.userId;
  return !recordUserId;
}

/**
 * 带过渡期的可见性判断（用于文件型/无标记的历史数据）：
 * - system / desktop：照旧（desktop 只看无标记的历史数据）；
 * - web：本人数据可见；没有归属标记的历史数据仅管理员可见，普通员工不可见。
 */
export function recordVisibleToScope(recordUserId: string | undefined | null, scope: OwnershipScope): boolean {
  if (scope.kind === "system") return true;
  if (!recordUserId) return scope.kind === "desktop" || (scope.kind === "web" && scope.role === "admin");
  if (scope.kind === "web") return recordUserId === scope.userId;
  return false;
}

/** 当前作用域下新建记录应打上的归属标记（桌面/系统上下文返回 undefined） */
export async function ownershipStamp(): Promise<string | undefined> {
  const scope = await ownershipScope();
  return scope.kind === "web" ? scope.userId : undefined;
}

/** 服务端归属写入被拒绝时抛出（路由层转成 403/404） */
export class OwnershipError extends Error {
  constructor(message = "没有权限访问该资源") {
    super(message);
    this.name = "OwnershipError";
  }
}
