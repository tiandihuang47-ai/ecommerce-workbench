"use client";

import { useMemo, useState } from "react";
import { Copy, Search } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { knowledgeItems } from "@/data/director-rules";

export function KnowledgeBrowser() {
  const [query, setQuery] = useState("");
  const [copied, setCopied] = useState("");

  const filtered = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    if (!keyword) {
      return knowledgeItems;
    }

    return knowledgeItems.filter((item) =>
      [item.module, item.methodName, item.scenario, item.example, item.promptTemplate]
        .join(" ")
        .toLowerCase()
        .includes(keyword)
    );
  }, [query]);

  async function copyPrompt(id: string, prompt: string) {
    await navigator.clipboard.writeText(prompt);
    setCopied(id);
    window.setTimeout(() => setCopied(""), 1400);
  }

  return (
    <div className="space-y-5">
      <Card>
        <CardHeader>
          <CardTitle>知识库</CardTitle>
          <CardDescription>按模块检索编导方法、适用场景、操作步骤、示例和提示词模板。</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              className="pl-9"
              placeholder="搜索：自然流、拆片、成本、实体店、剪辑..."
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-4 xl:grid-cols-2">
        {filtered.map((item) => (
          <Card key={item.id}>
            <CardHeader>
              <div className="flex items-start justify-between gap-4">
                <div>
                  <Badge>{item.module}</Badge>
                  <CardTitle className="mt-3">{item.methodName}</CardTitle>
                  <CardDescription className="mt-2">{item.scenario}</CardDescription>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => copyPrompt(item.id, item.promptTemplate)}
                >
                  <Copy className="h-4 w-4" />
                  {copied === item.id ? "已复制" : "复制提示词"}
                </Button>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <div className="mb-2 text-sm font-semibold">操作步骤</div>
                <ol className="space-y-1 text-sm leading-6 text-muted-foreground">
                  {item.steps.map((step, index) => (
                    <li key={step}>
                      {index + 1}. {step}
                    </li>
                  ))}
                </ol>
              </div>
              <div>
                <div className="mb-2 text-sm font-semibold">示例</div>
                <p className="text-sm leading-6 text-muted-foreground">{item.example}</p>
              </div>
              <div>
                <div className="mb-2 text-sm font-semibold">提示词模板</div>
                <pre className="whitespace-pre-wrap rounded-md border bg-muted/60 p-3 text-sm leading-6">
                  {item.promptTemplate}
                </pre>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
