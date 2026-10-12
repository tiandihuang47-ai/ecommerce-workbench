"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { fetchAuthState, type AuthUser } from "@/lib/auth/use-auth-user";

type ManagedUser = AuthUser;

export default function AdminPage() {
  const router = useRouter();
  const [checking, setChecking] = useState(true);
  const [users, setUsers] = useState<ManagedUser[]>([]);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [newUsername, setNewUsername] = useState("");
  const [newNickname, setNewNickname] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [creating, setCreating] = useState(false);

  const loadUsers = useCallback(async () => {
    const res = await fetch("/api/admin/users", { cache: "no-store" });
    if (res.status === 401) {
      router.replace("/login");
      return;
    }
    if (!res.ok) {
      setError("读取账号列表失败");
      return;
    }
    const data = await res.json();
    setUsers(data.users || []);
  }, [router]);

  useEffect(() => {
    fetchAuthState().then((state) => {
      if (!state.authEnabled || !state.user || state.user.role !== "admin") {
        router.replace("/");
        return;
      }
      setChecking(false);
      loadUsers();
    });
  }, [router, loadUsers]);

  async function handleCreate(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    setNotice("");
    setCreating(true);
    try {
      const res = await fetch("/api/admin/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: newUsername, password: newPassword, nickname: newNickname })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || "创建失败，请重试");
        return;
      }
      setNotice(`账号「${data.user.nickname}」已开通，请把用户名和密码告诉同事`);
      setNewUsername("");
      setNewNickname("");
      setNewPassword("");
      await loadUsers();
    } finally {
      setCreating(false);
    }
  }

  async function patchUser(id: string, patch: Record<string, string>, successMessage: string) {
    setError("");
    setNotice("");
    const res = await fetch(`/api/admin/users/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch)
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(data.error || "操作失败，请重试");
      return false;
    }
    setNotice(successMessage);
    await loadUsers();
    return true;
  }

  async function handleResetPassword(user: ManagedUser) {
    const password = window.prompt(`为「${user.nickname}」设置新密码（至少 6 位）：`);
    if (!password) return;
    await patchUser(user.id, { password }, `「${user.nickname}」的密码已重置`);
  }

  async function handleToggleStatus(user: ManagedUser) {
    const nextStatus = user.status === "active" ? "disabled" : "active";
    await patchUser(
      user.id,
      { status: nextStatus },
      nextStatus === "disabled" ? `「${user.nickname}」已停用` : `「${user.nickname}」已启用`
    );
  }

  async function handleDelete(user: ManagedUser) {
    if (!window.confirm(`确定删除账号「${user.nickname}」吗？\n\n删除后该账号无法登录；其生成内容仍保留在服务器上。`)) return;
    setError("");
    setNotice("");
    const res = await fetch(`/api/admin/users/${user.id}`, { method: "DELETE" });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(data.error || "删除失败，请重试");
      return;
    }
    setNotice(`「${user.nickname}」已删除`);
    await loadUsers();
  }

  const inputClass
    = "w-full rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground outline-none transition-colors focus:border-brand";

  if (checking) {
    return <div className="py-20 text-center text-sm text-muted-foreground">正在检查权限…</div>;
  }

  return (
    <div className="mx-auto w-full max-w-3xl space-y-6">
      <div>
        <h1 className="text-xl font-semibold tracking-[-0.01em] text-foreground">管理后台</h1>
        <p className="mt-1 text-sm text-muted-foreground">为同事开通账号；每个账号拥有独立的工作区，数据互不干扰。</p>
      </div>

      <form onSubmit={handleCreate} className="rounded-2xl border border-border bg-card/60 p-5">
        <h2 className="mb-3 text-sm font-semibold text-foreground">开通新账号</h2>
        <div className="grid gap-3 md:grid-cols-3">
          <div>
            <label className="mb-1 block text-xs text-muted-foreground">用户名（登录用）</label>
            <input
              value={newUsername}
              onChange={(event) => setNewUsername(event.target.value)}
              required
              placeholder="例如 xiaowang"
              className={inputClass}
            />
          </div>
          <div>
            <label className="mb-1 block text-xs text-muted-foreground">昵称（显示用，可选）</label>
            <input
              value={newNickname}
              onChange={(event) => setNewNickname(event.target.value)}
              placeholder="例如 小王"
              className={inputClass}
            />
          </div>
          <div>
            <label className="mb-1 block text-xs text-muted-foreground">初始密码（至少 6 位）</label>
            <input
              value={newPassword}
              onChange={(event) => setNewPassword(event.target.value)}
              required
              minLength={6}
              className={inputClass}
            />
          </div>
        </div>
        <button
          type="submit"
          disabled={creating}
          className="mt-3 rounded-lg bg-brand px-4 py-2 text-sm font-medium text-brand-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          {creating ? "正在开通…" : "开通账号"}
        </button>
      </form>

      {error ? <p className="text-sm text-red-500">{error}</p> : null}
      {notice ? <p className="text-sm text-emerald-600 dark:text-emerald-400">{notice}</p> : null}

      <div className="overflow-hidden rounded-2xl border border-border">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
            <tr>
              <th className="px-4 py-2.5 font-medium">成员</th>
              <th className="px-4 py-2.5 font-medium">用户名</th>
              <th className="px-4 py-2.5 font-medium">角色</th>
              <th className="px-4 py-2.5 font-medium">状态</th>
              <th className="px-4 py-2.5 text-right font-medium">操作</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {users.map((user) => (
              <tr key={user.id} className="text-foreground">
                <td className="px-4 py-3">{user.nickname}</td>
                <td className="px-4 py-3 text-muted-foreground">{user.username}</td>
                <td className="px-4 py-3">
                  {user.role === "admin"
                    ? <span className="rounded-md bg-brand/10 px-1.5 py-0.5 text-xs text-brand">管理员</span>
                    : <span className="text-xs text-muted-foreground">成员</span>}
                </td>
                <td className="px-4 py-3">
                  {user.status === "active"
                    ? <span className="text-xs text-emerald-600 dark:text-emerald-400">正常</span>
                    : <span className="text-xs text-red-500">已停用</span>}
                </td>
                <td className="px-4 py-3">
                  <div className="flex flex-wrap justify-end gap-1.5">
                    <button
                      type="button"
                      onClick={() => handleResetPassword(user)}
                      className="rounded-md border border-border px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                    >
                      重置密码
                    </button>
                    <button
                      type="button"
                      onClick={() => handleToggleStatus(user)}
                      className="rounded-md border border-border px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                    >
                      {user.status === "active" ? "停用" : "启用"}
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDelete(user)}
                      className="rounded-md border border-red-200 px-2 py-1 text-xs text-red-500 transition-colors hover:bg-red-50 dark:border-red-500/30 dark:hover:bg-red-500/10"
                    >
                      删除
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
