"use client";

import { useEffect, useState } from "react";

export type AuthUser = {
  id: string;
  username: string;
  nickname: string;
  role: "admin" | "user";
  status: "active" | "disabled";
};

export type AuthState = {
  loading: boolean;
  /** 桌面端为 false（无需登录）；网页端为 true */
  authEnabled: boolean;
  /** 系统是否已有账号（决定首次进入是去初始化还是登录） */
  initialized: boolean;
  user: AuthUser | null;
};

const initial: AuthState = { loading: true, authEnabled: true, initialized: true, user: null };

let cached: AuthState | null = null;
let inflight: Promise<AuthState> | null = null;

export async function fetchAuthState(force = false): Promise<AuthState> {
  if (!force && cached) return cached;
  if (inflight) return inflight;
  inflight = fetch("/api/auth/me", { cache: "no-store" })
    .then((res) => (res.ok ? res.json() : { authEnabled: true, initialized: false, user: null }))
    .then((data: Omit<AuthState, "loading">) => {
      cached = { ...data, loading: false };
      return cached;
    })
    .catch(() => ({ loading: false, authEnabled: true, initialized: false, user: null }))
    .finally(() => {
      inflight = null;
    });
  return inflight;
}

export function invalidateAuthState() {
  cached = null;
}

export function useAuthUser(): AuthState {
  const [state, setState] = useState<AuthState>(cached ?? initial);

  useEffect(() => {
    let mounted = true;
    fetchAuthState().then((next) => {
      if (mounted) setState(next);
    });
    return () => {
      mounted = false;
    };
  }, []);

  return state;
}

export async function logout() {
  try {
    await fetch("/api/auth/logout", { method: "POST" });
  } finally {
    invalidateAuthState();
    window.location.href = "/login";
  }
}
