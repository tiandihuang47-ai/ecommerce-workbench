"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Archive,
  BarChart3,
  FileSearch,
  ImagePlus,
  LayoutDashboard,
  Library,
  LogOut,
  MessageCircle,
  Package,
  PanelLeftClose,
  PanelLeftOpen,
  Puzzle,
  Settings,
  ShieldCheck,
  WandSparkles,
  type LucideIcon
} from "lucide-react";
import { ThemeToggle } from "@/components/theme-toggle";
import { logout, useAuthUser } from "@/lib/auth/use-auth-user";
import { cn } from "@/lib/utils";

export type SidebarNavItem = {
  title: string;
  href: string;
  icon: LucideIcon;
  aliases?: string[];
};

export type SidebarNavGroup = {
  label: string;
  items: SidebarNavItem[];
};

export const sidebarNavGroups: SidebarNavGroup[] = [
  {
    label: "工作台",
    items: [
      { title: "工作台", href: "/", icon: LayoutDashboard, aliases: ["/", "/dashboard"] }
    ]
  },
  {
    label: "创作",
    items: [
      { title: "脚本", href: "/script-generator", icon: WandSparkles },
      { title: "爆款复刻", href: "/deconstruction", icon: FileSearch },
      { title: "AI 生图", href: "/image-generator", icon: ImagePlus },
      { title: "AI 对话", href: "/ai-chat", icon: MessageCircle },
      { title: "Skill", href: "/skills", icon: Puzzle }
    ]
  },
  {
    label: "内容资产",
    items: [
      { title: "产品资料", href: "/products", icon: Package },
      { title: "资产库", href: "/assets", icon: Archive },
      { title: "资料库", href: "/resources", icon: Library }
    ]
  },
  {
    label: "分析",
    items: [
      { title: "数据复盘", href: "/reviews", icon: BarChart3 }
    ]
  }
];

export const settingsNavItem: SidebarNavItem = {
  title: "设置",
  href: "/settings",
  icon: Settings
};

export const sidebarNavItems: SidebarNavItem[] = [
  ...sidebarNavGroups.flatMap((group) => group.items),
  settingsNavItem
];

export const adminNavItem: SidebarNavItem = {
  title: "管理后台",
  href: "/admin",
  icon: ShieldCheck
};

/** 网页模式下普通成员不显示「设置」；桌面端与管理员保持原样 */
export function filterNavItemsForUser(items: SidebarNavItem[], auth: { authEnabled: boolean; user: { role: "admin" | "user" } | null }) {
  if (!auth.authEnabled) return items;
  if (auth.user?.role === "admin") return items;
  return items.filter((item) => item.href !== settingsNavItem.href);
}

function isItemActive(pathname: string, item: SidebarNavItem) {
  if (pathname === item.href) return true;
  if (item.aliases?.some((alias) => pathname === alias || (alias !== "/" && pathname.startsWith(`${alias}/`)))) return true;
  if (item.href !== "/" && pathname.startsWith(`${item.href}/`)) return true;
  return false;
}

export function AppSidebar({ collapsed = false, onToggleCollapsed }: { collapsed?: boolean; onToggleCollapsed?: () => void }) {
  const pathname = usePathname();
  const auth = useAuthUser();
  const showAdmin = auth.authEnabled && auth.user?.role === "admin";
  const showSettings = !auth.authEnabled || !auth.user || auth.user.role === "admin";

  return (
    <aside
      className={cn(
        "fixed inset-y-0 left-0 z-30 hidden flex-col border-r border-border bg-sidebar transition-[width] duration-200 md:flex",
        collapsed ? "w-14" : "w-60"
      )}
    >
      <div className={cn("flex h-14 shrink-0 items-center gap-2 border-b border-border", collapsed ? "justify-center px-2" : "px-3")}>
        <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-brand text-xs font-semibold text-brand-foreground">
          编
        </div>
        {!collapsed ? (
          <div className="min-w-0 flex-1 truncate text-sm font-semibold tracking-[-0.01em] text-foreground">
            AI 内容中台
          </div>
        ) : null}
        <button
          type="button"
          onClick={onToggleCollapsed}
          title={collapsed ? "展开功能栏" : "收起功能栏"}
          className={cn(
            "inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground/70 transition-colors hover:bg-muted hover:text-foreground",
            collapsed && "hidden"
          )}
        >
          <PanelLeftClose className="h-4 w-4" />
        </button>
      </div>

      <nav className="flex-1 overflow-y-auto px-2 py-3 scrollbar-subtle">
        {sidebarNavGroups.map((group) => (
          <div key={group.label} className="mb-3">
            {collapsed ? (
              <div className="mx-auto my-2 h-px w-6 bg-border" />
            ) : (
              <div className="px-2 pb-1.5 text-[10.5px] font-medium tracking-[0.08em] text-muted-foreground/60">
                {group.label}
              </div>
            )}
            <div className="space-y-0.5">
              {group.items.map((item) => {
                const active = isItemActive(pathname, item);
                const Icon = item.icon;

                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    title={collapsed ? item.title : undefined}
                    className={cn(
                      "group relative flex h-9 w-full items-center rounded-lg text-sm transition-colors duration-150",
                      collapsed ? "justify-center" : "gap-2.5 px-2.5",
                      active
                        ? "bg-card text-foreground font-medium ring-1 ring-border/70 shadow-[0_1px_2px_rgba(15,23,42,0.05),0_3px_8px_rgba(15,23,42,0.09)] dark:bg-white/[0.08] dark:ring-white/10 dark:shadow-none"
                        : "text-muted-foreground hover:bg-muted/60 hover:text-foreground"
                    )}
                  >
                    <span
                      className={cn(
                        "absolute left-0 top-1/2 h-[14px] w-[2px] -translate-y-1/2 rounded-full bg-accent transition-opacity duration-150",
                        active ? "opacity-100" : "opacity-0"
                      )}
                    />
                    <Icon className="h-[18px] w-[18px] shrink-0" />
                    {!collapsed ? <span className="truncate">{item.title}</span> : null}
                  </Link>
                );
              })}
            </div>
          </div>
        ))}
      </nav>

      <div className="shrink-0 border-t border-border p-2">
        {showAdmin ? (
          <Link
            href={adminNavItem.href}
            title={collapsed ? adminNavItem.title : undefined}
            className={cn(
              "group relative flex h-9 w-full items-center rounded-lg text-sm transition-colors duration-150",
              collapsed ? "justify-center" : "gap-2.5 px-2.5",
              isItemActive(pathname, adminNavItem)
                ? "bg-card text-foreground font-medium ring-1 ring-border/70 shadow-[0_1px_2px_rgba(15,23,42,0.05),0_3px_8px_rgba(15,23,42,0.09)] dark:bg-white/[0.08] dark:ring-white/10 dark:shadow-none"
                : "text-muted-foreground hover:bg-muted/60 hover:text-foreground"
            )}
          >
            <adminNavItem.icon className="h-[18px] w-[18px] shrink-0" />
            {!collapsed ? <span className="truncate">{adminNavItem.title}</span> : null}
          </Link>
        ) : null}
        {showSettings ? (
          <Link
            href={settingsNavItem.href}
            title={collapsed ? settingsNavItem.title : undefined}
            className={cn(
              "group relative flex h-9 w-full items-center rounded-lg text-sm transition-colors duration-150",
              collapsed ? "justify-center" : "gap-2.5 px-2.5",
              isItemActive(pathname, settingsNavItem)
                ? "bg-card text-foreground font-medium ring-1 ring-border/70 shadow-[0_1px_2px_rgba(15,23,42,0.05),0_3px_8px_rgba(15,23,42,0.09)] dark:bg-white/[0.08] dark:ring-white/10 dark:shadow-none"
                : "text-muted-foreground hover:bg-muted/60 hover:text-foreground"
            )}
          >
            <settingsNavItem.icon className="h-[18px] w-[18px] shrink-0" />
            {!collapsed ? <span className="truncate">{settingsNavItem.title}</span> : null}
          </Link>
        ) : null}
        <div className={cn("mt-1.5 flex items-center", collapsed ? "justify-center" : "justify-between px-1")}>
          <ThemeToggle compact />
          {auth.authEnabled && auth.user ? (
            <div className={cn("flex min-w-0 items-center gap-1", collapsed && "justify-center")}>
              {!collapsed ? (
                <span className="min-w-0 truncate text-[11px] text-muted-foreground" title={auth.user.nickname}>
                  {auth.user.nickname}
                </span>
              ) : null}
              <button
                type="button"
                onClick={() => void logout()}
                title="退出登录"
                className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-muted-foreground/70 transition-colors hover:bg-muted hover:text-foreground"
              >
                <LogOut className="h-3.5 w-3.5" />
              </button>
            </div>
          ) : (
            !collapsed ? <span className="text-[11px] text-muted-foreground/60">本地保存</span> : null
          )}
        </div>
      </div>

      {collapsed ? (
        <button
          type="button"
          onClick={onToggleCollapsed}
          title="展开功能栏"
          className="mx-auto mb-2 flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground/70 transition-colors hover:bg-muted hover:text-foreground"
        >
          <PanelLeftOpen className="h-4 w-4" />
        </button>
      ) : null}
    </aside>
  );
}
