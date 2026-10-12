#!/usr/bin/env node
/**
 * 中央模型路由单元测试（纯 Node，无第三方测试框架）
 *
 * 被测对象：src/lib/model-router/config.ts
 *   - config.ts 只依赖 node:fs / node:path / yaml，不含 "@/..." 别名，
 *     所以先 tsc 编译到 tmp/model-router-build，再 require 编译产物（不改 src）。
 *   - 每个用例切换 MODEL_CONFIG_DIR 并调用 resetModelRouterCache()。
 *   - 真实用例直接读仓库 config/；坏配置用例写临时 fixture 到
 *     tmp/model-router-fixtures/（用后清理）。
 *
 * 用法：node scripts/test-model-router.mjs
 * 全部 PASS 时 exit 0；任一失败输出 FAIL 并 exit 1。
 */

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const buildDir = path.join(root, "tmp", "model-router-build");
const fixturesDir = path.join(root, "tmp", "model-router-fixtures");
const realConfigDir = path.join(root, "config");
const require = createRequire(import.meta.url);

let passed = 0;
const failed = [];

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function test(name, fn) {
  try {
    fn();
    passed += 1;
    console.log("  PASS  " + name);
  } catch (error) {
    failed.push(name);
    console.log("  FAIL  " + name + " — " + (error && error.message ? error.message : String(error)));
  }
}

/* ------------------------------------------------------------------ */
/* 1) 编译 config.ts（若首次报错，追加 --noEmitOnError false 重试）    */
/* ------------------------------------------------------------------ */

function compileRouter() {
  const rel = (target) => path.relative(root, target);
  const baseArgs = [
    "tsc",
    rel(path.join(root, "src", "lib", "model-router", "config.ts")),
    "--outDir", rel(buildDir),
    "--module", "commonjs",
    "--target", "es2022",
    "--moduleResolution", "node",
    "--esModuleInterop",
    "--skipLibCheck"
  ];
  const run = (args) => spawnSync("npx", args, { cwd: root, encoding: "utf8" });
  const outFile = path.join(buildDir, "config.js");

  rmSync(buildDir, { recursive: true, force: true });
  mkdirSync(buildDir, { recursive: true });

  let result = run(baseArgs);
  if (result.status !== 0 && !existsSync(outFile)) {
    console.log("提示：首次 tsc 编译报错，追加 --noEmitOnError false 重试…");
    result = run([...baseArgs, "--noEmitOnError", "false"]);
  }
  if (!existsSync(outFile)) {
    throw new Error(
      "tsc 编译 config.ts 失败（不改 src）：\n" + (result.stdout || "") + (result.stderr || "")
    );
  }
  if (result.status !== 0) {
    console.log("提示：tsc 退出码非 0，但已产出 config.js，继续运行。");
  }
  return require(outFile);
}

/* ------------------------------------------------------------------ */
/* 2) 测试夹具与配置目录切换                                           */
/* ------------------------------------------------------------------ */

function writeFixture(name, modelsYaml, routingYaml) {
  const dir = path.join(fixturesDir, name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, "models.yaml"), modelsYaml.trimStart(), "utf8");
  writeFileSync(path.join(dir, "model-routing.yaml"), routingYaml.trimStart(), "utf8");
  return dir;
}

function withConfigDir(router, dir, fn) {
  const previous = process.env.MODEL_CONFIG_DIR;
  process.env.MODEL_CONFIG_DIR = dir;
  router.resetModelRouterCache();
  try {
    return fn();
  } finally {
    if (previous === undefined) delete process.env.MODEL_CONFIG_DIR;
    else process.env.MODEL_CONFIG_DIR = previous;
    router.resetModelRouterCache();
  }
}

/* ------------------------------------------------------------------ */
/* 3) 用例                                                             */
/* ------------------------------------------------------------------ */

function runTests(router) {
  // ---- 夹具：route 引用不存在的模型（用例 3）----
  const badModelDir = writeFixture(
    "route-bad-model",
    `
providers:
  p1:
    label: Fixture Provider
    protocol: openai_compatible
    base_url: https://example.invalid/v1
    api_key_env: FIXTURE_P1_KEY
models:
  good_model:
    label: Good Model
    provider: p1
    model_id: fixture-good-model
    capabilities: [text, structured_output]
`,
    `
routes:
  broken_route:
    model: ghost_model
    fallback: none
`
  );

  // ---- 夹具：模型引用不存在的 Provider（用例 4）----
  const badProviderDir = writeFixture(
    "model-bad-provider",
    `
providers: {}
models:
  orphan_model:
    label: Orphan Model
    provider: ghost_provider
    model_id: fixture-orphan-model
    capabilities: [text]
`,
    `
routes: {}
`
  );

  // ---- 夹具：capability 不匹配（用例 6）----
  const badCapabilityDir = writeFixture(
    "route-bad-capability",
    `
providers:
  p1:
    label: Fixture Provider
    protocol: openai_compatible
    base_url: https://example.invalid/v1
    api_key_env: FIXTURE_P1_KEY
models:
  text_only:
    label: Text Only
    provider: p1
    model_id: fixture-text-only
    capabilities: [text]
`,
    `
routes:
  image_generation:
    capability: image_generation
    model: text_only
    fallback_models:
      - text_only
`
  );

  // 用例 1：正常配置（真实 config/）
  test("真实配置：resolveRoute('script_generation') 解析出主模型 / Provider / fallback", () => {
    withConfigDir(router, realConfigDir, () => {
      const route = router.resolveRoute("script_generation");
      assert(route.modelId === "claude-opus-5-5", "modelId 应为 claude-opus-5-5，实际 " + route.modelId);
      assert(route.provider.name === "teamorouter_claude", "provider.name 应为 teamorouter_claude，实际 " + route.provider.name);
      assert(route.fallbackAlias === "deepseek_v4_flash", "fallbackAlias 应为 deepseek_v4_flash，实际 " + route.fallbackAlias);
    });
  });

  // 用例 2：未知 route（真实 config/）
  test("真实配置：resolveRoute('not_a_route') 抛错且信息含 routeKey 与可用 Route 列表", () => {
    withConfigDir(router, realConfigDir, () => {
      let caught = null;
      try {
        router.resolveRoute("not_a_route");
      } catch (error) {
        caught = error;
      }
      assert(caught, "resolveRoute('not_a_route') 应抛出 ModelRoutingError");
      assert(caught instanceof router.ModelRoutingError || caught.name === "ModelRoutingError",
        "错误类型应为 ModelRoutingError，实际 " + (caught && caught.name));
      assert(caught.message.includes("not_a_route"), "错误信息应包含 not_a_route，实际：" + caught.message);
      assert(caught.message.includes("可用 Route"), "错误信息应包含可用 Route 列表，实际：" + caught.message);
      assert(caught.message.includes("script_generation"), "可用 Route 列表应含真实 route（script_generation），实际：" + caught.message);
    });
  });

  // 用例 3：route 引用不存在的模型（fixture）
  test("坏配置：route 引用不存在的模型 → errors 含 routeKey 与坏 alias", () => {
    withConfigDir(router, badModelDir, () => {
      const result = router.validateModelRouting();
      assert(!result.ok, "validateModelRouting().ok 应为 false");
      assert(result.errors.some((item) => item.includes("broken_route") && item.includes("ghost_model")),
        "errors 应同时包含 broken_route 与 ghost_model，实际：" + JSON.stringify(result.errors));
    });
  });

  // 用例 4：模型引用不存在的 Provider（fixture）
  test("坏配置：模型引用不存在的 Provider → errors 有可读信息", () => {
    withConfigDir(router, badProviderDir, () => {
      const result = router.validateModelRouting();
      assert(!result.ok, "validateModelRouting().ok 应为 false");
      assert(result.errors.some((item) => item.includes("ghost_provider") && item.includes("orphan_model")),
        "errors 应包含 orphan_model 与 ghost_provider，实际：" + JSON.stringify(result.errors));
    });
  });

  // 用例 5：缺环境变量（真实 config/，api_key_env 指向的变量不存在）
  test("真实配置：provider 的 api_key_env 未设置 → overview.configured=false 且 validate 有 warning", () => {
    const saved = new Map();
    const catalog = withConfigDir(router, realConfigDir, () => router.loadModelCatalog());
    for (const provider of catalog.providers) {
      for (const envName of [provider.apiKeyEnv, provider.apiKeyFallbackEnv]) {
        if (envName && !saved.has(envName)) {
          saved.set(envName, process.env[envName]);
          delete process.env[envName];
        }
      }
    }
    try {
      withConfigDir(router, realConfigDir, () => {
        const overview = router.listRouteOverview();
        const entry = overview.find((item) => item.routeKey === "script_generation");
        assert(entry, "listRouteOverview() 应包含 script_generation");
        assert(entry.providerName === "teamorouter_claude", "script_generation 的 Provider 应为 teamorouter_claude，实际 " + entry.providerName);
        assert(entry.configured === false,
          "缺少 " + entry.apiKeyEnv + " 时 configured 应为 false，实际 " + entry.configured);
        const result = router.validateModelRouting();
        assert(result.warnings.some((item) => item.includes("script_generation")),
          "warnings 应包含 script_generation，实际：" + JSON.stringify(result.warnings));
      });
    } finally {
      for (const [envName, value] of saved) {
        if (value === undefined) delete process.env[envName];
        else process.env[envName] = value;
      }
    }
  });

  // 用例 6：capability 不匹配（fixture）
  test("坏配置：image_generation 路由指向纯文本模型 → errors 说明能力不匹配", () => {
    withConfigDir(router, badCapabilityDir, () => {
      const result = router.validateModelRouting();
      assert(!result.ok, "validateModelRouting().ok 应为 false");
      assert(result.errors.some((item) => item.includes("image_generation") && (item.includes("能力") || item.includes("capability"))),
        "errors 应包含 image_generation 与能力/capability 说明，实际：" + JSON.stringify(result.errors));
    });
  });

  // 用例 7：生图候选链（真实 config/）
  test("真实配置：resolveRoute('image_generation').modelAliasChain 含默认模型 + fallback_models", () => {
    withConfigDir(router, realConfigDir, () => {
      const route = router.resolveRoute("image_generation");
      const definition = router.loadRouteTable().find((item) => item.key === "image_generation");
      assert(definition, "真实 config 应有 image_generation route");
      const expected = [definition.model, ...(definition.fallbackModels || [])];
      assert(route.modelAliasChain.includes(definition.model),
        "候选链应包含默认模型 " + definition.model + "，实际 " + JSON.stringify(route.modelAliasChain));
      for (const alias of definition.fallbackModels || []) {
        assert(route.modelAliasChain.includes(alias),
          "候选链应包含 fallback 模型 " + alias + "，实际 " + JSON.stringify(route.modelAliasChain));
      }
      assert(JSON.stringify(route.modelAliasChain) === JSON.stringify(expected),
        "候选链应与 config/model-routing.yaml 一致：期望 " + JSON.stringify(expected) + "，实际 " + JSON.stringify(route.modelAliasChain));
      assert(route.modelAliasChain.includes("seedream_5_pro")
        && route.modelAliasChain.includes("gpt_image_2_5")
        && route.modelAliasChain.includes("gpt_image_2"),
        "候选链应包含真实值 seedream_5_pro / gpt_image_2_5 / gpt_image_2，实际 " + JSON.stringify(route.modelAliasChain));
      assert((definition.retouchModels || []).includes("gpt_image_2"),
        "retouch_models 应可从 loadRouteTable 读取且含 gpt_image_2，实际 " + JSON.stringify(definition.retouchModels));
    });
  });
}

/* ------------------------------------------------------------------ */
/* 4) 主流程                                                           */
/* ------------------------------------------------------------------ */

function main() {
  rmSync(fixturesDir, { recursive: true, force: true });
  mkdirSync(fixturesDir, { recursive: true });
  try {
    const router = compileRouter();
    runTests(router);
  } finally {
    rmSync(fixturesDir, { recursive: true, force: true });
  }
  console.log("");
  if (failed.length) {
    console.log("FAIL：" + failed.length + " 个用例失败（共 " + (passed + failed.length) + "）。");
    for (const name of failed) console.log("  - " + name);
    process.exit(1);
  }
  console.log("PASS：全部 " + passed + " 个用例通过。");
  process.exit(0);
}

main();
