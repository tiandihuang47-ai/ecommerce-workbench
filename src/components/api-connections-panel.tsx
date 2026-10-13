"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { capabilityLabels, kindCapabilities, kindLabels, type ApiSetupSummary, type ConnectionProtocol, type ModelKind, type SetupCapability } from "@/lib/model-router/settings-types";

const selectClass = "h-10 w-full rounded-lg border border-border bg-background px-3 text-sm";
const fieldClass = "space-y-1.5 text-sm";
const routeNames: Record<string, string> = { ai_chat: "AI 对话", script_generation: "脚本生成", script_rewrite: "脚本改稿", script_direction_recommendation: "创作方向", script_qa: "脚本问答", script_analysis: "参考素材分析", topic_generation: "选题", interview_generation: "采访提纲", deconstruction_analysis: "拆片分析", editing_plan: "剪辑建议", link_deconstruction_rewrite: "原创仿写", comment_insight: "评论洞察", douyin_comment_insight: "抖音评论分析", workflow_ai: "AI 工作流", product_document_structure: "产品资料整理", skill_verify: "Skill 验证", marketing_intent: "营销意图", marketing_strategy: "营销策略", marketing_creative_plan: "营销文案", marketing_review: "营销复盘", image_task_planning: "生图策划", commerce_selling_point_cards: "卖点提炼", commerce_chat: "生图对话", replica_dialogue_adaptation: "复刻文案", replica_prompt_refine: "复刻提示词", replica_chat: "复刻对话", replica_self_check: "复刻自检", product_image_understanding: "产品看图", commerce_image_quality_check: "图片质检", video_understanding: "视频画面分析", speech_to_text: "语音转写", image_generation: "生图" };

export function ApiConnectionsPanel({ onSaved }: { onSaved: () => void }) {
  const [summary, setSummary] = useState<ApiSetupSummary | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [connectionId, setConnectionId] = useState("");
  const [name, setName] = useState("我的 API");
  const [baseUrl, setBaseUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [protocol, setProtocol] = useState<ConnectionProtocol>("openai_compatible");
  const [kind, setKind] = useState<ModelKind>("text");
  const [modelId, setModelId] = useState("");
  const [models, setModels] = useState<string[]>([]);
  const [applyDefault, setApplyDefault] = useState(true);
  const [audio, setAudio] = useState<{ base64: string; format: string } | null>(null);
  useEffect(() => { void reload(); }, []);
  async function reload() {
    try {
      const response = await fetch("/api/settings/connections", { cache: "no-store" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || data.error || "配置读取失败，请刷新重试。");
      setSummary(data);
    } catch (e) { setMessage(e instanceof Error ? e.message : "配置读取失败。"); }
  }
  async function post(body: Record<string, unknown>) {
    const response = await fetch("/api/settings/connections", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const data = await response.json();
    if (!response.ok || !data.success) throw new Error(data.message || data.error || "操作失败。");
    return data;
  }
  async function run(action: () => Promise<void>) {
    setBusy(true); setMessage("");
    try { await action(); }
    catch (e) { setMessage(e instanceof Error ? e.message : "操作失败。"); }
    finally { setBusy(false); }
  }
  function chooseConnection(id: string) {
    setConnectionId(id); setApiKey(""); setModels([]); setModelId("");
    const c = summary?.connections.find((item) => item.id === id);
    setName(c?.name || "我的 API"); setBaseUrl(c?.baseUrl || ""); setProtocol(c?.protocol || "openai_compatible");
  }
  async function save() {
    if (!summary) return;
    await run(async () => {
      const next = await post({ action: "connect", revision: summary.revision, connectionId: connectionId || undefined, name, baseUrl, apiKey, protocol, kind, modelId, applyDefault }) as ApiSetupSummary;
      setSummary(next); setApiKey("");
      const c = connectionId || next.connections[next.connections.length - 1]?.id;
      if (c) setConnectionId(c);
      setMessage(applyDefault ? `${capabilityLabels[kindCapabilities[kind]]}模型已保存并启用，无需重启。可以验证连接或直接开始使用。` : "模型已保存，可在下方高级配置中分配给功能。");
      onSaved();
    });
  }
  async function assign(body: Record<string, unknown>) {
    if (!summary) return;
    await run(async () => { setSummary(await post({ action: "assign", revision: summary.revision, ...body })); setMessage("功能分配已保存并生效。"); onSaved(); });
  }
  async function verify(alias: string) {
    if (!summary || !window.confirm("验证会调用一次所选模型，可能产生费用。生图验证会生成一张测试图。继续吗？")) return;
    await run(async () => {
      const next = await post({ action: "verify", revision: summary.revision, alias, audioBase64: audio?.base64, audioFormat: audio?.format });
      setSummary(next); setMessage(next.message || "对应能力已验证。"); onSaved();
    });
  }
  async function loadAudio(file?: File) {
    setAudio(null);
    if (!file) return;
    const format = file.name.toLowerCase().endsWith(".wav") ? "wav" : file.name.toLowerCase().endsWith(".mp3") ? "mp3" : "";
    if (!format || file.size > 1024 * 1024) { setMessage("请选择 1MB 以内、含有人声的 MP3 或 WAV 文件。"); return; }
    const bytes = new Uint8Array(await file.arrayBuffer());
    let binary = ""; for (const byte of bytes) binary += String.fromCharCode(byte);
    setAudio({ base64: btoa(binary), format });
  }
  const kinds = Object.keys(kindLabels) as ModelKind[];
  return <section aria-label="统一 API 配置" className="mb-6 space-y-5 rounded-2xl border border-border bg-card p-5 md:p-6">
    <div><h2 className="text-lg font-semibold">用你自己的 API，快速开始</h2><p className="mt-1 text-sm text-muted-foreground">先配一个文字模型，对话、脚本、选题和复盘等共用。看图、生图和语音按需添加。</p></div>
    {message ? <p role="status" className="rounded-lg bg-muted p-3 text-sm">{message}</p> : null}
    {!summary ? <Button variant="outline" onClick={() => void reload()}>重新读取配置</Button> : <>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {(Object.entries(capabilityLabels) as [SetupCapability, string][]).map(([cap, label]) => {
          const routes = summary.routes.filter((r) => r.capability === cap);
          const configured = routes.filter((r) => r.configured).length;
          const model = summary.models.find((m) => m.alias === summary.defaults[cap]);
          return <div key={cap} className="rounded-lg border border-border p-3"><div className="font-medium">{label} · {configured ? `${configured}/${routes.length} 项已配置` : "按需配置"}</div><p className="mt-1 break-all text-xs text-muted-foreground">{model ? model.modelId : "沿用原有组合"}</p><p className="mt-1 text-xs text-muted-foreground">{model ? model.verifiedAt ? "此模型的对应能力已验证" : "已保存，尚未真实调用验证" : "原有配置保留；状态表示已填写连接"}</p></div>;
        })}
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <label className={fieldClass}>API 连接<select aria-label="API 连接" className={selectClass} value={connectionId} onChange={(e) => chooseConnection(e.target.value)} disabled={busy}><option value="">添加新的 API</option>{summary.connections.map((c) => <option key={c.id} value={c.id}>{c.name}（复用已保存的 Key）</option>)}</select></label>
        <label className={fieldClass}>这次配置什么<select aria-label="模型用途" className={selectClass} value={kind} onChange={(e) => setKind(e.target.value as ModelKind)} disabled={busy}>{kinds.map((k) => <option key={k} value={k}>{kindLabels[k]}</option>)}</select></label>
        {!connectionId ? <label className={fieldClass}>服务商<select aria-label="服务商" className={selectClass} defaultValue="" onChange={(e) => {
          if (!e.target.value) { setName("我的 API"); setBaseUrl(""); setProtocol("openai_compatible"); setModels([]); return; }
          const p = summary.presets[Number(e.target.value)]; if (p) { setName(p.name); setBaseUrl(p.baseUrl); setProtocol(p.protocol); setModels([]); }
        }} disabled={busy}><option value="">自定义 / 中转 API</option>{summary.presets.map((p, i) => <option key={`${p.name}-${i}`} value={i}>{p.name}</option>)}</select></label> : null}
        <label className={fieldClass}>API 地址<Input aria-label="API 地址" value={baseUrl} onChange={(e) => { setBaseUrl(e.target.value); setModels([]); }} placeholder="粘贴服务商提供的 Base URL" disabled={busy} /></label>
        <label className={fieldClass}>API Key<Input aria-label="API Key" type="password" autoComplete="new-password" value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder={connectionId ? "已保存；留空继续使用，填入可替换" : "粘贴你自己的 API Key"} disabled={busy} /></label>
        <label className={fieldClass}>模型名称<Input aria-label="模型名称" list="api-model-options" value={modelId} onChange={(e) => setModelId(e.target.value)} placeholder="选择列表中的模型，或直接填写名称" disabled={busy} /><datalist id="api-model-options">{models.map((id) => <option key={id} value={id} />)}</datalist></label>
      </div>
      <details className="text-sm"><summary className="cursor-pointer text-muted-foreground">连接名称与接口格式</summary><div className="mt-3 grid gap-3 md:grid-cols-2"><label className={fieldClass}>连接名称<Input aria-label="连接名称" value={name} onChange={(e) => setName(e.target.value)} disabled={busy} /></label><label className={fieldClass}>接口格式<select aria-label="接口格式" className={selectClass} value={protocol} onChange={(e) => setProtocol(e.target.value as ConnectionProtocol)} disabled={busy}><option value="openai_compatible">OpenAI 兼容（多数服务商和中转站）</option><option value="anthropic_compatible">Anthropic Messages（文字）</option></select></label></div></details>
      <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={applyDefault} onChange={(e) => setApplyDefault(e.target.checked)} disabled={busy} className="mt-1" /><span>设为默认{capabilityLabels[kindCapabilities[kind]]}模型，供所有对应功能共用{kind === "text" ? "（包括复刻文案）" : ""}</span></label>
      <div className="flex flex-wrap gap-3"><Button disabled={busy || !modelId.trim() || !baseUrl.trim() || (!apiKey && !connectionId)} onClick={() => void save()}>{busy ? "正在处理…" : "保存并启用"}</Button><Button variant="outline" disabled={busy || !baseUrl || (!apiKey && !connectionId)} onClick={() => void run(async () => { const data = await post({ action: "discover", connectionId: connectionId || undefined, name, baseUrl, apiKey, protocol }); setModels(data.models || []); setMessage(data.models?.length ? `获取到 ${data.models.length} 个模型，可在模型名称框中选择；能力需单独验证。` : "服务商未返回列表，请直接填写模型名称。"); })}>获取模型列表</Button></div>
      <p className="text-xs text-muted-foreground">保存不会调用模型。Key 只存在这台机器的私有配置中，页面不会读回明文；修改后立即生效。</p>
      {connectionId ? <p className="text-xs text-muted-foreground">修改此连接的地址、Key 或接口格式，会同时影响所有共用此连接的模型。</p> : null}
      {summary.models.some((m) => m.connectionId) ? <div className="space-y-2 border-t border-border pt-4"><h3 className="text-sm font-medium">已添加的模型</h3>{summary.models.filter((m) => m.connectionId).map((m) => <div key={m.alias} className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-muted/50 p-3"><div className="min-w-0 text-sm"><p className="break-all">{m.label}</p><p className="text-xs text-muted-foreground">{m.kind ? kindLabels[m.kind] : ""} · {m.verifiedAt ? "对应能力已验证" : "待验证"}</p></div><Button size="sm" variant="outline" disabled={busy || !summary.routes.some((r) => r.alias === m.alias)} onClick={() => void verify(m.alias)}>验证此模型</Button></div>)}{summary.models.some((m) => m.kind?.startsWith("audio")) ? <label className={fieldClass}>语音验证用音频（MP3 / WAV，1MB 以内）<Input aria-label="语音验证音频" type="file" accept=".mp3,.wav" onChange={(e) => void loadAudio(e.target.files?.[0])} disabled={busy} /></label> : null}</div> : null}
      <details className="border-t border-border pt-4"><summary className="cursor-pointer font-medium">高级：多个模型组合与逐功能分配</summary><p className="mt-3 text-sm text-muted-foreground">统一默认只影响对应能力。这里可以给某个功能单独选模型；未设置时沿用原来的组合。</p>
        <div className="mt-4 grid gap-3 md:grid-cols-2">{(Object.entries(capabilityLabels) as [SetupCapability, string][]).map(([cap, label]) => <label className={fieldClass} key={cap}>默认{label}模型<select aria-label={`默认${label}模型`} className={selectClass} value={summary.defaults[cap] || ""} disabled={busy} onChange={(e) => void assign({ defaults: { [cap]: e.target.value } })}><option value="">沿用原有组合</option>{summary.models.filter((m) => m.capabilities.includes(cap)).map((m) => <option key={m.alias} value={m.alias} disabled={!m.configured}>{m.label}{!m.configured ? "（未配 Key）" : ""}</option>)}</select></label>)}</div>
        <div className="mt-4 grid gap-3 md:grid-cols-2">{summary.routes.map((r) => <label className={fieldClass} key={r.key}>{routeNames[r.key] || r.label}<select aria-label={`功能模型：${routeNames[r.key] || r.label}`} className={selectClass} value={summary.overrides[r.key] || ""} disabled={busy} onChange={(e) => void assign({ routeKey: r.key, alias: e.target.value })}><option value="">跟随默认 / 原有配置</option>{summary.models.filter((m) => m.capabilities.includes(r.capability)).map((m) => <option key={m.alias} value={m.alias} disabled={!m.configured}>{m.label}</option>)}</select><p className="break-all text-xs text-muted-foreground">当前：{r.modelId} · {r.configured ? "已配连接" : "缺少 Key"}</p></label>)}</div>
        <Button className="mt-4" variant="outline" disabled={busy} onClick={() => { if (window.confirm("恢复项目原有的模型组合？新增 API 连接和历史内容都会保留。")) void assign({ restore: true }); }}>恢复原有模型组合</Button>
      </details>
    </>}
  </section>;
}
