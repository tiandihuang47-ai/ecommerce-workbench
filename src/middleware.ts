import { NextResponse, type NextRequest } from "next/server";
import { getSessionUser, isAuthDisabled, SESSION_COOKIE_NAME } from "@/lib/auth/session";
import { getLocalAccessUser } from "@/lib/auth/local-access";

const SESSION_COOKIE = SESSION_COOKIE_NAME;

/** 无需登录即可访问的页面路径（登录/初始化自身） */
const PUBLIC_PATHS = ["/login", "/setup"];

function isPublicPage(pathname: string) {
  return PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

function isStaticAsset(pathname: string) {
  return (
    pathname.startsWith("/_next/static")
    || pathname.startsWith("/_next/image")
    || pathname === "/favicon.ico"
    || /\.(?:png|jpe?g|gif|svg|ico|webp|woff2?|ttf|otf|txt|xml|json)$/i.test(pathname)
  );
}

/**
 * 页面门禁（Node 运行时）。
 *
 * 职责划分（重要）：Next 的 Node 中间件会包裹请求体流，API 请求（尤其大文件上传）
 * 经过中间件后在路由内可能触发 “body disturbed or locked” 或请求体被截断（Next 已知问题）。
 * 因此：
 * - 所有 /api 路由不经过中间件，统一由路由内守卫
 *   `denyIfUnauthenticated` / `requireAdminFromRequest` 完成会话与角色校验（见 src/lib/auth/guard.ts）；
 * - 页面在这里做真实会话校验：未登录/会话伪造/过期/账号停用 → 跳转 /login；
 * - 桌面端注入 DIRECTOR_WEB_AUTH_DISABLED=1 时全部放行；
 * - 校验自身异常时按“未登录”处理（fail-closed），绝不降级成无鉴权模式。
 */
export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (process.env.DIRECTOR_WEB_AUTH_DISABLED === "1") {
    return NextResponse.next();
  }
  const localUser = await getLocalAccessUser(request.headers.get("host"), request.headers.get("origin"));
  if (localUser) {
    return isPublicPage(pathname)
      ? NextResponse.redirect(new URL("/", request.url))
      : NextResponse.next();
  }
  if (isStaticAsset(pathname) || isPublicPage(pathname)) {
    return NextResponse.next();
  }

  let sessionValid = false;
  try {
    sessionValid = Boolean(await getSessionUser(request.cookies.get(SESSION_COOKIE)?.value));
  } catch {
    sessionValid = false; // fail-closed：鉴权服务异常时不放行
  }
  if (!sessionValid) {
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("next", pathname + (request.nextUrl.search || ""));
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  runtime: "nodejs",
  // 只拦截页面：/api 由路由内守卫负责（避免中间件包裹请求体引发的损坏问题）。
  matcher: ["/((?!_next)(?!api).*)"]
};
