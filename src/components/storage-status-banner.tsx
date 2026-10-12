"use client";

import { useEffect, useState } from "react";
import {
  adoptServerValue,
  declineMigration,
  acceptMigration,
  getMigrationOffer,
  retryLoadFailedKeys,
  retrySaveFailedKeys,
  storageKeyLabel,
  subscribeStorageStatus,
  type MigrationOffer,
  type StorageStatusSnapshot
} from "@/lib/web-storage";

/**
 * 数据保存状态栏（仅网页登录模式显示）。
 * 汇总展示：加载失败 / 保存中 / 已保存 / 保存失败 / 版本冲突 / 内容过大，
 * 并提供手动重试与冲突处理入口。桌面端（本地模式）不渲染。
 */
export function StorageStatusBanner() {
  const [snapshot, setSnapshot] = useState<StorageStatusSnapshot | null>(null);
  const [offer, setOffer] = useState<MigrationOffer | null>(null);
  const [migrationBusy, setMigrationBusy] = useState(false);
  const [migrationResult, setMigrationResult] = useState("");

  useEffect(() => {
    const unsubscribe = subscribeStorageStatus((next) => {
      setSnapshot(next);
      if (next.mode === "web") setOffer(getMigrationOffer());
    });
    return unsubscribe;
  }, []);

  if (!snapshot || snapshot.mode !== "web") return null;
  const { summary, keys } = snapshot;

  const loadFailedKeys = keys.filter((k) => k.load === "failed");
  const saveFailedKeys = keys.filter((k) => k.save === "failed");
  const conflictKeys = keys.filter((k) => k.save === "conflict");
  const tooLargeKeys = keys.filter((k) => k.save === "too-large");
  const savingKeys = keys.filter((k) => k.save === "saving" && !loadFailedKeys.includes(k));

  const quiet = !loadFailedKeys.length && !saveFailedKeys.length && !conflictKeys.length && !tooLargeKeys.length && !savingKeys.length && !migrationResult;

  return (
    <>
      {!quiet && (
        <div className="fixed bottom-4 right-4 z-50 max-w-sm space-y-2">
          {loadFailedKeys.length > 0 && (
            <div className="rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-xs text-red-800 shadow-lg dark:border-red-900 dark:bg-red-950 dark:text-red-200">
              <p className="font-medium">
                数据加载失败：{loadFailedKeys.map((k) => storageKeyLabel(k.key)).join("、")}
              </p>
              <p className="mt-0.5 opacity-80">
                {loadFailedKeys[0]?.message || "这些数据没有加载完整，本页修改暂时不会上传。"}
              </p>
              <button
                type="button"
                onClick={() => void retryLoadFailedKeys()}
                className="mt-1.5 rounded border border-red-300 px-2 py-0.5 font-medium hover:bg-red-100 dark:border-red-800 dark:hover:bg-red-900"
              >
                重新加载
              </button>
            </div>
          )}
          {conflictKeys.length > 0 && (
            <div className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900 shadow-lg dark:border-amber-800 dark:bg-amber-950 dark:text-amber-100">
              <p className="font-medium">
                版本冲突：{conflictKeys.map((k) => storageKeyLabel(k.key)).join("、")}
              </p>
              <p className="mt-0.5 opacity-80">其他窗口或设备更新了同一份数据，双方版本都已保留。</p>
              <div className="mt-1.5 flex gap-2">
                <button
                  type="button"
                  onClick={() => void retrySaveFailedKeys()}
                  className="rounded border border-amber-300 px-2 py-0.5 font-medium hover:bg-amber-100 dark:border-amber-700 dark:hover:bg-amber-900"
                >
                  保留本页修改
                </button>
                <button
                  type="button"
                  onClick={() => {
                    void Promise.all(conflictKeys.map((k) => adoptServerValue(k.key))).then(() => {
                      window.location.reload();
                    });
                  }}
                  className="rounded border border-amber-300 px-2 py-0.5 hover:bg-amber-100 dark:border-amber-700 dark:hover:bg-amber-900"
                >
                  采用最新数据（刷新）
                </button>
              </div>
            </div>
          )}
          {saveFailedKeys.length > 0 && (
            <div className="rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-xs text-red-800 shadow-lg dark:border-red-900 dark:bg-red-950 dark:text-red-200">
              <p className="font-medium">
                保存失败：{saveFailedKeys.map((k) => storageKeyLabel(k.key)).join("、")}
              </p>
              <p className="mt-0.5 opacity-80">修改还保留在本页，没有丢失。</p>
              <button
                type="button"
                onClick={() => void retrySaveFailedKeys()}
                className="mt-1.5 rounded border border-red-300 px-2 py-0.5 font-medium hover:bg-red-100 dark:border-red-800 dark:hover:bg-red-900"
              >
                立即重试
              </button>
            </div>
          )}
          {tooLargeKeys.length > 0 && (
            <div className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900 shadow-lg dark:border-amber-800 dark:bg-amber-950 dark:text-amber-100">
              <p className="font-medium">
                内容过大：{tooLargeKeys.map((k) => storageKeyLabel(k.key)).join("、")}
              </p>
              <p className="mt-0.5 opacity-80">{tooLargeKeys[0]?.message || "这份内容超过了单条数据上限，暂时无法保存到服务器。"}</p>
            </div>
          )}
          {savingKeys.length > 0 && (
            <div className="rounded-lg border border-border bg-background px-3 py-2 text-xs text-muted-foreground shadow-lg">
              正在保存：{savingKeys.map((k) => storageKeyLabel(k.key)).join("、")}…
            </div>
          )}
          {migrationResult && (
            <div className="rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-2 text-xs text-emerald-800 shadow-lg dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-100">
              {migrationResult}
            </div>
          )}
        </div>
      )}

      {offer && (
        <div className="fixed bottom-4 left-1/2 z-50 w-[min(92vw,30rem)] -translate-x-1/2 rounded-xl border border-border bg-background p-4 shadow-xl">
          <p className="text-sm font-medium text-foreground">发现本机浏览器里的旧数据</p>
          <p className="mt-1 text-xs text-muted-foreground">
            服务器上还没有当前账号的 {offer.keys.length} 项数据（约 {Math.ceil(offer.totalChars / 1000)} 千字）：
            {offer.keys.slice(0, 5).map((k) => k.label).join("、")}
            {offer.keys.length > 5 ? " 等" : ""}。可以把它迁入当前账号；本机原始数据不会被删除。换浏览器或换电脑时需要重新扒取/导入。
          </p>
          <div className="mt-3 flex justify-end gap-2">
            <button
              type="button"
              disabled={migrationBusy}
              onClick={() => {
                declineMigration();
                setOffer(null);
                setMigrationResult("已跳过迁移。之后不再自动提示。");
              }}
              className="rounded-md border border-border px-3 py-1.5 text-xs hover:bg-muted disabled:opacity-50"
            >
              暂不迁入
            </button>
            <button
              type="button"
              disabled={migrationBusy}
              onClick={() => {
                setMigrationBusy(true);
                void acceptMigration().then(({ migrated }) => {
                  setMigrationBusy(false);
                  setOffer(null);
                  setMigrationResult(migrated > 0 ? `已迁入 ${migrated} 项旧数据到当前账号。` : "没有可迁入的数据。");
                });
              }}
              className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
            >
              {migrationBusy ? "迁入中…" : "迁入当前账号"}
            </button>
          </div>
        </div>
      )}
    </>
  );
}
