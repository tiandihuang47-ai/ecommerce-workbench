"use client";

import { useMemo, useState } from "react";
import { Check, Copy, Eraser, RotateCcw, WandSparkles } from "lucide-react";
import ReactMarkdown from "react-markdown";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  generateDeconstruction,
  generateEditing,
  generateInterview,
  generateScript,
  generateTopics,
  stringifyResult,
  type GeneratedSection,
  type ToolInput
} from "@/lib/generators";
import { type ToolDefinition } from "@/lib/tool-config";
import { cn } from "@/lib/utils";

type ApiGenerateType = "topic" | "script" | "interview" | "deconstruction" | "editing";

const apiTypeMap: Record<ToolDefinition["id"], ApiGenerateType> = {
  topics: "topic",
  scripts: "script",
  interview: "interview",
  deconstruction: "deconstruction",
  editing: "editing"
};

function createInitialValues(definition: ToolDefinition): ToolInput {
  return Object.fromEntries(
    definition.fields.map((field) => {
      if (field.type === "multiselect") {
        return [field.name, []];
      }

      if (field.type === "select") {
        return [field.name, field.options?.[0]?.value ?? ""];
      }

      return [field.name, ""];
    })
  );
}

function runGenerator(definition: ToolDefinition, values: ToolInput): GeneratedSection[] {
  switch (definition.id) {
    case "topics":
      return generateTopics(values);
    case "scripts":
      return generateScript(values);
    case "interview":
      return generateInterview(values);
    case "deconstruction":
      return generateDeconstruction(values);
    case "editing":
      return generateEditing(values);
  }
}

async function copyToClipboard(text: string) {
  await navigator.clipboard.writeText(text);
}

function hasMeaningfulUserInput(values: ToolInput) {
  return Object.entries(values).some(([key, value]) => {
    if (["purpose", "direction", "scriptType", "videoType"].includes(key)) {
      return false;
    }

    if (Array.isArray(value)) {
      return value.length > 0;
    }

    return value.trim().length > 0;
  });
}

export function ToolWorkspace({ definition }: { definition: ToolDefinition }) {
  const initialValues = useMemo(() => createInitialValues(definition), [definition]);
  const [values, setValues] = useState<ToolInput>(initialValues);
  const [result, setResult] = useState<GeneratedSection[]>([]);
  const [copiedKey, setCopiedKey] = useState<string>("");
  const [isGenerating, setIsGenerating] = useState(false);
  const [notice, setNotice] = useState<string>("");
  const [resultSource, setResultSource] = useState<"empty" | "deepseek" | "fallback">("empty");

  function updateValue(name: string, next: string | string[]) {
    setValues((current) => ({ ...current, [name]: next }));
  }

  function toggleMulti(name: string, option: string) {
    const current = Array.isArray(values[name]) ? (values[name] as string[]) : [];
    const next = current.includes(option)
      ? current.filter((item) => item !== option)
      : [...current, option];
    updateValue(name, next);
  }

  async function handleGenerate() {
    setNotice("");

    if (!hasMeaningfulUserInput(values)) {
      setResult([]);
      setResultSource("empty");
      setNotice("请先补充必要输入，再生成内容。");
      return;
    }

    setIsGenerating(true);

    try {
      const response = await fetch("/api/generate", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          type: apiTypeMap[definition.id],
          input: values,
          rules: {}
        })
      });

      const data = (await response.json()) as { content?: string; error?: string; source?: string };

      if (!response.ok || !data.content) {
        throw new Error(data.error || "DeepSeek 请求失败，已切换本地规则库生成");
      }

      setResult([
        {
          title: "DeepSeek 生成结果",
          content: data.content
        }
      ]);
      setResultSource("deepseek");
    } catch (error) {
      const message = error instanceof Error ? error.message : "DeepSeek 请求失败，已切换本地规则库生成";
      setNotice(`${message}。已自动使用本地规则库备用生成。`);
      setResult(runGenerator(definition, values));
      setResultSource("fallback");
    } finally {
      setIsGenerating(false);
    }
  }

  function handleClear() {
    setValues(initialValues);
    setResult([]);
    setNotice("");
    setResultSource("empty");
  }

  function handleExample() {
    setValues({ ...initialValues, ...definition.example });
    setResult([]);
    setNotice("");
    setResultSource("empty");
  }

  async function handleCopy(key: string, text: string) {
    await copyToClipboard(text);
    setCopiedKey(key);
    window.setTimeout(() => setCopiedKey(""), 1400);
  }

  return (
    <div className="grid gap-6 xl:grid-cols-[440px_minmax(0,1fr)]">
      <Card>
        <CardHeader>
          <CardTitle>{definition.title}</CardTitle>
          <CardDescription>{definition.description}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          {definition.fields.map((field) => {
            const fieldValue = values[field.name];

            return (
              <div key={field.name} className="space-y-2">
                <Label htmlFor={field.name}>{field.label}</Label>
                {field.type === "text" ? (
                  <Input
                    id={field.name}
                    placeholder={field.placeholder}
                    value={typeof fieldValue === "string" ? fieldValue : ""}
                    onChange={(event) => updateValue(field.name, event.target.value)}
                  />
                ) : null}
                {field.type === "textarea" ? (
                  <Textarea
                    id={field.name}
                    placeholder={field.placeholder}
                    value={typeof fieldValue === "string" ? fieldValue : ""}
                    onChange={(event) => updateValue(field.name, event.target.value)}
                  />
                ) : null}
                {field.type === "select" ? (
                  <Select
                    id={field.name}
                    options={field.options ?? []}
                    value={typeof fieldValue === "string" ? fieldValue : ""}
                    onChange={(event) => updateValue(field.name, event.target.value)}
                  />
                ) : null}
                {field.type === "multiselect" ? (
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 xl:grid-cols-2">
                    {(field.options ?? []).map((option) => {
                      const selected = Array.isArray(fieldValue) && fieldValue.includes(option.value);
                      return (
                        <button
                          key={option.value}
                          type="button"
                          onClick={() => toggleMulti(field.name, option.value)}
                          className={cn(
                            "flex h-10 items-center justify-between rounded-md border px-3 text-left text-sm transition-colors",
                            selected
                              ? "border-primary bg-primary text-primary-foreground"
                              : "border-input bg-background hover:bg-muted"
                          )}
                        >
                          <span>{option.label}</span>
                          {selected ? <Check className="h-4 w-4" /> : null}
                        </button>
                      );
                    })}
                  </div>
                ) : null}
              </div>
            );
          })}

          <div className="flex flex-wrap gap-2 pt-2">
            <Button onClick={handleGenerate} disabled={isGenerating}>
              <WandSparkles className="h-4 w-4" />
              {isGenerating ? "生成中..." : "生成"}
            </Button>
            <Button variant="secondary" onClick={handleExample} disabled={isGenerating}>
              <RotateCcw className="h-4 w-4" />
              示例填充
            </Button>
            <Button variant="outline" onClick={handleClear} disabled={isGenerating}>
              <Eraser className="h-4 w-4" />
              清空
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card className="min-h-[620px]">
        <CardHeader className="flex-row items-start justify-between gap-4 space-y-0">
          <div>
            <CardTitle>结果输出</CardTitle>
            <CardDescription>
              {resultSource === "deepseek"
                ? "DeepSeek 智能生成结果。"
                : resultSource === "fallback"
                  ? "DeepSeek 不可用，已使用本地规则库备用生成。"
                  : "优先使用 DeepSeek，失败时自动切换到本地规则库。"}
            </CardDescription>
          </div>
          <Button
            variant="outline"
            size="sm"
            disabled={result.length === 0}
            onClick={() => handleCopy("all", stringifyResult(result))}
          >
            <Copy className="h-4 w-4" />
            {copiedKey === "all" ? "已复制" : "复制全部"}
          </Button>
        </CardHeader>
        <CardContent>
          {notice ? (
            <div className="mb-4 rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm leading-6 text-amber-900">
              {notice}
            </div>
          ) : null}

          {isGenerating ? (
            <div className="flex min-h-[450px] items-center justify-center rounded-lg border border-dashed bg-muted/40 p-8 text-center text-sm text-muted-foreground">
              DeepSeek 正在生成，请稍候...
            </div>
          ) : result.length === 0 ? (
            <div className="flex min-h-[450px] items-center justify-center rounded-lg border border-dashed bg-muted/40 p-8 text-center text-sm text-muted-foreground">
              填写左侧信息后生成结果。也可以先使用示例填充快速查看输出效果。
            </div>
          ) : (
            <div className="space-y-4">
              {result.map((item, index) => (
                <section key={`${item.title}-${index}`} className="rounded-lg border bg-background">
                  <div className="flex items-center justify-between gap-3 border-b px-4 py-3">
                    <h2 className="text-sm font-semibold">{item.title}</h2>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleCopy(`${item.title}-${index}`, item.content)}
                    >
                      <Copy className="h-4 w-4" />
                      {copiedKey === `${item.title}-${index}` ? "已复制" : "复制"}
                    </Button>
                  </div>
                  <div className="scrollbar-subtle break-words px-4 py-4 text-sm leading-7 text-foreground">
                    <ReactMarkdown
                      components={{
                        h1: ({ children }) => <h1 className="mb-3 text-xl font-semibold">{children}</h1>,
                        h2: ({ children }) => <h2 className="mb-3 mt-5 text-lg font-semibold">{children}</h2>,
                        h3: ({ children }) => <h3 className="mb-2 mt-4 text-base font-semibold">{children}</h3>,
                        p: ({ children }) => <p className="mb-3 leading-7">{children}</p>,
                        ul: ({ children }) => <ul className="mb-3 list-disc space-y-1 pl-5">{children}</ul>,
                        ol: ({ children }) => <ol className="mb-3 list-decimal space-y-1 pl-5">{children}</ol>,
                        li: ({ children }) => <li className="leading-7">{children}</li>,
                        strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
                        code: ({ children }) => (
                          <code className="rounded bg-muted px-1.5 py-0.5 text-[0.92em]">{children}</code>
                        )
                      }}
                    >
                      {item.content}
                    </ReactMarkdown>
                  </div>
                </section>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
