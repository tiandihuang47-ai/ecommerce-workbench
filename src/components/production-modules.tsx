"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { AlertTriangle, ArrowRight, Bot, CheckCircle2, ClipboardList, Copy, Edit, FileText, GitBranch, MessageSquare, Plus, RotateCcw, Save, ShieldCheck, Trash2, XCircle } from "lucide-react";
import { EmptyState, PageHeader, SectionCard } from "@/components/design-system";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  createId,
  deleteContentAsset,
  deleteEditBrief,
  deleteReviewRecord,
  deleteVideoTask,
  getPipelineData,
  nowIso,
  saveApprovalRecord,
  saveContentAsset,
  saveEditBrief,
  saveReviewRecord,
  saveScript,
  saveShotList,
  saveTaskComment,
  saveTaskRisk,
  saveTopic,
  saveVideoTask,
  saveVersionRecord
} from "@/lib/pipeline-storage";
import {
  approvalNodeDefinitions,
  approvalStatuses,
  commentModules,
  commentTypes,
  contentAssetTypes,
  contentGoals,
  editRhythms,
  platforms,
  problemAttributionOptions,
  reviewScoreKeys,
  reviewScoreLabels,
  videoContentTypes,
  videoTaskStatuses,
  versionContentTypes,
  type ApprovalNodeName,
  type ApprovalRecord,
  type ApprovalStatus,
  type ContentAsset,
  type CommentModule,
  type CommentStatus,
  type CommentType,
  type EditBrief,
  type PipelineData,
  type Priority,
  type ProblemAttributionKey,
  type ProductProfile,
  type Project,
  type ReviewRecord,
  type ReviewScores,
  type ScriptItem,
  type ShotList,
  type TaskComment,
  type TaskRisk,
  type VideoTask,
  type VideoTaskStatus,
  type VersionContentType,
  type VersionRecord
} from "@/lib/pipeline-types";
import {
  generateEditBrief,
  generateReviewConclusion,
  generateShotList,
  reviewToContentAsset,
  shotListToMarkdownTable,
  shotListToShootingChecklist
} from "@/services/generatorService";
import {
  analyzeTaskRisks,
  approvalStatus,
  buildScoreHint,
  createApprovalRecord,
  createNextTaskFromFailedReview,
  createVersionRecord,
  enhanceReviewConclusion,
  localAiAssetFromReview,
  localAiTaskScript,
  localAiTaskTopic
} from "@/services/workflowService";

const emptyData: PipelineData = {
  projects: [],
  products: [],
  videoTasks: [],
  topics: [],
  scripts: [],
  shotLists: [],
  scriptTranscripts: [],
  editBriefs: [],
  publishPlans: [],
  reviewRecords: [],
  contentAssets: [],
  deconstructionRecords: [],
  approvalRecords: [],
  versionRecords: [],
  taskComments: [],
  teamMembers: [],
  taskRisks: [],
  viralAnalyses: [],
  directorMethods: [],
  scriptRecords: [],
  simpleReviewRecords: [],
  simpleDeconstructionRecords: [],
  resourceItems: [],
  productRecords: [],
  commentInsightRecords: []
};

function useProductionData() {
  const [data, setData] = useState<PipelineData>(emptyData);

  function refresh() {
    setData(getPipelineData());
  }

  useEffect(() => {
    refresh();
  }, []);

  return { data, refresh };
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      {children}
    </div>
  );
}

function Info({ label, value }: { label: string; value?: string }) {
  return (
    <div className="rounded-2xl border border-slate-200/70 bg-slate-50/70 p-4">
      <div className="text-xs font-medium text-slate-500">{label}</div>
      <div className="mt-1 whitespace-pre-wrap text-sm leading-6 text-slate-700">{value || "未填写"}</div>
    </div>
  );
}

function projectOptions(projects: Project[]) {
  return [{ label: "请选择项目", value: "" }, ...projects.map((item) => ({ label: item.name, value: item.id }))];
}

function productOptions(products: ProductProfile[], projectId?: string) {
  const scoped = projectId ? products.filter((item) => item.projectId === projectId) : products;
  return [{ label: "请选择产品资料", value: "" }, ...scoped.map((item) => ({ label: item.productName, value: item.id }))];
}

function taskOptions(tasks: VideoTask[]) {
  return [{ label: "请选择视频任务", value: "" }, ...tasks.map((item) => ({ label: item.videoTitle, value: item.id }))];
}

function scriptOptions(scripts: ScriptItem[], projectId?: string) {
  const scoped = projectId ? scripts.filter((item) => item.projectId === projectId) : scripts;
  return [{ label: "请选择脚本", value: "" }, ...scoped.map((item) => ({ label: item.title, value: item.id }))];
}

function shotListOptions(shotLists: ShotList[], projectId?: string) {
  const scoped = projectId ? shotLists.filter((item) => item.projectId === projectId) : shotLists;
  return [{ label: "请选择分镜拍摄单", value: "" }, ...scoped.map((item) => ({ label: `${item.scene || "未命名场景"}｜${item.rows.length} 镜头`, value: item.id }))];
}

function findProject(data: PipelineData, id: string) {
  return data.projects.find((item) => item.id === id);
}

function findProduct(data: PipelineData, id: string) {
  return data.products.find((item) => item.id === id);
}

function findTask(data: PipelineData, id: string) {
  return data.videoTasks.find((item) => item.id === id);
}

function findScript(data: PipelineData, id: string) {
  return data.scripts.find((item) => item.id === id);
}

function findShotList(data: PipelineData, id: string) {
  return data.shotLists.find((item) => item.id === id);
}

async function copyText(text: string) {
  await navigator.clipboard.writeText(text);
}

async function runWorkflowAi<T>(action: string, input: unknown, fallback: () => T): Promise<{ result: T; source: "deepseek" | "fallback" }> {
  try {
    const response = await fetch("/api/workflow-ai", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, input })
    });
    const data = (await response.json()) as { result?: T; error?: string };

    if (!response.ok || !data.result) {
      return { result: fallback(), source: "fallback" };
    }

    return { result: data.result, source: "deepseek" };
  } catch {
    return { result: fallback(), source: "fallback" };
  }
}

function formatDate(value: string) {
  if (!value) return "未设置";
  return new Date(value).toLocaleString("zh-CN", { hour12: false });
}

function priorityTone(priority: Priority) {
  if (priority === "高") return "border-rose-200 bg-rose-50 text-rose-700";
  if (priority === "中") return "border-amber-200 bg-amber-50 text-amber-700";
  return "border-slate-200 bg-slate-50 text-slate-600";
}

function statusNext(status: VideoTaskStatus, direction: 1 | -1) {
  const index = videoTaskStatuses.indexOf(status);
  const next = videoTaskStatuses[Math.min(videoTaskStatuses.length - 1, Math.max(0, index + direction))];
  return next || status;
}

function taskCopyText(task: VideoTask, data: PipelineData) {
  return [
    `视频标题：${task.videoTitle}`,
    `所属项目：${findProject(data, task.projectId)?.name || "未关联"}`,
    `关联产品：${findProduct(data, task.productId)?.productName || "未关联"}`,
    `内容类型：${task.contentType}`,
    `内容目的：${task.contentGoal}`,
    `当前状态：${task.status}`,
    `优先级：${task.priority}`,
    `截止时间：${task.dueDate || "未设置"}`,
    `负责人：选题 ${task.topicOwner || "未填"}｜脚本 ${task.scriptOwner || "未填"}｜拍摄 ${task.shootingOwner || "未填"}｜剪辑 ${task.editingOwner || "未填"}｜发布 ${task.publishingOwner || "未填"}｜复盘 ${task.reviewOwner || "未填"}`,
    `任务备注：${task.remarks || "无"}`
  ].join("\n");
}

function blankVideoTask(data: PipelineData): VideoTask {
  const now = nowIso();
  return {
    id: createId("task"),
    videoTitle: "",
    projectId: data.projects[0]?.id || "",
    productId: "",
    contentType: "教知识",
    contentGoal: "涨粉",
    status: "选题中",
    topicOwner: "",
    scriptOwner: "",
    shootingOwner: "",
    editingOwner: "",
    publishingOwner: "",
    reviewOwner: "",
    dueDate: "",
    priority: "中",
    remarks: "",
    topicId: "",
    scriptId: "",
    shotListId: "",
    editBriefId: "",
    publishRecordId: "",
    reviewRecordId: "",
    createdAt: now,
    updatedAt: now
  };
}

export function VideoTasksPage() {
  const { data, refresh } = useProductionData();
  const [form, setForm] = useState<VideoTask>(() => blankVideoTask(emptyData));
  const [owner, setOwner] = useState("全部");
  const [projectId, setProjectId] = useState("全部");
  const [productId, setProductId] = useState("全部");
  const [status, setStatus] = useState("全部");
  const [search, setSearch] = useState("");

  useEffect(() => {
    if (!form.projectId && data.projects[0]?.id) {
      setForm((current) => ({ ...current, projectId: data.projects[0].id }));
    }
  }, [data.projects, form.projectId]);

  const owners = useMemo(() => {
    const values = data.videoTasks.flatMap((task) => [task.topicOwner, task.scriptOwner, task.shootingOwner, task.editingOwner, task.publishingOwner, task.reviewOwner]).filter(Boolean);
    return Array.from(new Set(values));
  }, [data.videoTasks]);

  const filtered = data.videoTasks.filter((task) => {
    const ownerValues = [task.topicOwner, task.scriptOwner, task.shootingOwner, task.editingOwner, task.publishingOwner, task.reviewOwner];
    return (
      task.videoTitle.includes(search) &&
      (owner === "全部" || ownerValues.includes(owner)) &&
      (projectId === "全部" || task.projectId === projectId) &&
      (productId === "全部" || task.productId === productId) &&
      (status === "全部" || task.status === status)
    );
  });

  function submit() {
    if (!form.videoTitle.trim()) return;
    saveVideoTask({ ...form, updatedAt: nowIso() });
    setForm(blankVideoTask(data));
    refresh();
  }

  function updateTaskStatus(task: VideoTask, nextStatus: VideoTaskStatus) {
    saveVideoTask({ ...task, status: nextStatus, updatedAt: nowIso() });
    refresh();
  }

  return (
    <div>
      <PageHeader title="视频任务卡" description="每一条视频都以任务卡推进，统一负责人、状态、截止时间和关联交付物。" eyebrow="编导中台 / 视频任务卡" />
      <div className="grid gap-6 xl:grid-cols-[430px_minmax(0,1fr)]">
        <Card>
          <CardHeader>
            <CardTitle>{data.videoTasks.some((item) => item.id === form.id) ? "编辑视频任务" : "新建视频任务"}</CardTitle>
            <CardDescription>任务卡是选题、脚本、拍摄、剪辑、发布和复盘的主线。</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <VideoTaskForm form={form} setForm={setForm} data={data} />
            <div className="flex flex-wrap gap-2">
              <Button onClick={submit}><Save className="h-4 w-4" />保存任务</Button>
              <Button variant="outline" onClick={() => setForm(blankVideoTask(data))}>清空</Button>
            </div>
          </CardContent>
        </Card>

        <div className="space-y-4">
          <Card>
            <CardContent className="grid gap-3 pt-6 md:grid-cols-5">
              <Input placeholder="搜索视频标题" value={search} onChange={(event) => setSearch(event.target.value)} />
              <Select value={owner} onChange={(event) => setOwner(event.target.value)} options={[{ label: "全部负责人", value: "全部" }, ...owners.map((item) => ({ label: item, value: item }))]} />
              <Select value={projectId} onChange={(event) => setProjectId(event.target.value)} options={[{ label: "全部项目", value: "全部" }, ...data.projects.map((item) => ({ label: item.name, value: item.id }))]} />
              <Select value={productId} onChange={(event) => setProductId(event.target.value)} options={[{ label: "全部产品", value: "全部" }, ...data.products.map((item) => ({ label: item.productName, value: item.id }))]} />
              <Select value={status} onChange={(event) => setStatus(event.target.value)} options={[{ label: "全部状态", value: "全部" }, ...videoTaskStatuses.map((item) => ({ label: item, value: item }))]} />
            </CardContent>
          </Card>

          {filtered.length === 0 ? <EmptyState text="还没有符合条件的视频任务。先新建一张任务卡。" /> : null}

          <div className="grid gap-4 overflow-x-auto pb-2 xl:grid-cols-4 2xl:grid-cols-5">
            {videoTaskStatuses.map((columnStatus) => {
              const tasks = filtered.filter((task) => task.status === columnStatus);
              return (
                <section key={columnStatus} className="min-w-72 rounded-3xl border border-slate-200/70 bg-slate-50/70 p-3">
                  <div className="mb-3 flex items-center justify-between px-1">
                    <h3 className="text-sm font-semibold text-slate-900">{columnStatus}</h3>
                    <span className="rounded-full bg-white px-2 py-0.5 text-xs text-slate-500 ring-1 ring-slate-200">{tasks.length}</span>
                  </div>
                  <div className="space-y-3">
                    {tasks.map((task) => (
                      <Card key={task.id} className="soft-panel-hover">
                        <CardHeader className="p-4">
                          <div className="flex items-start justify-between gap-3">
                            <div>
                              <CardTitle className="leading-6">{task.videoTitle}</CardTitle>
                              <CardDescription>{findProject(data, task.projectId)?.name || "未关联项目"}｜{findProduct(data, task.productId)?.productName || "未关联产品"}</CardDescription>
                            </div>
                            <span className={`rounded-full border px-2 py-0.5 text-xs ${priorityTone(task.priority)}`}>{task.priority}</span>
                          </div>
                        </CardHeader>
                        <CardContent className="space-y-3 p-4 pt-0">
                          <div className="grid gap-2 text-xs text-slate-500">
                            <div>脚本：{task.scriptOwner || "未分配"}｜拍摄：{task.shootingOwner || "未分配"}</div>
                            <div>剪辑：{task.editingOwner || "未分配"}｜复盘：{task.reviewOwner || "未分配"}</div>
                            <div>截止：{task.dueDate || "未设置"}</div>
                          </div>
                          <div className="flex flex-wrap gap-2">
                            <Button size="sm" variant="outline" onClick={() => updateTaskStatus(task, statusNext(task.status, -1))}>上一步</Button>
                            <Button size="sm" variant="outline" onClick={() => updateTaskStatus(task, statusNext(task.status, 1))}>下一步</Button>
                            <Button size="sm" variant="ghost" onClick={() => setForm(task)}><Edit className="h-4 w-4" />编辑</Button>
                          </div>
                          <div className="flex flex-wrap gap-2">
                            <Button size="sm" variant="ghost" onClick={() => copyText(taskCopyText(task, data))}><Copy className="h-4 w-4" />复制</Button>
                            <Link className="inline-flex h-8 items-center justify-center gap-2 rounded-xl px-3 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-100" href={`/video-tasks/${task.id}`}>
                              详情<ArrowRight className="h-4 w-4" />
                            </Link>
                            <Button size="sm" variant="destructive" onClick={() => { deleteVideoTask(task.id); refresh(); }}><Trash2 className="h-4 w-4" />删除</Button>
                          </div>
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                </section>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

function VideoTaskForm({ form, setForm, data }: { form: VideoTask; setForm: (value: VideoTask) => void; data: PipelineData }) {
  return (
    <div className="grid gap-4">
      <Field label="视频标题"><Input value={form.videoTitle} onChange={(event) => setForm({ ...form, videoTitle: event.target.value })} /></Field>
      <div className="grid gap-4 md:grid-cols-2">
        <Field label="所属项目"><Select value={form.projectId} onChange={(event) => setForm({ ...form, projectId: event.target.value, productId: "" })} options={projectOptions(data.projects)} /></Field>
        <Field label="关联产品"><Select value={form.productId} onChange={(event) => setForm({ ...form, productId: event.target.value })} options={productOptions(data.products, form.projectId)} /></Field>
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <Field label="内容类型"><Select value={form.contentType} onChange={(event) => setForm({ ...form, contentType: event.target.value as VideoTask["contentType"] })} options={videoContentTypes.map((item) => ({ label: item, value: item }))} /></Field>
        <Field label="内容目的"><Select value={form.contentGoal} onChange={(event) => setForm({ ...form, contentGoal: event.target.value as VideoTask["contentGoal"] })} options={contentGoals.map((item) => ({ label: item, value: item }))} /></Field>
      </div>
      <div className="grid gap-4 md:grid-cols-3">
        <Field label="当前状态"><Select value={form.status} onChange={(event) => setForm({ ...form, status: event.target.value as VideoTaskStatus })} options={videoTaskStatuses.map((item) => ({ label: item, value: item }))} /></Field>
        <Field label="优先级"><Select value={form.priority} onChange={(event) => setForm({ ...form, priority: event.target.value as Priority })} options={["高", "中", "低"].map((item) => ({ label: item, value: item }))} /></Field>
        <Field label="截止时间"><Input type="date" value={form.dueDate} onChange={(event) => setForm({ ...form, dueDate: event.target.value })} /></Field>
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <Field label="选题负责人"><Input value={form.topicOwner} onChange={(event) => setForm({ ...form, topicOwner: event.target.value })} /></Field>
        <Field label="脚本负责人"><Input value={form.scriptOwner} onChange={(event) => setForm({ ...form, scriptOwner: event.target.value })} /></Field>
        <Field label="拍摄负责人"><Input value={form.shootingOwner} onChange={(event) => setForm({ ...form, shootingOwner: event.target.value })} /></Field>
        <Field label="剪辑负责人"><Input value={form.editingOwner} onChange={(event) => setForm({ ...form, editingOwner: event.target.value })} /></Field>
        <Field label="发布负责人"><Input value={form.publishingOwner} onChange={(event) => setForm({ ...form, publishingOwner: event.target.value })} /></Field>
        <Field label="复盘负责人"><Input value={form.reviewOwner} onChange={(event) => setForm({ ...form, reviewOwner: event.target.value })} /></Field>
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <Field label="关联脚本"><Select value={form.scriptId} onChange={(event) => setForm({ ...form, scriptId: event.target.value })} options={scriptOptions(data.scripts, form.projectId)} /></Field>
        <Field label="关联分镜拍摄单"><Select value={form.shotListId} onChange={(event) => setForm({ ...form, shotListId: event.target.value })} options={shotListOptions(data.shotLists, form.projectId)} /></Field>
      </div>
      <Field label="任务备注"><Textarea value={form.remarks} onChange={(event) => setForm({ ...form, remarks: event.target.value })} /></Field>
    </div>
  );
}

export function VideoTaskDetailPage({ taskId }: { taskId: string }) {
  const router = useRouter();
  const { data, refresh } = useProductionData();
  const task = findTask(data, taskId);

  if (!task) {
    return (
      <div>
        <PageHeader title="任务详情" description="没有找到这条视频任务，可能已被删除。" eyebrow="编导中台 / 视频任务卡" />
        <EmptyState text="没有找到任务。返回视频任务卡重新选择。" actionText="返回任务看板" onAction={() => router.push("/video-tasks")} />
      </div>
    );
  }

  const currentTask = task;
  const project = findProject(data, currentTask.projectId);
  const product = findProduct(data, currentTask.productId);
  const script = findScript(data, currentTask.scriptId);
  const shotList = findShotList(data, currentTask.shotListId);
  const editBrief = data.editBriefs.find((item) => item.id === currentTask.editBriefId);
  const publishPlan = data.publishPlans.find((item) => item.id === currentTask.publishRecordId);
  const review = data.reviewRecords.find((item) => item.id === currentTask.reviewRecordId);
  const taskRisks = analyzeTaskRisks(data, currentTask);
  const unresolvedComments = data.taskComments.filter((item) => item.taskId === currentTask.id && item.status !== "已解决");
  const taskApprovals = data.approvalRecords.filter((item) => item.taskId === currentTask.id);
  const taskVersions = data.versionRecords.filter((item) => item.taskId === currentTask.id);
  const taskComments = data.taskComments.filter((item) => item.taskId === currentTask.id);

  async function aiGenerateTopic() {
    if (!project) return;
    const fallbackTopic = localAiTaskTopic(project, product);
    const { result } = await runWorkflowAi<Record<string, string>>("taskTopic", { project, product, task: currentTask }, () => fallbackTopic as unknown as Record<string, string>);
    const now = nowIso();
    const topic = {
      ...fallbackTopic,
      title: result.title || fallbackTopic.title,
      hook: result.hook || fallbackTopic.hook,
      angle: result.angle || fallbackTopic.angle,
      coreOpinion: result.reason || fallbackTopic.coreOpinion,
      createdAt: now,
      updatedAt: now
    };
    saveTopic(topic);
    saveVideoTask({ ...currentTask, topicId: topic.id, videoTitle: currentTask.videoTitle || topic.title, status: "脚本中", updatedAt: nowIso() });
    refresh();
  }

  async function aiGenerateScript() {
    if (!project) return;
    const fallbackScript = localAiTaskScript(project, product, currentTask);
    const { result } = await runWorkflowAi<Record<string, string>>("taskScript", { project, product, task: currentTask, topic: currentTask.videoTitle }, () => fallbackScript as unknown as Record<string, string>);
    const nextScript = {
      ...fallbackScript,
      title: result.title || fallbackScript.title,
      hook: result.hook || fallbackScript.hook,
      copy: result.copy || fallbackScript.copy,
      rhythm: result.rhythm || fallbackScript.rhythm,
      pictureInPicture: result.pictureInPicture || fallbackScript.pictureInPicture,
      ending: result.ending || fallbackScript.ending
    };
    saveScript(nextScript);
    saveVideoTask({ ...currentTask, scriptId: nextScript.id, status: "待拍摄", updatedAt: nowIso() });
    refresh();
  }

  function createShotList() {
    if (!project || !script) return;
    const next = generateShotList({ project, product, script, task: currentTask, scene: "按脚本场景执行", needModel: false, needProductCloseup: true, needPictureInPicture: true });
    saveShotList(next);
    saveVideoTask({ ...currentTask, shotListId: next.id, status: "待拍摄", updatedAt: nowIso() });
    refresh();
  }

  function createEditBrief() {
    if (!project) return;
    const next = generateEditBrief({
      project,
      product,
      task: currentTask,
      script,
      shotList,
      editor: currentTask.editingOwner,
      targetDuration: script?.duration || "60秒",
      rhythm: "中等",
      deadline: currentTask.dueDate
    });
    saveEditBrief(next);
    saveVideoTask({ ...currentTask, editBriefId: next.id, status: "待剪辑", updatedAt: nowIso() });
    refresh();
  }

  function createReviewAsset() {
    if (!review) return;
    saveContentAsset(localAiAssetFromReview(review));
    refresh();
  }

  function createNextTaskFromReview() {
    if (!review) return;
    saveVideoTask(createNextTaskFromFailedReview(review, currentTask));
    refresh();
  }

  function updateTaskRiskHandled(risk: TaskRisk) {
    saveTaskRisk({ ...risk, status: "已处理", resolvedAt: nowIso() });
    refresh();
  }

  return (
    <div>
      <PageHeader title={currentTask.videoTitle} description="查看一条视频从产品资料、脚本、分镜、剪辑、发布到复盘的完整链路。" eyebrow="编导中台 / 任务详情" />
      {taskRisks.length > 0 || unresolvedComments.length > 0 ? (
        <TaskRiskPanel risks={taskRisks} unresolvedCount={unresolvedComments.length} onHandled={updateTaskRiskHandled} />
      ) : null}
      <div className="mb-6 flex flex-wrap gap-2">
        <Link className="inline-flex h-10 items-center justify-center rounded-xl border border-slate-200 bg-white px-4 text-sm font-medium text-slate-700 shadow-sm hover:bg-slate-50" href="/video-tasks">返回任务看板</Link>
        <Button variant="outline" onClick={() => copyText(taskCopyText(currentTask, data))}><Copy className="h-4 w-4" />复制任务信息</Button>
        <Button variant="outline" onClick={aiGenerateTopic}><Bot className="h-4 w-4" />AI 生成选题</Button>
        <Button variant="outline" onClick={aiGenerateScript} disabled={!project}><Bot className="h-4 w-4" />AI 生成脚本</Button>
        <Button onClick={createShotList} disabled={!script}><ClipboardList className="h-4 w-4" />从脚本生成分镜</Button>
        <Button onClick={createEditBrief} disabled={!script}><FileText className="h-4 w-4" />生成剪辑说明单</Button>
        <Button variant="outline" onClick={createReviewAsset} disabled={!review}><Bot className="h-4 w-4" />AI 沉淀资产</Button>
        <Button variant="outline" onClick={createNextTaskFromReview} disabled={!review}><Bot className="h-4 w-4" />生成优化任务</Button>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <SectionCard><CardHeader><CardTitle>任务状态</CardTitle><CardDescription>{currentTask.status}｜优先级 {currentTask.priority}</CardDescription></CardHeader><CardContent className="grid gap-3"><Info label="截止时间" value={currentTask.dueDate} /><Info label="任务备注" value={currentTask.remarks} /></CardContent></SectionCard>
        <SectionCard><CardHeader><CardTitle>负责人</CardTitle><CardDescription>减少跨环节口头交接</CardDescription></CardHeader><CardContent className="grid gap-3"><Info label="脚本/拍摄" value={`${currentTask.scriptOwner || "未分配"} / ${currentTask.shootingOwner || "未分配"}`} /><Info label="剪辑/复盘" value={`${currentTask.editingOwner || "未分配"} / ${currentTask.reviewOwner || "未分配"}`} /></CardContent></SectionCard>
        <SectionCard><CardHeader><CardTitle>关联资料</CardTitle><CardDescription>{project?.name || "未关联项目"}</CardDescription></CardHeader><CardContent className="grid gap-3"><Info label="产品" value={product?.productName} /><Info label="内容目标" value={currentTask.contentGoal} /></CardContent></SectionCard>
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <ChainCard title="产品资料" ok={Boolean(product)} description={product?.sellingPoints || "未关联产品资料"} href="/products" />
        <ChainCard title="脚本" ok={Boolean(script)} description={script?.title || "未关联脚本"} href="/scripts" />
        <ChainCard title="分镜拍摄单" ok={Boolean(shotList)} description={shotList ? `${shotList.rows.length} 个镜头｜${shotList.rows.filter((row) => row.completionStatus === "已拍").length} 个已拍` : "可从脚本一键生成"} href="/shot-lists" />
        <ChainCard title="剪辑说明单" ok={Boolean(editBrief)} description={editBrief?.rhythm || "可从脚本和分镜生成"} href="/edit-briefs" />
        <ChainCard title="发布记录" ok={Boolean(publishPlan)} description={publishPlan?.title || "发布运营后关联"} href="/publishing" />
        <ChainCard title="复盘记录" ok={Boolean(review)} description={review?.autoConclusion || "发布后进入复盘"} href="/reviews" />
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-2">
        <ApprovalFlowSection task={currentTask} records={taskApprovals} versions={taskVersions} onSave={(record) => { saveApprovalRecord(record); refresh(); }} />
        <VersionRecordsSection data={data} task={currentTask} records={taskVersions} onSave={(records) => { records.forEach(saveVersionRecord); refresh(); }} />
      </div>
      <div className="mt-6">
        <TaskCommentsSection task={currentTask} comments={taskComments} onSave={(comment) => { saveTaskComment(comment); refresh(); }} />
      </div>
    </div>
  );
}

function ChainCard({ title, ok, description, href }: { title: string; ok: boolean; description: string; href: string }) {
  return (
    <Card className="soft-panel-hover">
      <CardHeader>
        <div className="flex items-center justify-between gap-3">
          <CardTitle>{title}</CardTitle>
          <Badge className={ok ? "bg-emerald-50 text-emerald-700" : "bg-slate-50 text-slate-500"}>{ok ? "已完成" : "待补齐"}</Badge>
        </div>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent><Link className="text-sm font-medium text-slate-700 hover:text-slate-950" href={href}>进入模块</Link></CardContent>
    </Card>
  );
}

function TaskRiskPanel({ risks, unresolvedCount, onHandled }: { risks: TaskRisk[]; unresolvedCount: number; onHandled: (risk: TaskRisk) => void }) {
  return (
    <Card className="mb-6 border-amber-200 bg-amber-50/70">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-amber-900"><AlertTriangle className="h-5 w-5" />当前任务风险</CardTitle>
        <CardDescription className="text-amber-800">这些问题会造成返工、延期或交付物断层。</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3 lg:grid-cols-2">
        {risks.map((risk) => (
          <div key={risk.id} className="rounded-2xl border border-amber-200 bg-white/80 p-4">
            <div className="text-sm font-semibold text-slate-950">{risk.title}</div>
            <p className="mt-1 text-sm leading-6 text-slate-600">{risk.description}</p>
            <p className="mt-2 text-xs font-medium text-amber-800">建议：{risk.actionText}</p>
            <Button className="mt-3" size="sm" variant="outline" onClick={() => onHandled(risk)}>标记已处理</Button>
          </div>
        ))}
        {unresolvedCount > 0 ? (
          <div className="rounded-2xl border border-amber-200 bg-white/80 p-4">
            <div className="text-sm font-semibold text-slate-950">未解决评论</div>
            <p className="mt-1 text-sm leading-6 text-slate-600">当前还有 {unresolvedCount} 条协作评论未解决。</p>
            <p className="mt-2 text-xs font-medium text-amber-800">建议：先处理修改意见，再推进下一流程。</p>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

function ApprovalFlowSection({
  task,
  records,
  versions,
  onSave
}: {
  task: VideoTask;
  records: ApprovalRecord[];
  versions: VersionRecord[];
  onSave: (record: ApprovalRecord) => void;
}) {
  const [nodeName, setNodeName] = useState<ApprovalNodeName>("脚本审核");
  const [submitter, setSubmitter] = useState("");
  const [reviewer, setReviewer] = useState("");
  const [reviewOpinion, setReviewOpinion] = useState("");
  const [changeRequest, setChangeRequest] = useState("");
  const [versionId, setVersionId] = useState("");

  function save(status: ApprovalStatus) {
    onSave(createApprovalRecord({ taskId: task.id, nodeName, status, submitter, reviewer, reviewOpinion, changeRequest, versionId }));
    setReviewOpinion("");
    setChangeRequest("");
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><ShieldCheck className="h-5 w-5" />审核流</CardTitle>
        <CardDescription>审核记录只追加不覆盖，驳回或需修改会阻塞下一流程。</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 md:grid-cols-2">
          <Field label="审核节点"><Select value={nodeName} onChange={(event) => setNodeName(event.target.value as ApprovalNodeName)} options={approvalNodeDefinitions.map((item) => ({ label: item.nodeName, value: item.nodeName }))} /></Field>
          <Field label="关联版本"><Select value={versionId} onChange={(event) => setVersionId(event.target.value)} options={[{ label: "不关联版本", value: "" }, ...versions.map((item) => ({ label: `${item.contentType} ${item.versionName}${item.isLatest ? "｜最新" : ""}`, value: item.id }))]} /></Field>
          <Field label="提交人"><Input value={submitter} onChange={(event) => setSubmitter(event.target.value)} /></Field>
          <Field label="审核人"><Input value={reviewer} onChange={(event) => setReviewer(event.target.value)} /></Field>
        </div>
        <Field label="审核意见"><Textarea value={reviewOpinion} onChange={(event) => setReviewOpinion(event.target.value)} /></Field>
        <Field label="修改要求"><Textarea value={changeRequest} onChange={(event) => setChangeRequest(event.target.value)} /></Field>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" onClick={() => save("待审核")}>提交审核</Button>
          <Button size="sm" onClick={() => save("通过")}><CheckCircle2 className="h-4 w-4" />通过</Button>
          <Button size="sm" variant="outline" onClick={() => save("需修改")}>需修改</Button>
          <Button size="sm" variant="destructive" onClick={() => save("驳回")}><XCircle className="h-4 w-4" />驳回</Button>
        </div>

        <div className="space-y-3">
          {approvalNodeDefinitions.map((node, index) => {
            const latest = records.filter((item) => item.nodeName === node.nodeName).sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
            const previousNode = approvalNodeDefinitions[index - 1];
            const previousStatus = previousNode ? approvalStatus(records, task.id, previousNode.nodeName) : "通过";
            const blocked = index > 0 && previousStatus !== "通过";
            return (
              <div key={node.nodeName} className="rounded-2xl border border-slate-200/70 bg-slate-50/70 p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <div className="text-sm font-semibold text-slate-950">{node.nodeName}</div>
                    <div className="mt-1 text-xs text-slate-500">审核对象：{node.objectType}</div>
                  </div>
                  <Badge className={latest?.status === "通过" ? "bg-emerald-50 text-emerald-700" : latest?.status === "驳回" || latest?.status === "需修改" ? "bg-rose-50 text-rose-700" : "bg-slate-50 text-slate-600"}>{latest?.status || "待提交"}</Badge>
                </div>
                {blocked ? <p className="mt-2 text-xs font-medium text-amber-700">上一节点未通过，继续推进有返工风险。</p> : null}
                {latest ? (
                  <div className="mt-3 grid gap-2 text-sm text-slate-600">
                    <div>提交人：{latest.submitter || "未填写"}｜审核人：{latest.reviewer || "未填写"}</div>
                    <div>提交：{formatDate(latest.submittedAt)}｜审核：{formatDate(latest.reviewedAt)}</div>
                    <div className="whitespace-pre-wrap">意见：{latest.reviewOpinion || "无"}</div>
                    <div className="whitespace-pre-wrap">修改要求：{latest.changeRequest || "无"}</div>
                    <Button size="sm" variant="outline" onClick={() => copyText(`【${node.nodeName}】\n状态：${latest.status}\n审核意见：${latest.reviewOpinion || "无"}\n修改要求：${latest.changeRequest || "无"}`)}>复制审核意见</Button>
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}

function VersionRecordsSection({
  data,
  task,
  records,
  onSave
}: {
  data: PipelineData;
  task: VideoTask;
  records: VersionRecord[];
  onSave: (records: VersionRecord[]) => void;
}) {
  const [contentType, setContentType] = useState<VersionContentType>("脚本");
  const [versionName, setVersionName] = useState("V1");
  const [creator, setCreator] = useState("");
  const [changeNote, setChangeNote] = useState("");
  const [selected, setSelected] = useState<VersionRecord | null>(null);

  function createVersion() {
    const next = createVersionRecord({ data, task, contentType, versionName, creator, changeNote });
    const updates = records.filter((item) => item.contentType === contentType && item.isLatest).map((item) => ({ ...item, isLatest: false }));
    onSave([...updates, next]);
    setSelected(next);
  }

  function restore(record: VersionRecord) {
    const restored: VersionRecord = {
      ...record,
      id: createId("version"),
      versionName: `${record.versionName}-恢复版`,
      createdAt: nowIso(),
      changeNote: `从 ${record.versionName} 恢复为当前使用版本。`,
      isLatest: true
    };
    const updates = records.filter((item) => item.contentType === record.contentType && item.isLatest).map((item) => ({ ...item, isLatest: false }));
    onSave([...updates, restored]);
    setSelected(restored);
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><GitBranch className="h-5 w-5" />版本记录</CardTitle>
        <CardDescription>记录脚本、分镜、剪辑说明、发布文案和复盘结论的当前版本，避免拿错旧稿。</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 md:grid-cols-2">
          <Field label="内容类型"><Select value={contentType} onChange={(event) => setContentType(event.target.value as VersionContentType)} options={versionContentTypes.map((item) => ({ label: item, value: item }))} /></Field>
          <Field label="版本名称"><Input value={versionName} onChange={(event) => setVersionName(event.target.value)} /></Field>
          <Field label="创建人"><Input value={creator} onChange={(event) => setCreator(event.target.value)} /></Field>
          <Field label="修改说明"><Input value={changeNote} onChange={(event) => setChangeNote(event.target.value)} /></Field>
        </div>
        <Button onClick={createVersion}><Plus className="h-4 w-4" />新建版本</Button>
        <div className="space-y-3">
          {records.length === 0 ? <EmptyState text="还没有版本记录。先为脚本或分镜创建 V1 版本。" /> : null}
          {records.map((record) => (
            <div key={record.id} className="rounded-2xl border border-slate-200/70 bg-slate-50/70 p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <div className="text-sm font-semibold text-slate-950">{record.contentType}｜{record.versionName}</div>
                  <div className="mt-1 text-xs text-slate-500">{record.creator || "未填写创建人"}｜{formatDate(record.createdAt)}</div>
                </div>
                <div className="flex gap-2">
                  {record.isLatest ? <Badge className="bg-emerald-50 text-emerald-700">最新版本</Badge> : null}
                  {record.approved ? <Badge className="bg-slate-950 text-white">已审核</Badge> : null}
                </div>
              </div>
              <p className="mt-2 text-sm text-slate-600">{record.changeNote || "无修改说明"}</p>
              <div className="mt-3 flex flex-wrap gap-2">
                <Button size="sm" variant="outline" onClick={() => setSelected(record)}>查看快照</Button>
                <Button size="sm" variant="outline" onClick={() => restore(record)}><RotateCcw className="h-4 w-4" />恢复为新版</Button>
              </div>
            </div>
          ))}
        </div>
        {selected ? (
          <div className="rounded-2xl border border-slate-200/70 bg-white p-4">
            <div className="mb-2 text-sm font-semibold text-slate-950">版本快照：{selected.contentType} {selected.versionName}</div>
            <pre className="max-h-80 overflow-auto whitespace-pre-wrap rounded-xl bg-slate-950 p-4 text-xs leading-6 text-slate-100">{selected.contentSnapshot}</pre>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

function TaskCommentsSection({ task, comments, onSave }: { task: VideoTask; comments: TaskComment[]; onSave: (comment: TaskComment) => void }) {
  const [moduleFilter, setModuleFilter] = useState("全部");
  const [author, setAuthor] = useState("");
  const [content, setContent] = useState("");
  const [commentType, setCommentType] = useState<CommentType>("普通评论");
  const [module, setModule] = useState<CommentModule>("脚本");
  const [assignee, setAssignee] = useState("");
  const filtered = moduleFilter === "全部" ? comments : comments.filter((item) => item.module === moduleFilter);

  function submit() {
    if (!content.trim()) return;
    onSave({
      id: createId("comment"),
      taskId: task.id,
      author,
      content,
      commentType,
      module,
      assignee,
      status: "未处理",
      createdAt: nowIso(),
      resolvedAt: ""
    });
    setContent("");
  }

  function updateStatus(comment: TaskComment, status: CommentStatus) {
    onSave({ ...comment, status, resolvedAt: status === "已解决" ? nowIso() : comment.resolvedAt });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><MessageSquare className="h-5 w-5" />协作评论</CardTitle>
        <CardDescription>记录修改意见、风险提醒和复盘补充，避免口头沟通丢失。</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 md:grid-cols-4">
          <Field label="评论人"><Input value={author} onChange={(event) => setAuthor(event.target.value)} /></Field>
          <Field label="评论类型"><Select value={commentType} onChange={(event) => setCommentType(event.target.value as CommentType)} options={commentTypes.map((item) => ({ label: item, value: item }))} /></Field>
          <Field label="关联模块"><Select value={module} onChange={(event) => setModule(event.target.value as CommentModule)} options={commentModules.map((item) => ({ label: item, value: item }))} /></Field>
          <Field label="关联负责人"><Input value={assignee} onChange={(event) => setAssignee(event.target.value)} /></Field>
        </div>
        <Field label="评论内容"><Textarea value={content} onChange={(event) => setContent(event.target.value)} /></Field>
        <div className="flex flex-wrap gap-2">
          <Button onClick={submit}><Plus className="h-4 w-4" />添加评论</Button>
          <Select value={moduleFilter} onChange={(event) => setModuleFilter(event.target.value)} options={[{ label: "全部模块", value: "全部" }, ...commentModules.map((item) => ({ label: item, value: item }))]} />
        </div>
        <div className="space-y-3">
          {filtered.length === 0 ? <EmptyState text="还没有协作评论。把修改意见记录在这里，后续可追踪处理状态。" /> : null}
          {filtered.map((comment) => (
            <div key={comment.id} className="rounded-2xl border border-slate-200/70 bg-slate-50/70 p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <div className="text-sm font-semibold text-slate-950">{comment.module}｜{comment.commentType}</div>
                  <div className="mt-1 text-xs text-slate-500">{comment.author || "未填写"} → {comment.assignee || "未指派"}｜{formatDate(comment.createdAt)}</div>
                </div>
                <Badge className={comment.status === "已解决" ? "bg-emerald-50 text-emerald-700" : comment.status === "处理中" ? "bg-amber-50 text-amber-700" : "bg-rose-50 text-rose-700"}>{comment.status}</Badge>
              </div>
              <p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-slate-700">{comment.content}</p>
              <div className="mt-3 flex flex-wrap gap-2">
                <Button size="sm" variant="outline" onClick={() => updateStatus(comment, "处理中")}>处理中</Button>
                <Button size="sm" onClick={() => updateStatus(comment, "已解决")}>标记已解决</Button>
                <Button size="sm" variant="outline" onClick={() => copyText(`【${comment.module}｜${comment.commentType}】\n负责人：${comment.assignee || "未指派"}\n内容：${comment.content}`)}><Copy className="h-4 w-4" />复制评论</Button>
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

export function EditBriefsPage() {
  const { data, refresh } = useProductionData();
  const blank = (): EditBrief => {
    const now = nowIso();
    return {
      id: createId("editbrief"),
      taskId: "",
      projectId: "",
      productId: "",
      scriptId: "",
      shotListId: "",
      editor: "",
      targetDuration: "60秒",
      rhythm: "中等",
      openingTreatment: "",
      subtitleHighlights: "",
      pictureInPicturePositions: "",
      enlargedKeywords: "",
      soundEffectRequirements: "",
      musicStyle: "",
      transitionRequirements: "",
      productDetailPositions: "",
      emotionHighlights: "",
      conversionGuidePosition: "",
      forbiddenActions: "",
      referenceVideoLinks: "",
      deadline: "",
      reviewFeedback: "",
      revisionRecords: "",
      currentVersion: "初版",
      versions: [],
      createdAt: now,
      updatedAt: now
    };
  };
  const [form, setForm] = useState<EditBrief>(blank);

  const task = findTask(data, form.taskId);
  const project = findProject(data, task?.projectId || form.projectId);
  const product = findProduct(data, task?.productId || form.productId);
  const script = findScript(data, task?.scriptId || form.scriptId);
  const shotList = findShotList(data, task?.shotListId || form.shotListId);

  function handleTaskChange(taskId: string) {
    const nextTask = findTask(data, taskId);
    setForm({
      ...form,
      taskId,
      projectId: nextTask?.projectId || "",
      productId: nextTask?.productId || "",
      scriptId: nextTask?.scriptId || "",
      shotListId: nextTask?.shotListId || "",
      editor: nextTask?.editingOwner || form.editor,
      deadline: nextTask?.dueDate || form.deadline
    });
  }

  function handleGenerate() {
    if (!project) return;
    const next = generateEditBrief({
      project,
      product,
      task,
      script,
      shotList,
      editor: form.editor,
      targetDuration: form.targetDuration,
      rhythm: form.rhythm,
      deadline: form.deadline
    });
    setForm({ ...next, id: form.id, createdAt: form.createdAt });
  }

  function submit() {
    saveEditBrief({ ...form, updatedAt: nowIso() });
    if (task) saveVideoTask({ ...task, editBriefId: form.id, status: task.status === "待剪辑" || task.status === "剪辑中" ? task.status : "待剪辑", updatedAt: nowIso() });
    setForm(blank());
    refresh();
  }

  return (
    <div>
      <PageHeader title="剪辑说明单" description="把编导脑子里的节奏、画中画、字幕、音效和成交引导完整交付给剪辑师。" eyebrow="编导中台 / 剪辑说明单" />
      <div className="grid gap-6 xl:grid-cols-[430px_minmax(0,1fr)]">
        <Card>
          <CardHeader><CardTitle>{data.editBriefs.some((item) => item.id === form.id) ? "编辑剪辑说明" : "新建剪辑说明"}</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <Field label="视频任务"><Select value={form.taskId} onChange={(event) => handleTaskChange(event.target.value)} options={taskOptions(data.videoTasks)} /></Field>
            <div className="grid gap-4 md:grid-cols-2">
              <Field label="剪辑负责人"><Input value={form.editor} onChange={(event) => setForm({ ...form, editor: event.target.value })} /></Field>
              <Field label="成片时长目标"><Input value={form.targetDuration} onChange={(event) => setForm({ ...form, targetDuration: event.target.value })} /></Field>
              <Field label="剪辑节奏"><Select value={form.rhythm} onChange={(event) => setForm({ ...form, rhythm: event.target.value as EditBrief["rhythm"] })} options={editRhythms.map((item) => ({ label: item, value: item }))} /></Field>
              <Field label="交付截止时间"><Input type="date" value={form.deadline} onChange={(event) => setForm({ ...form, deadline: event.target.value })} /></Field>
            </div>
            <Button variant="outline" onClick={handleGenerate} disabled={!project}>从脚本和分镜生成</Button>
            <EditBriefForm form={form} setForm={setForm} />
            <div className="flex flex-wrap gap-2">
              <Button onClick={submit}><Save className="h-4 w-4" />保存说明单</Button>
              <Button variant="outline" onClick={() => setForm(blank())}>清空</Button>
            </div>
          </CardContent>
        </Card>

        <div className="space-y-4">
          {data.editBriefs.length === 0 ? <EmptyState text="还没有剪辑说明单。选择任务后可从脚本和分镜自动生成。" /> : null}
          {data.editBriefs.map((item) => (
            <EditBriefCard key={item.id} item={item} data={data} onEdit={() => setForm(item)} onDelete={() => { deleteEditBrief(item.id); refresh(); }} />
          ))}
        </div>
      </div>
    </div>
  );
}

function EditBriefForm({ form, setForm }: { form: EditBrief; setForm: (value: EditBrief) => void }) {
  return (
    <div className="grid gap-4">
      <Field label="开头处理方式"><Textarea value={form.openingTreatment} onChange={(event) => setForm({ ...form, openingTreatment: event.target.value })} /></Field>
      <Field label="字幕重点"><Textarea value={form.subtitleHighlights} onChange={(event) => setForm({ ...form, subtitleHighlights: event.target.value })} /></Field>
      <Field label="画中画插入位置"><Textarea value={form.pictureInPicturePositions} onChange={(event) => setForm({ ...form, pictureInPicturePositions: event.target.value })} /></Field>
      <Field label="需要放大的关键词"><Textarea value={form.enlargedKeywords} onChange={(event) => setForm({ ...form, enlargedKeywords: event.target.value })} /></Field>
      <Field label="音效要求"><Textarea value={form.soundEffectRequirements} onChange={(event) => setForm({ ...form, soundEffectRequirements: event.target.value })} /></Field>
      <Field label="音乐风格"><Textarea value={form.musicStyle} onChange={(event) => setForm({ ...form, musicStyle: event.target.value })} /></Field>
      <Field label="转场要求"><Textarea value={form.transitionRequirements} onChange={(event) => setForm({ ...form, transitionRequirements: event.target.value })} /></Field>
      <Field label="产品细节展示位置"><Textarea value={form.productDetailPositions} onChange={(event) => setForm({ ...form, productDetailPositions: event.target.value })} /></Field>
      <Field label="情绪强化点"><Textarea value={form.emotionHighlights} onChange={(event) => setForm({ ...form, emotionHighlights: event.target.value })} /></Field>
      <Field label="成交引导位置"><Textarea value={form.conversionGuidePosition} onChange={(event) => setForm({ ...form, conversionGuidePosition: event.target.value })} /></Field>
      <Field label="禁止事项"><Textarea value={form.forbiddenActions} onChange={(event) => setForm({ ...form, forbiddenActions: event.target.value })} /></Field>
      <Field label="参考视频链接"><Textarea value={form.referenceVideoLinks} onChange={(event) => setForm({ ...form, referenceVideoLinks: event.target.value })} /></Field>
      <Field label="审核意见"><Textarea value={form.reviewFeedback} onChange={(event) => setForm({ ...form, reviewFeedback: event.target.value })} /></Field>
      <Field label="修改记录"><Textarea value={form.revisionRecords} onChange={(event) => setForm({ ...form, revisionRecords: event.target.value })} /></Field>
    </div>
  );
}

function EditBriefCard({ item, data, onEdit, onDelete }: { item: EditBrief; data: PipelineData; onEdit: () => void; onDelete: () => void }) {
  const task = findTask(data, item.taskId);
  const text = [
    `视频任务：${task?.videoTitle || "未关联"}`,
    `剪辑负责人：${item.editor}`,
    `成片时长目标：${item.targetDuration}`,
    `剪辑节奏：${item.rhythm}`,
    `开头处理方式：${item.openingTreatment}`,
    `字幕重点：${item.subtitleHighlights}`,
    `画中画插入位置：${item.pictureInPicturePositions}`,
    `需要放大的关键词：${item.enlargedKeywords}`,
    `音效要求：${item.soundEffectRequirements}`,
    `音乐风格：${item.musicStyle}`,
    `转场要求：${item.transitionRequirements}`,
    `产品细节展示位置：${item.productDetailPositions}`,
    `情绪强化点：${item.emotionHighlights}`,
    `成交引导位置：${item.conversionGuidePosition}`,
    `禁止事项：${item.forbiddenActions}`,
    `审核意见：${item.reviewFeedback}`,
    `修改记录：${item.revisionRecords}`
  ].join("\n");

  return (
    <Card>
      <CardHeader><CardTitle>{task?.videoTitle || "未关联任务"}</CardTitle><CardDescription>{item.editor || "未分配剪辑"}｜{item.rhythm}｜{item.currentVersion}</CardDescription></CardHeader>
      <CardContent className="space-y-3">
        <Info label="开头处理方式" value={item.openingTreatment} />
        <Info label="画中画插入位置" value={item.pictureInPicturePositions} />
        <Info label="成交引导位置" value={item.conversionGuidePosition} />
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" onClick={onEdit}><Edit className="h-4 w-4" />编辑</Button>
          <Button size="sm" variant="outline" onClick={() => copyText(text)}><Copy className="h-4 w-4" />复制给剪辑师</Button>
          <Button size="sm" variant="destructive" onClick={onDelete}><Trash2 className="h-4 w-4" />删除</Button>
        </div>
      </CardContent>
    </Card>
  );
}

function blankScores(): ReviewScores {
  return Object.fromEntries(reviewScoreKeys.map((key) => [key, 3])) as ReviewScores;
}

function blankReview(data: PipelineData): ReviewRecord {
  const task = data.videoTasks.find((item) => item.status === "待复盘") || data.videoTasks[0];
  const project = findProject(data, task?.projectId || "");
  const product = findProduct(data, task?.productId || "");
  const now = nowIso();
  return {
    id: createId("review"),
    taskId: task?.id || "",
    projectId: project?.id || "",
    productId: product?.id || "",
    publishRecordId: task?.publishRecordId || "",
    videoTitle: task?.videoTitle || "",
    publishedAt: "",
    platform: project?.targetPlatform || "抖音",
    account: "",
    metrics: {
      views: "",
      fiveSecondRetention: "",
      completionRate: "",
      averageWatchTime: "",
      likeRate: "",
      commentRate: "",
      shareRate: "",
      favoriteRate: "",
      profileVisits: "",
      productClicks: "",
      liveRoomClicks: "",
      transactionAmount: "",
      transactionCount: ""
    },
    scores: blankScores(),
    dataScores: {
      topic: 3,
      opening: 3,
      script: 3,
      shooting: 3,
      editing: 3,
      publishing: 3,
      conversion: 3
    },
    judgements: {
      viewsMet: false,
      completionMet: false,
      interactionMet: false,
      productClickMet: false,
      transactionMet: false
    },
    problemAttributions: [],
    primaryCause: "",
    secondaryCause: "",
    evidence: "",
    nextAction: "",
    retainedPoints: "",
    avoidNextTime: "",
    reusableStructure: "",
    reusableOpening: "",
    reusablePictureInPicture: "",
    nextOptimization: "",
    coreReason: "",
    keepNext: "",
    removeNext: "",
    strengthenNext: "",
    nextTestDirection: "",
    scoreHint: "",
    insight: {
      primaryCause: "",
      secondaryCause: "",
      evidence: "",
      nextAction: "",
      coreReason: "",
      keepNext: "",
      removeNext: "",
      strengthenNext: "",
      nextTestDirection: ""
    },
    autoConclusion: "",
    caseType: "",
    addedToAssetLibrary: false,
    createdAt: now,
    updatedAt: now
  };
}

export function ReviewsPage() {
  const { data, refresh } = useProductionData();
  const [form, setForm] = useState<ReviewRecord>(() => blankReview(emptyData));

  function selectTask(taskId: string) {
    const task = findTask(data, taskId);
    const project = findProject(data, task?.projectId || "");
    setForm({
      ...form,
      taskId,
      projectId: task?.projectId || "",
      productId: task?.productId || "",
      publishRecordId: task?.publishRecordId || "",
      videoTitle: task?.videoTitle || "",
      platform: project?.targetPlatform || form.platform
    });
  }

  function updateMetric(key: keyof ReviewRecord["metrics"], value: string) {
    setForm({ ...form, metrics: { ...form.metrics, [key]: value } });
  }

  function updateScore(key: keyof ReviewScores, value: string) {
    setForm({ ...form, scores: { ...form.scores, [key]: Number(value) } });
  }

  function updateDataScore(key: keyof ReviewRecord["dataScores"], value: string) {
    const nextScores = { ...form.dataScores, [key]: Number(value) };
    setForm({ ...form, dataScores: nextScores, scoreHint: buildScoreHint(nextScores) });
  }

  function updateJudgement(key: keyof ReviewRecord["judgements"], value: boolean) {
    setForm({ ...form, judgements: { ...form.judgements, [key]: value } });
  }

  function toggleProblem(value: ProblemAttributionKey) {
    const next = form.problemAttributions.includes(value)
      ? form.problemAttributions.filter((item) => item !== value)
      : [...form.problemAttributions, value];
    setForm({ ...form, problemAttributions: next });
  }

  function submit(caseType?: ReviewRecord["caseType"]) {
    const nextCaseType = caseType ?? form.caseType;
    const insight = {
      primaryCause: form.primaryCause,
      secondaryCause: form.secondaryCause,
      evidence: form.evidence,
      nextAction: form.nextAction,
      coreReason: form.coreReason,
      keepNext: form.keepNext,
      removeNext: form.removeNext,
      strengthenNext: form.strengthenNext,
      nextTestDirection: form.nextTestDirection
    };
    const review = {
      ...form,
      caseType: nextCaseType,
      addedToAssetLibrary: Boolean(nextCaseType),
      scoreHint: form.scoreHint || buildScoreHint(form.dataScores),
      insight,
      autoConclusion: form.autoConclusion || enhanceReviewConclusion({ ...form, insight, scoreHint: form.scoreHint || buildScoreHint(form.dataScores) }),
      updatedAt: nowIso()
    };
    saveReviewRecord(review);
    const task = findTask(data, review.taskId);
    if (task) saveVideoTask({ ...task, reviewRecordId: review.id, status: "已归档", updatedAt: nowIso() });
    if (review.caseType) {
      saveContentAsset(reviewToContentAsset(review));
    }
    setForm(blankReview(data));
    refresh();
  }

  async function aiReviewConclusion() {
    const { result } = await runWorkflowAi<Record<string, string>>("reviewConclusion", form, () => ({
      autoConclusion: enhanceReviewConclusion(form),
      primaryCause: form.primaryCause,
      secondaryCause: form.secondaryCause,
      evidence: form.evidence,
      nextAction: form.nextAction
    }));
    setForm({
      ...form,
      primaryCause: result.primaryCause || form.primaryCause,
      secondaryCause: result.secondaryCause || form.secondaryCause,
      evidence: result.evidence || form.evidence,
      nextAction: result.nextAction || form.nextAction,
      autoConclusion: result.autoConclusion || enhanceReviewConclusion(form)
    });
  }

  function createOptimizedTask() {
    const sourceTask = findTask(data, form.taskId);
    saveVideoTask(createNextTaskFromFailedReview(form, sourceTask));
    refresh();
  }

  const productReviews = form.productId ? data.reviewRecords.filter((item) => item.productId === form.productId && item.id !== form.id) : [];

  return (
    <div>
      <PageHeader title="标准化复盘" description="用固定维度复盘发布结果，把结论沉淀成公司内容资产，而不是凭感觉讨论。" eyebrow="编导中台 / 标准化复盘" />
      <div className="grid gap-6 xl:grid-cols-[460px_minmax(0,1fr)]">
        <Card>
          <CardHeader><CardTitle>复盘表</CardTitle><CardDescription>所有关键维度结构化填写，并支持 1-5 分打分。</CardDescription></CardHeader>
          <CardContent className="space-y-4">
            <Field label="视频任务"><Select value={form.taskId} onChange={(event) => selectTask(event.target.value)} options={taskOptions(data.videoTasks)} /></Field>
            <div className="grid gap-4 md:grid-cols-2">
              <Field label="视频标题"><Input value={form.videoTitle} onChange={(event) => setForm({ ...form, videoTitle: event.target.value })} /></Field>
              <Field label="发布时间"><Input type="datetime-local" value={form.publishedAt} onChange={(event) => setForm({ ...form, publishedAt: event.target.value })} /></Field>
              <Field label="发布平台"><Select value={form.platform} onChange={(event) => setForm({ ...form, platform: event.target.value as ReviewRecord["platform"] })} options={platforms.map((item) => ({ label: item, value: item }))} /></Field>
              <Field label="账号"><Input value={form.account} onChange={(event) => setForm({ ...form, account: event.target.value })} /></Field>
            </div>

            <h3 className="pt-2 text-sm font-semibold text-slate-900">数据指标</h3>
            <div className="grid gap-3 md:grid-cols-2">
              {([
                ["views", "播放量"],
                ["fiveSecondRetention", "5 秒留存"],
                ["completionRate", "完播率"],
                ["averageWatchTime", "平均播放时长"],
                ["likeRate", "点赞率"],
                ["commentRate", "评论率"],
                ["shareRate", "转发率"],
                ["favoriteRate", "收藏率"],
                ["profileVisits", "主页访问"],
                ["productClicks", "商品点击"],
                ["liveRoomClicks", "直播间点击"],
                ["transactionAmount", "成交金额"],
                ["transactionCount", "成交件数"]
              ] as const).map(([key, label]) => (
                <Field key={key} label={label}><Input value={form.metrics[key]} onChange={(event) => updateMetric(key, event.target.value)} /></Field>
              ))}
            </div>

            <h3 className="pt-2 text-sm font-semibold text-slate-900">内容复盘评分</h3>
            <div className="grid gap-3">
              {reviewScoreKeys.map((key) => (
                <div key={key} className="grid grid-cols-[minmax(0,1fr)_96px] items-center gap-3 rounded-2xl border border-slate-200/70 bg-slate-50/70 p-3">
                  <span className="text-sm text-slate-700">{reviewScoreLabels[key]}</span>
                  <Select value={String(form.scores[key])} onChange={(event) => updateScore(key, event.target.value)} options={["1", "2", "3", "4", "5"].map((item) => ({ label: `${item} 分`, value: item }))} />
                </div>
              ))}
            </div>

            <h3 className="pt-2 text-sm font-semibold text-slate-900">数据评分</h3>
            <div className="grid gap-3 md:grid-cols-2">
              {([
                ["topic", "选题评分"],
                ["opening", "开头评分"],
                ["script", "脚本评分"],
                ["shooting", "拍摄评分"],
                ["editing", "剪辑评分"],
                ["publishing", "发布评分"],
                ["conversion", "转化评分"]
              ] as const).map(([key, label]) => (
                <Field key={key} label={label}>
                  <Select value={String(form.dataScores[key])} onChange={(event) => updateDataScore(key, event.target.value)} options={["1", "2", "3", "4", "5"].map((item) => ({ label: `${item} 分`, value: item }))} />
                </Field>
              ))}
            </div>
            <Info label="自动评分提示" value={form.scoreHint || buildScoreHint(form.dataScores)} />

            <h3 className="pt-2 text-sm font-semibold text-slate-900">数据判断</h3>
            <div className="grid gap-2 md:grid-cols-2">
              {([
                ["viewsMet", "播放是否达标"],
                ["completionMet", "完播是否达标"],
                ["interactionMet", "互动是否达标"],
                ["productClickMet", "商品点击是否达标"],
                ["transactionMet", "成交是否达标"]
              ] as const).map(([key, label]) => (
                <label key={key} className="flex items-center gap-2 rounded-xl border border-slate-200/70 bg-slate-50/70 px-3 py-2 text-sm text-slate-700">
                  <input className="accent-slate-950" type="checkbox" checked={form.judgements[key]} onChange={(event) => updateJudgement(key, event.target.checked)} />
                  {label}
                </label>
              ))}
            </div>

            <h3 className="pt-2 text-sm font-semibold text-slate-900">问题归因</h3>
            <div className="grid gap-2 md:grid-cols-2">
              {problemAttributionOptions.map((item) => (
                <label key={item} className="flex items-center gap-2 rounded-xl border border-slate-200/70 bg-slate-50/70 px-3 py-2 text-sm text-slate-700">
                  <input className="accent-slate-950" type="checkbox" checked={form.problemAttributions.includes(item)} onChange={() => toggleProblem(item)} />
                  {item}
                </label>
              ))}
            </div>

            <Field label="本条视频值得保留的点"><Textarea value={form.retainedPoints} onChange={(event) => setForm({ ...form, retainedPoints: event.target.value })} /></Field>
            <Field label="下次必须避免的问题"><Textarea value={form.avoidNextTime} onChange={(event) => setForm({ ...form, avoidNextTime: event.target.value })} /></Field>
            <div className="grid gap-4 md:grid-cols-2">
              <Field label="主因"><Textarea value={form.primaryCause} onChange={(event) => setForm({ ...form, primaryCause: event.target.value })} /></Field>
              <Field label="次因"><Textarea value={form.secondaryCause} onChange={(event) => setForm({ ...form, secondaryCause: event.target.value })} /></Field>
            </div>
            <Field label="证据"><Textarea value={form.evidence} onChange={(event) => setForm({ ...form, evidence: event.target.value })} /></Field>
            <Field label="下次动作"><Textarea value={form.nextAction} onChange={(event) => setForm({ ...form, nextAction: event.target.value })} /></Field>
            <Field label="可以复用的结构"><Textarea value={form.reusableStructure} onChange={(event) => setForm({ ...form, reusableStructure: event.target.value })} /></Field>
            <Field label="可以复用的开头"><Textarea value={form.reusableOpening} onChange={(event) => setForm({ ...form, reusableOpening: event.target.value })} /></Field>
            <Field label="可以复用的画中画"><Textarea value={form.reusablePictureInPicture} onChange={(event) => setForm({ ...form, reusablePictureInPicture: event.target.value })} /></Field>
            <Field label="下一条视频优化建议"><Textarea value={form.nextOptimization} onChange={(event) => setForm({ ...form, nextOptimization: event.target.value })} /></Field>
            <Field label="成功或失败的核心原因"><Textarea value={form.coreReason} onChange={(event) => setForm({ ...form, coreReason: event.target.value })} /></Field>
            <div className="grid gap-4 md:grid-cols-2">
              <Field label="下次保留什么"><Textarea value={form.keepNext} onChange={(event) => setForm({ ...form, keepNext: event.target.value })} /></Field>
              <Field label="下次删除什么"><Textarea value={form.removeNext} onChange={(event) => setForm({ ...form, removeNext: event.target.value })} /></Field>
            </div>
            <Field label="下次加强什么"><Textarea value={form.strengthenNext} onChange={(event) => setForm({ ...form, strengthenNext: event.target.value })} /></Field>
            <Field label="下一条测试方向"><Textarea value={form.nextTestDirection} onChange={(event) => setForm({ ...form, nextTestDirection: event.target.value })} /></Field>
            <Field label="自动复盘结论"><Textarea value={form.autoConclusion} onChange={(event) => setForm({ ...form, autoConclusion: event.target.value })} /></Field>

            <div className="flex flex-wrap gap-2">
              <Button variant="outline" onClick={() => setForm({ ...form, scoreHint: buildScoreHint(form.dataScores), autoConclusion: enhanceReviewConclusion(form) })}>生成复盘结论</Button>
              <Button variant="outline" onClick={aiReviewConclusion}><Bot className="h-4 w-4" />AI 自动归因</Button>
              <Button onClick={() => submit()}><Save className="h-4 w-4" />保存复盘</Button>
              <Button variant="outline" onClick={() => submit("成功案例")}>保存为成功案例</Button>
              <Button variant="outline" onClick={() => submit("失败案例")}>保存为失败案例</Button>
              <Button variant="outline" onClick={createOptimizedTask}>生成下一条优化任务</Button>
            </div>
          </CardContent>
        </Card>

        <div className="space-y-4">
          <Card>
            <CardHeader><CardTitle>同产品复盘对比</CardTitle><CardDescription>先做简单列表对比，后续可升级成趋势图。</CardDescription></CardHeader>
            <CardContent className="space-y-3">
              {productReviews.length === 0 ? <EmptyState text="当前产品还没有其他复盘记录。" /> : null}
              {productReviews.slice(0, 6).map((item) => (
                <div key={item.id} className="rounded-2xl border border-slate-200/70 bg-slate-50/70 p-4">
                  <div className="text-sm font-semibold text-slate-950">{item.videoTitle || "未命名视频"}</div>
                  <div className="mt-1 text-xs text-slate-500">播放 {item.metrics.views || "未填"}｜完播 {item.metrics.completionRate || "未填"}｜商品点击 {item.metrics.productClicks || "未填"}｜成交 {item.metrics.transactionAmount || "未填"}</div>
                  <p className="mt-2 line-clamp-3 text-sm leading-6 text-slate-600">{item.autoConclusion || item.nextOptimization || "未填写结论"}</p>
                </div>
              ))}
            </CardContent>
          </Card>
          {data.reviewRecords.length === 0 ? <EmptyState text="还没有复盘记录。视频发布后，选择任务并按固定维度填写复盘。" /> : null}
          {data.reviewRecords.map((item) => (
            <ReviewCard key={item.id} item={item} onEdit={() => setForm(item)} onDelete={() => { deleteReviewRecord(item.id); refresh(); }} />
          ))}
        </div>
      </div>
    </div>
  );
}

export function ContentAssetsPage() {
  const { data, refresh } = useProductionData();
  const blank = (): ContentAsset => ({
    id: createId("asset"),
    title: "",
    assetType: "成功案例库",
    sourceVideo: "",
    productId: "",
    scenario: "",
    effectivenessReason: "",
    reusableMethod: "",
    notes: "",
    tags: "",
    creator: "",
    sourceRecordId: "",
    createdAt: nowIso()
  });
  const [form, setForm] = useState<ContentAsset>(blank);
  const [assetType, setAssetType] = useState("全部");
  const [productId, setProductId] = useState("全部");
  const [keyword, setKeyword] = useState("");
  const filtered = data.contentAssets.filter((item) => {
    const text = [item.title, item.sourceVideo, item.scenario, item.tags, item.reusableMethod].join(" ");
    return (assetType === "全部" || item.assetType === assetType) && (productId === "全部" || item.productId === productId) && text.includes(keyword);
  });

  function submit() {
    if (!form.title.trim()) return;
    saveContentAsset(form);
    setForm(blank());
    refresh();
  }

  return (
    <div>
      <PageHeader title="内容资产库" description="沉淀成功案例、失败案例、爆款开头、可复用结构、画中画素材和复盘结论。" eyebrow="编导中台 / 内容资产库" />
      <div className="grid gap-6 xl:grid-cols-[430px_minmax(0,1fr)]">
        <Card>
          <CardHeader><CardTitle>{data.contentAssets.some((item) => item.id === form.id) ? "编辑内容资产" : "新增内容资产"}</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <Field label="资产标题"><Input value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} /></Field>
            <Field label="资产类型"><Select value={form.assetType} onChange={(event) => setForm({ ...form, assetType: event.target.value as ContentAsset["assetType"] })} options={contentAssetTypes.map((item) => ({ label: item, value: item }))} /></Field>
            <Field label="来源视频"><Input value={form.sourceVideo} onChange={(event) => setForm({ ...form, sourceVideo: event.target.value })} /></Field>
            <Field label="所属产品"><Select value={form.productId} onChange={(event) => setForm({ ...form, productId: event.target.value })} options={productOptions(data.products)} /></Field>
            <Field label="适用场景"><Textarea value={form.scenario} onChange={(event) => setForm({ ...form, scenario: event.target.value })} /></Field>
            <Field label="为什么有效 / 为什么无效"><Textarea value={form.effectivenessReason} onChange={(event) => setForm({ ...form, effectivenessReason: event.target.value })} /></Field>
            <Field label="可复用方法"><Textarea value={form.reusableMethod} onChange={(event) => setForm({ ...form, reusableMethod: event.target.value })} /></Field>
            <Field label="注意事项"><Textarea value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })} /></Field>
            <div className="grid gap-4 md:grid-cols-2">
              <Field label="标签"><Input value={form.tags} onChange={(event) => setForm({ ...form, tags: event.target.value })} /></Field>
              <Field label="创建人"><Input value={form.creator} onChange={(event) => setForm({ ...form, creator: event.target.value })} /></Field>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button onClick={submit}><Save className="h-4 w-4" />保存资产</Button>
              <Button variant="outline" onClick={() => setForm(blank())}>清空</Button>
            </div>
          </CardContent>
        </Card>

        <div className="space-y-4">
          <Card>
            <CardContent className="grid gap-3 pt-6 md:grid-cols-3">
              <Input placeholder="搜索资产标题、标签、方法" value={keyword} onChange={(event) => setKeyword(event.target.value)} />
              <Select value={assetType} onChange={(event) => setAssetType(event.target.value)} options={[{ label: "全部类型", value: "全部" }, ...contentAssetTypes.map((item) => ({ label: item, value: item }))]} />
              <Select value={productId} onChange={(event) => setProductId(event.target.value)} options={[{ label: "全部产品", value: "全部" }, ...data.products.map((item) => ({ label: item.productName, value: item.id }))]} />
            </CardContent>
          </Card>
          {filtered.length === 0 ? <EmptyState text="还没有内容资产。复盘保存为成功或失败案例后，会自动沉淀到这里。" /> : null}
          {filtered.map((item) => (
            <ContentAssetCard key={item.id} item={item} product={findProduct(data, item.productId)} onEdit={() => setForm(item)} onDelete={() => { deleteContentAsset(item.id); refresh(); }} />
          ))}
        </div>
      </div>
    </div>
  );
}

function ContentAssetCard({ item, product, onEdit, onDelete }: { item: ContentAsset; product?: ProductProfile; onEdit: () => void; onDelete: () => void }) {
  const text = [
    `资产标题：${item.title}`,
    `资产类型：${item.assetType}`,
    `来源视频：${item.sourceVideo}`,
    `所属产品：${product?.productName || "未关联"}`,
    `适用场景：${item.scenario}`,
    `为什么有效/无效：${item.effectivenessReason}`,
    `可复用方法：${item.reusableMethod}`,
    `注意事项：${item.notes}`,
    `标签：${item.tags}`
  ].join("\n");

  return (
    <Card>
      <CardHeader><CardTitle>{item.title}</CardTitle><CardDescription>{item.assetType}｜{product?.productName || "未关联产品"}｜{item.tags || "无标签"}</CardDescription></CardHeader>
      <CardContent className="space-y-3">
        <Info label="可复用方法" value={item.reusableMethod} />
        <Info label="为什么有效 / 为什么无效" value={item.effectivenessReason} />
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" onClick={onEdit}><Edit className="h-4 w-4" />编辑</Button>
          <Button size="sm" variant="outline" onClick={() => copyText(text)}><Copy className="h-4 w-4" />复制资产</Button>
          <Button size="sm" variant="destructive" onClick={onDelete}><Trash2 className="h-4 w-4" />删除</Button>
        </div>
      </CardContent>
    </Card>
  );
}

function ReviewCard({ item, onEdit, onDelete }: { item: ReviewRecord; onEdit: () => void; onDelete: () => void }) {
  const text = [
    `视频标题：${item.videoTitle}`,
    `平台：${item.platform}`,
    `账号：${item.account}`,
    `播放量：${item.metrics.views}`,
    `5 秒留存：${item.metrics.fiveSecondRetention}`,
    `完播率：${item.metrics.completionRate}`,
    `问题归因：${item.problemAttributions.join("、")}`,
    `复盘结论：${item.autoConclusion}`,
    `可复用结构：${item.reusableStructure}`,
    `下一条优化建议：${item.nextOptimization}`
  ].join("\n");

  return (
    <Card>
      <CardHeader><CardTitle>{item.videoTitle || "未命名视频"}</CardTitle><CardDescription>{item.platform}｜{item.caseType || "普通复盘"}｜{formatDate(item.updatedAt)}</CardDescription></CardHeader>
      <CardContent className="space-y-3">
        <Info label="复盘结论" value={item.autoConclusion} />
        <Info label="问题归因" value={item.problemAttributions.join("、")} />
        <Info label="下一条优化建议" value={item.nextOptimization} />
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" onClick={onEdit}><Edit className="h-4 w-4" />编辑</Button>
          <Button size="sm" variant="outline" onClick={() => copyText(text)}><Copy className="h-4 w-4" />复制复盘</Button>
          <Button size="sm" variant="destructive" onClick={onDelete}><Trash2 className="h-4 w-4" />删除</Button>
        </div>
      </CardContent>
    </Card>
  );
}
