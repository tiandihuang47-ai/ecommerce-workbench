import type { CommerceImageTask } from "@/lib/commerce-image-types";
import type { CommerceComposition, CommerceCreativeCommand, CommerceCreativePlan, CommerceCreativeState } from "@/lib/commerce-image-v4-types";

export class CommerceCreativeError extends Error {
  constructor(public readonly code: string, message: string, public readonly status = 400) {
    super(message);
    this.name = "CommerceCreativeError";
  }
}

function fail(field: string): never {
  throw new CommerceCreativeError("V4_VALIDATION_ERROR", `V4 数据不合法：${field}`);
}

function object(value: unknown, keys: string[], field: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(field);
  const record = value as Record<string, unknown>;
  if (Object.keys(record).some((key) => !keys.includes(key))) fail(`${field}包含未允许字段`);
  return record;
}

function text(value: unknown, field: string, max = 4000): asserts value is string {
  if (typeof value !== "string" || value.length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value)) fail(field);
}

function id(value: unknown, field: string): asserts value is string {
  if (typeof value !== "string" || !/^[a-zA-Z0-9_-]{1,160}$/.test(value)) fail(field);
}

function number(value: unknown, field: string, min: number, max: number, integer = false): asserts value is number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max || (integer && !Number.isSafeInteger(value))) fail(field);
}

function enumeration(value: unknown, values: readonly unknown[], field: string) {
  if (!values.includes(value)) fail(field);
}

function array(value: unknown, field: string, max = 10000): unknown[] {
  if (!Array.isArray(value) || value.length > max) fail(field);
  return value;
}

function ids(value: unknown, field: string, allowed?: Set<string>): string[] {
  const values = array(value, field).map((item) => { id(item, field); return item; });
  if (new Set(values).size !== values.length || (allowed && values.some((item) => !allowed.has(item)))) fail(field);
  return values;
}

function texts(value: unknown, field: string, max = 100) {
  for (const item of array(value, field, max)) text(item, field);
}

function color(value: unknown) {
  if (typeof value !== "string" || !/^#[\da-f]{6}$/i.test(value)) fail("颜色");
}

function date(value: unknown, field: string) {
  text(value, field, 40);
  if (!/^\d{4}-\d{2}-\d{2}T/.test(value) || !Number.isFinite(Date.parse(value))) fail(field);
}

function region(value: Record<string, unknown>) {
  number(value.x, "x", 0, 1); number(value.y, "y", 0, 1);
  number(value.width, "width", Number.EPSILON, 1); number(value.height, "height", Number.EPSILON, 1);
  if (value.x + value.width > 1.000001 || value.y + value.height > 1.000001) fail("图层越界");
}

export function validateCommerceComposition(value: unknown, assetIds: Set<string>): CommerceComposition {
  const composition = object(value, ["background", "layers"], "composition");
  color(composition.background);
  const layers = array(composition.layers, "layers", 100);
  const layerIds: string[] = [];
  for (const input of layers) {
    const base = ["id", "type", "x", "y", "width", "height", "visible", "locked"];
    const layer = object(input, [...base, "assetId", "fit", "text", "fontFamily", "fontSize", "fontWeight", "lineHeight", "align", "color", "backgroundColor", "backgroundOpacity", "shape", "fill", "stroke", "strokeWidth"], "layer");
    id(layer.id, "layer.id"); layerIds.push(layer.id); region(layer);
    enumeration(layer.visible, [true, false], "visible"); enumeration(layer.locked, [true, false], "locked");
    if (layer.type === "image") {
      object(input, [...base, "assetId", "fit"], "image");
      id(layer.assetId, "assetId"); if (!assetIds.has(layer.assetId)) fail("跨项目或不存在的图片");
      enumeration(layer.fit, ["contain"], "图片必须等比完整放置");
    } else if (layer.type === "text") {
      object(input, [...base, "text", "fontFamily", "fontSize", "fontWeight", "lineHeight", "align", "color", "backgroundColor", "backgroundOpacity"], "text");
      text(layer.text, "text", 12000); enumeration(layer.fontFamily, ["sans", "serif", "rounded"], "fontFamily");
      number(layer.fontSize, "fontSize", 0.001, 1); number(layer.lineHeight, "lineHeight", 0.5, 4);
      enumeration(layer.fontWeight, [400, 500, 600, 700, 800, 900], "fontWeight");
      enumeration(layer.align, ["left", "center", "right"], "align");
      color(layer.color); color(layer.backgroundColor); number(layer.backgroundOpacity, "backgroundOpacity", 0, 1);
    } else if (layer.type === "shape") {
      object(input, [...base, "shape", "fill", "stroke", "strokeWidth"], "shape");
      enumeration(layer.shape, ["rectangle", "ellipse", "line"], "shape");
      color(layer.fill); color(layer.stroke); number(layer.strokeWidth, "strokeWidth", 0, 1);
    } else fail("layer.type");
  }
  if (new Set(layerIds).size !== layerIds.length) fail("重复图层 ID");
  return structuredClone(value) as CommerceComposition;
}

export function validateCommerceCreativeCommand(value: unknown): CommerceCreativeCommand {
  const command = object(value, ["action", "scope", "targetPanelIds", "targetLayerIds", "expectedTaskRevision", "instruction"], "command");
  enumeration(command.action, ["discuss", "clarify", "plan", "generate", "revise"], "action");
  enumeration(command.scope, ["project", "panels", "layers"], "scope");
  const panels = ids(command.targetPanelIds, "targetPanelIds");
  const layers = ids(command.targetLayerIds, "targetLayerIds");
  if (command.scope !== "project" && !panels.length) fail("缺少目标页面");
  if (command.scope === "layers" && !layers.length) fail("缺少目标图层");
  if (command.scope === "project" && (panels.length || layers.length)) fail("项目级操作不能携带局部目标");
  if (command.scope === "panels" && layers.length) fail("页面级操作不能携带图层目标");
  number(command.expectedTaskRevision, "expectedTaskRevision", 0, Number.MAX_SAFE_INTEGER, true);
  text(command.instruction, "instruction", 12000);
  if (!command.instruction.trim()) fail("空需求");
  return structuredClone(value) as CommerceCreativeCommand;
}

type Context = Pick<CommerceImageTask, "sourceAssets" | "documents" | "chatMessages" | "panels">;

export function validateCommerceCreativeState(value: unknown, task: Context): CommerceCreativeState {
  const state = object(value, ["evidenceRevision", "evidence", "conversationSummary", "explicitConstraints", "plans", "activePlanId", "runs", "activeRunId", "artifacts", "selectedArtifactIds", "qualityReports", "editor"], "creative");
  const assets = new Set([...task.sourceAssets.map((a) => a.id), ...task.panels.flatMap((p) => p.versions.map((v) => v.assetId))]);
  const messages = new Set(task.chatMessages.map((m) => m.id));
  const documents = new Set(task.documents.map((d) => d.id));
  const productAssets = new Set(task.sourceAssets.filter((a) => !["style_reference", "skill_reference", "benchmark_reference", "reference_segment"].includes(a.role)).map((a) => a.id));
  number(state.evidenceRevision, "evidenceRevision", 0, Number.MAX_SAFE_INTEGER, true);
  text(state.conversationSummary, "conversationSummary", 16000); texts(state.explicitConstraints, "explicitConstraints");
  const evidenceIds: string[] = [];
  const usableEvidence = new Set<string>();
  for (const input of array(state.evidence, "evidence")) {
    const item = object(input, ["id", "content", "status", "sources"], "evidence");
    id(item.id, "evidence.id"); evidenceIds.push(item.id); text(item.content, "evidence.content");
    enumeration(item.status, ["documented", "observed", "inferred", "conflict"], "evidence.status");
    const sources = array(item.sources, "evidence.sources", 100);
    if (!sources.length && item.status !== "inferred") fail("商品事实缺少来源");
    for (const source of sources) {
      const s = object(source, ["kind", "id", "excerpt", "region"], "source");
      id(s.id, "source.id"); text(s.excerpt, "source.excerpt");
      enumeration(s.kind, ["asset", "document", "message"], "source.kind");
      const allowed = s.kind === "asset" ? productAssets : s.kind === "document" ? documents : messages;
      if (!allowed.has(s.id)) fail("商品证据来源不存在或属于风格参考");
      if (s.region !== undefined) region(object(s.region, ["x", "y", "width", "height"], "source.region"));
      if (!s.excerpt && !s.region) fail("缺少来源摘录或图片区域");
    }
    if (item.status === "documented" || item.status === "observed") usableEvidence.add(item.id);
  }
  unique(evidenceIds, "evidence");

  const panelIds = new Set(task.panels.map((p) => p.id));
  const planIds: string[] = [];
  const planRevisions: number[] = [];
  const validatePlan = (input: unknown): CommerceCreativePlan => {
    const plan = object(input, ["id", "revision", "sourceMessageIds", "evidenceRevision", "intent", "visualDirection", "panels"], "plan");
    id(plan.id, "plan.id"); number(plan.revision, "plan.revision", 1, Number.MAX_SAFE_INTEGER, true);
    ids(plan.sourceMessageIds, "plan.sourceMessageIds", messages);
    number(plan.evidenceRevision, "plan.evidenceRevision", 0, state.evidenceRevision as number, true);
    const intent = object(plan.intent, ["objective", "platform", "request", "audienceHypothesis", "buyingScenario", "purchaseReason", "desiredAction", "explicitConstraints", "assumptions", "count", "countSource", "ratio"], "intent");
    enumeration(intent.objective, ["product_interest"], "objective");
    enumeration(intent.platform, ["xiaohongshu", "douyin", "generic"], "platform");
    for (const key of ["request", "audienceHypothesis", "buyingScenario", "purchaseReason", "desiredAction"]) text(intent[key], key);
    texts(intent.explicitConstraints, "intent.explicitConstraints"); texts(intent.assumptions, "assumptions");
    enumeration(intent.countSource, ["user", "ai"], "countSource");
    number(intent.count, "count", 1, intent.countSource === "user" ? 9 : 6, true);
    enumeration(intent.ratio, ["3:4", "4:3", "16:9", "9:16", "2:3", "3:2", "1:1"], "ratio");
    const direction = object(plan.visualDirection, ["description", "palette", "typography", "continuityRules"], "visualDirection");
    text(direction.description, "description"); text(direction.typography, "typography"); texts(direction.continuityRules, "continuityRules");
    for (const c of array(direction.palette, "palette", 16)) color(c);
    const panels = array(plan.panels, "plan.panels", 9);
    if (panels.length !== intent.count) fail("方案张数不符");
    const currentIds: string[] = [];
    panels.forEach((input, order) => {
      const p = object(input, ["id", "order", "purpose", "visualBrief", "relationToPrevious", "evidenceIds", "referenceAssetIds", "renderMode", "composition"], "creativePanel");
      id(p.id, "panel.id"); currentIds.push(p.id); panelIds.add(p.id);
      if (p.order !== order) fail("页面顺序必须连续且唯一");
      text(p.purpose, "purpose"); text(p.visualBrief, "visualBrief");
      if (!p.purpose.trim() || !p.visualBrief.trim()) fail("页面缺少创作目的或视觉描述");
      if (p.relationToPrevious !== undefined) text(p.relationToPrevious, "relationToPrevious");
      ids(p.evidenceIds, "panel.evidenceIds", usableEvidence); ids(p.referenceAssetIds, "panel.referenceAssetIds", assets);
      enumeration(p.renderMode, ["reference_generation", "source_composition"], "renderMode");
      validateCommerceComposition(p.composition, assets);
    });
    unique(currentIds, "plan.panels");
    return input as CommerceCreativePlan;
  };
  for (const input of array(state.plans, "plans")) {
    const p = validatePlan(input); planIds.push(p.id); planRevisions.push(p.revision);
  }
  unique(planIds, "plans"); unique(planRevisions, "plan.revision");
  reference(state.activePlanId, new Set(planIds), "activePlanId");

  const reportIds: string[] = [];
  const reportPanels = new Map<string, string>();
  for (const input of array(state.qualityReports, "qualityReports")) {
    const q = object(input, ["id", "panelId", "status", "checks", "createdAt", "acceptedAt"], "qualityReport");
    id(q.id, "qualityReport.id"); id(q.panelId, "qualityReport.panelId");
    if (!panelIds.has(q.panelId)) fail("qualityReport.panelId");
    reportIds.push(q.id); reportPanels.set(q.id, q.panelId); qualityStatus(q.status);
    const checks = array(q.checks, "qualityReport.checks", 100);
    for (const input of checks) {
      const check = object(input, ["kind", "status", "issues"], "check");
      enumeration(check.kind, ["technical", "visual", "marketing"], "check.kind"); qualityStatus(check.status); texts(check.issues, "issues");
    }
    if (q.status === "passed" && (!["technical", "visual", "marketing"].every((kind) => checks.some((c) => (c as Record<string, unknown>).kind === kind)) || checks.some((c) => (c as Record<string, unknown>).status !== "passed"))) fail("未经完整检查不能标为通过");
    date(q.createdAt, "quality.createdAt"); if (q.acceptedAt !== undefined) date(q.acceptedAt, "acceptedAt");
  }
  unique(reportIds, "qualityReports");
  const artifactIds: string[] = [];
  const artifactPanels = new Map<string, string>();
  for (const input of array(state.artifacts, "artifacts")) {
    const a = object(input, ["id", "panelId", "planRevision", "sourceMessageIds", "imageVersionIds", "composition", "qualityReportId", "createdAt", "textSnapshotSource"], "artifact");
    id(a.id, "artifact.id"); artifactIds.push(a.id); id(a.panelId, "artifact.panelId");
    if (!panelIds.has(a.panelId)) fail("artifact.panelId");
    artifactPanels.set(a.id, a.panelId);
    number(a.planRevision, "artifact.planRevision", 0, Number.MAX_SAFE_INTEGER, true);
    enumeration(a.textSnapshotSource, ["authored", "migration_current_state"], "textSnapshotSource");
    if (a.textSnapshotSource !== "migration_current_state" && !planRevisions.includes(a.planRevision)) fail("artifact.planRevision");
    ids(a.sourceMessageIds, "artifact.sourceMessageIds", messages);
    const versions = new Set(task.panels.find((p) => p.id === a.panelId)?.versions.map((v) => v.id) || []);
    ids(a.imageVersionIds, "artifact.imageVersionIds", versions);
    if (reportPanels.get(a.qualityReportId as string) !== a.panelId) fail("artifact.qualityReportId");
    validateCommerceComposition(a.composition, assets); date(a.createdAt, "artifact.createdAt");
  }
  unique(artifactIds, "artifacts");
  if (!state.selectedArtifactIds || typeof state.selectedArtifactIds !== "object" || Array.isArray(state.selectedArtifactIds)) fail("selectedArtifactIds");
  for (const [panelId, artifactId] of Object.entries(state.selectedArtifactIds)) {
    id(panelId, "selectedArtifactIds.panelId"); id(artifactId, "selectedArtifactIds.artifactId");
    if (artifactPanels.get(artifactId) !== panelId) fail("selectedArtifactIds");
  }
  const layerOwners = new Map<string, Set<string>>();
  const addLayers = (panelId: string, layerIds: string[]) => layerIds.forEach((id) => layerOwners.set(id, new Set([...(layerOwners.get(id) || []), panelId])));
  task.panels.forEach((p) => addLayers(p.id, p.textLayers.map((l) => l.id)));
  (state.plans as CommerceCreativePlan[]).forEach((p) => p.panels.forEach((panel) => addLayers(panel.id, panel.composition.layers.map((l) => l.id))));
  const runIds: string[] = [];
  const requestIds: string[] = [];
  let activeCount = 0;
  for (const input of array(state.runs, "runs")) {
    const r = object(input, ["id", "requestId", "requestFingerprint", "command", "mode", "taskRevision", "planSnapshot", "status", "phase", "modelSnapshots", "attempts", "completedPanelIds", "artifactRevisionIds", "error", "createdAt", "updatedAt"], "run");
    id(r.id, "run.id"); runIds.push(r.id); id(r.requestId, "requestId"); requestIds.push(r.requestId);
    if (typeof r.requestFingerprint !== "string" || !/^[a-f0-9]{64}$/.test(r.requestFingerprint)) fail("requestFingerprint");
    const c = validateCommerceCreativeCommand(r.command);
    ids(c.targetPanelIds, "command.targetPanelIds", panelIds);
    if (c.targetLayerIds.some((id) => !c.targetPanelIds.some((p) => layerOwners.get(id)?.has(p)))) fail("目标图层不属于目标页面");
    number(r.taskRevision, "run.taskRevision", 0, Number.MAX_SAFE_INTEGER, true);
    enumeration(r.mode, ["auto", "plan_only"], "run.mode");
    enumeration(r.status, ["queued", "running", "completed", "failed", "cancelled", "interrupted"], "run.status");
    enumeration(r.phase, ["understanding", "planning", "generating", "composing", "checking", "completed"], "run.phase");
    if (r.mode === "plan_only" && (r.phase === "generating" || array(r.attempts, "attempts").length)) fail("仅规划不能调用生图");
    if (r.planSnapshot !== null) validatePlan(r.planSnapshot);
    for (const input of array(r.modelSnapshots, "modelSnapshots", 20)) {
      const model = object(input, ["role", "provider", "configuredModelId", "reportedModelId"], "modelSnapshot");
      enumeration(model.role, ["text", "vision", "image"], "model.role");
      for (const key of ["provider", "configuredModelId"]) { text(model[key], key, 160); if (!/^[a-zA-Z0-9_./:-]+$/.test(model[key] as string) || /sk-|https?:/i.test(model[key] as string)) fail("模型标识不得包含密钥或地址"); }
      if (model.reportedModelId !== null) { text(model.reportedModelId, "reportedModelId", 160); if (!/^[a-zA-Z0-9_./:-]+$/.test(model.reportedModelId as string) || /sk-|https?:/i.test(model.reportedModelId as string)) fail("reportedModelId"); }
    }
    const attempts = new Map<string, number>();
    for (const input of array(r.attempts, "attempts", 18)) {
      const a = object(input, ["panelId", "number", "providerRequestId", "state"], "attempt");
      id(a.panelId, "attempt.panelId"); if (!panelIds.has(a.panelId)) fail("attempt.panelId");
      const next = (attempts.get(a.panelId) || 0) + 1;
      if (next > 2 || a.number !== next) fail("每张图最多两次且按序记录");
      attempts.set(a.panelId, next); text(a.providerRequestId, "providerRequestId", 300);
      enumeration(a.state, ["submitted", "completed", "failed", "unknown"], "attempt.state");
    }
    ids(r.completedPanelIds, "completedPanelIds", panelIds); ids(r.artifactRevisionIds, "artifactRevisionIds", new Set(artifactIds));
    text(r.error, "run.error"); date(r.createdAt, "run.createdAt"); date(r.updatedAt, "run.updatedAt");
    if (r.status === "queued" || r.status === "running") { activeCount++; if (state.activeRunId !== r.id) fail("活动运行指针不一致"); }
    else if (state.activeRunId === r.id) fail("已结束运行不能占用活动指针");
  }
  unique(runIds, "runs"); unique(requestIds, "requestIds");
  reference(state.activeRunId, new Set(runIds), "activeRunId");
  if (activeCount > 1) fail("同一项目只能有一个活动运行");
  const editor = object(state.editor, ["zoom", "draft"], "editor");
  number(editor.zoom, "zoom", 0.25, 3); text(editor.draft, "draft", 12000);
  return structuredClone(value) as CommerceCreativeState;
}

function unique(values: Array<string | number>, field: string) {
  if (new Set(values).size !== values.length) fail(`${field}重复 ID 或修订号`);
}

function reference(value: unknown, allowed: Set<string>, field: string) {
  if (value !== null) { id(value, field); if (!allowed.has(value)) fail(field); }
}

function qualityStatus(value: unknown) {
  enumeration(value, ["passed", "failed", "unverified", "needs_review"], "quality.status");
}
