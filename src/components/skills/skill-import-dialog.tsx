"use client";

import { useRef, useState } from "react";
import { FileArchive, FolderUp, Loader2, Upload, X } from "lucide-react";
import { importSkill } from "@/lib/skills-client";
import { cn } from "@/lib/utils";

interface PickedFile {
  file: File;
  path: string;
}

export function SkillImportDialog({
  open,
  onClose,
  onImported
}: {
  open: boolean;
  onClose: () => void;
  onImported: (message: string) => void;
}) {
  const [picked, setPicked] = useState<PickedFile[]>([]);
  const [archive, setArchive] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [message, setMessage] = useState("");
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const folderInputRef = useRef<HTMLInputElement | null>(null);

  if (!open) return null;

  function reset() {
    setPicked([]);
    setArchive(null);
    setBusy(false);
    setMessage("");
  }

  function close() {
    reset();
    onClose();
  }

  function acceptFiles(list: FileList | null) {
    if (!list) return;
    const next: PickedFile[] = [];
    let zip: File | null = null;
    Array.from(list).forEach((file) => {
      if (/\.zip$/i.test(file.name)) {
        zip = file;
        return;
      }
      const relative = (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name;
      next.push({ file, path: relative });
    });
    setArchive(zip);
    setPicked(next);
    setMessage("");
  }

  async function acceptDataTransfer(items: DataTransferItemList) {
    const next: PickedFile[] = [];
    let zip: File | null = null;
    const walkers: Array<Promise<void>> = [];

    for (const item of Array.from(items)) {
      const entry = (item as DataTransferItem & { webkitGetAsEntry?: () => FileSystemEntry | null }).webkitGetAsEntry?.();
      if (entry) {
        walkers.push(walkEntry(entry, "", next, (file) => { zip = file; }));
      } else if (item.kind === "file") {
        const file = item.getAsFile();
        if (file) {
          if (/\.zip$/i.test(file.name)) zip = file;
          else next.push({ file, path: file.name });
        }
      }
    }

    await Promise.all(walkers);
    setArchive(zip);
    setPicked(next);
    setMessage("");
  }

  async function submit() {
    if (busy) return;
    if (archive) {
      setBusy(true);
      setMessage("正在准备 Skill…");
      const result = await importSkill({ sourceName: archive.name, sourceType: "zip", files: [], paths: [], archive });
      setBusy(false);
      if (!result.ok) {
        setMessage(result.message || "导入失败。");
        return;
      }
      onImported(result.message || "正在准备 Skill…");
      close();
      return;
    }

    if (picked.length === 0) {
      setMessage("请先选择 Skill 文件或文件夹。");
      return;
    }

    setBusy(true);
    setMessage("正在准备 Skill…");
    const first = picked[0].path.split("/")[0] || "skill";
    const isFolder = picked.some((item) => item.path.includes("/"));
    const result = await importSkill({
      sourceName: isFolder ? first : picked[0].file.name,
      sourceType: isFolder ? "folder" : "file",
      files: picked.map((item) => item.file),
      paths: picked.map((item) => item.path),
      archive: null
    });
    setBusy(false);

    if (!result.ok) {
      setMessage(result.message || "导入失败。");
      return;
    }
    onImported(result.message || "正在准备 Skill…");
    close();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4">
      <div className="w-full max-w-[520px] rounded-2xl border border-line bg-surface p-5 shadow-[0_24px_64px_rgba(15,23,42,0.24)] anim-fade-up">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-[17px] font-medium text-ink-1">导入 Skill</h2>
            <p className="mt-1 text-[12.5px] leading-5 text-ink-3">
              支持单个 Markdown / 文本 / JSON / YAML 文件、整个 Skill 文件夹，或 zip 压缩包。
              剩下的兼容工作全部由系统处理。
            </p>
          </div>
          <button
            type="button"
            aria-label="关闭"
            onClick={close}
            className="inline-flex h-7 w-7 items-center justify-center rounded-lg text-ink-3 transition-colors duration-150 hover:bg-surface-2 hover:text-ink-1"
          >
            <X className="h-4 w-4" strokeWidth={1.8} />
          </button>
        </div>

        <div
          onDragOver={(event) => { event.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={(event) => {
            event.preventDefault();
            setDragging(false);
            void acceptDataTransfer(event.dataTransfer.items);
          }}
          className={cn(
            "mt-4 flex flex-col items-center justify-center rounded-xl border border-dashed px-4 py-7 text-center transition-colors duration-150",
            dragging ? "border-brand-ring bg-brand-soft" : "border-line bg-surface-2"
          )}
        >
          <Upload className="h-5 w-5 text-ink-3" strokeWidth={1.8} />
          <p className="mt-2 text-[13px] text-ink-2">把 Skill 文件夹或 zip 拖到这里</p>
          <div className="mt-3 flex flex-wrap items-center justify-center gap-2">
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-line bg-surface px-3 text-[12.5px] text-ink-1 transition-colors duration-150 hover:border-line-strong"
            >
              <FileArchive className="h-3.5 w-3.5" strokeWidth={1.8} />
              选择文件 / zip
            </button>
            <button
              type="button"
              onClick={() => folderInputRef.current?.click()}
              className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-line bg-surface px-3 text-[12.5px] text-ink-1 transition-colors duration-150 hover:border-line-strong"
            >
              <FolderUp className="h-3.5 w-3.5" strokeWidth={1.8} />
              选择文件夹
            </button>
          </div>
        </div>

        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept=".md,.markdown,.txt,.json,.yaml,.yml,.zip"
          className="hidden"
          onChange={(event) => acceptFiles(event.target.files)}
        />
        <input
          ref={folderInputRef}
          type="file"
          multiple
          className="hidden"
          {...({ webkitdirectory: "" } as Record<string, string>)}
          onChange={(event) => acceptFiles(event.target.files)}
        />

        {archive ? (
          <p className="mt-3 truncate rounded-lg bg-surface-2 px-3 py-2 text-[12.5px] text-ink-2">已选择压缩包：{archive.name}</p>
        ) : picked.length > 0 ? (
          <p className="mt-3 rounded-lg bg-surface-2 px-3 py-2 text-[12.5px] text-ink-2">
            已选择 {picked.length} 个文件（{picked[0].path.split("/")[0]}）
          </p>
        ) : null}

        {message ? <p className="mt-3 text-[12.5px] text-ink-3">{message}</p> : null}

        <div className="mt-5 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={close}
            className="inline-flex h-9 items-center rounded-lg px-3 text-[13px] text-ink-2 transition-colors duration-150 hover:bg-surface-2 hover:text-ink-1"
          >
            取消
          </button>
          <button
            type="button"
            disabled={busy || (!archive && picked.length === 0)}
            onClick={() => void submit()}
            className="inline-flex h-9 items-center gap-2 rounded-lg bg-brand-solid px-4 text-[13px] font-medium text-white transition-colors duration-150 hover:bg-[var(--ui-brand-hover)] disabled:cursor-not-allowed disabled:opacity-45"
          >
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
            {busy ? "正在准备 Skill…" : "开始导入"}
          </button>
        </div>
      </div>
    </div>
  );
}

function walkEntry(
  entry: FileSystemEntry,
  prefix: string,
  out: PickedFile[],
  onZip: (file: File) => void
): Promise<void> {
  return new Promise((resolve) => {
    if (entry.isFile) {
      (entry as FileSystemFileEntry).file(
        (file) => {
          if (/\.zip$/i.test(file.name)) onZip(file);
          else out.push({ file, path: prefix ? prefix + "/" + file.name : file.name });
          resolve();
        },
        () => resolve()
      );
      return;
    }
    if (entry.isDirectory) {
      const reader = (entry as FileSystemDirectoryEntry).createReader();
      const directory = entry.name;
      const nextPrefix = prefix ? prefix + "/" + directory : directory;
      const readBatch = () => {
        reader.readEntries(
          async (entries) => {
            if (entries.length === 0) {
              resolve();
              return;
            }
            await Promise.all(entries.map((child) => walkEntry(child, nextPrefix, out, onZip)));
            readBatch();
          },
          () => resolve()
        );
      };
      readBatch();
      return;
    }
    resolve();
  });
}
