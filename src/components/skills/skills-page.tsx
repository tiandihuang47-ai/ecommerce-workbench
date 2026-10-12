"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronRight, Import, Loader2, Search } from "lucide-react";
import { SkillCard } from "@/components/skills/skill-card";
import { SkillDetailDrawer } from "@/components/skills/skill-detail-drawer";
import { SkillImportDialog } from "@/components/skills/skill-import-dialog";
import { handOffToAIChat } from "@/lib/ai-chat-bridge";
import {
  deleteSkill,
  fetchSkillDetail,
  fetchSkills,
  setSkillEnabled,
  type SkillDetail,
  type SkillListItem
} from "@/lib/skills-client";
import { cn } from "@/lib/utils";

const statusFilters: Array<{ value: "all" | SkillListItem["publicStatus"]; label: string }> = [
  { value: "all", label: "全部" },
  { value: "ready", label: "可使用" },
  { value: "preparing", label: "正在准备" },
  { value: "requires_authorization", label: "需要授权" },
  { value: "unavailable", label: "暂时无法使用" },
  { value: "disabled", label: "已停用" }
];

const sourceFilters = [
  { value: "all", label: "全部来源" },
  { value: "file", label: "文件" },
  { value: "folder", label: "文件夹" },
  { value: "zip", label: "压缩包" }
];

export function SkillsPage() {
  const router = useRouter();
  const [skills, setSkills] = useState<SkillListItem[]>([]);
  const [keyword, setKeyword] = useState("");
  const [status, setStatus] = useState<"all" | SkillListItem["publicStatus"]>("all");
  const [source, setSource] = useState("all");
  const [importOpen, setImportOpen] = useState(false);
  const [menuId, setMenuId] = useState("");
  const [detail, setDetail] = useState<SkillDetail | null>(null);
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    const next = await fetchSkills();
    setSkills(next);
    setLoading(false);
    return next;
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // 有 Skill 正在准备时轮询；前台只看到「正在准备」。
  useEffect(() => {
    if (!skills.some((item) => item.publicStatus === "preparing")) return;
    const timer = window.setInterval(() => void refresh(), 2500);
    return () => window.clearInterval(timer);
  }, [skills, refresh]);

  const filtered = useMemo(() => {
    const search = keyword.trim().toLowerCase();
    return skills.filter((item) => {
      if (status !== "all" && item.publicStatus !== status) return false;
      if (source !== "all" && item.sourceType !== source) return false;
      if (!search) return true;
      return `${item.name} ${item.description} ${item.sourceName}`.toLowerCase().includes(search);
    });
  }, [skills, keyword, status, source]);

  async function openDetail(skillId: string) {
    const next = await fetchSkillDetail(skillId);
    if (!next) {
      setNotice("没有找到这个 Skill。");
      return;
    }
    setDetail(next);
  }

  /** 点击「使用」：挂载到 AI 对话并跳过去（§33）。 */
  function useSkill(skill: SkillListItem) {
    router.push(handOffToAIChat({ skillIds: [skill.skillId] }));
  }

  async function toggleEnabled(skill: SkillListItem) {
    const ok = await setSkillEnabled(skill.skillId, !skill.enabled);
    if (!ok) setNotice("操作失败，请稍后重试。");
    await refresh();
  }

  async function remove(skill: SkillListItem) {
    if (!window.confirm(`确定要删除「${skill.name}」吗？删除后需要重新导入。`)) return;
    const ok = await deleteSkill(skill.skillId);
    if (!ok) setNotice("删除失败，请稍后重试。");
    await refresh();
  }

  const preparingCount = skills.filter((item) => item.publicStatus === "preparing").length;

  return (
    <div>
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <nav className="flex items-center gap-1.5 text-[12.5px] text-ink-3">
            <span>AI 内容中台</span>
            <ChevronRight className="h-3 w-3" strokeWidth={1.8} />
            <span className="text-ink-2">Skill</span>
          </nav>
          <h1 className="mt-2 text-[26px] font-semibold leading-tight tracking-[-0.02em] text-ink-1">Skill</h1>
          <p className="mt-1.5 text-[13px] text-ink-3">
            把你在其他 Agent 里已经用顺手的 Skill 导入进来，选一个就能在 AI 对话里直接用。
          </p>
        </div>
        <button
          type="button"
          onClick={() => setImportOpen(true)}
          className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-lg bg-brand-solid px-4 text-[13px] font-medium text-white transition-colors duration-150 hover:bg-[var(--ui-brand-hover)]"
        >
          <Import className="h-3.5 w-3.5" strokeWidth={2} />
          导入 Skill
        </button>
      </header>

      {notice ? (
        <div className="mt-4 rounded-xl border border-line bg-surface-2 px-3.5 py-2.5 text-[12.5px] text-ink-2">{notice}</div>
      ) : null}

      <div className="mt-5 flex flex-wrap items-center gap-2">
        <div className="relative min-w-[220px] flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink-3" strokeWidth={1.8} />
          <input
            value={keyword}
            onChange={(event) => setKeyword(event.target.value)}
            placeholder="搜索 Skill"
            className="h-9 w-full rounded-lg border border-line bg-surface-2 pl-9 pr-3 text-[12.5px] text-ink-1 placeholder:text-ink-3 focus:border-brand-ring focus:outline-none"
          />
        </div>

        <select
          value={source}
          onChange={(event) => setSource(event.target.value)}
          aria-label="来源筛选"
          className="h-9 rounded-lg border border-line bg-surface-2 px-2 text-[12.5px] text-ink-2 focus:outline-none"
        >
          {sourceFilters.map((item) => (
            <option key={item.value} value={item.value}>{item.label}</option>
          ))}
        </select>

        <div className="flex flex-wrap items-center gap-1.5">
          {statusFilters.map((item) => (
            <button
              key={item.value}
              type="button"
              onClick={() => setStatus(item.value)}
              className={cn(
                "h-8 rounded-full px-2.5 text-[12px] transition-colors duration-150",
                status === item.value ? "bg-brand-soft text-brand" : "text-ink-3 hover:bg-surface-2 hover:text-ink-1"
              )}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>

      {preparingCount > 0 ? (
        <p className="mt-4 inline-flex items-center gap-2 rounded-lg bg-info-soft px-3 py-1.5 text-[12.5px] text-info">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          正在准备 {preparingCount} 个 Skill…完成后会自动变成「可使用」
        </p>
      ) : null}

      {loading ? (
        <div className="mt-6 rounded-2xl border border-line bg-surface p-10 text-center text-[13px] text-ink-3">正在读取 Skill…</div>
      ) : filtered.length === 0 ? (
        <div className="mt-6 rounded-2xl border border-dashed border-line bg-surface-2 px-6 py-14 text-center">
          <p className="text-[14px] text-ink-2">{skills.length === 0 ? "还没有导入任何 Skill" : "没有符合条件的 Skill"}</p>
          <p className="mt-1.5 text-[12.5px] leading-6 text-ink-3">
            {skills.length === 0
              ? "点右上角「导入 Skill」，选择一个 Skill 文件夹或 zip 包即可。"
              : "换个关键词或筛选条件试试。"}
          </p>
        </div>
      ) : (
        <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {filtered.map((skill) => (
            <SkillCard
              key={skill.skillId}
              skill={skill}
              menuOpen={menuId === skill.skillId}
              onToggleMenu={() => setMenuId(menuId === skill.skillId ? "" : skill.skillId)}
              onUse={() => useSkill(skill)}
              onDetail={() => void openDetail(skill.skillId)}
              onToggleEnabled={() => void toggleEnabled(skill)}
              onDelete={() => void remove(skill)}
            />
          ))}
        </div>
      )}

      <SkillImportDialog
        open={importOpen}
        onClose={() => setImportOpen(false)}
        onImported={(message) => {
          setNotice(message);
          void refresh();
        }}
      />

      <SkillDetailDrawer
        skill={detail}
        open={Boolean(detail)}
        onClose={() => setDetail(null)}
      />
    </div>
  );
}
