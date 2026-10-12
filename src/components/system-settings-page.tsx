"use client";

import { useEffect, useState } from "react";
import { Download, KeyRound, Loader2, RefreshCw, Save, Trash2, Upload, Zap } from "lucide-react";
import { PageHeader, SectionCard } from "@/components/design-system";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { clearAllContentCenterData, clearArchivedAssets, exportAssets, importAssets } from "@/lib/stores/asset-store";
import type { CommerceAssistantProviderStatus, CommerceImageProviderStatus } from "@/lib/commerce-image-types";

type ProviderDraft = { apiKey: string; workspaceId: string; baseUrl: string; modelId: string };
type AssistantDraft = { apiKey: string; baseUrl: string; modelId: string };

export function SystemSettingsPage() {
  const [status, setStatus] = useState({ deepseekConfigured: false, arkConfigured: false, deepseekModel: "", speechModel: "", visionModel: "", aiChatConfigured: false, aiChatModel: "", aiChatProvider: "", aiChatBaseUrl: "", loaded: false });
  const [jsonText, setJsonText] = useState("");
  const [message, setMessage] = useState("");
  const [providers, setProviders] = useState<CommerceImageProviderStatus[]>([]);
  const [providerDrafts, setProviderDrafts] = useState<Record<string, ProviderDraft>>({});
  const [providerBusy, setProviderBusy] = useState("");
  const [assistants, setAssistants] = useState<CommerceAssistantProviderStatus[]>([]);
  const [assistantDrafts, setAssistantDrafts] = useState<Record<string, AssistantDraft>>({});

  useEffect(() => {
    void loadStatus();
  }, []);

  async function loadStatus() {
    try {
      const [response, imageResponse, assistantResponse] = await Promise.all([
        fetch("/api/settings/status"),
        fetch("/api/commerce-image/providers"),
        fetch("/api/commerce-image/assistants")
      ]);
      const payload = await response.json();
      const imagePayload = await imageResponse.json();
      const assistantPayload = await assistantResponse.json();
      setStatus({
        deepseekConfigured: Boolean(payload.deepseekConfigured),
        arkConfigured: Boolean(payload.arkConfigured),
        deepseekModel: typeof payload.deepseekModel === "string" ? payload.deepseekModel : "",
        speechModel: typeof payload.speechModel === "string" ? payload.speechModel : "",
        visionModel: typeof payload.visionModel === "string" ? payload.visionModel : "",
        aiChatConfigured: Boolean(payload.aiChatConfigured),
        aiChatModel: typeof payload.aiChatModel === "string" ? payload.aiChatModel : "",
        aiChatProvider: typeof payload.aiChatProvider === "string" ? payload.aiChatProvider : "",
        aiChatBaseUrl: typeof payload.aiChatBaseUrl === "string" ? payload.aiChatBaseUrl : "",
        loaded: true,
      });
      const nextProviders = Array.isArray(imagePayload.providers) ? imagePayload.providers as CommerceImageProviderStatus[] : [];
      setProviders(nextProviders);
      setProviderDrafts((current) => Object.fromEntries(nextProviders.map((provider) => [provider.provider, {
        apiKey: current[provider.provider]?.apiKey || "",
        workspaceId: current[provider.provider]?.workspaceId || provider.workspaceId || "",
        baseUrl: current[provider.provider]?.baseUrl || provider.baseUrl || "",
        modelId: current[provider.provider]?.modelId || provider.providerModelId || ""
      }])));
      const nextAssistants = Array.isArray(assistantPayload.providers) ? assistantPayload.providers as CommerceAssistantProviderStatus[] : [];
      setAssistants(nextAssistants);
      setAssistantDrafts((current) => Object.fromEntries(nextAssistants.map((provider) => [provider.provider, {
        apiKey: current[provider.provider]?.apiKey || "",
        baseUrl: current[provider.provider]?.baseUrl || provider.baseUrl,
        modelId: current[provider.provider]?.modelId || provider.modelId
      }])));
    } catch {
      setStatus((current) => ({ ...current, loaded: true }));
    }
  }

  async function saveProvider(provider: CommerceImageProviderStatus["provider"]) {
    setProviderBusy(`save:${provider}`);
    setMessage("");
    try {
      const draft = providerDrafts[provider] || { apiKey: "", workspaceId: "", baseUrl: "", modelId: "" };
      const response = await fetch("/api/commerce-image/providers", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider, ...draft })
      });
      const payload = await response.json();
      if (!response.ok || payload.success === false) throw new Error(payload.message || "配置保存失败。");
      setProviders(payload.providers || []);
      setProviderDrafts((current) => ({ ...current, [provider]: { ...current[provider], apiKey: "" } }));
      setMessage(payload.message || "生图模型配置已保存。 ");
    } catch (error) {
      setMessage(`❌ ${error instanceof Error ? error.message : "配置保存失败。"}`);
    } finally {
      setProviderBusy("");
    }
  }

  async function testProvider(provider: CommerceImageProviderStatus["provider"]) {
    setProviderBusy(`test:${provider}`);
    setMessage("⏳ 正在连接 API…（生图通常需要 30–60 秒，请不要关闭页面）");
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 120_000);
    try {
      const draft = providerDrafts[provider] || { apiKey: "", workspaceId: "", baseUrl: "", modelId: "" };
      const response = await fetch("/api/commerce-image/providers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider, ...draft }),
        signal: controller.signal
      });
      const payload = await response.json();
      if (!response.ok || payload.success === false) {
        const detail = [payload.message, payload.code ? `code: ${payload.code}` : "", payload.category ? `category: ${payload.category}` : ""].filter(Boolean).join(" · ");
        throw new Error(detail || `HTTP ${response.status}`);
      }
      setProviders(payload.providers || []);
      setProviderDrafts((current) => ({ ...current, [provider]: { ...current[provider], apiKey: "" } }));
      setMessage(`✅ ${payload.message || "连接测试成功。"}`);
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        setMessage("❌ 请求超时（120 秒）。请检查网络连接和 API 端点是否可达。");
      } else {
        const detail = error instanceof Error ? error.message : "未知错误";
        setMessage(`❌ ${detail}`);
      }
    } finally {
      clearTimeout(timeout);
      setProviderBusy("");
    }
  }

  async function deleteProvider(provider: CommerceImageProviderStatus["provider"]) {
    if (!window.confirm("确定删除这项本机生图配置吗？环境变量中的配置不会被删除。")) return;
    setProviderBusy(`delete:${provider}`);
    try {
      const response = await fetch(`/api/commerce-image/providers?provider=${encodeURIComponent(provider)}`, { method: "DELETE" });
      const payload = await response.json();
      if (!response.ok || payload.success === false) throw new Error(payload.message || "配置删除失败。");
      setProviders(payload.providers || []);
      setProviderDrafts((current) => ({ ...current, [provider]: { apiKey: "", workspaceId: "", baseUrl: "", modelId: "" } }));
      setMessage(payload.message || "配置已删除。 ");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "配置删除失败。 ");
    } finally {
      setProviderBusy("");
    }
  }

  async function saveAssistant(provider: CommerceAssistantProviderStatus["provider"], verify = false) {
    if (verify && !window.confirm("连接测试会调用一次对应模型，可能产生少量费用。确定继续吗？")) return;
    setProviderBusy(`${verify ? "test" : "save"}:assistant:${provider}`);
    setMessage("");
    try {
      const draft = assistantDrafts[provider] || { apiKey: "", baseUrl: "", modelId: "" };
      const response = await fetch("/api/commerce-image/assistants", {
        method: verify ? "POST" : "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider, ...draft })
      });
      const payload = await response.json();
      if (!response.ok || payload.success === false) throw new Error(payload.message || "配置保存失败。");
      setAssistants(payload.providers || []);
      setAssistantDrafts((current) => ({ ...current, [provider]: { ...current[provider], apiKey: "" } }));
      setMessage(payload.message || "配置已保存。");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "配置保存失败。");
    } finally {
      setProviderBusy("");
    }
  }

  function exportData() {
    const data = exportAssets();
    const text = JSON.stringify(data, null, 2);
    setJsonText(text);
    navigator.clipboard?.writeText(text).catch(() => undefined);
    setMessage("全部数据 JSON 已生成并复制。你也可以直接选中文本另存备份。");
  }

  function importData() {
    if (!jsonText.trim()) {
      setMessage("请先粘贴要导入的 JSON 数据。");
      return;
    }
    try {
      const parsed = JSON.parse(jsonText);
      importAssets(parsed);
      setMessage("导入完成，已与当前本地数据合并。");
    } catch (error) {
      setMessage(error instanceof Error ? `导入失败：${error.message}` : "导入失败，请检查 JSON 格式。");
    }
  }

  function clearArchived() {
    if (!window.confirm("确定要清理已归档资产吗？这不会影响未归档内容。")) return;
    clearArchivedAssets();
    setMessage("已清理归档资产。");
  }

  function clearAll() {
    if (!window.confirm("确定要清空统一资产、产品、会话和设置数据吗？建议先导出备份。")) return;
    if (!window.confirm("再次确认：清空后无法在页面里恢复，除非你有 JSON 备份。")) return;
    clearAllContentCenterData();
    setMessage("统一资产系统数据已清空。旧版数据未主动删除，用于兼容和恢复。");
  }

  return (
    <div>
      <PageHeader
        eyebrow="AI 内容中台 / 系统设置"
        title="系统设置"
        description="查看 API 配置状态、主题说明和本地数据备份。不会展示任何 API Key 明文。"
        action={<Button variant="outline" onClick={loadStatus}><RefreshCw className="h-4 w-4" />刷新状态</Button>}
      />

      <div className="grid gap-5 xl:grid-cols-[360px_minmax(0,1fr)]">
        <div className="space-y-5">
          <SectionCard>
            <CardHeader>
              <CardTitle>API 配置状态</CardTitle>
              <CardDescription>状态由服务端读取 .env.local，只显示是否配置。</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <ConfigRow
                label="AI 对话（Claude Opus 5.5 · 中转站）"
                ok={status.aiChatConfigured}
                loaded={status.loaded}
                detail={`模型：${status.aiChatModel || "未知"}｜协议：Anthropic Messages${status.aiChatBaseUrl ? `｜中转站：${status.aiChatBaseUrl}` : ""}`}
              />
              <ConfigRow label="DeepSeek（脚本 / 爆款复刻 / 复盘等）" ok={status.deepseekConfigured} loaded={status.loaded} detail={`模型：${status.deepseekModel || "未知"}`} />
              <ConfigRow label="豆包语音转写（火山方舟）" ok={status.arkConfigured} loaded={status.loaded} detail={`模型：${status.speechModel || "未知"}`} />
              <ConfigRow label="豆包视觉理解（火山方舟）" ok={status.arkConfigured} loaded={status.loaded} detail={`模型：${status.visionModel || "未知"}`} />
            </CardContent>
          </SectionCard>

          <SectionCard>
            <CardHeader>
              <CardTitle>本地存储说明</CardTitle>
              <CardDescription>当前阶段使用浏览器 localStorage 保存数据，后续可迁移到 Supabase / PostgreSQL。</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2 text-sm leading-6 text-slate-500 dark:text-slate-400">
              <p>统一资产 key：CONTENT_CENTER_ASSETS_V1</p>
              <p>产品资料 key：CONTENT_CENTER_PRODUCTS_V1</p>
              <p>AI 会话 key：CONTENT_CENTER_CHAT_SESSIONS_V1</p>
              <p>旧数据会兼容迁移，不会默认清空。</p>
              <p>生图任务与图片：本机服务端专用目录（不写入 localStorage）。</p>
            </CardContent>
          </SectionCard>
        </div>

        <div className="space-y-5">
        <SectionCard>
          <CardHeader>
            <CardTitle>生图模型 API</CardTitle>
            <CardDescription>Key 仅写入本机权限隔离文件；页面、接口响应和日志都不会返回明文。留空 Key 保存时会保留原值。</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {providers.length ? providers.map((provider) => {
              const draft = providerDrafts[provider.provider] || { apiKey: "", workspaceId: provider.workspaceId || "", baseUrl: provider.baseUrl || "", modelId: provider.providerModelId || "" };
              const isBusy = providerBusy.endsWith(provider.provider);
              return (
                <div key={provider.provider} className="rounded-2xl border border-slate-200/70 bg-white/70 p-4 dark:border-slate-800 dark:bg-slate-950/35">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div><div className="flex items-center gap-2 text-sm font-semibold text-slate-950 dark:text-slate-100"><KeyRound className="h-4 w-4" />{provider.label}</div><div className="mt-1 text-xs text-slate-500">{provider.message}{provider.maskedKey ? ` · ${provider.maskedKey}` : ""}</div></div>
                    <Badge variant="secondary">{provider.configured ? provider.verifiedForCurrentConfig ? "已验证" : "待验证" : "未配置"}</Badge>
                  </div>
                  <div className="mt-4 grid gap-3 md:grid-cols-2">
                    <div className="space-y-2"><Label>API Key</Label><Input type="password" autoComplete="new-password" value={draft.apiKey} onChange={(event) => setProviderDrafts((current) => ({ ...current, [provider.provider]: { ...draft, apiKey: event.target.value } }))} placeholder={provider.configured ? "已保存；输入新 Key 可替换" : "输入 API Key"} /></div>
                    <div className="space-y-2"><Label>Model ID / Endpoint ID</Label><Input value={draft.modelId} onChange={(event) => setProviderDrafts((current) => ({ ...current, [provider.provider]: { ...draft, modelId: event.target.value } }))} /></div>
                    <div className="space-y-2 md:col-span-2"><Label>Base URL</Label><Input value={draft.baseUrl} onChange={(event) => setProviderDrafts((current) => ({ ...current, [provider.provider]: { ...draft, baseUrl: event.target.value } }))} /></div>
                  </div>
                  <div className="mt-4 flex flex-wrap gap-2"><Button size="sm" onClick={() => void saveProvider(provider.provider)} disabled={isBusy}><Save className="h-4 w-4" />保存</Button><Button size="sm" variant="outline" onClick={() => void testProvider(provider.provider)} disabled={isBusy || (!provider.configured && !draft.apiKey.trim())}>
                      {providerBusy === `test:${provider.provider}` ? <><Loader2 className="h-4 w-4 animate-spin" />正在请求…</> : <><Zap className="h-4 w-4" />生成测试图验证</>}
                    </Button>{provider.source === "local" ? <Button size="sm" variant="destructive" onClick={() => void deleteProvider(provider.provider)} disabled={isBusy}><Trash2 className="h-4 w-4" />删除本机配置</Button> : null}</div>
                </div>
              );
            }) : <p className="text-sm text-slate-500">正在读取生图模型配置……</p>}
            {message ? (
              <div className={`rounded-xl px-4 py-3 text-sm font-medium ${message.startsWith("\u2705") ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300" : message.startsWith("\u274c") ? "bg-rose-50 text-rose-700 dark:bg-rose-950/50 dark:text-rose-300" : "bg-amber-50 text-amber-700 dark:bg-amber-950/50 dark:text-amber-300"}`}>
                {message}
              </div>
            ) : null}
          </CardContent>
        </SectionCard>

        <SectionCard>
          <CardHeader>
            <CardTitle>AI 理解与对话</CardTitle>
            <CardDescription>详情长图拆解需要视觉模型，需求沟通和营销策划需要文本模型。仍兼容原 .env.local 配置。</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {assistants.map((provider) => {
              const draft = assistantDrafts[provider.provider] || { apiKey: "", baseUrl: provider.baseUrl, modelId: provider.modelId };
              const isBusy = providerBusy.endsWith(`assistant:${provider.provider}`);
              return <div key={provider.provider} className="rounded-2xl border border-slate-200/70 bg-white/70 p-4 dark:border-slate-800 dark:bg-slate-950/35">
                <div className="flex items-start justify-between gap-3"><div><div className="text-sm font-semibold text-slate-950 dark:text-slate-100">{provider.label}</div><div className="mt-1 text-xs text-slate-500">{provider.message}{provider.maskedKey ? ` · ${provider.maskedKey}` : ""}</div></div><Badge variant="secondary">{provider.configured ? provider.verifiedForCurrentConfig ? "已验证" : "待验证" : "未配置"}</Badge></div>
                <div className="mt-4 grid gap-3 md:grid-cols-2">
                  <div className="space-y-2"><Label>API Key</Label><Input type="password" autoComplete="new-password" value={draft.apiKey} onChange={(event) => setAssistantDrafts((current) => ({ ...current, [provider.provider]: { ...draft, apiKey: event.target.value } }))} placeholder={provider.configured ? "已保存；输入新 Key 可替换" : "输入 API Key"} /></div>
                  <div className="space-y-2"><Label>Model ID</Label><Input value={draft.modelId} onChange={(event) => setAssistantDrafts((current) => ({ ...current, [provider.provider]: { ...draft, modelId: event.target.value } }))} /></div>
                  <div className="space-y-2 md:col-span-2"><Label>Base URL</Label><Input value={draft.baseUrl} onChange={(event) => setAssistantDrafts((current) => ({ ...current, [provider.provider]: { ...draft, baseUrl: event.target.value } }))} /></div>
                </div>
                <div className="mt-4 flex gap-2"><Button size="sm" onClick={() => void saveAssistant(provider.provider)} disabled={isBusy}><Save className="h-4 w-4" />保存</Button><Button size="sm" variant="outline" onClick={() => void saveAssistant(provider.provider, true)} disabled={isBusy || (!provider.configured && !draft.apiKey.trim())}><Zap className="h-4 w-4" />验证连接</Button></div>
              </div>;
            })}
          </CardContent>
        </SectionCard>

        <SectionCard>
          <CardHeader>
            <CardTitle>数据管理</CardTitle>
            <CardDescription>导出备份、导入合并、清理归档或清空统一资产数据。清空前会二次确认。</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-wrap gap-2">
              <Button onClick={exportData}><Download className="h-4 w-4" />导出全部数据</Button>
              <Button variant="outline" onClick={importData}><Upload className="h-4 w-4" />导入 JSON</Button>
              <Button variant="outline" onClick={clearArchived}>清理归档</Button>
              <Button variant="destructive" onClick={clearAll}><Trash2 className="h-4 w-4" />清空本地数据</Button>
            </div>
            <Textarea className="min-h-80 font-mono text-xs" value={jsonText} onChange={(event) => setJsonText(event.target.value)} placeholder="点击“导出全部数据”生成备份，或粘贴备份 JSON 后点击“导入 JSON”。" />
          </CardContent>
        </SectionCard>
        </div>
      </div>
    </div>
  );
}

function ConfigRow({ label, ok, loaded, detail }: { label: string; ok: boolean; loaded: boolean; detail?: string }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-2xl border border-slate-200/70 bg-white/70 px-4 py-3 dark:border-slate-800 dark:bg-slate-950/40">
      <span className="text-sm font-medium text-slate-700 dark:text-slate-300">
        {label}
        {detail ? <span className="ml-2 text-xs font-normal text-slate-500 dark:text-slate-400">{detail}</span> : null}
      </span>
      <Badge variant={ok ? "secondary" : "default"}>{loaded ? (ok ? "已配置" : "未配置") : "检测中"}</Badge>
    </div>
  );
}
