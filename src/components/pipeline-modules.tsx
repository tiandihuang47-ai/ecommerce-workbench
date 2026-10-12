"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import {
  ArrowRight,
  AlertTriangle,
  Briefcase,
  Clock,
  ClipboardCheck,
  ClipboardList,
  Copy,
  Download,
  Edit,
  FileText,
  LoaderCircle,
  Lightbulb,
  Package,
  Plus,
  Save,
  Scissors,
  Send,
  Sparkles,
  TableProperties,
  Trash2,
  Upload
} from "lucide-react";
import {
  EmptyState as StyledEmptyState,
  PageHeader,
  SectionCard,
  StatCard
} from "@/components/design-system";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  clearPipelineData,
  createId,
  deleteDirectorMethod,
  deleteProductRecord,
  deleteProject,
  deletePublishPlan,
  deleteScript,
  deleteShotList,
  deleteTopic,
  deleteViralAnalysis,
  getPipelineData,
  importPipelineData,
  nowIso,
  saveDirectorMethod,
  getProductRecords,
  saveProductRecord,
  saveProject,
  savePublishPlan,
  saveScript,
  saveShotList,
  saveTopic,
  saveVideoTask,
  saveViralAnalysis
} from "@/lib/pipeline-storage";
import {
  contentGoals,
  methodCategories,
  platforms,
  projectStatuses,
  scriptTypes,
  speakingStyles,
  topicAngles,
  videoTaskStatuses,
  videoDurations,
  type DirectorMethod,
  type PipelineData,
  type ProductRecord,
  type ProductRecordSaveInput,
  type ProductProfile,
  type Project,
  type ProjectStatus,
  type PublishPlan,
  type ScriptItem,
  type ShotList,
  type ShotRequiredLevel,
  type ShotCompletionStatus,
  type TopicCard,
  type VideoTask,
  type VideoTaskStatus,
  type ViralAnalysis
} from "@/lib/pipeline-types";
import {
  analyzeViralVideo,
  generatePublishPlan,
  generateScript,
  generateShotList,
  generateTopics,
  shotListToCsv,
  shotListToMarkdownTable,
  shotListToShootingChecklist
} from "@/services/generatorService";
import { analyzeTaskRisks } from "@/services/workflowService";
import { createAsset, deleteAsset } from "@/lib/stores/asset-store";

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

function usePipelineData() {
  const [data, setData] = useState<PipelineData>(emptyData);

  function refresh() {
    setData(getPipelineData());
  }

  useEffect(() => {
    refresh();
  }, []);

  return { data, refresh };
}

function PageIntro({ title, description }: { title: string; description: string }) {
  const eyebrow = title === "短视频编导工作台" ? "编导中台 / 工作台" : `编导中台 / ${title}`;
  return <PageHeader eyebrow={eyebrow} title={title} description={description} />;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      {children}
    </div>
  );
}

function EmptyState({ text }: { text: string }) {
  return <StyledEmptyState text={text} />;
}

function findProject(data: PipelineData, id: string) {
  return data.projects.find((item) => item.id === id);
}

function findProduct(data: PipelineData, id: string) {
  return data.products.find((item) => item.id === id);
}

function formatDate(value: string) {
  if (!value) return "";
  return new Date(value).toLocaleString("zh-CN", { hour12: false });
}

async function copyText(text: string) {
  await navigator.clipboard.writeText(text);
}

async function runWorkflowAi<T>(action: string, input: unknown, fallback: () => T): Promise<T> {
  try {
    const response = await fetch("/api/workflow-ai", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, input })
    });
    const data = (await response.json()) as { result?: T };
    return response.ok && data.result ? data.result : fallback();
  } catch {
    return fallback();
  }
}

function projectOptions(projects: Project[]) {
  return [{ label: "请选择项目", value: "" }, ...projects.map((item) => ({ label: item.name, value: item.id }))];
}

function productOptions(products: ProductProfile[], projectId?: string) {
  const scoped = projectId ? products.filter((item) => item.projectId === projectId) : products;
  return [{ label: "请选择产品资料", value: "" }, ...scoped.map((item) => ({ label: item.productName, value: item.id }))];
}

export function PipelineDashboard() {
  const { data } = usePipelineData();
  const [apiConfigured, setApiConfigured] = useState<boolean | null>(null);

  useEffect(() => {
    let active = true;

    fetch("/api/generate/status")
      .then((response) => response.json())
      .then((result: { configured?: boolean }) => {
        if (active) setApiConfigured(Boolean(result.configured));
      })
      .catch(() => {
        if (active) setApiConfigured(false);
      });

    return () => {
      active = false;
    };
  }, []);

  const todoItems = [
    { label: "待写脚本", count: data.videoTasks.filter((item) => item.status === "脚本中").length, href: "/scripts", icon: FileText },
    { label: "待拍摄", count: data.videoTasks.filter((item) => item.status === "待拍摄" || item.status === "拍摄中").length, href: "/shot-lists", icon: ClipboardList },
    { label: "待剪辑", count: data.videoTasks.filter((item) => item.status === "待剪辑" || item.status === "剪辑中").length, href: "/edit-briefs", icon: Scissors },
    { label: "待审核", count: data.videoTasks.filter((item) => item.status === "待审核").length, href: "/video-tasks", icon: ClipboardCheck },
    { label: "待发布", count: data.videoTasks.filter((item) => item.status === "待发布").length, href: "/publishing", icon: Send },
    { label: "待复盘", count: data.videoTasks.filter((item) => item.status === "待复盘").length, href: "/reviews", icon: AlertTriangle }
  ];
  const pipelineStatuses: VideoTaskStatus[] = ["选题中", "脚本中", "待拍摄", "待剪辑", "待发布", "待复盘", "已归档"];
  const today = new Date().toISOString().slice(0, 10);
  const overdueTasks = data.videoTasks.filter((item) => item.dueDate && item.dueDate < today && item.status !== "已归档");
  const allTaskRisks = data.videoTasks.flatMap((task) => analyzeTaskRisks(data, task).map((risk) => ({ task, risk })));
  const missingProductTasks = allTaskRisks.filter((item) => item.risk.riskType === "产品资料缺失核心卖点" || item.risk.riskType === "产品资料缺失禁忌词");
  const missingShotListTasks = allTaskRisks.filter((item) => item.risk.riskType === "分镜未生成却进入拍摄");
  const missingEditBriefTasks = allTaskRisks.filter((item) => item.risk.riskType === "剪辑说明未生成却进入剪辑");
  const publishedWithoutReview = allTaskRisks.filter((item) => item.risk.riskType === "已发布但未复盘");
  const waitingApprovalTasks = data.videoTasks.filter((task) => task.status === "待审核" || data.approvalRecords.some((record) => record.taskId === task.id && record.status === "待审核"));
  const waitingReviewTasks = data.videoTasks.filter((task) => task.status === "待复盘" || task.status === "已发布");
  const riskItems = [
    { label: "逾期任务", count: overdueTasks.length, desc: "截止时间已过但未归档" },
    { label: "缺产品资料的任务", count: missingProductTasks.length, desc: "会导致脚本和拍摄事实不统一" },
    { label: "没有分镜拍摄单的任务", count: missingShotListTasks.length, desc: "摄影交接信息不完整" },
    { label: "没有剪辑说明单的任务", count: missingEditBriefTasks.length, desc: "剪辑师无法准确还原节奏" },
    { label: "已发布但未复盘的视频", count: publishedWithoutReview.length, desc: "复盘结论没有沉淀" }
  ];
  const apiStatusText = apiConfigured === null ? "检测中" : apiConfigured ? "已配置" : "未配置";

  return (
    <div>
      <PageIntro title="短视频内容生产看板" description="用视频任务卡统一流程、交付物、负责人、风险提醒和复盘沉淀。" />

      <SectionCard className="mb-8 overflow-hidden rounded-[24px]">
        <div className="grid gap-8 p-8 lg:grid-cols-[minmax(0,1fr)_320px] lg:items-center">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-medium text-slate-500">
              <Sparkles className="h-3.5 w-3.5 text-slate-700" />
              公司内部内容生产中台
            </div>
            <h1 className="mt-6 max-w-3xl text-2xl font-semibold tracking-normal text-slate-950 md:text-[28px]">
              短视频内容生产看板
            </h1>
            <p className="mt-4 max-w-2xl text-sm leading-7 text-slate-500">
              从任务卡开始串联产品资料、脚本、分镜、剪辑说明、发布记录和标准复盘，减少跨岗位沟通损耗。
            </p>
            <div className="mt-6 flex flex-wrap gap-2">
              <Link className="inline-flex h-10 items-center justify-center rounded-xl bg-slate-950 px-4 text-sm font-medium text-white shadow-sm hover:bg-slate-800" href="/video-tasks">新建视频任务</Link>
              <Link className="inline-flex h-10 items-center justify-center rounded-xl border border-slate-200 bg-white px-4 text-sm font-medium text-slate-700 shadow-sm hover:bg-slate-50" href="/reviews">进入复盘</Link>
            </div>
          </div>
          <div className="rounded-3xl border border-slate-200/80 bg-slate-50/70 p-5">
            <div className="flex items-center justify-between border-b border-slate-200/80 pb-4">
              <span className="text-sm text-slate-500">今日待办</span>
              <span className="text-2xl font-semibold text-slate-950">{todoItems.reduce((sum, item) => sum + item.count, 0)}</span>
            </div>
            <div className="flex items-center justify-between border-b border-slate-200/80 py-4">
              <span className="text-sm text-slate-500">视频任务</span>
              <span className="text-2xl font-semibold text-slate-950">{data.videoTasks.length}</span>
            </div>
            <div className="flex items-center justify-between pt-4">
              <span className="text-sm text-slate-500">智能接口</span>
              <span className="rounded-full bg-white px-3 py-1 text-sm font-medium text-slate-700 ring-1 ring-slate-200">
                {apiStatusText}
              </span>
            </div>
          </div>
        </div>
      </SectionCard>

      <section>
        <div className="mb-4 flex items-end justify-between gap-4">
          <div>
            <h3 className="text-lg font-semibold text-slate-950">今日待办</h3>
            <p className="mt-1 text-sm text-slate-500">按内容生产岗位拆解，快速看到今天最需要推进的环节。</p>
          </div>
        </div>
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {todoItems.map((item) => (
            <Link key={item.label} href={item.href}>
              <StatCard label={item.label} value={item.count} icon={item.icon} />
            </Link>
          ))}
        </div>
      </section>

      <section className="mt-8">
        <div className="mb-4 flex items-end justify-between gap-4">
          <div>
            <h3 className="text-lg font-semibold text-slate-950">内容生产流水线</h3>
            <p className="mt-1 text-sm text-slate-500">每条视频任务当前所处阶段，先补齐交付物，再进入下一环。</p>
          </div>
        </div>
        <div className="grid gap-4 lg:grid-cols-4 2xl:grid-cols-7">
          {pipelineStatuses.map((status) => (
            <Link key={status} href={`/video-tasks`}>
              <Card className="soft-panel-hover h-full">
                <CardHeader>
                  <CardDescription className="text-xs font-medium tracking-[0.18em] text-slate-400">状态</CardDescription>
                  <CardTitle>{status}</CardTitle>
                  <CardDescription>{data.videoTasks.filter((item) => item.status === status).length} 条视频</CardDescription>
                </CardHeader>
              </Card>
            </Link>
          ))}
        </div>
      </section>

      <section className="mt-8 grid gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div>
          <div className="mb-4">
            <h3 className="text-lg font-semibold text-slate-950">风险提醒</h3>
            <p className="mt-1 text-sm text-slate-500">优先处理会造成返工、延期和复盘断层的问题。</p>
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            {riskItems.map((item) => (
              <Card key={item.label} className="soft-panel-hover">
                <CardHeader>
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <CardTitle>{item.label}</CardTitle>
                      <CardDescription>{item.desc}</CardDescription>
                    </div>
                    <span className={item.count > 0 ? "rounded-full bg-rose-50 px-3 py-1 text-sm font-semibold text-rose-700" : "rounded-full bg-emerald-50 px-3 py-1 text-sm font-semibold text-emerald-700"}>{item.count}</span>
                  </div>
                </CardHeader>
              </Card>
            ))}
          </div>
          <Card className="mt-4">
            <CardHeader><CardTitle>风险任务列表</CardTitle><CardDescription>直接告诉负责人应该补什么。</CardDescription></CardHeader>
            <CardContent className="space-y-3">
              {allTaskRisks.length === 0 ? <EmptyState text="当前没有未处理风险。" /> : null}
              {allTaskRisks.slice(0, 8).map(({ task, risk }) => (
                <Link key={`${task.id}-${risk.riskType}`} href={`/video-tasks/${task.id}`} className="block rounded-2xl border border-slate-200/70 bg-slate-50/70 p-4 transition-colors hover:bg-white">
                  <div className="flex items-center justify-between gap-3">
                    <div className="text-sm font-semibold text-slate-950">{task.videoTitle}</div>
                    <span className="rounded-full bg-rose-50 px-2 py-0.5 text-xs font-medium text-rose-700">{risk.riskType}</span>
                  </div>
                  <p className="mt-2 text-sm leading-6 text-slate-600">{risk.actionText}</p>
                </Link>
              ))}
            </CardContent>
          </Card>
        </div>
        <Card>
          <CardHeader>
            <CardTitle>快捷入口</CardTitle>
            <CardDescription>常用动作直接进入对应模块。</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-2">
            {[
              { label: "新建视频任务", href: "/video-tasks" },
              { label: "新建产品资料", href: "/products" },
              { label: "生成脚本", href: "/scripts" },
              { label: "生成分镜拍摄单", href: "/shot-lists" },
              { label: "新建复盘", href: "/reviews" },
              { label: "新建拆片", href: "/viral-library" }
            ].map((item) => (
              <Link key={item.href} className="flex items-center justify-between rounded-2xl border border-slate-200/70 bg-slate-50/70 px-4 py-3 text-sm font-medium text-slate-700 transition-colors hover:bg-white hover:text-slate-950" href={item.href}>
                {item.label}
                <ArrowRight className="h-4 w-4" />
              </Link>
            ))}
          </CardContent>
        </Card>
      </section>

      <section className="mt-8 grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>待审核任务</CardTitle><CardDescription>包含状态为待审核或有待审核节点的任务。</CardDescription></CardHeader>
          <CardContent className="space-y-3">
            {waitingApprovalTasks.length === 0 ? <EmptyState text="当前没有待审核任务。" /> : null}
            {waitingApprovalTasks.slice(0, 6).map((task) => (
              <Link key={task.id} href={`/video-tasks/${task.id}`} className="flex items-center justify-between rounded-2xl border border-slate-200/70 bg-slate-50/70 px-4 py-3 text-sm hover:bg-white">
                <span className="font-medium text-slate-800">{task.videoTitle}</span>
                <span className="text-slate-500">{task.status}</span>
              </Link>
            ))}
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>待复盘任务</CardTitle><CardDescription>发布后需要补数据和沉淀结论。</CardDescription></CardHeader>
          <CardContent className="space-y-3">
            {waitingReviewTasks.length === 0 ? <EmptyState text="当前没有待复盘任务。" /> : null}
            {waitingReviewTasks.slice(0, 6).map((task) => (
              <Link key={task.id} href={`/video-tasks/${task.id}`} className="flex items-center justify-between rounded-2xl border border-slate-200/70 bg-slate-50/70 px-4 py-3 text-sm hover:bg-white">
                <span className="font-medium text-slate-800">{task.videoTitle}</span>
                <span className="text-slate-500">{task.reviewOwner || "未分配复盘负责人"}</span>
              </Link>
            ))}
          </CardContent>
        </Card>
      </section>
    </div>
  );
}

export function ProjectManagementPage() {
  const { data, refresh } = usePipelineData();
  const blankProject = (): Project => ({
    id: createId("project"),
    name: "",
    industry: "",
    productName: "",
    targetPlatform: "抖音",
    contentGoal: "获客",
    audience: "",
    sellingPoints: "",
    painPoints: "",
    forbiddenWords: "",
    owner: "",
    status: "待选题",
    createdAt: nowIso(),
    updatedAt: nowIso()
  });
  const [form, setForm] = useState<Project>(blankProject);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("全部");
  const [industry, setIndustry] = useState("全部");
  const [selected, setSelected] = useState<Project | null>(null);
  const industries = Array.from(new Set(data.projects.map((item) => item.industry).filter(Boolean)));
  const filtered = data.projects.filter((item) => {
    const matchSearch = item.name.includes(search);
    const matchStatus = status === "全部" || item.status === status;
    const matchIndustry = industry === "全部" || item.industry === industry;
    return matchSearch && matchStatus && matchIndustry;
  });

  function submit() {
    if (!form.name.trim()) return;
    saveProject({ ...form, updatedAt: nowIso() });
    setForm(blankProject());
    refresh();
  }

  return (
    <div>
      <PageIntro title="项目管理" description="管理电商内容项目，所有后续选题、脚本、分镜和发布计划都围绕项目推进。" />
      <div className="grid gap-6 xl:grid-cols-[420px_minmax(0,1fr)]">
        <Card>
          <CardHeader>
            <CardTitle>{data.projects.some((item) => item.id === form.id) ? "编辑项目" : "新建项目"}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <ProjectForm form={form} setForm={setForm} />
            <div className="flex gap-2">
              <Button onClick={submit}><Save className="h-4 w-4" />保存项目</Button>
              <Button variant="outline" onClick={() => setForm(blankProject())}>清空</Button>
            </div>
          </CardContent>
        </Card>
        <div className="space-y-4">
          <Card>
            <CardContent className="grid gap-3 pt-5 md:grid-cols-3">
              <Input placeholder="搜索项目名称" value={search} onChange={(event) => setSearch(event.target.value)} />
              <Select value={status} onChange={(event) => setStatus(event.target.value)} options={[{ label: "全部状态", value: "全部" }, ...projectStatuses.map((item) => ({ label: item, value: item }))]} />
              <Select value={industry} onChange={(event) => setIndustry(event.target.value)} options={[{ label: "全部行业", value: "全部" }, ...industries.map((item) => ({ label: item, value: item }))]} />
            </CardContent>
          </Card>
          {filtered.length === 0 ? <EmptyState text="还没有项目。先在左侧新建一个项目。" /> : null}
          <div className="grid gap-3">
            {filtered.map((item) => (
              <Card key={item.id} className="cursor-pointer" onClick={() => setSelected(item)}>
                <CardContent className="flex flex-col gap-3 pt-5 lg:flex-row lg:items-center lg:justify-between">
                  <div>
                    <div className="font-semibold">{item.name}</div>
                    <div className="mt-1 text-sm text-muted-foreground">{item.industry}｜{item.productName}｜{item.targetPlatform}｜{item.status}</div>
                  </div>
                  <div className="flex gap-2" onClick={(event) => event.stopPropagation()}>
                    <Button size="sm" variant="outline" onClick={() => setForm(item)}><Edit className="h-4 w-4" />编辑</Button>
                    <Button size="sm" variant="destructive" onClick={() => { deleteProject(item.id); refresh(); }}><Trash2 className="h-4 w-4" />删除</Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
          {selected ? (
            <Card>
              <CardHeader>
                <CardTitle>项目详情：{selected.name}</CardTitle>
                <CardDescription>创建：{formatDate(selected.createdAt)}｜更新：{formatDate(selected.updatedAt)}</CardDescription>
              </CardHeader>
              <CardContent className="grid gap-3 text-sm md:grid-cols-2">
                <Info label="目标人群" value={selected.audience} />
                <Info label="内容目标" value={selected.contentGoal} />
                <Info label="核心卖点" value={selected.sellingPoints} />
                <Info label="用户痛点" value={selected.painPoints} />
                <Info label="禁忌词" value={selected.forbiddenWords} />
                <Info label="负责人" value={selected.owner} />
              </CardContent>
            </Card>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function ProjectForm({ form, setForm }: { form: Project; setForm: (value: Project) => void }) {
  return (
    <div className="grid gap-4">
      <Field label="项目名称"><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
      <div className="grid gap-4 md:grid-cols-2">
        <Field label="行业"><Input value={form.industry} onChange={(e) => setForm({ ...form, industry: e.target.value })} /></Field>
        <Field label="产品/服务名称"><Input value={form.productName} onChange={(e) => setForm({ ...form, productName: e.target.value })} /></Field>
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <Field label="目标平台"><Select value={form.targetPlatform} onChange={(e) => setForm({ ...form, targetPlatform: e.target.value as Project["targetPlatform"] })} options={platforms.map((item) => ({ label: item, value: item }))} /></Field>
        <Field label="内容目标"><Select value={form.contentGoal} onChange={(e) => setForm({ ...form, contentGoal: e.target.value as Project["contentGoal"] })} options={contentGoals.map((item) => ({ label: item, value: item }))} /></Field>
      </div>
      <Field label="目标人群"><Textarea value={form.audience} onChange={(e) => setForm({ ...form, audience: e.target.value })} /></Field>
      <Field label="核心卖点"><Textarea value={form.sellingPoints} onChange={(e) => setForm({ ...form, sellingPoints: e.target.value })} /></Field>
      <Field label="用户痛点"><Textarea value={form.painPoints} onChange={(e) => setForm({ ...form, painPoints: e.target.value })} /></Field>
      <Field label="禁忌词"><Textarea value={form.forbiddenWords} onChange={(e) => setForm({ ...form, forbiddenWords: e.target.value })} /></Field>
      <div className="grid gap-4 md:grid-cols-2">
        <Field label="负责人"><Input value={form.owner} onChange={(e) => setForm({ ...form, owner: e.target.value })} /></Field>
        <Field label="当前状态"><Select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value as ProjectStatus })} options={projectStatuses.map((item) => ({ label: item, value: item }))} /></Field>
      </div>
    </div>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-slate-200/70 bg-slate-50/70 p-4">
      <div className="text-xs font-medium text-slate-500">{label}</div>
      <div className="mt-1 whitespace-pre-wrap text-sm leading-6 text-slate-700">{value || "未填写"}</div>
    </div>
  );
}

export function ProductLibraryPage() {
  const { data, refresh } = usePipelineData();
  const [importing, setImporting] = useState(false);
  const [importMessage, setImportMessage] = useState("");
  const [importError, setImportError] = useState("");
  const [importSuggestion, setImportSuggestion] = useState("");
  const [fileInputKey, setFileInputKey] = useState(0);

  async function importProductDocument(file: File) {
    setImporting(true);
    setImportMessage(`正在读取 ${file.name}…`);
    setImportError("");
    setImportSuggestion("");

    try {
      const formData = new FormData();
      formData.append("file", file);
      const response = await fetch("/api/products/import-word", {
        method: "POST",
        body: formData
      });
      const responseText = await response.text();
      let payload: Record<string, unknown> = {};
      try {
        payload = JSON.parse(responseText) as Record<string, unknown>;
      } catch {
        throw new Error("产品资料服务返回异常，请重新打开工具后再试。");
      }
      if (!response.ok || !payload.success) {
        setImportSuggestion(typeof payload.suggestion === "string" ? payload.suggestion : "");
        throw new Error(typeof payload.message === "string" ? payload.message : "Word 产品资料解析失败。");
      }

      const imported = payload.product as ProductRecordSaveInput | undefined;
      if (!imported?.name?.trim()) {
        throw new Error("Word 文档没有解析出有效产品名称，未保存任何资料。");
      }

      const existing = getProductRecords().find((item) =>
        item.sourceType === "word" && item.sourceDocumentName === file.name
      );
      const saved = saveProductRecord({
        ...imported,
        id: existing?.id,
        createdAt: existing?.createdAt
      });
      createAsset({
        id: `asset_product_${saved.id}`,
        type: "product",
        title: saved.name,
        summary: saved.coreSellingPoints || saved.category || "Word 产品资料",
        content: formatProductRecord(saved),
        rawData: saved,
        sourceModule: "manual",
        platform: "unknown",
        productId: saved.id,
        productName: saved.name,
        tags: [saved.category].filter(Boolean),
        status: "completed",
        createdAt: saved.createdAt,
        updatedAt: saved.updatedAt,
        linkedRecordIds: [saved.id]
      });

      refresh();
      const extra = payload.truncated ? " 文档较长，已保留前 20 万字。" : "";
      setImportMessage(`${saved.name} 已自动保存，可直接在脚本、拆片和 AI 对话中调用。${extra}`);
    } catch (error) {
      setImportMessage("");
      setImportError(error instanceof Error ? error.message : "Word 产品资料解析失败，请稍后重试。");
    } finally {
      setFileInputKey((current) => current + 1);
      setImporting(false);
    }
  }

  function removeProduct(item: ProductRecord) {
    if (!window.confirm(`确定要删除“${item.name}”吗？删除后其他模块将无法再调用这条资料。`)) return;
    deleteProductRecord(item.id);
    deleteAsset(`asset_product_${item.id}`);
    refresh();
  }

  return (
    <div>
      <PageIntro title="产品资料" description="上传 Word 文档，系统会自动读取、整理并保存，之后可直接用于脚本、拆片和 AI 对话。" />
      <Card className="mb-6 overflow-hidden">
        <CardContent className="p-6 md:p-8">
          <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_300px] lg:items-center">
            <div>
              <div className="flex items-center gap-3">
                <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-accent/10 text-accent">
                  {importing ? <LoaderCircle className="h-5 w-5 animate-spin" /> : <Upload className="h-5 w-5" />}
                </div>
                <div>
                  <h2 className="text-lg font-semibold text-slate-950 dark:text-slate-100">上传产品 Word 文档</h2>
                  <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">选择 .docx 后立即自动解析并保存，无需再手填表单。</p>
                </div>
              </div>
              <div className="mt-5 rounded-xl border border-dashed border-slate-300 bg-slate-50/70 p-4 dark:border-slate-700 dark:bg-slate-950/40">
                <Input
                  key={fileInputKey}
                  type="file"
                  accept=".doc,.docx,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                  disabled={importing}
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    if (file) void importProductDocument(file);
                  }}
                />
                <p className="mt-2 text-xs leading-5 text-slate-500 dark:text-slate-400">支持 .docx 和普通 .doc，单个文件不超过 10MB。WPS 私密或加密文档需先另存为标准 DOCX。</p>
              </div>
              {importMessage ? <p className="mt-4 text-sm text-emerald-600 dark:text-emerald-400">{importMessage}</p> : null}
              {importError ? (
                <div className="mt-4 rounded-xl border border-rose-300/60 bg-rose-500/5 p-4 dark:border-rose-900/70">
                  <p className="text-sm font-medium text-rose-700 dark:text-rose-300">{importError}</p>
                  {importSuggestion ? <p className="mt-2 text-sm leading-6 text-slate-600 dark:text-slate-300">解决方法：{importSuggestion}</p> : null}
                </div>
              ) : null}
            </div>
            <div className="rounded-xl bg-slate-950 px-5 py-4 text-slate-100 dark:bg-slate-900">
              <div className="text-3xl font-semibold">{data.productRecords.length}</div>
              <div className="mt-1 text-sm text-slate-300">条可调用产品资料</div>
              <div className="mt-4 text-xs leading-5 text-slate-400">已保存资料会自动出现在脚本、拆片和 AI 对话的产品选择器中。</div>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="space-y-3">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h2 className="text-base font-semibold text-slate-950 dark:text-slate-100">已保存产品</h2>
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">这里只展示系统从文档中整理出的内容，不再提供手动填写框。</p>
          </div>
        </div>
        {data.productRecords.length === 0 ? <EmptyState text="还没有产品资料。选择一个 Word 文档后会自动保存到这里。" /> : null}
        <div className="grid gap-3 lg:grid-cols-2">
          {data.productRecords.map((item) => (
            <Card key={item.id}>
              <CardHeader>
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <CardTitle>{item.name}</CardTitle>
                    <CardDescription>{item.category || "未识别品类"}｜{item.sourceDocumentName || "历史产品资料"}</CardDescription>
                  </div>
                  <span className="shrink-0 rounded-full bg-emerald-500/10 px-2.5 py-1 text-xs font-medium text-emerald-700 dark:text-emerald-400">可调用</span>
                </div>
              </CardHeader>
              <CardContent className="space-y-4 text-sm">
                <div>
                  <div className="text-xs font-medium text-slate-500">核心卖点</div>
                  <p className="mt-1 line-clamp-3 whitespace-pre-wrap leading-6 text-slate-700 dark:text-slate-300">{item.coreSellingPoints || "文档中未识别到明确卖点"}</p>
                </div>
                <div>
                  <div className="text-xs font-medium text-slate-500">目标人群</div>
                  <p className="mt-1 line-clamp-2 whitespace-pre-wrap leading-6 text-slate-700 dark:text-slate-300">{item.targetAudience || "文档中未识别到明确人群"}</p>
                </div>
                <details className="rounded-xl border border-slate-200/70 px-4 py-3 dark:border-slate-800">
                  <summary className="cursor-pointer text-sm font-medium text-slate-700 dark:text-slate-200">查看完整提取内容</summary>
                  <pre className="mt-3 whitespace-pre-wrap font-sans text-xs leading-6 text-slate-600 dark:text-slate-400">{formatProductRecord(item)}</pre>
                </details>
                <div className="flex items-center justify-between gap-3 border-t border-slate-200/70 pt-3 dark:border-slate-800">
                  <span className="text-xs text-slate-500">更新于 {formatDate(item.updatedAt)}</span>
                  <Button size="sm" variant="ghost" className="text-rose-600 hover:text-rose-700" onClick={() => removeProduct(item)}><Trash2 className="h-4 w-4" />删除</Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </div>
  );
}

function formatProductRecord(item: ProductRecord) {
  return [
    `产品名称：${item.name}`,
    `品牌：${item.brandName || "资料中未提供"}`,
    `品类：${item.category || "资料中未提供"}`,
    `价格区间：${item.priceRange || "资料中未提供"}`,
    `核心卖点：${item.coreSellingPoints || "资料中未提供"}`,
    `次级卖点：${item.secondarySellingPoints || "资料中未提供"}`,
    `目标人群：${item.targetAudience || "资料中未提供"}`,
    `用户痛点：${item.painPoints || "资料中未提供"}`,
    `用户顾虑：${item.objections || "资料中未提供"}`,
    `使用场景：${item.useScenarios || "资料中未提供"}`,
    `竞品对比：${item.competitorComparison || "资料中未提供"}`,
    `禁忌词：${item.forbiddenWords || "资料中未提供"}`,
    `不能承诺：${item.forbiddenClaims || "资料中未提供"}`,
    `来源文档：${item.sourceDocumentName || "历史产品资料"}`
  ].join("\n\n");
}

export function TopicPlanningPage() {
  const router = useRouter();
  const { data, refresh } = usePipelineData();
  const [projectId, setProjectId] = useState("");
  const [productId, setProductId] = useState("");
  const [count, setCount] = useState("6");
  const [goal, setGoal] = useState("获客");
  const [angle, setAngle] = useState("痛点型");
  const [extra, setExtra] = useState("");
  const [generated, setGenerated] = useState<TopicCard[]>([]);
  const project = findProject(data, projectId);
  const product = findProduct(data, productId);

  function handleGenerate() {
    if (!project) return;
    setGenerated(generateTopics({ project, product, count: Number(count), goal: goal as Project["contentGoal"], angle, extra }));
  }

  function saveOne(item: TopicCard) {
    saveTopic(item);
    refresh();
  }

  function goScript(item: TopicCard) {
    saveOne(item);
    window.localStorage.setItem("director-platform.selectedTopicId", item.id);
    router.push("/scripts");
  }

  return (
    <div>
      <PageIntro title="选题策划" description="选择项目和产品资料，生成可保存、可采用、可进入脚本生产的选题卡。" />
      <div className="grid gap-6 xl:grid-cols-[420px_minmax(0,1fr)]">
        <Card>
          <CardHeader><CardTitle>生成选题卡</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <Field label="选择项目"><Select value={projectId} onChange={(e) => { setProjectId(e.target.value); setProductId(""); }} options={projectOptions(data.projects)} /></Field>
            <Field label="选择产品资料"><Select value={productId} onChange={(e) => setProductId(e.target.value)} options={productOptions(data.products, projectId)} /></Field>
            <Field label="选题数量"><Input type="number" min="1" max="20" value={count} onChange={(e) => setCount(e.target.value)} /></Field>
            <Field label="内容目标"><Select value={goal} onChange={(e) => setGoal(e.target.value)} options={contentGoals.map((item) => ({ label: item, value: item }))} /></Field>
            <Field label="选题角度"><Select value={angle} onChange={(e) => setAngle(e.target.value)} options={topicAngles.map((item) => ({ label: item, value: item }))} /></Field>
            <Field label="额外要求"><Textarea value={extra} onChange={(e) => setExtra(e.target.value)} /></Field>
            <Button onClick={handleGenerate}><Plus className="h-4 w-4" />生成选题</Button>
          </CardContent>
        </Card>
        <div className="space-y-4">
          {generated.length === 0 ? <EmptyState text="选择项目后生成选题卡。" /> : null}
          {generated.map((item) => <TopicCardView key={item.id} item={item} onSave={() => saveOne(item)} onDelete={() => setGenerated(generated.filter((entry) => entry.id !== item.id))} onUse={() => goScript(item)} />)}
          <h3 className="pt-2 text-lg font-semibold">已保存选题</h3>
          {data.topics.map((item) => (
            <TopicCardView
              key={item.id}
              item={item}
              onSave={() => {
                saveTopic({ ...item, adopted: !item.adopted, updatedAt: nowIso() });
                refresh();
              }}
              saveText={item.adopted ? "取消采用" : "标记采用"}
              onDelete={() => { deleteTopic(item.id); refresh(); }}
              onUse={() => goScript(item)}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function TopicCardView({ item, onSave, onDelete, onUse, saveText = "保存" }: { item: TopicCard; onSave: () => void; onDelete: () => void; onUse: () => void; saveText?: string }) {
  const text = `选题标题：${item.title}\n目标人群：${item.audience}\n用户痛点：${item.painPoint}\n视频角度：${item.angle}\n开头钩子：${item.hook}\n核心观点：${item.coreOpinion}\n对应卖点：${item.sellingPoint}\n拍摄建议：${item.shootingSuggestion}\n结尾转化动作：${item.conversionAction}\n适合平台：${item.platform}\n推荐优先级：${item.priority}`;
  return (
    <Card>
      <CardHeader>
        <CardTitle>{item.title}</CardTitle>
        <CardDescription>{item.angle}｜{item.platform}｜优先级：{item.priority}{item.adopted ? "｜已采用" : ""}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <Info label="开头钩子" value={item.hook} />
        <Info label="核心观点" value={item.coreOpinion} />
        <Info label="拍摄建议" value={item.shootingSuggestion} />
        <div className="flex flex-wrap gap-2">
          <Button size="sm" onClick={onSave}><Save className="h-4 w-4" />{saveText}</Button>
          <Button size="sm" variant="outline" onClick={() => copyText(text)}><Copy className="h-4 w-4" />复制</Button>
          <Button size="sm" variant="outline" onClick={onUse}><ArrowRight className="h-4 w-4" />进入脚本生产</Button>
          <Button size="sm" variant="destructive" onClick={onDelete}><Trash2 className="h-4 w-4" />删除</Button>
        </div>
      </CardContent>
    </Card>
  );
}

export function ScriptProductionPage() {
  const router = useRouter();
  const { data, refresh } = usePipelineData();
  const [projectId, setProjectId] = useState("");
  const [productId, setProductId] = useState("");
  const [topicId, setTopicId] = useState("");
  const [scriptType, setScriptType] = useState("带货口播");
  const [duration, setDuration] = useState("60秒");
  const [style, setStyle] = useState("真实口语");
  const [extra, setExtra] = useState("");
  const [generated, setGenerated] = useState<ScriptItem | null>(null);
  const project = findProject(data, projectId);
  const product = findProduct(data, productId);
  const topics = projectId ? data.topics.filter((item) => item.projectId === projectId) : data.topics;
  const topic = topics.find((item) => item.id === topicId);

  useEffect(() => {
    const selectedTopicId = window.localStorage.getItem("director-platform.selectedTopicId");
    if (selectedTopicId && data.topics.some((item) => item.id === selectedTopicId)) {
      const selectedTopic = data.topics.find((item) => item.id === selectedTopicId);
      setTopicId(selectedTopicId);
      setProjectId(selectedTopic?.projectId || "");
      setProductId(selectedTopic?.productId || "");
      window.localStorage.removeItem("director-platform.selectedTopicId");
    }
  }, [data.topics]);

  function handleGenerate() {
    if (!project || !topic) return;
    setGenerated(generateScript({ project, product, topic, scriptType, duration, style, extra }));
  }

  function saveGenerated() {
    if (!generated) return;
    saveScript({ ...generated, updatedAt: nowIso() });
    refresh();
  }

  function goShotList(script: ScriptItem) {
    saveScript(script);
    window.localStorage.setItem("director-platform.selectedScriptId", script.id);
    router.push("/shot-lists");
  }

  return (
    <div>
      <PageIntro title="脚本生产" description="把已保存选题变成可拍摄的口播脚本，支持带货口播、自然流获客、老板视角等类型。" />
      <div className="grid gap-6 xl:grid-cols-[420px_minmax(0,1fr)]">
        <Card>
          <CardHeader><CardTitle>生成脚本</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <Field label="选择项目"><Select value={projectId} onChange={(e) => { setProjectId(e.target.value); setProductId(""); setTopicId(""); }} options={projectOptions(data.projects)} /></Field>
            <Field label="选择产品资料"><Select value={productId} onChange={(e) => setProductId(e.target.value)} options={productOptions(data.products, projectId)} /></Field>
            <Field label="选择已保存选题"><Select value={topicId} onChange={(e) => setTopicId(e.target.value)} options={[{ label: "请选择选题", value: "" }, ...topics.map((item) => ({ label: item.title, value: item.id }))]} /></Field>
            <Field label="脚本类型"><Select value={scriptType} onChange={(e) => setScriptType(e.target.value)} options={scriptTypes.map((item) => ({ label: item, value: item }))} /></Field>
            <Field label="视频时长"><Select value={duration} onChange={(e) => setDuration(e.target.value)} options={videoDurations.map((item) => ({ label: item, value: item }))} /></Field>
            <Field label="口播风格"><Select value={style} onChange={(e) => setStyle(e.target.value)} options={speakingStyles.map((item) => ({ label: item, value: item }))} /></Field>
            <Field label="额外要求"><Textarea value={extra} onChange={(e) => setExtra(e.target.value)} /></Field>
            <Button onClick={handleGenerate}><Plus className="h-4 w-4" />生成脚本</Button>
          </CardContent>
        </Card>
        <div className="space-y-4">
          {generated ? <ScriptCard item={generated} onSave={saveGenerated} onDelete={() => setGenerated(null)} onShotList={() => goShotList(generated)} onEdit={setGenerated} /> : <EmptyState text="选择项目和选题后生成脚本。" />}
          <h3 className="pt-2 text-lg font-semibold">已保存脚本</h3>
          {data.scripts.map((item) => <ScriptCard key={item.id} item={item} onSave={() => saveScript({ ...item, updatedAt: nowIso() })} onDelete={() => { deleteScript(item.id); refresh(); }} onShotList={() => goShotList(item)} onEdit={(next) => { saveScript(next); refresh(); }} />)}
        </div>
      </div>
    </div>
  );
}

function ScriptCard({ item, onSave, onDelete, onShotList, onEdit }: { item: ScriptItem; onSave: () => void; onDelete: () => void; onShotList: () => void; onEdit: (item: ScriptItem) => void }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(item);
  const text = `标题：${draft.title}\n开头3秒钩子：${draft.hook}\n完整口播文案：\n${draft.copy}\n分段节奏：${draft.rhythm}\n画中画建议：${draft.pictureInPicture}\n产品展示点：${draft.productShowPoints}\n人物动作建议：${draft.actionSuggestion}\n字幕重点：${draft.subtitleHighlights}\n结尾转化话术：${draft.ending}\n拍摄注意事项：${draft.shootingNotes}\n禁忌词检查提醒：${draft.forbiddenWordReminder}`;
  return (
    <Card>
      <CardHeader><CardTitle>{draft.title}</CardTitle><CardDescription>{draft.scriptType}｜{draft.duration}｜{draft.style}</CardDescription></CardHeader>
      <CardContent className="space-y-3">
        {editing ? (
          <>
            <Field label="标题"><Input value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} /></Field>
            <Field label="完整口播文案"><Textarea value={draft.copy} onChange={(e) => setDraft({ ...draft, copy: e.target.value })} /></Field>
            <Button onClick={() => { onEdit({ ...draft, updatedAt: nowIso() }); setEditing(false); }}>保存编辑</Button>
          </>
        ) : (
          <>
            <Info label="开头3秒钩子" value={draft.hook} />
            <Info label="完整口播文案" value={draft.copy} />
            <Info label="画中画建议" value={draft.pictureInPicture} />
            <Info label="结尾转化话术" value={draft.ending} />
          </>
        )}
        <div className="flex flex-wrap gap-2">
          <Button size="sm" onClick={onSave}><Save className="h-4 w-4" />保存</Button>
          <Button size="sm" variant="outline" onClick={() => copyText(text)}><Copy className="h-4 w-4" />复制</Button>
          <Button size="sm" variant="outline" onClick={() => setEditing(!editing)}><Edit className="h-4 w-4" />编辑</Button>
          <Button size="sm" variant="outline" onClick={onShotList}><ArrowRight className="h-4 w-4" />生成分镜拍摄表</Button>
          <Button size="sm" variant="destructive" onClick={onDelete}><Trash2 className="h-4 w-4" />删除</Button>
        </div>
      </CardContent>
    </Card>
  );
}

export function ShotListPage() {
  const { data, refresh } = usePipelineData();
  const [taskId, setTaskId] = useState("");
  const [projectId, setProjectId] = useState("");
  const [productId, setProductId] = useState("");
  const [scriptId, setScriptId] = useState("");
  const [scene, setScene] = useState("门店或产品展示台");
  const [needModel, setNeedModel] = useState(false);
  const [needProductCloseup, setNeedProductCloseup] = useState(true);
  const [needPictureInPicture, setNeedPictureInPicture] = useState(true);
  const [generated, setGenerated] = useState<ShotList | null>(null);
  const project = findProject(data, projectId);
  const product = findProduct(data, productId);
  const task = data.videoTasks.find((item) => item.id === taskId);
  const scripts = projectId ? data.scripts.filter((item) => item.projectId === projectId) : data.scripts;
  const script = scripts.find((item) => item.id === scriptId);

  useEffect(() => {
    const selectedScriptId = window.localStorage.getItem("director-platform.selectedScriptId");
    if (selectedScriptId && data.scripts.some((item) => item.id === selectedScriptId)) {
      const selectedScript = data.scripts.find((item) => item.id === selectedScriptId);
      setScriptId(selectedScriptId);
      setProjectId(selectedScript?.projectId || "");
      setProductId(selectedScript?.productId || "");
      window.localStorage.removeItem("director-platform.selectedScriptId");
    }
  }, [data.scripts]);

  function handleGenerate() {
    if (!project || !script) return;
    setGenerated(generateShotList({ project, product, script, task, scene, needModel, needProductCloseup, needPictureInPicture }));
  }

  function handleTaskChange(nextTaskId: string) {
    const nextTask = data.videoTasks.find((item) => item.id === nextTaskId);
    setTaskId(nextTaskId);
    setProjectId(nextTask?.projectId || "");
    setProductId(nextTask?.productId || "");
    setScriptId(nextTask?.scriptId || "");
  }

  function saveGeneratedShotList(item: ShotList) {
    saveShotList(item);
    if (task) {
      saveVideoTask({ ...task, shotListId: item.id, status: task.status === "选题中" || task.status === "脚本中" ? "待拍摄" : task.status, updatedAt: nowIso() });
    }
    refresh();
  }

  return (
    <div>
      <PageIntro title="分镜拍摄表" description="把脚本拆成拍摄执行表，明确每个镜头的口播、画面、动作、景别和注意事项。" />
      <div className="grid gap-6 xl:grid-cols-[420px_minmax(0,1fr)]">
        <Card>
          <CardHeader><CardTitle>生成分镜</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <Field label="选择视频任务"><Select value={taskId} onChange={(e) => handleTaskChange(e.target.value)} options={[{ label: "可不选任务", value: "" }, ...data.videoTasks.map((item) => ({ label: item.videoTitle, value: item.id }))]} /></Field>
            <Field label="选择项目"><Select value={projectId} onChange={(e) => { setProjectId(e.target.value); setProductId(""); setScriptId(""); }} options={projectOptions(data.projects)} /></Field>
            <Field label="选择产品资料"><Select value={productId} onChange={(e) => setProductId(e.target.value)} options={productOptions(data.products, projectId)} /></Field>
            <Field label="选择已保存脚本"><Select value={scriptId} onChange={(e) => setScriptId(e.target.value)} options={[{ label: "请选择脚本", value: "" }, ...scripts.map((item) => ({ label: item.title, value: item.id }))]} /></Field>
            <Field label="拍摄场景"><Input value={scene} onChange={(e) => setScene(e.target.value)} /></Field>
            <CheckLine label="是否需要模特" value={needModel} onChange={setNeedModel} />
            <CheckLine label="是否需要产品细节镜头" value={needProductCloseup} onChange={setNeedProductCloseup} />
            <CheckLine label="是否需要画中画" value={needPictureInPicture} onChange={setNeedPictureInPicture} />
            <Button onClick={handleGenerate}><Plus className="h-4 w-4" />生成分镜拍摄表</Button>
          </CardContent>
        </Card>
        <div className="space-y-4">
          {generated ? <ShotListView item={generated} onChange={setGenerated} onSave={() => saveGeneratedShotList(generated)} onDelete={() => setGenerated(null)} /> : <EmptyState text="选择任务或脚本后生成分镜拍摄表。" />}
          <h3 className="pt-2 text-lg font-semibold">已保存分镜表</h3>
          {data.shotLists.map((item) => <ShotListView key={item.id} item={item} onChange={(next) => { saveShotList(next); refresh(); }} onSave={() => saveShotList(item)} onDelete={() => { deleteShotList(item.id); refresh(); }} />)}
        </div>
      </div>
    </div>
  );
}

function CheckLine({ label, value, onChange }: { label: string; value: boolean; onChange: (value: boolean) => void }) {
  return (
    <label className="flex items-center gap-3 rounded-2xl border border-slate-200/70 bg-slate-50/70 px-4 py-3 text-sm text-slate-700">
      <input
        type="checkbox"
        checked={value}
        onChange={(e) => onChange(e.target.checked)}
        className="h-4 w-4 rounded border-slate-300 text-slate-950 accent-slate-950"
      />
      {label}
    </label>
  );
}

function ShotListView({ item, onChange, onSave, onDelete }: { item: ShotList; onChange: (item: ShotList) => void; onSave: () => void; onDelete: () => void }) {
  function updateRow(index: number, key: keyof ShotList["rows"][number], value: string) {
    const rows = item.rows.map((row, rowIndex) => (rowIndex === index ? { ...row, [key]: value } : row));
    onChange({ ...item, rows, updatedAt: nowIso() });
  }

  return (
    <Card>
      <CardHeader><CardTitle>分镜拍摄表</CardTitle><CardDescription>{item.scene}｜镜头数：{item.rows.length}｜已拍：{item.rows.filter((row) => row.completionStatus === "已拍").length}</CardDescription></CardHeader>
      <CardContent className="space-y-4 overflow-x-auto scrollbar-subtle">
        <table className="w-full min-w-[1500px] overflow-hidden rounded-2xl border border-slate-200/70 text-sm">
          <thead><tr className="bg-slate-50">{["序号", "对应口播", "景别", "画面内容", "人物状态", "镜头运动", "拍摄重点", "所需道具", "所需场景", "产品展示点", "画中画素材", "剪辑备注", "必拍等级", "完成状态"].map((head) => <th key={head} className="border-b border-r border-slate-200/70 p-3 text-left text-xs font-medium text-slate-500 last:border-r-0">{head}</th>)}</tr></thead>
          <tbody>
            {item.rows.map((row, index) => (
              <tr key={row.id} className="align-top">
                <td className="border-b border-r border-slate-200/70 p-3 text-slate-600">{row.index}</td>
                <td className="border-b border-r border-slate-200/70 p-3"><Textarea value={row.spokenLine} onChange={(e) => updateRow(index, "spokenLine", e.target.value)} /></td>
                <td className="border-b border-r border-slate-200/70 p-3"><Select value={row.shotSize} onChange={(e) => updateRow(index, "shotSize", e.target.value)} options={["特写", "近景", "中景", "全景"].map((value) => ({ label: value, value }))} /></td>
                <td className="border-b border-r border-slate-200/70 p-3"><Textarea value={row.visualContent} onChange={(e) => updateRow(index, "visualContent", e.target.value)} /></td>
                <td className="border-b border-r border-slate-200/70 p-3"><Textarea value={row.personStatus} onChange={(e) => updateRow(index, "personStatus", e.target.value)} /></td>
                <td className="border-b border-r border-slate-200/70 p-3"><Select value={row.movement} onChange={(e) => updateRow(index, "movement", e.target.value)} options={["固定", "推近", "拉远", "跟拍", "摇镜"].map((value) => ({ label: value, value }))} /></td>
                <td className="border-b border-r border-slate-200/70 p-3"><Textarea value={row.shootingFocus} onChange={(e) => updateRow(index, "shootingFocus", e.target.value)} /></td>
                <td className="border-b border-r border-slate-200/70 p-3"><Textarea value={row.props} onChange={(e) => updateRow(index, "props", e.target.value)} /></td>
                <td className="border-b border-r border-slate-200/70 p-3"><Textarea value={row.scene} onChange={(e) => updateRow(index, "scene", e.target.value)} /></td>
                <td className="border-b border-r border-slate-200/70 p-3"><Textarea value={row.productPoint} onChange={(e) => updateRow(index, "productPoint", e.target.value)} /></td>
                <td className="border-b border-r border-slate-200/70 p-3"><Textarea value={row.pictureInPicture} onChange={(e) => updateRow(index, "pictureInPicture", e.target.value)} /></td>
                <td className="border-b border-r border-slate-200/70 p-3"><Textarea value={row.editNotes} onChange={(e) => updateRow(index, "editNotes", e.target.value)} /></td>
                <td className="border-b border-r border-slate-200/70 p-3"><Select value={row.requiredLevel} onChange={(e) => updateRow(index, "requiredLevel", e.target.value as ShotRequiredLevel)} options={["必拍", "可替代", "补充"].map((value) => ({ label: value, value }))} /></td>
                <td className="border-b border-slate-200/70 p-3"><Select value={row.completionStatus} onChange={(e) => updateRow(index, "completionStatus", e.target.value as ShotCompletionStatus)} options={["未拍", "已拍", "需补拍"].map((value) => ({ label: value, value }))} /></td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" onClick={onSave}><Save className="h-4 w-4" />保存</Button>
          <Button size="sm" variant="outline" onClick={() => copyText(shotListToMarkdownTable(item))}><Copy className="h-4 w-4" />复制成表格</Button>
          <Button size="sm" variant="outline" onClick={() => copyText(shotListToShootingChecklist(item))}><Copy className="h-4 w-4" />生成拍摄清单</Button>
          <Button size="sm" variant="outline" onClick={() => downloadText("分镜拍摄表.csv", shotListToCsv(item))}><Download className="h-4 w-4" />导出表格</Button>
          <Button size="sm" variant="destructive" onClick={onDelete}><Trash2 className="h-4 w-4" />删除</Button>
        </div>
      </CardContent>
    </Card>
  );
}

function downloadText(filename: string, content: string) {
  const blob = new Blob([content], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

export function PublishingPage() {
  const { data, refresh } = usePipelineData();
  const [taskId, setTaskId] = useState("");
  const [projectId, setProjectId] = useState("");
  const [scriptId, setScriptId] = useState("");
  const [shotListId, setShotListId] = useState("");
  const [platform, setPlatform] = useState("抖音");
  const [goal, setGoal] = useState("获客");
  const [account, setAccount] = useState("");
  const [publishAt, setPublishAt] = useState("");
  const [publisher, setPublisher] = useState("");
  const [publishUrl, setPublishUrl] = useState("");
  const [generated, setGenerated] = useState<PublishPlan | null>(null);
  const task = data.videoTasks.find((item) => item.id === taskId);
  const project = findProject(data, projectId);
  const script = data.scripts.find((item) => item.id === scriptId);
  const shotList = data.shotLists.find((item) => item.id === shotListId);

  function handleGenerate() {
    if (!project) return;
    const next = generatePublishPlan({ project, task, script, shotList, platform: platform as Project["targetPlatform"], goal: goal as Project["contentGoal"] });
    setGenerated({ ...next, account, publishAt, publisher, publishUrl });
  }

  function handleTaskChange(nextTaskId: string) {
    const nextTask = data.videoTasks.find((item) => item.id === nextTaskId);
    const nextProject = findProject(data, nextTask?.projectId || "");
    setTaskId(nextTaskId);
    setProjectId(nextTask?.projectId || "");
    setScriptId(nextTask?.scriptId || "");
    setShotListId(nextTask?.shotListId || "");
    setPlatform(nextProject?.targetPlatform || "抖音");
    setGoal(nextTask?.contentGoal || "获客");
    setPublisher(nextTask?.publishingOwner || "");
  }

  function savePlan(item: PublishPlan) {
    savePublishPlan(item);
    const linkedTask = data.videoTasks.find((entry) => entry.id === item.taskId);
    if (linkedTask) {
      saveVideoTask({ ...linkedTask, publishRecordId: item.id, updatedAt: nowIso() });
    }
    refresh();
  }

  function togglePublishStatus(item: PublishPlan, updateGenerated?: boolean) {
    const nextStatus: PublishPlan["status"] = item.status === "待发布" ? "已发布" : "待发布";
    const next = { ...item, status: nextStatus, publishStatus: nextStatus, updatedAt: nowIso() };
    if (updateGenerated) {
      setGenerated(next);
    } else {
      savePublishPlan(next);
    }
    const linkedTask = data.videoTasks.find((entry) => entry.id === next.taskId);
    if (linkedTask && nextStatus === "已发布") {
      saveVideoTask({ ...linkedTask, publishRecordId: next.id, status: "待复盘", updatedAt: nowIso() });
    }
    refresh();
  }

  return (
    <div>
      <PageIntro title="发布运营" description="为已完成脚本或分镜生成发布标题、文案、话题、评论和私信承接。" />
      <div className="grid gap-6 xl:grid-cols-[420px_minmax(0,1fr)]">
        <Card>
          <CardHeader><CardTitle>生成发布方案</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <Field label="视频任务"><Select value={taskId} onChange={(e) => handleTaskChange(e.target.value)} options={[{ label: "可不选任务", value: "" }, ...data.videoTasks.map((item) => ({ label: item.videoTitle, value: item.id }))]} /></Field>
            <Field label="选择项目"><Select value={projectId} onChange={(e) => setProjectId(e.target.value)} options={projectOptions(data.projects)} /></Field>
            <Field label="选择已保存脚本"><Select value={scriptId} onChange={(e) => setScriptId(e.target.value)} options={[{ label: "可不选", value: "" }, ...data.scripts.filter((item) => !projectId || item.projectId === projectId).map((item) => ({ label: item.title, value: item.id }))]} /></Field>
            <Field label="选择分镜"><Select value={shotListId} onChange={(e) => setShotListId(e.target.value)} options={[{ label: "可不选", value: "" }, ...data.shotLists.filter((item) => !projectId || item.projectId === projectId).map((item) => ({ label: `${item.scene}｜${item.rows.length} 镜头`, value: item.id }))]} /></Field>
            <Field label="发布平台"><Select value={platform} onChange={(e) => setPlatform(e.target.value)} options={platforms.map((item) => ({ label: item, value: item }))} /></Field>
            <Field label="内容目标"><Select value={goal} onChange={(e) => setGoal(e.target.value)} options={contentGoals.map((item) => ({ label: item, value: item }))} /></Field>
            <div className="grid gap-4 md:grid-cols-2">
              <Field label="账号"><Input value={account} onChange={(e) => setAccount(e.target.value)} /></Field>
              <Field label="发布时间"><Input type="datetime-local" value={publishAt} onChange={(e) => setPublishAt(e.target.value)} /></Field>
              <Field label="发布负责人"><Input value={publisher} onChange={(e) => setPublisher(e.target.value)} /></Field>
              <Field label="发布链接"><Input value={publishUrl} onChange={(e) => setPublishUrl(e.target.value)} /></Field>
            </div>
            <Button onClick={handleGenerate}><Plus className="h-4 w-4" />生成发布方案</Button>
          </CardContent>
        </Card>
        <div className="space-y-4">
          {generated ? <PublishPlanCard item={generated} onSave={() => savePlan(generated)} onDelete={() => setGenerated(null)} onStatus={() => togglePublishStatus(generated, true)} /> : <EmptyState text="选择项目后生成发布运营方案。" />}
          <h3 className="pt-2 text-lg font-semibold">已保存发布方案</h3>
          {data.publishPlans.map((item) => <PublishPlanCard key={item.id} item={item} onSave={() => savePlan(item)} onDelete={() => { deletePublishPlan(item.id); refresh(); }} onStatus={() => togglePublishStatus(item)} />)}
        </div>
      </div>
    </div>
  );
}

function PublishPlanCard({ item, onSave, onDelete, onStatus }: { item: PublishPlan; onSave: () => void; onDelete: () => void; onStatus: () => void }) {
  const text = `平台：${item.platform}\n账号：${item.account}\n发布时间：${item.publishAt}\n发布标题：${item.title}\n封面标题：${item.coverTitle}\n发布文案：${item.caption}\n话题标签：${item.hashtags}\n挂车商品：${item.productLink}\n直播间承接：${item.liveRoomHandoff}\n私域引导：${item.privateDomainGuide}\n发布负责人：${item.publisher}\n发布状态：${item.status}\n发布链接：${item.publishUrl}\n置顶评论：${item.pinnedComment}\n评论区引导：${item.commentGuide}\n私信承接：${item.privateMessageScript}\n发布时间建议：${item.publishTimeSuggestion}\n多平台改写：\n${item.multiPlatformRewrite}`;
  return (
    <Card>
      <CardHeader><CardTitle>{item.title}</CardTitle><CardDescription>{item.platform}｜{item.goal}｜{item.status}</CardDescription></CardHeader>
      <CardContent className="space-y-3">
        <Info label="账号/发布时间" value={`${item.account || "未填写"}｜${item.publishAt || "未填写"}`} />
        <Info label="发布文案" value={item.caption} />
        <Info label="话题标签" value={item.hashtags} />
        <Info label="直播间承接/私域引导" value={`${item.liveRoomHandoff || item.liveRoomGuide}\n${item.privateDomainGuide || item.privateMessageScript}`} />
        <Info label="私信承接话术" value={item.privateMessageScript} />
        <Info label="发布链接" value={item.publishUrl} />
        <div className="flex flex-wrap gap-2">
          <Button size="sm" onClick={onSave}><Save className="h-4 w-4" />保存</Button>
          <Button size="sm" variant="outline" onClick={() => copyText(text)}><Copy className="h-4 w-4" />复制</Button>
          <Button size="sm" variant="outline" onClick={onStatus}>{item.status === "待发布" ? "标记已发布" : "标记待发布"}</Button>
          <Button size="sm" variant="destructive" onClick={onDelete}><Trash2 className="h-4 w-4" />删除</Button>
        </div>
      </CardContent>
    </Card>
  );
}

export function ViralLibraryPage() {
  const { data, refresh } = usePipelineData();
  const [form, setForm] = useState({ url: "", title: "", transcript: "", industry: "", platform: "抖音" });
  const [generated, setGenerated] = useState<ViralAnalysis | null>(null);

  function handleAnalyze() {
    if (!form.title.trim()) return;
    setGenerated(analyzeViralVideo({ ...form, platform: form.platform as Project["targetPlatform"] }));
  }

  return (
    <div>
      <PageIntro title="爆款拆解库" description="手动录入爆款内容，用规则拆出钩子、结构、情绪、成交动作和可复用公式。" />
      <div className="grid gap-6 xl:grid-cols-[420px_minmax(0,1fr)]">
        <Card>
          <CardHeader><CardTitle>录入爆款</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <Field label="爆款视频链接"><Input value={form.url} onChange={(e) => setForm({ ...form, url: e.target.value })} /></Field>
            <Field label="爆款标题"><Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} /></Field>
            <Field label="口播文案"><Textarea value={form.transcript} onChange={(e) => setForm({ ...form, transcript: e.target.value })} /></Field>
            <Field label="行业"><Input value={form.industry} onChange={(e) => setForm({ ...form, industry: e.target.value })} /></Field>
            <Field label="平台"><Select value={form.platform} onChange={(e) => setForm({ ...form, platform: e.target.value })} options={platforms.map((item) => ({ label: item, value: item }))} /></Field>
            <Button onClick={handleAnalyze}>拆解爆款</Button>
          </CardContent>
        </Card>
        <div className="space-y-4">
          {generated ? <ViralCard item={generated} onSave={() => { saveViralAnalysis(generated); refresh(); }} onDelete={() => setGenerated(null)} /> : <EmptyState text="录入标题和口播后进行拆解。" />}
          <h3 className="pt-2 text-lg font-semibold">已保存拆解</h3>
          {data.viralAnalyses.map((item) => <ViralCard key={item.id} item={item} onSave={() => saveViralAnalysis(item)} onDelete={() => { deleteViralAnalysis(item.id); refresh(); }} />)}
        </div>
      </div>
    </div>
  );
}

function ViralCard({ item, onSave, onDelete }: { item: ViralAnalysis; onSave: () => void; onDelete: () => void }) {
  const text = `开头钩子：${item.openingHook}\n视频结构：${item.structure}\n情绪点：${item.emotionPoints}\n用户痛点：${item.painPoints}\n卖点植入方式：${item.sellingPointPlacement}\n画中画使用方式：${item.pictureInPictureUsage}\n成交动作：${item.conversionAction}\n可复用公式：${item.reusableFormula}\n如何套用：${item.productApplication}`;
  return (
    <Card>
      <CardHeader><CardTitle>{item.title}</CardTitle><CardDescription>{item.industry}｜{item.platform}</CardDescription></CardHeader>
      <CardContent className="space-y-3">
        <Info label="开头钩子" value={item.openingHook} />
        <Info label="可复用公式" value={item.reusableFormula} />
        <Info label="如何套用到自己的产品" value={item.productApplication} />
        <div className="flex flex-wrap gap-2">
          <Button size="sm" onClick={onSave}><Save className="h-4 w-4" />保存</Button>
          <Button size="sm" variant="outline" onClick={() => copyText(text)}><Copy className="h-4 w-4" />复制</Button>
          <Button size="sm" variant="destructive" onClick={onDelete}><Trash2 className="h-4 w-4" />删除</Button>
        </div>
      </CardContent>
    </Card>
  );
}

export function DirectorMethodsPage() {
  const { data, refresh } = usePipelineData();
  const blank = (): DirectorMethod => ({ id: createId("method"), category: "开头钩子", name: "", scenario: "", steps: "", example: "", promptTemplate: "", createdAt: nowIso(), updatedAt: nowIso() });
  const [form, setForm] = useState<DirectorMethod>(blank);
  const [category, setCategory] = useState("全部");
  const filtered = category === "全部" ? data.directorMethods : data.directorMethods.filter((item) => item.category === category);

  function submit() {
    if (!form.name.trim()) return;
    saveDirectorMethod({ ...form, updatedAt: nowIso() });
    setForm(blank());
    refresh();
  }

  return (
    <div>
      <PageIntro title="编导方法库" description="展示、补充和维护编导方法，作为选题、脚本、分镜和拆解的规则来源。" />
      <div className="grid gap-6 xl:grid-cols-[420px_minmax(0,1fr)]">
        <Card>
          <CardHeader><CardTitle>{data.directorMethods.some((item) => item.id === form.id) ? "编辑方法" : "新增方法"}</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <Field label="分类"><Select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value as DirectorMethod["category"] })} options={methodCategories.map((item) => ({ label: item, value: item }))} /></Field>
            <Field label="方法名称"><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
            <Field label="适用场景"><Textarea value={form.scenario} onChange={(e) => setForm({ ...form, scenario: e.target.value })} /></Field>
            <Field label="操作步骤"><Textarea value={form.steps} onChange={(e) => setForm({ ...form, steps: e.target.value })} /></Field>
            <Field label="示例"><Textarea value={form.example} onChange={(e) => setForm({ ...form, example: e.target.value })} /></Field>
            <Field label="提示词模板"><Textarea value={form.promptTemplate} onChange={(e) => setForm({ ...form, promptTemplate: e.target.value })} /></Field>
            <Button onClick={submit}><Save className="h-4 w-4" />保存方法</Button>
          </CardContent>
        </Card>
        <div className="space-y-4">
          <Select value={category} onChange={(e) => setCategory(e.target.value)} options={[{ label: "全部分类", value: "全部" }, ...methodCategories.map((item) => ({ label: item, value: item }))]} />
          {filtered.map((item) => (
            <Card key={item.id}>
              <CardHeader><CardTitle>{item.name}</CardTitle><CardDescription>{item.category}｜{item.scenario}</CardDescription></CardHeader>
              <CardContent className="space-y-3">
                <Info label="操作步骤" value={item.steps} />
                <Info label="示例" value={item.example} />
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" variant="outline" onClick={() => setForm(item)}><Edit className="h-4 w-4" />编辑</Button>
                  <Button size="sm" variant="outline" onClick={() => copyText(item.promptTemplate)}><Copy className="h-4 w-4" />复制提示词</Button>
                  <Button size="sm" variant="destructive" onClick={() => { deleteDirectorMethod(item.id); refresh(); }}><Trash2 className="h-4 w-4" />删除</Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </div>
  );
}

export function SystemSettingsPage() {
  const { data, refresh } = usePipelineData();
  const exportText = JSON.stringify(data, null, 2);
  const [importText, setImportText] = useState("");

  function handleImport() {
    try {
      importPipelineData(JSON.parse(importText));
      refresh();
    } catch {
      window.alert("导入内容不是有效的数据格式");
    }
  }

  return (
    <div>
      <PageIntro title="系统设置" description="只保留日常会用到的配置状态、主题说明和本地数据管理。" />
      <div className="grid gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader><CardTitle>接口配置</CardTitle><CardDescription>接口密钥只保存在本地环境文件中，前台不会展示。</CardDescription></CardHeader>
          <CardContent className="space-y-2 text-sm leading-6 text-muted-foreground">
            <p>当前生成接口：服务端统一生成接口。</p>
            <p>模型选择：在本地环境文件中配置。</p>
            <p>如需更换模型，修改本地环境文件后重启网站。</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>本地规则库状态</CardTitle></CardHeader>
          <CardContent className="grid gap-2 text-sm">
            <Info label="项目" value={`${data.projects.length} 条`} />
            <Info label="产品资料" value={`${data.products.length} 条`} />
            <Info label="编导方法" value={`${data.directorMethods.length} 条`} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>本地数据</CardTitle><CardDescription>清理前请先导出备份。</CardDescription></CardHeader>
          <CardContent className="space-y-3">
            <Button variant="destructive" onClick={() => { clearPipelineData(); refresh(); }}>清空本地数据</Button>
            <p className="text-xs leading-5 text-muted-foreground">只清空当前浏览器里的本地数据，不影响代码文件。</p>
          </CardContent>
        </Card>
        <Card className="lg:col-span-2">
          <CardHeader><CardTitle>提示词模板</CardTitle><CardDescription>模板归到方法库维护，日常不用在设置里处理。</CardDescription></CardHeader>
          <CardContent><Link className="text-sm font-medium text-primary" href="/methods">进入编导方法库</Link></CardContent>
        </Card>
        <Card className="lg:col-span-3">
          <CardContent className="p-4">
            <details>
              <summary className="cursor-pointer text-sm font-semibold text-slate-900 dark:text-slate-100">导入 / 导出本地数据</summary>
              <div className="mt-4 grid gap-4 lg:grid-cols-2">
                <div className="space-y-2">
                  <Label>导出数据</Label>
                  <Textarea value={exportText} readOnly className="min-h-52" />
                  <Button variant="outline" onClick={() => copyText(exportText)}>复制导出数据</Button>
                </div>
                <div className="space-y-2">
                  <Label>导入数据</Label>
                  <Textarea value={importText} onChange={(e) => setImportText(e.target.value)} className="min-h-52" />
                  <Button onClick={handleImport}>导入本地数据</Button>
                </div>
              </div>
            </details>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
