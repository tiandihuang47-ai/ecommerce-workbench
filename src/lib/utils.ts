export function cn(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(" ");
}

export function toPlainText(value: unknown): string {
  if (Array.isArray(value)) {
    return value.map(toPlainText).join("\n");
  }

  if (value && typeof value === "object") {
    return Object.entries(value)
      .map(([key, entry]) => `${key}: ${toPlainText(entry)}`)
      .join("\n");
  }

  return String(value ?? "");
}
