import Link from "next/link";
import type * as React from "react";
import type { LucideIcon } from "lucide-react";
import { ArrowRight, Inbox } from "lucide-react";
import { Button, type ButtonProps } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

export function PageHeader({ eyebrow, title, description, action }: { eyebrow?: string; title: string; description: string; action?: React.ReactNode }) {
  return (
    <div className="mb-6">
      {eyebrow ? (
        <div className="text-[11px] font-medium tracking-[0.08em] text-muted-foreground/70">{eyebrow}</div>
      ) : null}
      <div className="mt-1.5 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-[22px] font-semibold leading-tight tracking-[-0.015em] text-foreground md:text-2xl">{title}</h2>
          <p className="mt-1.5 max-w-3xl text-sm leading-6 text-muted-foreground">{description}</p>
        </div>
        {action ? <div className="shrink-0">{action}</div> : null}
      </div>
    </div>
  );
}

export function SectionCard({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <Card className={cn("soft-panel", className)} {...props} />;
}

export function StatCard({ label, value, icon: Icon }: { label: string; value: number | string; icon: LucideIcon }) {
  return (
    <Card className="soft-panel-hover overflow-hidden">
      <CardHeader className="p-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <CardDescription className="text-[13px]">{label}</CardDescription>
            <CardTitle className="mt-3 text-2xl font-semibold tabular-nums tracking-[-0.01em] text-foreground">{value}</CardTitle>
          </div>
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-accent/10 text-accent">
            <Icon className="h-4 w-4" />
          </div>
        </div>
      </CardHeader>
    </Card>
  );
}

export function WorkflowCard({
  index,
  title,
  description,
  count,
  href,
  active
}: {
  index: number;
  title: string;
  description: string;
  count: number;
  href: string;
  active?: boolean;
}) {
  return (
    <Card className={cn("soft-panel-hover min-h-56", active && "ring-1 ring-ring/30")}>
      <CardHeader className="p-6">
        <CardDescription className="text-xs font-medium tracking-[0.14em] text-muted-foreground/70">
          步骤 {String(index).padStart(2, "0")}
        </CardDescription>
        <CardTitle className="mt-4 text-lg">{title}</CardTitle>
        <CardDescription className="min-h-12">{description}</CardDescription>
      </CardHeader>
      <CardContent className="flex items-end justify-between gap-4 p-6 pt-0">
        <div>
          <div className="text-xs text-muted-foreground/80">当前数量</div>
          <div className="mt-1 text-xl font-semibold tabular-nums text-foreground">{count}</div>
        </div>
        <Link
          href={href}
          className="inline-flex h-9 items-center justify-center gap-2 rounded-lg px-3 text-sm font-medium text-foreground transition-colors hover:bg-brand hover:text-brand-foreground"
        >
          进入模块
          <ArrowRight className="h-4 w-4" />
        </Link>
      </CardContent>
    </Card>
  );
}

export function EmptyState({
  text,
  actionText,
  onAction
}: {
  text: string;
  actionText?: string;
  onAction?: () => void;
}) {
  return (
    <div className="flex min-h-36 flex-col items-center justify-center rounded-xl border border-dashed border-border bg-card/50 p-6 text-center">
      <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-accent/10 text-accent">
        <Inbox className="h-5 w-5" />
      </div>
      <p className="mt-4 max-w-sm text-sm leading-6 text-muted-foreground">{text}</p>
      {actionText && onAction ? (
        <Button className="mt-4" onClick={onAction}>
          {actionText}
        </Button>
      ) : null}
    </div>
  );
}

export function ModuleCard({
  title,
  description,
  href,
  icon: Icon
}: {
  title: string;
  description: string;
  href: string;
  icon: LucideIcon;
}) {
  return (
    <Link href={href}>
      <Card className="soft-panel-hover h-full">
        <CardHeader>
          <div className="mb-4 flex h-9 w-9 items-center justify-center rounded-lg bg-accent/10 text-accent">
            <Icon className="h-4 w-4" />
          </div>
          <CardTitle>{title}</CardTitle>
          <CardDescription>{description}</CardDescription>
        </CardHeader>
      </Card>
    </Link>
  );
}

export function PrimaryButton(props: ButtonProps) {
  return <Button {...props} />;
}

export function GhostButton(props: ButtonProps) {
  return <Button variant="ghost" {...props} />;
}
