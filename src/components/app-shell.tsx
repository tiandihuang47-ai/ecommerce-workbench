"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { AppSidebar, adminNavItem, filterNavItemsForUser, sidebarNavItems } from "@/components/app-sidebar";
import { StorageStatusBanner } from "@/components/storage-status-banner";
import { ThemeToggle } from "@/components/theme-toggle";
import { useAuthUser } from "@/lib/auth/use-auth-user";
import { useWebStorageReady } from "@/lib/web-storage";
import { cn } from "@/lib/utils";

const sidebarCollapsedKey = "director-platform.sidebarCollapsed";

/** 这些页面不需要等待按账号的数据水合 */
const STORAGE_FREE_PATHS = ["/login", "/setup", "/admin"];

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const auth = useAuthUser();
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  useEffect(() => {
    setSidebarCollapsed(window.localStorage.getItem(sidebarCollapsedKey) === "true");
  }, []);

  function toggleSidebar() {
    setSidebarCollapsed((current) => {
      const next = !current;
      window.localStorage.setItem(sidebarCollapsedKey, String(next));
      return next;
    });
  }

  // 脚本工作台是高频内容编辑器：桌面端锁定视口，由左栏 / 正文各自滚动。
  // 只作用于该路由，其他模块保持原有文档流布局。
  const fullBleedWorkbench = pathname === "/script-generator";

  // 网页模式下按角色过滤导航（普通成员不显示设置），管理员额外显示管理后台
  const mobileNavItems = filterNavItemsForUser(sidebarNavItems, auth);
  if (auth.authEnabled && auth.user?.role === "admin") {
    mobileNavItems.push(adminNavItem);
  }

  // 网页模式：等服务器上的按账号数据水合完成后再渲染业务页面，避免读到空数据
  const storageReady = useWebStorageReady();
  const storageFreePage = STORAGE_FREE_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));
  const pageReady = storageFreePage || storageReady;

  return (
    <div className={cn("bg-background text-foreground", fullBleedWorkbench ? "lg:h-[100dvh] lg:overflow-hidden" : "min-h-screen")}>
      <AppSidebar collapsed={sidebarCollapsed} onToggleCollapsed={toggleSidebar} />
      {!pageReady ? (
        <div className="flex min-h-screen items-center justify-center md:pl-60">
          <p className="text-sm text-muted-foreground">正在加载你的工作区…</p>
        </div>
      ) : (
      <div
        className={cn(
          "transition-[padding] duration-200",
          sidebarCollapsed ? "md:pl-14" : "md:pl-60",
          fullBleedWorkbench && "lg:flex lg:h-[100dvh] lg:min-h-0 lg:flex-col"
        )}
      >
        <header className="sticky top-0 z-20 border-b border-border bg-background/90 backdrop-blur md:hidden">
          <div className="px-4 py-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-base font-semibold tracking-[-0.01em] text-foreground">AI 内容中台</div>
                <div className="mt-0.5 text-xs text-muted-foreground">脚本、拆片、生图，一站式内容生产</div>
              </div>
              <ThemeToggle compact />
            </div>
            <nav className="mt-4 flex gap-2 overflow-x-auto pb-1">
              {mobileNavItems.map((item) => {
                const active = pathname === item.href
                  || item.aliases?.some((alias) => pathname === alias || (alias !== "/" && pathname.startsWith(`${alias}/`)))
                  || (item.href !== "/" && pathname.startsWith(`${item.href}/`));
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={cn(
                      "shrink-0 rounded-lg border px-3 py-1.5 text-sm transition-colors",
                      active
                        ? "border-brand bg-brand text-brand-foreground"
                        : "border-border bg-card text-muted-foreground"
                    )}
                  >
                    {item.title}
                  </Link>
                );
              })}
            </nav>
          </div>
        </header>
        <main
          className={cn(
            fullBleedWorkbench
              ? "px-4 py-4 lg:mx-0 lg:flex lg:min-h-0 lg:max-w-none lg:flex-1 lg:flex-col lg:overflow-hidden lg:px-5 lg:py-4"
              : "mx-auto max-w-[1680px] px-4 py-5 md:px-7 md:py-7 xl:px-8"
          )}
        >
          {children}
        </main>
      </div>
      )}
      <StorageStatusBanner />
    </div>
  );
}
