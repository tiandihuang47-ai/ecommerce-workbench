export const replicaVideoSchemaVersion = 3;
export const replicaSchemaVersion = 2;

export interface ReplicaVideoMetadata {
  duration: number;
  width: number;
  height: number;
  fps: number;
  hasAudio: boolean;
  videoCodec: string;
  audioCodec: string;
  fileSize: number;
}

export interface ReplicaCameraDNA {
  shotSize: string;
  cameraHeight: string;
  horizontalAngle: string;
  pitchAngle: string;
  lensFeel: string;
  subjectFraming: string;
  subjectScale: string;
  foreground: string;
  midground: string;
  background: string;
  depthOfField: string;
  focusPoint: string;
  composition: string;
  movement: string;
  movementDirection: string;
  movementSpeed: string;
  stability: string;
  cutTransition: string;
}

export interface ReplicaActionDNA {
  start: number;
  end: number;
  subjectId: string;
  head: string;
  shoulders: string;
  torso: string;
  arms: string;
  hands: string;
  fingers: string;
  legs: string;
  feet: string;
  weight: string;
  lean: string;
  speed: string;
  amplitude: string;
  direction: string;
  sequence: string;
}

export interface ReplicaFaceDNA {
  start: number;
  end: number;
  subjectId: string;
  emotion: string;
  change: string;
  eyeOpenness: string;
  gazeDirection: string;
  gazeTarget: string;
  eyebrows: string;
  lips: string;
  mouthCorners: string;
  chin: string;
  headAngle: string;
  blinking: string;
  intensity: string;
  transitionSpeed: string;
}

export interface ReplicaBlockingDNA {
  start: number;
  end: number;
  subjectId: string;
  entry: string;
  exit: string;
  position: string;
  facing: string;
  distanceToCamera: string;
  distanceToOthers: string;
  movement: string;
  occlusion: string;
  propRelation: string;
  environmentRelation: string;
}

export interface ReplicaShotDNA {
  id: string;
  index: number;
  start: number;
  end: number;
  duration: number;
  purpose: string;
  camera: ReplicaCameraDNA;
  subjects: string[];
  actions: ReplicaActionDNA[];
  facialExpressions: ReplicaFaceDNA[];
  blocking: ReplicaBlockingDNA[];
  events: string[];
  props: string[];
  environment: string;
  dialogueIds: string[];
  audioCues: string[];
  continuity: string[];
}

export interface ReplicaCharacterDNA {
  id: string;
  role: string;
  agePresentation: string;
  genderPresentation: string;
  heightProportion: string;
  build: string;
  hair: string;
  clothing: string;
  initialPosition: string;
  orientation: string;
  cameraDistance: string;
  relationToOthers: string;
  entrance: number;
  exit: number;
}

export interface ReplicaDialogueDNA {
  id: string;
  speaker: string;
  start: number;
  end: number;
  text: string;
  speakingRate: string;
  pauses: string;
  emphasis: string;
  emotion: string;
  offscreen: boolean;
  interruption: string;
  gapFromPrevious: number;
  syncWithAction: string;
}

export interface ReplicaAudioDNA {
  voice: string;
  environment: string;
  music: string;
  soundEffects: string[];
  beatChanges: string[];
  volumeChanges: string[];
  silenceWindows: Array<{ start: number; end: number }>;
  keySync: string[];
  meanVolume: string;
  maxVolume: string;
}

export interface ReplicaEnvironmentDNA {
  sceneType: string;
  time: string;
  weather: string;
  lighting: string;
  colorTemperature: string;
  lightDirection: string;
  contrast: string;
  elements: string[];
  props: string[];
  backgroundPeople: string;
  architecture: string;
  ground: string;
  ceiling: string;
  depth: string;
  subjectEnvironmentRelation: string;
}

export interface ReplicaProductMapping {
  sourceCandidates: string[];
  sourceLocations: string[];
  replacementInstruction: string;
  visibilityMoments: string[];
  occlusionRules: string[];
  consistencyRules: string[];
}

export interface ReplicaRhythmDNA {
  averageShotLength: number;
  pace: string;
  hookTime: number;
  emotionalPeakTime: number;
  productInfoTime: number[];
  priceInfoTime: number[];
  turnTime: number;
  ctaTime: number;
  cutRhythm: string;
  actionDialogueRelationship: string;
}

export interface ReplicaFrameObservation {
  timestamp: number;
  shotId: string;
  visualSummary: string;
  subjects: string[];
  actions: string[];
  facialExpression: string;
  gaze: string;
  blocking: string;
  camera: string;
  product: string;
  environment: string;
  continuity: string;
  confidence: number;
}

export interface VideoDNA {
  schemaVersion: number;
  videoHash: string;
  sourceFileName: string;
  metadata: ReplicaVideoMetadata;
  shotBoundaries: number[];
  shots: ReplicaShotDNA[];
  frameObservations: ReplicaFrameObservation[];
  characters: ReplicaCharacterDNA[];
  dialogue: ReplicaDialogueDNA[];
  audio: ReplicaAudioDNA;
  environment: ReplicaEnvironmentDNA;
  productMapping: ReplicaProductMapping;
  rhythm: ReplicaRhythmDNA;
  continuity: string[];
  analysisMeta: {
    visionModel: string;
    frameInterval: number;
    frameCount: number;
    shotBoundaryThreshold: number;
    transcriptSource: string;
    alignmentMethod: string;
    createdAt: string;
    warnings: string[];
  };
}

export interface ReplicaProductUnderstanding {
  schemaVersion: number;
  productHash: string;
  imageCount: number;
  name: string;
  category: string;
  color: string;
  silhouette: string;
  material: string;
  construction: string;
  logo: string;
  textAndPattern: string;
  details: string[];
  imageEvidence: string[];
  facts: string[];
  uncertainties: string[];
  consistencyConstraints: string[];
  analyzedAt: string;
}

export interface ReplicaAdaptedDialogue extends ReplicaDialogueDNA {
  originalText: string;
  adaptedText: string;
  adaptationReason: string;
}

export interface ReplicaSelfCheck {
  source: "deepseek" | "local";
  passed: boolean;
  issues: string[];
  correctionDirectives: string[];
  checkedAt: string;
}

export interface ReplicaVersion {
  id: string;
  version: number;
  prompt: string;
  note: string;
  createdAt: string;
}

export interface ReplicaTaskMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
}

export interface ReplicaDialogueHandling {
  mode: "original" | "custom" | "none";
  instruction: string;
  requestedAt: string;
}

export interface ReplicaAnalysisProgress {
  status: "queued" | "running" | "completed" | "failed" | "stalled";
  stage: string;
  stageLabel: string;
  completedUnits?: number;
  totalUnits?: number;
  percent?: number;
  overallPercent?: number;
  startedAt?: string;
  stageStartedAt?: string;
  updatedAt?: string;
  lastHeartbeatAt?: string;
  detail?: string;
  errorCode?: string;
  errorMessage?: string;
  errorStack?: string;
  timings?: Record<string, number>;
}

export interface ReplicaTask {
  id: string;
  title: string;
  status: "draft" | "uploading" | "analyzing_video" | "analyzing_product" | "compiling_prompt" | "completed" | "failed";
  video: {
    assetId?: string;
    thumbnailAssetId?: string;
    name: string;
    size: number;
    duration: number;
    cacheKey: string;
    sourceType?: "local" | "douyin";
    sourceUrl?: string;
    resolvedUrl?: string;
    authorName?: string;
    importedAt?: string;
  };
  products: Array<{ assetId?: string; name: string; size: number; type: string }>;
  productCacheKey: string;
  documentName?: string;
  documentAssetId?: string;
  requirements: string;
  referenceCopy: string;
  copyMode?: "source" | "custom";
  customCopy?: string;
  copyPromptRequested?: boolean;
  dialogueHandling?: ReplicaDialogueHandling;
  messages: ReplicaTaskMessage[];
  prompt: string;
  versions: ReplicaVersion[];
  selfCheck?: ReplicaSelfCheck;
  warnings: string[];
  error?: string;
  analysisProgress?: ReplicaAnalysisProgress;
  createdAt: string;
  updatedAt: string;
}
