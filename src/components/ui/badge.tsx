import * as React from "react";
import { cn } from "@/lib/utils";

type BadgeVariant = "default" | "secondary";

export function Badge({ className, variant = "default", ...props }: React.HTMLAttributes<HTMLSpanElement> & { variant?: BadgeVariant }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-md border px-2 py-0.5 text-[11px] font-medium",
        variant === "default"
          ? "border-border bg-muted text-foreground"
          : "border-transparent bg-transparent text-muted-foreground",
        className
      )}
      {...props}
    />
  );
}
