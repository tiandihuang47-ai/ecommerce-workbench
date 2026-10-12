"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { SystemSettingsPage } from "@/components/system-settings-page";
import { fetchAuthState } from "@/lib/auth/use-auth-user";

/**
 * 系统设置（AI 连接、模型配置）属于全局配置：
 * - 桌面端（无需登录）行为完全不变；
 * - 网页端仅管理员可以进入，其他成员自动跳回工作台。
 */
export default function SettingsPage() {
  const router = useRouter();
  const [allowed, setAllowed] = useState(false);

  useEffect(() => {
    fetchAuthState().then((state) => {
      if (!state.authEnabled) {
        setAllowed(true); // 桌面端：保持原有行为
        return;
      }
      if (!state.user) {
        router.replace("/login");
        return;
      }
      if (state.user.role !== "admin") {
        router.replace("/");
        return;
      }
      setAllowed(true);
    });
  }, [router]);

  if (!allowed) {
    return <div className="py-20 text-center text-sm text-muted-foreground">正在检查权限…</div>;
  }
  return <SystemSettingsPage />;
}
