#!/usr/bin/env node
/**
 * 可控改稿针对性测试（2026-09 开发文档 §五.1/§五.4）
 * 覆盖：选区外逐字不变、相同句子只改选中处、锁定不可绕过、正文变化后过期拒绝、区间平移。
 * 运行：node --experimental-strip-types scripts/test-script-revision.mjs
 */
import {
  contentHash,
  applySelectionProposal,
  invalidLockRanges,
  locksSurvivedIn
} from "../src/lib/script-revision.ts";

let passed = 0;
let failed = 0;
function check(name, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) { passed += 1; console.log(`  ✓ ${name}`); }
  else { failed += 1; console.error(`  ✗ ${name}\n    期望: ${JSON.stringify(expected)}\n    实际: ${JSON.stringify(actual)}`); }
}

const base = "开头一句话。中间这段写得很像广告。结尾引导语。";

console.log("\n[1] 正常应用：只改选中部分，选区外逐字不变");
{
  const start = base.indexOf("中间这段");
  const end = start + "中间这段写得很像广告。".length;
  const proposal = { baseContentHash: contentHash(base), selection: { start, end, text: base.slice(start, end) }, replacement: "中间这句改成朋友聊天的说法。" };
  const result = applySelectionProposal(base, proposal, []);
  check("应用成功", result.ok, true);
  if (result.ok) {
    check("开头不变", result.content.startsWith("开头一句话。"), true);
    check("结尾不变", result.content.endsWith("结尾引导语。"), true);
    check("中间已替换", result.content.includes("朋友聊天的说法"), true);
    check("旧句子已消失", result.content.includes("很像广告"), false);
  }
}

console.log("\n[2] 正文中有相同句子：只改选中的那一处");
{
  const repeated = "AAA。BBB。AAA。";
  const first = repeated.indexOf("AAA");
  const proposal = { baseContentHash: contentHash(repeated), selection: { start: first, end: first + 3, text: "AAA" }, replacement: "XXX" };
  const result = applySelectionProposal(repeated, proposal, []);
  check("按偏移替换第一处", result.ok ? result.content : result, "XXX。BBB。AAA。");
}

console.log("\n[3] 正文已变化 → 过期拒绝");
{
  const proposal = { baseContentHash: contentHash(base), selection: { start: 6, end: 18, text: base.slice(6, 18) }, replacement: "x" };
  const edited = base + "（用户又加了一句）";
  check("content_changed", applySelectionProposal(edited, proposal, []).ok, false);
  check("原因 = content_changed", applySelectionProposal(edited, proposal, []).reason, "content_changed");
}

console.log("\n[4] 选区文本不一致 → 拒绝");
{
  const proposal = { baseContentHash: contentHash(base), selection: { start: 6, end: 18, text: "和正文不一样的文本" }, replacement: "x" };
  check("selection_changed", applySelectionProposal(base, proposal, []).reason, "selection_changed");
}

console.log("\n[5] 锁定：重叠拒绝；不重叠时逐字保护并平移");
{
  const locks = [{ start: 0, end: 6, text: "开头一句话。" }];
  const start = base.indexOf("中间这段");
  const end = start + "中间这段写得很像广告。".length;
  const proposal = { baseContentHash: contentHash(base), selection: { start, end, text: base.slice(start, end) }, replacement: "中间改写了。" };
  check("不重叠 → 应用成功", applySelectionProposal(base, proposal, locks).ok, true);
  const applied = applySelectionProposal(base, proposal, locks);
  check("锁定区间平移后文本不变", applied.ok ? applied.adjustedLocks : null, [{ start: 0, end: 6, text: "开头一句话。" }]);

  const overlapProposal = { baseContentHash: contentHash(base), selection: { start: 0, end: 10, text: base.slice(0, 10) }, replacement: "x" };
  check("与锁定重叠 → 拒绝", applySelectionProposal(base, overlapProposal, locks).reason, "lock_overlap");

  // 关键保证：选区外文本由程序拼装（模型无法触碰）。即使模型返回的替换文本
  // 复制了锁定前缀，前缀仍然逐字保留在原位；选区替换只发生在选区内。
  const swallow = { baseContentHash: contentHash(base), selection: { start, end, text: base.slice(start, end) }, replacement: "开头一句话。被吞掉了。" };
  const swallowResult = applySelectionProposal(base, swallow, locks);
  check("替换后锁定前缀仍逐字保留在原位", swallowResult.ok ? swallowResult.content.startsWith("开头一句话。") : false, true);
  check("替换范围之外没有多出内容", swallowResult.ok ? swallowResult.content.endsWith("结尾引导语。") : false, true);
}

console.log("\n[6] 手改后失效锁定检测 + 全局改稿锁定存活");
{
  const content = "新的开头。中间。结尾。";
  const staleLocks = [{ start: 0, end: 6, text: "开头一句话。" }];
  check("失效锁定被识别", invalidLockRanges(content, staleLocks).length, 1);
  const validLocks = [{ start: 0, end: 5, text: "新的开头。" }];
  check("有效锁定通过", invalidLockRanges(content, validLocks).length, 0);
  check("结果包含锁定文本 → 存活", locksSurvivedIn("前面。新的开头。后面。", validLocks), true);
  check("结果丢失锁定文本 → 未存活", locksSurvivedIn("别的 entirely 内容。", validLocks), false);
}

console.log("\n[7] 哈希敏感性");
check("不同文本哈希不同", contentHash(base) !== contentHash(base + "1"), true);
check("相同文本哈希相同", contentHash(base) === contentHash(base), true);

console.log(`\n结果：${passed} 通过，${failed} 失败`);
process.exit(failed > 0 ? 1 : 0);
