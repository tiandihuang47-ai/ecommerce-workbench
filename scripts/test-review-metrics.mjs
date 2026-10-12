#!/usr/bin/env node
/**
 * 复盘口径修正针对性测试（2026-09 开发文档 §五.4）
 * 覆盖：数值单位解析、累计快照去重聚合、混合口径、重叠区间、比率不可加、相对中位数样本门槛。
 * 运行：node --experimental-strip-types scripts/test-review-metrics.mjs
 */
import {
  parseNumber,
  normalizeMetrics,
  aggregatePerformance,
  aggregatePerformanceRecords,
  relativeToAccountMedian,
  workKeyOf,
  performanceFingerprint
} from "../src/lib/marketing-learning/metrics.ts";

let passed = 0;
let failed = 0;

function check(name, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) { passed += 1; console.log(`  ✓ ${name}`); }
  else { failed += 1; console.error(`  ✗ ${name}\n    期望: ${JSON.stringify(expected)}\n    实际: ${JSON.stringify(actual)}`); }
}

function record(overrides = {}) {
  return {
    performanceId: "performance_" + Math.random().toString(36).slice(2, 8),
    creativeId: "creative_a",
    sourceType: "own",
    platform: "抖音",
    postId: "",
    postUrl: "",
    publishedAt: "",
    dataCapturedAt: "2026-09-01T00:00:00Z",
    metrics: { ...normalizeMetrics({ views: 0 }), views: null },
    rawMetrics: {},
    source: "manual",
    accountBaseline: null,
    notes: "",
    createdAt: "2026-09-01T00:00:00Z",
    ...overrides
  };
}

console.log("\n[1] 数值与单位解析");
check("1.2万 → 12000", parseNumber("1.2万"), 12000);
check("3亿 → 300000000", parseNumber("3亿"), 300000000);
check("1,000 → 1000", parseNumber("1,000"), 1000);
check("45%（比率）→ 0.45", parseNumber("45%", { rate: true }), 0.45);
check("45（比率）→ 0.45", parseNumber("45", { rate: true }), 0.45);
check("0.45（比率）→ 0.45", parseNumber("0.45", { rate: true }), 0.45);
check("无法识别 → null", parseNumber("约三条"), null);
check("normalizeMetrics 完播率 45 → 0.45", normalizeMetrics({ completionRate: "45" }).completionRate, 0.45);
check("缺失值保持 null", normalizeMetrics({ views: "" }).views, null);

console.log("\n[2] 累计快照：同作品 1000 → 1500，汇总为 1500（文档必测用例）");
{
  const records = [
    record({ postId: "p1", dataCapturedAt: "2026-09-01T00:00:00Z", metrics: { ...normalizeMetrics({ views: 1000 }) } }),
    record({ postId: "p1", dataCapturedAt: "2026-09-05T00:00:00Z", metrics: { ...normalizeMetrics({ views: 1500 }) } })
  ];
  const result = aggregatePerformance(records);
  check("总播放 = 1500（不是 2500）", result.views, 1500);
}

console.log("\n[3] 混合口径：累计 + 增量 → 只用累计最新，增量排除并提示");
{
  const records = [
    record({ postId: "p2", dataCapturedAt: "2026-09-01T00:00:00Z", metrics: { ...normalizeMetrics({ views: 800 }) } }),
    record({ postId: "p2", dataCapturedAt: "2026-09-06T00:00:00Z", metricType: "increment", periodStart: "2026-09-02", periodEnd: "2026-09-05", metrics: { ...normalizeMetrics({ views: 200 }) } })
  ];
  const result = aggregatePerformanceRecords(records);
  check("总播放 = 800（增量被排除）", result.total.views, 800);
  check("出现 mixed_caliber 提示", result.caveats.some((item) => item.kind === "mixed_caliber"), true);
  check("排除计数 = 1", result.excludedCount, 1);
}

console.log("\n[4] 增量：区间不重叠相加，重叠排除");
{
  const records = [
    record({ postId: "p3", metricType: "increment", periodStart: "2026-09-01", periodEnd: "2026-09-05", metrics: { ...normalizeMetrics({ views: 100 }) } }),
    record({ postId: "p3", metricType: "increment", periodStart: "2026-09-05", periodEnd: "2026-09-10", metrics: { ...normalizeMetrics({ views: 50 }) } }),
    record({ postId: "p3", metricType: "increment", periodStart: "2026-09-08", periodEnd: "2026-09-12", metrics: { ...normalizeMetrics({ views: 999 }) } })
  ];
  const result = aggregatePerformanceRecords(records);
  check("不重叠部分相加 = 150", result.total.views, 150);
  check("重叠提示存在", result.caveats.some((item) => item.kind === "overlapping_period"), true);
}

console.log("\n[5] 旧记录无口径字段：按累计处理并标记");
{
  const records = [
    record({ postId: "p4", dataCapturedAt: "2026-09-01T00:00:00Z", metrics: { ...normalizeMetrics({ views: 700 }) } }),
    record({ postId: "p4", dataCapturedAt: "2026-09-03T00:00:00Z", metrics: { ...normalizeMetrics({ views: 900 }) } })
  ];
  const result = aggregatePerformanceRecords(records);
  check("取最新快照 900", result.total.views, 900);
  check("出现 legacy_caliber 提示", result.caveats.some((item) => item.kind === "legacy_caliber"), true);
}

console.log("\n[6] 比率不可跨作品相加；不同作品计数可加");
{
  const records = [
    record({ postId: "p5", metrics: { ...normalizeMetrics({ views: 100, completionRate: 0.3 }) } }),
    record({ postId: "p6", metrics: { ...normalizeMetrics({ views: 200, completionRate: 0.5 }) } })
  ];
  const result = aggregatePerformance(records);
  check("播放可加 = 300", result.views, 300);
  check("完播率不可加 = null", result.completionRate, null);
}

console.log("\n[7] 同采集时间不同数据 → 冲突提示");
{
  const records = [
    record({ postId: "p7", dataCapturedAt: "2026-09-02T00:00:00Z", metrics: { ...normalizeMetrics({ views: 100 }) } }),
    record({ postId: "p7", dataCapturedAt: "2026-09-02T00:00:00Z", metrics: { ...normalizeMetrics({ views: 300 }) } })
  ];
  const result = aggregatePerformanceRecords(records);
  check("出现 capture_conflict 提示", result.caveats.some((item) => item.kind === "capture_conflict"), true);
  check("总数不为 400（未相加）", result.total.views === 400, false);
}

console.log("\n[8] 相对中位数：样本不足返回 null，≥5 条输出相对值");
{
  const self = record({ postId: "me", metrics: { ...normalizeMetrics({ views: 1150 }) } });
  const fewPeers = [1, 2, 3, 4].map((n) => record({ postId: `peer${n}`, metrics: { ...normalizeMetrics({ views: 1000 }) } }));
  check("4 条样本 → null", relativeToAccountMedian({ record: self, peers: fewPeers, metricKey: "views" }), null);
  const enoughPeers = [500, 800, 1000, 1000, 1200, 2000].map((n, i) => record({ postId: `peer${i}`, metrics: { ...normalizeMetrics({ views: n }) } }));
  const relative = relativeToAccountMedian({ record: self, peers: enoughPeers, metricKey: "views" });
  check("中位数 = 1000", relative?.median, 1000);
  check("相对值 = +15%", relative?.deltaPercent, 15);
}

console.log("\n[9] 作品身份与指纹");
check("postId 优先", workKeyOf({ postId: "9", postUrl: "https://v.douyin.com/x/", creativeId: "c", platform: "抖音" }), "post:9");
check("无 postId 用规范化链接", workKeyOf({ postId: "", postUrl: "https://v.douyin.com/x/?a=1", creativeId: "c", platform: "抖音" }), "url:https://v.douyin.com/x");
check("指纹稳定", performanceFingerprint(record({ postId: "z", dataCapturedAt: "t", metrics: { ...normalizeMetrics({ views: 5 }) } })) === performanceFingerprint(record({ postId: "z", dataCapturedAt: "t", metrics: { ...normalizeMetrics({ views: 5 }) } })), true);

console.log(`\n结果：${passed} 通过，${failed} 失败`);
process.exit(failed > 0 ? 1 : 0);
