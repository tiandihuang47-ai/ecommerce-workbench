"use client";

import { useSearchParams } from "next/navigation";
import { Suspense, FormEvent, useEffect, useState } from "react";
import { fetchAuthState } from "@/lib/auth/use-auth-user";

function LoginForm() {
  const searchParams = useSearchParams();
  const [checking, setChecking] = useState(true);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    fetchAuthState().then((state) => {
      if (!state.authEnabled || state.localAccess) {
        window.location.replace("/");
        return;
      }
      if (!state.initialized) {
        window.location.replace("/setup");
        return;
      }
      setChecking(false);
    });
  }, []);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError("");
    setSubmitting(true);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (data.code === "NOT_INITIALIZED") {
          window.location.replace("/setup");
          return;
        }
        setError(data.error || "登录失败，请重试");
        return;
      }
      const next = searchParams.get("next");
      // 整页跳转：登录/登出都重新加载文档，确保按账号的数据水合从干净状态开始
      window.location.assign(next && next.startsWith("/") && !next.startsWith("/login") ? next : "/");
    } catch {
      setError("网络异常，请重试");
    } finally {
      setSubmitting(false);
    }
  }

  const inputClass
    = "w-full rounded-lg border border-border bg-card px-3 py-2.5 text-sm text-foreground outline-none transition-colors focus:border-brand";

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center">
          <div className="mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-xl bg-brand text-lg font-semibold text-brand-foreground">
            编
          </div>
          <h1 className="text-xl font-semibold tracking-[-0.01em] text-foreground">AI 内容中台</h1>
          <p className="mt-1.5 text-sm text-muted-foreground">请登录你的账号，每个人有自己独立的工作区</p>
        </div>

        {checking ? (
          <p className="text-center text-sm text-muted-foreground">正在检查系统状态…</p>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-3.5 rounded-2xl border border-border bg-card/60 p-5">
            <div>
              <label className="mb-1.5 block text-sm font-medium text-foreground">用户名</label>
              <input
                value={username}
                onChange={(event) => setUsername(event.target.value)}
                required
                autoFocus
                autoCapitalize="none"
                className={inputClass}
              />
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium text-foreground">密码</label>
              <input
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                required
                className={inputClass}
              />
            </div>
            {error ? <p className="text-sm text-red-500">{error}</p> : null}
            <button
              type="submit"
              disabled={submitting}
              className="w-full rounded-lg bg-brand px-4 py-2.5 text-sm font-medium text-brand-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              {submitting ? "正在登录…" : "登录"}
            </button>
            <p className="text-center text-xs text-muted-foreground">没有账号？请联系系统维护者。</p>
          </form>
        )}
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}
