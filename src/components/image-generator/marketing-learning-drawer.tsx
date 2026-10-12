"use client";

import { useCallback, useEffect, useState } from "react";
import { X } from "lucide-react";
import type { CreativeRecord, Experiment, LearningGoal, MarketingReview, PerformanceAnalysis, PerformanceRecord } from "@/lib/marketing-learning/types";
import { formatMetric } from "@/lib/marketing-learning/metrics";
import {
  createExperiment,
  fetchAnalysis,
  fetchCreativeDetail,
  fetchExperiments,
  fetchHistory,
  fetchOverview,
  importCsv,
  postPerformance,
  previewCsv,
  runReview,
  type CreativeDetailApi,
  type CreativeHistoryApiItem,
  type LearningOverviewApi
} from "@/lib/marketing-learning-client";

const GOALS: Array<{ value: LearningGoal; label: string }> = [
  { value: "traffic", label: "流量" },
  { value: "engagement", label: "互动" },
  { value: "product_click", label: "商品点击" },
  { value: "conversion", label: "转化" }
];

const METRIC_FIELDS: Array<{ key: string; label: string }> = [
  { key: "impressions", label: "曝光" },
  { key: "views", label: "播放/浏览" },
  { key: "likes", label: "点赞" },
  { key: "comments", label: "评论" },
  { key: "favorites", label: "收藏" },
  { key: "shares", label: "分享" },
  { key: "productClicks", label: "商品点击" },
  { key: "orders", label: "订单" },
  { key: "gmv", label: "GMV" }
];

const CSV_FIELDS = ["", "creativeId", "platform", "publishedAt", "postId", "postUrl", "impressions", "views", "clicks", "productClicks", "likes", "comments", "shares", "favorites", "follows", "orders", "gmv"];

export function MarketingLearningDrawer(props: {
  open: boolean;
  taskId?: string;
  versionId?: string;
  creativeId?: string;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<"creatives" | "experiments">("creatives");
  const [history, setHistory] = useState<CreativeHistoryApiItem[]>([]);
  const [overview, setOverview] = useState<LearningOverviewApi | null>(null);
  const [experiments, setExperiments] = useState<Array<Experiment & { creativeCount: number; productName: string }>>([]);
  const [selectedId, setSelectedId] = useState("");
  const [detail, setDetail] = useState<CreativeDetailApi | null>(null);
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");
  const [form, setForm] = useState<Record<string, string>>({});
  const [review, setReview] = useState<MarketingReview | null>(null);
  const [csvText, setCsvText] = useState("");
  const [csvPreview, setCsvPreview] = useState<{ headers: string[]; sampleRows: string[][]; totalRows: number; suggestedMapping: Record<string, string>; metricKeys: string[] } | null>(null);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [defaultCreativeId, setDefaultCreativeId] = useState("");
  const [experimentName, setExperimentName] = useState("");
  const [experimentGoal, setExperimentGoal] = useState<LearningGoal>("traffic");
  const [experimentPick, setExperimentPick] = useState<string[]>([]);
  const [analysis, setAnalysis] = useState<PerformanceAnalysis | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [historyPayload, overviewPayload, experimentPayload] = await Promise.all([fetchHistory(), fetchOverview(), fetchExperiments()]);
      setHistory(historyPayload.history || []);
      setOverview(overviewPayload.overview || null);
      setExperiments(experimentPayload.experiments || []);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "读取营销记录失败。");
    }
  }, []);

  const loadDetail = useCallback(async (creativeId: string) => {
    try {
      const payload = await fetchCreativeDetail(creativeId);
      setDetail(payload);
      setReview(payload.reviews?.[0] || null);
      setForm({
        platform: payload.creative.platform || "",
        publishedAt: "",
        impressions: "",
        views: "",
        likes: "",
        comments: "",
        favorites: "",
        shares: "",
        productClicks: "",
        orders: "",
        gmv: ""
      });
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "读取创意详情失败。");
    }
  }, []);

  useEffect(() => { if (props.open) void refresh(); }, [props.open, refresh]);

  useEffect(() => {
    if (!props.open) return;
    if (props.creativeId) { setSelectedId(props.creativeId); return; }
    if (props.versionId) {
      const found = history.find((item) => item.creative.versionId === props.versionId);
      if (found) setSelectedId(found.creative.creativeId);
    }
  }, [props.open, props.creativeId, props.versionId, history]);

  useEffect(() => { if (props.open && selectedId) void loadDetail(selectedId); }, [props.open, selectedId, loadDetail]);

  if (!props.open) return null;

  async function submitPerformance() {
    if (!detail) return;
    setBusy("performance");
    try {
      const metrics: Record<string, string> = {};
      for (const field of METRIC_FIELDS) metrics[field.key] = form[field.key] || "";
      const payload = await postPerformance({
        creativeId: detail.creative.creativeId,
        platform: form.platform || detail.creative.platform,
        publishedAt: form.publishedAt || "",
        metrics
      });
      setMessage(payload.message);
      await loadDetail(detail.creative.creativeId);
      await refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "记录数据失败。");
    } finally {
      setBusy("");
    }
  }

  async function doPreview() {
    setBusy("csv");
    try {
      const payload = await previewCsv(csvText);
      setCsvPreview(payload.preview);
      setMapping(payload.preview.suggestedMapping || {});
      setMessage("已解析 " + payload.preview.totalRows + " 行，请确认字段映射。");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "CSV 解析失败。");
    } finally {
      setBusy("");
    }
  }

  async function doImport() {
    setBusy("csv");
    try {
      const payload = await importCsv({ text: csvText, mapping, defaultCreativeId: defaultCreativeId || selectedId });
      setMessage(payload.message + (payload.result.errors.length ? "（" + payload.result.errors.length + " 行有问题）" : ""));
      await refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "CSV 导入失败。");
    } finally {
      setBusy("");
    }
  }

  async function doReview() {
    if (!detail) return;
    setBusy("review");
    try {
      const payload = await runReview({ creativeIds: [detail.creative.creativeId], goal: undefined });
      setReview(payload.review);
      setMessage("复盘已生成（基于真实数据）。");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "复盘失败。");
    } finally {
      setBusy("");
    }
  }

  async function doCreateExperiment() {
    setBusy("experiment");
    try {
      await createExperiment({ name: experimentName, goal: experimentGoal, creativeIds: experimentPick });
      setMessage("营销实验已创建。");
      setExperimentName("");
      setExperimentPick([]);
      await refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "创建实验失败。");
    } finally {
      setBusy("");
    }
  }

  async function doCompare(experimentId: string) {
    setBusy("compare");
    try {
      const payload = await fetchAnalysis({ experimentId, goal: experimentGoal });
      setAnalysis(payload.analysis || null);
      setTab("experiments");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "对比失败。");
    } finally {
      setBusy("");
    }
  }

  function updateForm(key: string, value: string) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  return (
    <div className="fixed inset-0 z-[60] bg-black/40 backdrop-blur-[1px]" onClick={props.onClose}>
      <aside
        className="anim-fade-up absolute right-0 top-0 flex h-full w-[860px] max-w-[96vw] flex-col border-l border-line bg-surface"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex shrink-0 items-center justify-between border-b border-line px-4 py-3">
          <div className="flex items-center gap-3">
            <span className="text-[14px] font-medium text-ink-1">营销学习闭环</span>
            <div className="flex items-center gap-1 rounded-lg border border-line p-0.5">
              <TabButton active={tab === "creatives"} onClick={() => setTab("creatives")}>创意记录</TabButton>
              <TabButton active={tab === "experiments"} onClick={() => setTab("experiments")}>营销实验</TabButton>
            </div>
            {overview ? <span className="text-[11.5px] text-ink-3">创意 {overview.creativeCount} · 数据 {overview.performanceCount} · 实验 {overview.experimentCount}</span> : null}
          </div>
          <button type="button" aria-label="关闭" onClick={props.onClose} className="rounded-lg p-1 text-ink-3 hover:bg-surface-2 hover:text-ink-1"><X className="h-4 w-4" /></button>
        </div>

        {message ? <div className="shrink-0 border-b border-line bg-surface-2 px-4 py-2 text-[12px] text-ink-2">{message}</div> : null}

        <div className="flex min-h-0 flex-1">
          <div className="w-[300px] shrink-0 overflow-y-auto border-r border-line p-2 scrollbar-subtle">
            {history.length ? history.map((item) => (
              <button
                key={item.creative.creativeId}
                type="button"
                onClick={() => setSelectedId(item.creative.creativeId)}
                className={"flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-left transition-colors " + (selectedId === item.creative.creativeId ? "bg-surface-2" : "hover:bg-surface-2")}
              >
                {item.creative.outputImageUrl ? <img src={item.creative.outputImageUrl} alt="" className="h-12 w-9 shrink-0 rounded-md border border-line object-cover" /> : <span className="h-12 w-9 shrink-0 rounded-md border border-line" />}
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[12.5px] text-ink-1">{item.creative.productName || "未命名商品"}</span>
                  <span className="mt-0.5 block truncate text-[11px] text-ink-3">{item.creative.strategyKey} · {item.creative.platform}</span>
                  <span className="mt-0.5 block text-[11px] text-ink-3">
                    {item.performance ? item.performance.coreMetric.label + " " + formatMetric(item.performance.coreMetric.key, item.performance.coreMetric.value) : "暂无数据"}
                  </span>
                </span>
              </button>
            )) : <p className="p-6 text-center text-[12.5px] text-ink-3">还没有生成过营销图片</p>}
          </div>

          <div className="min-w-0 flex-1 overflow-y-auto p-4 scrollbar-subtle">
            {tab === "creatives" ? (
              detail ? (
                <div className="space-y-4">
                  <CreativeLineage creative={detail.creative} />
                  <PerformanceSection records={detail.performance} />

                  <section className="rounded-xl border border-line p-3">
                    <h3 className="text-[13px] font-medium text-ink-1">记录发布数据</h3>
                    <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3">
                      <Field label="平台" value={form.platform || ""} onChange={(value) => updateForm("platform", value)} placeholder="xiaohongshu" />
                      <Field label="发布日期" value={form.publishedAt || ""} onChange={(value) => updateForm("publishedAt", value)} placeholder="2026-09-20" />
                      {METRIC_FIELDS.map((field) => (
                        <Field key={field.key} label={field.label} value={form[field.key] || ""} onChange={(value) => updateForm(field.key, value)} placeholder="留空表示没有" />
                      ))}
                    </div>
                    <button type="button" disabled={busy === "performance"} onClick={() => void submitPerformance()} className="mt-3 rounded-lg bg-brand-solid px-3 py-1.5 text-[12.5px] text-white disabled:opacity-50">
                      {busy === "performance" ? "保存中…" : "保存并关联 creativeId"}
                    </button>
                  </section>

                  <CsvSection
                    csvText={csvText}
                    onCsvText={setCsvText}
                    preview={csvPreview}
                    mapping={mapping}
                    onMapping={setMapping}
                    defaultCreativeId={defaultCreativeId || selectedId}
                    onDefaultCreativeId={setDefaultCreativeId}
                    busy={busy === "csv"}
                    onPreview={() => void doPreview()}
                    onImport={() => void doImport()}
                  />

                  <section className="rounded-xl border border-line p-3">
                    <div className="flex items-center justify-between">
                      <h3 className="text-[13px] font-medium text-ink-1">营销复盘</h3>
                      <button type="button" disabled={busy === "review"} onClick={() => void doReview()} className="rounded-lg border border-line px-2.5 py-1 text-[12px] text-ink-2 hover:bg-surface-2 disabled:opacity-50">
                        {busy === "review" ? "分析中…" : "运行复盘"}
                      </button>
                    </div>
                    {review ? <ReviewView review={review} /> : <p className="mt-2 text-[12px] text-ink-3">复盘只基于已录入的真实数据，不会自动修改营销规则。</p>}
                  </section>
                </div>
              ) : <p className="p-8 text-center text-[13px] text-ink-3">左侧选择一条创意记录</p>
            ) : (
              <div className="space-y-4">
                <section className="rounded-xl border border-line p-3">
                  <h3 className="text-[13px] font-medium text-ink-1">新建营销实验</h3>
                  <p className="mt-1 text-[11.5px] text-ink-3">把同一个商品、同一轮比较的创意放在一起，之后才能判断哪种策略更适合。</p>
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <input value={experimentName} onChange={(event) => setExperimentName(event.target.value)} placeholder="实验名称，例如：羽绒服策略对比" className="min-w-[220px] flex-1 rounded-lg border border-line bg-surface px-2.5 py-1.5 text-[12.5px] text-ink-1" />
                    <select value={experimentGoal} onChange={(event) => setExperimentGoal(event.target.value as LearningGoal)} className="rounded-lg border border-line bg-surface px-2 py-1.5 text-[12.5px] text-ink-1">
                      {GOALS.map((goal) => <option key={goal.value} value={goal.value}>{goal.label}</option>)}
                    </select>
                    <button type="button" disabled={busy === "experiment"} onClick={() => void doCreateExperiment()} className="rounded-lg bg-brand-solid px-3 py-1.5 text-[12.5px] text-white disabled:opacity-50">创建</button>
                  </div>
                  <div className="mt-2 max-h-[180px] space-y-1 overflow-y-auto">
                    {history.map((item) => (
                      <label key={item.creative.creativeId} className="flex items-center gap-2 rounded-lg px-2 py-1 text-[12px] text-ink-2 hover:bg-surface-2">
                        <input type="checkbox" checked={experimentPick.includes(item.creative.creativeId)} onChange={(event) => setExperimentPick((current) => event.target.checked ? [...current, item.creative.creativeId] : current.filter((id) => id !== item.creative.creativeId))} />
                        <span className="min-w-0 flex-1 truncate">{item.creative.productName} · {item.creative.strategyKey} · {item.creative.creativeId.slice(0, 14)}</span>
                      </label>
                    ))}
                  </div>
                </section>

                <section className="rounded-xl border border-line p-3">
                  <h3 className="text-[13px] font-medium text-ink-1">已有实验</h3>
                  <div className="mt-2 space-y-1.5">
                    {experiments.length ? experiments.map((experiment) => (
                      <div key={String(experiment.experimentId)} className="flex items-center justify-between rounded-lg border border-line px-2.5 py-2">
                        <span className="min-w-0">
                          <span className="block truncate text-[12.5px] text-ink-1">{String(experiment.name)}</span>
                          <span className="text-[11px] text-ink-3">{String(experiment.productName || "")} · {String(experiment.creativeCount || 0)} 个创意 · 目标 {String(experiment.goal)}</span>
                        </span>
                        <button type="button" disabled={busy === "compare"} onClick={() => void doCompare(String(experiment.experimentId))} className="shrink-0 rounded-lg border border-line px-2.5 py-1 text-[12px] text-ink-2 hover:bg-surface-2">对比</button>
                      </div>
                    )) : <p className="text-[12px] text-ink-3">还没有实验。</p>}
                  </div>
                </section>

                {analysis ? <AnalysisView analysis={analysis} /> : null}
              </div>
            )}
          </div>
        </div>
      </aside>
    </div>
  );
}

function CreativeLineage(props: { creative: CreativeRecord }) {
  const creative = props.creative;
  const rows: Array<[string, string]> = [
    ["creativeId", creative.creativeId],
    ["商品", creative.productName + (creative.category ? "（" + creative.category + "）" : "")],
    ["平台 / 目标", creative.platform + " / " + creative.businessGoal],
    ["用户需求", creative.userRequest || "（未填写）"],
    ["营销策略", creative.marketingStrategy + "（" + creative.strategyKey + " v" + creative.strategyVersion + "）"],
    ["核心痛点", creative.primaryPainPoint],
    ["主卖点", creative.primarySellingPoint],
    ["辅助卖点", (creative.secondarySellingPoints || []).join(" / ")]
  ];
  const copy = [creative.headline, creative.subheadline, creative.cta].filter(Boolean).join(" ｜ ");
  const versions = [
    "策略 " + creative.strategyVersion,
    "Prompt 编译 " + creative.promptCompilerVersion,
    "商品高保真 " + creative.productFidelityVersion,
    "排版 " + creative.typographyVersion,
    "文案 " + creative.copyRuleVersion,
    "平台 " + creative.platformRuleVersion,
    "质检 " + creative.qaVersion
  ].join(" · ");
  return (
    <section className="rounded-xl border border-line p-3">
      <div className="flex items-start gap-3">
        {creative.outputImageUrl ? <img src={creative.outputImageUrl} alt="" className="h-40 w-30 shrink-0 rounded-lg border border-line object-cover" /> : null}
        <div className="min-w-0 flex-1 space-y-1">
          {rows.map(([label, value]) => (
            <p key={label} className="text-[12px] leading-5 text-ink-2"><span className="inline-block w-[92px] shrink-0 text-ink-3">{label}</span>{value || "—"}</p>
          ))}
          <p className="text-[12px] leading-5 text-ink-2"><span className="mr-1 inline-block w-[92px] align-top text-ink-3">画面文案</span><span className="text-ink-1">{copy || "—"}</span></p>
          <p className="pt-1 text-[11px] text-ink-3">{versions}</p>
          <p className="text-[11px] text-ink-3">模型 {creative.model} · 排版模板 {creative.layoutType} · 生成 {creative.generationCount} 张</p>
          <details className="pt-1">
            <summary className="cursor-pointer text-[11.5px] text-ink-3">查看完整 Prompt</summary>
            <pre className="mt-1 max-h-[220px] overflow-auto whitespace-pre-wrap rounded-lg bg-surface-2 p-2 text-[11px] leading-4 text-ink-2">{creative.compiledPrompt}</pre>
          </details>
        </div>
      </div>
    </section>
  );
}

function PerformanceSection(props: { records: PerformanceRecord[] }) {
  if (!props.records.length) return <section className="rounded-xl border border-line p-3 text-[12px] text-ink-3">还没有发布数据。生成时不需要填，发布后再补即可。</section>;
  return (
    <section className="rounded-xl border border-line p-3">
      <h3 className="text-[13px] font-medium text-ink-1">发布数据（{props.records.length} 条）</h3>
      <div className="mt-2 space-y-1.5">
        {props.records.map((record) => (
          <div key={String(record.performanceId)} className="rounded-lg bg-surface-2 px-2.5 py-2 text-[11.5px] leading-5 text-ink-2">
            {String(record.platform || "")} · {String(record.publishedAt || record.dataCapturedAt || "")} · 来源 {String(record.source || "")}
            <br />
            {METRIC_FIELDS.map((field) => {
              const value = record.metrics[field.key as keyof PerformanceRecord["metrics"]];
              return value === null || value === undefined ? null : <span key={field.key} className="mr-3 inline-block">{field.label} {formatMetric(field.key, value)}</span>;
            })}
          </div>
        ))}
      </div>
    </section>
  );
}

function CsvSection(props: {
  csvText: string;
  onCsvText: (value: string) => void;
  preview: { headers: string[]; sampleRows: string[][]; totalRows: number; suggestedMapping: Record<string, string>; metricKeys: string[] } | null;
  mapping: Record<string, string>;
  onMapping: (value: Record<string, string>) => void;
  defaultCreativeId: string;
  onDefaultCreativeId: (value: string) => void;
  busy: boolean;
  onPreview: () => void;
  onImport: () => void;
}) {
  return (
    <section className="rounded-xl border border-line p-3">
      <h3 className="text-[13px] font-medium text-ink-1">CSV 导入</h3>
      <p className="mt-1 text-[11.5px] text-ink-3">从平台后台导出的数据可以先预览、再映射字段。CSV 里没有 creativeId 时，用左侧选中的创意作为默认关联。</p>
      <textarea value={props.csvText} onChange={(event) => props.onCsvText(event.target.value)} placeholder="粘贴 CSV 内容" className="mt-2 h-24 w-full rounded-lg border border-line bg-surface-2 p-2 text-[11.5px] text-ink-1" />
      <div className="mt-2 flex items-center gap-2">
        <button type="button" disabled={props.busy || !props.csvText.trim()} onClick={props.onPreview} className="rounded-lg border border-line px-2.5 py-1 text-[12px] text-ink-2 hover:bg-surface-2 disabled:opacity-50">预览并映射</button>
        <button type="button" disabled={props.busy || !props.csvText.trim() || !props.preview} onClick={props.onImport} className="rounded-lg bg-brand-solid px-2.5 py-1 text-[12px] text-white disabled:opacity-50">导入</button>
        <span className="text-[11px] text-ink-3">默认关联：{props.defaultCreativeId.slice(0, 18) || "未选择"}</span>
      </div>
      {props.preview ? (
        <div className="mt-2 space-y-1.5">
          {props.preview.headers.map((header, index) => (
            <div key={String(index)} className="flex items-center gap-2">
              <span className="w-[150px] shrink-0 truncate text-[11.5px] text-ink-2">{header || "第 " + (index + 1) + " 列"}</span>
              <select value={props.mapping[String(index)] || ""} onChange={(event) => props.onMapping({ ...props.mapping, [String(index)]: event.target.value })} className="rounded-md border border-line bg-surface px-2 py-1 text-[11.5px] text-ink-2">
                {CSV_FIELDS.map((field) => <option key={field} value={field}>{field || "（忽略）"}</option>)}
              </select>
            </div>
          ))}
          <p className="text-[11px] text-ink-3">共 {props.preview.totalRows} 行</p>
        </div>
      ) : null}
    </section>
  );
}

function ReviewView(props: { review: MarketingReview }) {
  const review = props.review;
  return (
    <div className="mt-2 space-y-2 text-[12px] leading-5 text-ink-2">
      <p className="text-ink-1">{review.summary}</p>
      <ReviewList title="表现较好" items={review.whatWorked} />
      <ReviewList title="表现较弱" items={review.whatDidNotWork} />
      <ReviewList title="可能原因" items={review.possibleReasons} />
      <p><span className="text-ink-3">策略观察：</span>{review.strategyObservation}</p>
      <p><span className="text-ink-3">文案观察：</span>{review.copyObservation}</p>
      <p><span className="text-ink-3">视觉观察：</span>{review.visualObservation}</p>
      <ReviewList title="下一轮建议" items={review.nextTestRecommendation} />
      <p className="text-[11px] text-ink-3">置信度 {review.confidence} · 样本 {review.sampleSize} · 来源 {review.source}（建议只作参考，不会自动改规则）</p>
    </div>
  );
}

function ReviewList(props: { title: string; items: string[] }) {
  if (!props.items?.length) return null;
  return (
    <div>
      <p className="text-ink-3">{props.title}</p>
      <ul className="ml-4 list-disc">{props.items.map((item, index) => <li key={String(index)}>{item}</li>)}</ul>
    </div>
  );
}

function AnalysisView(props: { analysis: PerformanceAnalysis }) {
  return (
    <section className="rounded-xl border border-line p-3">
      <h3 className="text-[13px] font-medium text-ink-1">实验对比（目标：{props.analysis.goal}）</h3>
      <div className="mt-2 space-y-1.5">
        {props.analysis.creatives.map((item) => (
          <div key={item.creativeId} className="flex items-center justify-between rounded-lg bg-surface-2 px-2.5 py-2 text-[12px] text-ink-2">
            <span className="min-w-0 truncate">{item.strategyKey} · {item.primarySellingPoint || "未标注"}</span>
            <span className="shrink-0 text-ink-1">{item.coreMetric.label} {formatMetric(item.coreMetric.key, item.coreMetric.value)}</span>
          </div>
        ))}
      </div>
      <div className="mt-2 space-y-0.5">
        {props.analysis.caveats.map((item, index) => <p key={String(index)} className="text-[11px] text-ink-3">{item}</p>)}
      </div>
    </section>
  );
}

function Field(props: { label: string; value: string; onChange: (value: string) => void; placeholder?: string }) {
  return (
    <label className="block">
      <span className="mb-0.5 block text-[11px] text-ink-3">{props.label}</span>
      <input value={props.value} onChange={(event) => props.onChange(event.target.value)} placeholder={props.placeholder} className="w-full rounded-lg border border-line bg-surface px-2 py-1.5 text-[12px] text-ink-1" />
    </label>
  );
}

function TabButton(props: { active: boolean; onClick: () => void; children: string }) {
  return (
    <button type="button" onClick={props.onClick} className={"rounded-md px-2 py-0.5 text-[12px] " + (props.active ? "bg-surface-2 text-ink-1" : "text-ink-3 hover:text-ink-1")}>{props.children}</button>
  );
}
