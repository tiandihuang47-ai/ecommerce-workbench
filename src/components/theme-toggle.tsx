"use client";

import { useEffect, useState } from "react";
import { Monitor, Moon, Sun } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type ThemeMode = "light" | "dark" | "system";

const storageKey = "director-platform.theme";
const options: Array<{ label: string; value: ThemeMode; icon: typeof Sun }> = [
  { label: "亮色", value: "light", icon: Sun },
  { label: "深色", value: "dark", icon: Moon },
  { label: "系统", value: "system", icon: Monitor }
];

export function ThemeToggle({ compact = false }: { compact?: boolean }) {
  const [mode, setMode] = useState<ThemeMode>("system");

  useEffect(() => {
    const saved = window.localStorage.getItem(storageKey) as ThemeMode | null;
    const initial = saved && ["light", "dark", "system"].includes(saved) ? saved : "system";
    setMode(initial);
    applyTheme(initial);

    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => {
      if ((window.localStorage.getItem(storageKey) || "system") === "system") {
        applyTheme("system");
      }
    };
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, []);

  function choose(next: ThemeMode) {
    setMode(next);
    window.localStorage.setItem(storageKey, next);
    applyTheme(next);
  }

  if (compact) {
    const active = options.find((item) => item.value === mode) || options[2];
    const Icon = active.icon;
    const next = mode === "light" ? "dark" : mode === "dark" ? "system" : "light";

    return (
      <Button variant="ghost" size="icon" aria-label="切换主题" onClick={() => choose(next)}>
        <Icon className="h-4 w-4" />
      </Button>
    );
  }

  return (
    <div className="grid grid-cols-3 gap-1 rounded-2xl border border-border bg-card p-1">
      {options.map((item) => {
        const Icon = item.icon;
        const active = mode === item.value;
        return (
          <button
            key={item.value}
            type="button"
            onClick={() => choose(item.value)}
            className={cn(
              "inline-flex h-8 items-center justify-center gap-1.5 rounded-xl text-xs font-medium transition-colors",
              active
                ? "bg-brand text-brand-foreground"
                : "text-muted-foreground hover:bg-muted hover:text-foreground"
            )}
          >
            <Icon className="h-3.5 w-3.5" />
            {item.label}
          </button>
        );
      })}
    </div>
  );
}

function applyTheme(mode: ThemeMode) {
  const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
  const useDark = mode === "dark" || (mode === "system" && prefersDark);
  document.documentElement.classList.toggle("dark", useDark);
  document.documentElement.style.colorScheme = useDark ? "dark" : "light";
}
