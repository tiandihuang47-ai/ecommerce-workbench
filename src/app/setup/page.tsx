"use client";

import { useRouter } from "next/navigation";
import { FormEvent, useEffect, useState } from "react";
import { fetchAuthState } from "@/lib/auth/use-auth-user";

export default function SetupPage() {
  const router = useRouter();
  const [checking, setChecking] = useState(true);
  const [username, setUsername] = useState("");
  const [nickname, setNickname] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    fetchAuthState().then((state) => {
      if (!state.authEnabled) {
        router.replace("/");
        return;
      }
      if (state.initialized) {
        router.replace("/login");
        return;
      }
      setChecking(false);
    });
  }, [router]);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError("");
    if (password !== confirm) {
      setError("两次输入的密码不一致");
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch("/api/auth/setup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password, nickname })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || "初始化失败，请重试");
        return;
      }
      router.replace("/");
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
          <h1 className="text-xl font-semibold tracking-[-0.01em] text-foreground">初始化网页版</h1>
          <p className="mt-1.5 text-sm text-muted-foreground">
            第一次使用，先创建管理员账号。之后你在「管理后台」为同事开通账号。
          </p>
        </div>

        {checking ? (
          <p className="text-center text-sm text-muted-foreground">正在检查系统状态…</p>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-3.5 rounded-2xl border border-border bg-card/60 p-5">
            <div>
              <label className="mb-1.5 block text-sm font-medium text-foreground">管理员用户名</label>
              <input
                value={username}
                onChange={(event) => setUsername(event.target.value)}
                required
                autoFocus
                placeholder="例如 admin"
                className={inputClass}
              />
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium text-foreground">显示昵称（可选）</label>
              <input
                value={nickname}
                onChange={(event) => setNickname(event.target.value)}
                placeholder="默认与用户名相同"
                className={inputClass}
              />
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium text-foreground">密码（至少 6 位）</label>
              <input
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                required
                minLength={6}
                className={inputClass}
              />
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium text-foreground">确认密码</label>
              <input
                type="password"
                value={confirm}
                onChange={(event) => setConfirm(event.target.value)}
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
              {submitting ? "正在创建…" : "创建管理员账号"}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
