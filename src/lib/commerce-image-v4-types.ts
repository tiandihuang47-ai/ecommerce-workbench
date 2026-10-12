import type { CommerceImageRatio } from "@/lib/commerce-image-types";

export interface CommerceCreativeIntent {
  objective: "product_interest";
  platform: "xiaohongshu" | "douyin" | "generic";
  request: string;
  audienceHypothesis: string;
  buyingScenario: string;
  purchaseReason: string;
  desiredAction: string;
  explicitConstraints: string[];
  assumptions: string[];
  count: number;
  countSource: "user" | "ai";
  ratio: CommerceImageRatio;
}

export interface CommerceCompositionRegion {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface CommerceCompositionLayerBase extends CommerceCompositionRegion {
  id: string;
  visible: boolean;
  locked: boolean;
}

export type CommerceCompositionLayer =
  | (CommerceCompositionLayerBase & {
    type: "image";
    assetId: string;
    fit: "contain";
  })
  | (CommerceCompositionLayerBase & {
    type: "text";
    text: string;
    fontFamily: "sans" | "serif" | "rounded";
    fontSize: number;
    fontWeight: 400 | 500 | 600 | 700 | 800 | 900;
    lineHeight: number;
    align: "left" | "center" | "right";
    color: string;
    backgroundColor: string;
    backgroundOpacity: number;
  })
  | (CommerceCompositionLayerBase & {
    type: "shape";
    shape: "rectangle" | "ellipse" | "line";
    fill: string;
    stroke: string;
    strokeWidth: number;
  });

export interface CommerceComposition {
  background: string;
  layers: CommerceCompositionLayer[];
}

export interface CommerceCreativePanel {
  id: string;
  order: number;
  purpose: string;
  visualBrief: string;
  relationToPrevious?: string;
  /** 本页绑定的卖点：进入提示词让画面"卖什么"有明确答案；旧方案无此字段照常工作。 */
  sellingPoint?: { label: string; painPoint: string; evidence: string };
  evidenceIds: string[];
  referenceAssetIds: string[];
  renderMode: "reference_generation" | "source_composition";
  composition: CommerceComposition;
}

export interface CommerceCreativePlan {
  id: string;
  revision: number;
  sourceMessageIds: string[];
  evidenceRevision: number;
  intent: CommerceCreativeIntent;
  visualDirection: {
    description: string;
    palette: string[];
    typography: string;
    continuityRules: string[];
  };
  panels: CommerceCreativePanel[];
}

export interface CommerceCreativeCommand {
  action: "discuss" | "clarify" | "plan" | "generate" | "revise";
  scope: "project" | "panels" | "layers";
  targetPanelIds: string[];
  targetLayerIds: string[];
  expectedTaskRevision: number;
  instruction: string;
}

export interface CommerceProductEvidence {
  id: string;
  content: string;
  status: "documented" | "observed" | "inferred" | "conflict";
  sources: Array<{
    kind: "asset" | "document" | "message";
    id: string;
    excerpt: string;
    region?: CommerceCompositionRegion;
  }>;
}

export type CommerceCreativeQualityStatus = "passed" | "failed" | "unverified" | "needs_review";

export interface CommerceCreativeQualityReport {
  id: string;
  panelId: string;
  status: CommerceCreativeQualityStatus;
  checks: Array<{
    kind: "technical" | "visual" | "marketing";
    status: CommerceCreativeQualityStatus;
    issues: string[];
  }>;
  createdAt: string;
  /** Acknowledgement never rewrites an unverified/failed status to passed. */
  acceptedAt?: string;
}

export interface CommerceArtifactRevision {
  id: string;
  panelId: string;
  planRevision: number;
  sourceMessageIds: string[];
  imageVersionIds: string[];
  composition: CommerceComposition;
  qualityReportId: string;
  createdAt: string;
  textSnapshotSource: "authored" | "migration_current_state";
}

export type CommerceCreativeRunPhase = "understanding" | "planning" | "generating" | "composing" | "checking" | "completed";
export type CommerceCreativeRunStatus = "queued" | "running" | "completed" | "failed" | "cancelled" | "interrupted";

/** Deliberately excludes credentials, endpoint URLs, file paths and raw responses. */
export interface CommerceCreativeModelSnapshot {
  role: "text" | "vision" | "image";
  provider: string;
  configuredModelId: string;
  reportedModelId: string | null;
}

export interface CommerceCreativeRun {
  id: string;
  requestId: string;
  requestFingerprint: string;
  command: CommerceCreativeCommand;
  mode: "auto" | "plan_only";
  taskRevision: number;
  planSnapshot: CommerceCreativePlan | null;
  status: CommerceCreativeRunStatus;
  phase: CommerceCreativeRunPhase;
  modelSnapshots: CommerceCreativeModelSnapshot[];
  attempts: Array<{
    panelId: string;
    number: 1 | 2;
    providerRequestId: string;
    state: "submitted" | "completed" | "failed" | "unknown";
  }>;
  completedPanelIds: string[];
  artifactRevisionIds: string[];
  error: string;
  createdAt: string;
  updatedAt: string;
}

export interface CommerceCreativeState {
  evidenceRevision: number;
  evidence: CommerceProductEvidence[];
  conversationSummary: string;
  explicitConstraints: string[];
  plans: CommerceCreativePlan[];
  activePlanId: string | null;
  runs: CommerceCreativeRun[];
  activeRunId: string | null;
  artifacts: CommerceArtifactRevision[];
  selectedArtifactIds: Record<string, string>;
  qualityReports: CommerceCreativeQualityReport[];
  editor: { zoom: number; draft: string };
}

export function emptyCommerceCreativeState(): CommerceCreativeState {
  return {
    evidenceRevision: 0, evidence: [], conversationSummary: "", explicitConstraints: [],
    plans: [], activePlanId: null, runs: [], activeRunId: null,
    artifacts: [], selectedArtifactIds: {}, qualityReports: [], editor: { zoom: 1, draft: "" }
  };
}
