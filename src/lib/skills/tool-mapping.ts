import { isKnownCapability } from "@/lib/skills/capability-registry";
import type { SkillToolMapping } from "@/lib/skills/types";

/**
 * Tool Mapping Registry（§14 / §15）。
 *
 * 外部 Agent 用什么工具名不重要，这里统一映射成 Director 内部能力。
 * 新增一个 Agent 格式 = 增加一条 alias，不需要改 Skill Runtime。
 */
export interface SkillToolAliasRule {
  /** Director 内部能力 ID。 */
  capability: string;
  /** 适配器 ID（与 capability-registry 保持一致）。 */
  adapter: string;
  /** 精确别名（大小写不敏感，支持下划线/中划线/点/驼峰归一化后比较）。 */
  aliases: string[];
  /** 正则匹配（用于 mcp__*、server.tool 等前缀模式）。 */
  patterns?: RegExp[];
}

export const skillToolAliasRegistry: SkillToolAliasRule[] = [
  {
    capability: "file.read",
    adapter: "sandbox-file-read",
    aliases: ["read_file", "readfile", "read", "cat", "view_file", "open_file", "get_file", "filesystem_read", "file_reader", "read_text_file", "readfilecontent", "fs_read"],
    patterns: [/^(fs|filesystem)\.read$/i, /^file\.read$/i]
  },
  {
    capability: "file.write",
    adapter: "sandbox-file-write",
    aliases: ["write_file", "writefile", "create_file", "save_file", "filesystem_write", "file_writer", "edit_file", "append_file"],
    patterns: [/^(fs|filesystem)\.write$/i, /^file\.write$/i]
  },
  {
    capability: "document.read",
    adapter: "document-read",
    aliases: ["read_document", "read_doc", "document_reader", "read_pdf", "parse_document", "read_docx", "extract_text", "document_read", "read_markdown"],
    patterns: [/^document\.read$/i]
  },
  {
    capability: "document.parse",
    adapter: "document-parse",
    aliases: ["parse_document", "document_parse", "split_document", "chunk_document"],
    patterns: [/^document\.parse$/i]
  },
  {
    capability: "web.search",
    adapter: "web-search",
    aliases: ["web_search", "search_web", "google_search", "brave_search", "tavily_search", "search", "internet_search", "search_internet"],
    patterns: [/^web\.search$/i]
  },
  {
    capability: "web.fetch",
    adapter: "web-fetch",
    aliases: ["web_fetch", "fetch_url", "fetch_webpage", "browse", "scrape_url", "open_url", "read_url", "get_url", "crawl_url"],
    patterns: [/^web\.(fetch|browse)$/i]
  },
  {
    capability: "image.generate",
    adapter: "commerce-image-generate",
    aliases: ["image_generation", "generate_image", "create_image", "draw", "draw_image", "text_to_image", "image_gen", "make_image", "gen_image"],
    patterns: [/^image\.generate$/i]
  },
  {
    capability: "image.analyze",
    adapter: "vision-analyze",
    aliases: ["analyze_image", "describe_image", "read_image", "vision", "ocr", "image_understanding", "look_at_image"],
    patterns: [/^image\.(analyze|understand)$/i]
  },
  {
    capability: "model.text",
    adapter: "deepseek-text",
    aliases: ["llm", "chat", "ask_model", "complete", "generate_text", "text_model", "model"],
    patterns: [/^model\.(text|chat)$/i]
  },
  {
    capability: "model.vision",
    adapter: "vision-model",
    aliases: ["vision_model", "gpt_4v", "claude_vision", "multimodal"],
    patterns: [/^model\.vision$/i]
  },
  {
    capability: "shell.run",
    adapter: "shell-guarded",
    aliases: ["shell", "bash", "sh", "zsh", "run_command", "execute_command", "exec", "terminal", "run_shell", "command", "process_run"],
    patterns: [/^shell\.(run|exec)$/i]
  },
  {
    capability: "python.run",
    adapter: "python-isolated",
    aliases: ["python", "run_python", "python_exec", "execute_python", "python3", "py_run"],
    patterns: [/^python\.run$/i]
  },
  {
    capability: "node.run",
    adapter: "node-isolated",
    aliases: ["node", "run_node", "nodejs", "javascript", "run_js", "execute_node", "deno", "bun"],
    patterns: [/^node\.run$/i]
  },
  {
    capability: "http.request",
    adapter: "http-request",
    aliases: ["http_request", "request", "api_call", "call_api", "fetch_api", "http", "rest_call"],
    patterns: [/^http\.request$/i]
  },
  {
    capability: "asset.read",
    adapter: "director-assets",
    aliases: ["list_assets", "get_asset", "read_asset", "search_assets"],
    patterns: [/^asset\.read$/i]
  },
  {
    capability: "asset.write",
    adapter: "director-assets",
    aliases: ["save_asset", "write_asset", "create_asset", "store_asset"],
    patterns: [/^asset\.write$/i]
  },
  {
    capability: "product.read",
    adapter: "director-products",
    aliases: ["get_product", "product_lookup", "read_product", "list_products", "product_info"],
    patterns: [/^product\.read$/i]
  },
  {
    capability: "knowledge.search",
    adapter: "director-knowledge",
    aliases: ["search_knowledge", "knowledge_search", "rag_search", "search_documents", "search_docs", "search_library"],
    patterns: [/^knowledge\.search$/i]
  }
];

/** 归一化外部工具名：去掉命名空间前缀、统一分隔符与大小写。 */
export function normalizeToolName(name: string) {
  return name
    .trim()
    .replace(/^mcp__/i, "")
    .replace(/^mcp[.:/]/i, "")
    .replace(/^tools?[.:/]/i, "")
    .replace(/^functions?[.:/]/i, "")
    .replace(/[.:/\s-]+/g, "_")
    .replace(/[^a-z0-9_]/gi, "")
    .toLowerCase()
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "");
}

export function mapToolToCapability(toolName: string): SkillToolMapping {
  const normalized = normalizeToolName(toolName);

  for (const rule of skillToolAliasRegistry) {
    if (rule.aliases.some((alias) => normalizeToolName(alias) === normalized)) {
      return { externalName: toolName, capability: rule.capability, adapter: rule.adapter, matchedBy: "exact" };
    }
  }

  for (const rule of skillToolAliasRegistry) {
    for (const pattern of rule.patterns || []) {
      if (pattern.test(normalized) || pattern.test(toolName.trim())) {
        return { externalName: toolName, capability: rule.capability, adapter: rule.adapter, matchedBy: "pattern" };
      }
    }
  }

  // 模糊兜底：整体包含关系（例如 read_pdf_file / generate_product_image）
  for (const rule of skillToolAliasRegistry) {
    for (const alias of rule.aliases) {
      const normalizedAlias = normalizeToolName(alias);
      if (normalizedAlias.length >= 5 && normalized.includes(normalizedAlias)) {
        return { externalName: toolName, capability: rule.capability, adapter: rule.adapter, matchedBy: "alias" };
      }
    }
  }

  // 未知的 MCP 工具：登记为外部能力，不猜。
  if (/mcp/i.test(toolName)) {
    return { externalName: toolName, capability: "external.mcp", adapter: "mcp-adapter", matchedBy: "unmapped" };
  }

  return { externalName: toolName, capability: "", adapter: "", matchedBy: "unmapped" };
}

export function mapToolsToCapabilities(toolNames: string[]) {
  const mappings = toolNames
    .filter((name) => Boolean(name && name.trim()))
    .map(mapToolToCapability);
  const capabilities = new Set<string>();
  mappings.forEach((item) => {
    if (item.capability && isKnownCapability(item.capability)) capabilities.add(item.capability);
  });
  return { mappings, capabilities: Array.from(capabilities) };
}
