import { mkdir, readFile, readdir, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { commerceImageDataRoot, ensureCommerceImageDataRoot } from "@/lib/commerce-image-config";
import { ownershipScope, ownershipStamp, recordVisibleToScope } from "@/lib/server/request-scope";
import type {
  CreativeRecord,
  Experiment,
  MarketingReview,
  PerformanceRecord
} from "@/lib/marketing-learning/types";

/** 归属标记：网页模式下记录创建者，按账号隔离；桌面端/历史数据没有标记。 */
type OwnerTag = { userId?: string };

/**
 * 营销学习闭环 · 存储层
 *
 * 业务逻辑只依赖 MarketingLearningStore 接口；当前实现是本地文件 JSON，
 * 以后迁移 PostgreSQL / Supabase 时只换实现，不改服务层与 UI。
 *
 * 数据放在 .director-platform-data/commerce-image/learning/ 下，和现有生图数据同源。
 */

export interface MarketingLearningStore {
  saveCreative(record: CreativeRecord): Promise<CreativeRecord>;
  getCreative(creativeId: string): Promise<CreativeRecord | null>;
  listCreatives(): Promise<CreativeRecord[]>;
  findCreativeByVersion(taskId: string, versionId: string): Promise<CreativeRecord | null>;
  queryCreatives(filter: CreativeQuery): Promise<CreativeRecord[]>;
  updateCreative(creativeId: string, patch: Partial<CreativeRecord>): Promise<CreativeRecord | null>;

  savePerformance(record: PerformanceRecord): Promise<PerformanceRecord>;
  listPerformance(filter?: { creativeId?: string }): Promise<PerformanceRecord[]>;
  deletePerformance(performanceId: string): Promise<boolean>;

  saveExperiment(record: Experiment): Promise<Experiment>;
  getExperiment(experimentId: string): Promise<Experiment | null>;
  listExperiments(): Promise<Experiment[]>;

  saveReview(record: MarketingReview): Promise<MarketingReview>;
  listReviews(filter?: { experimentId?: string; creativeId?: string }): Promise<MarketingReview[]>;
}

export interface CreativeQuery {
  productId?: string;
  platform?: string;
  strategyKey?: string;
  primarySellingPoint?: string;
  tag?: string;
  taskId?: string;
  sourceType?: string;
}

class FileMarketingLearningStore implements MarketingLearningStore {
  async saveCreative(record: CreativeRecord) {
    const owned = await stampOwner(record);
    await atomicWrite(path.join(await groupDir("creatives"), owned.creativeId + ".json"), owned);
    return owned;
  }
  async getCreative(creativeId: string) {
    const record = await readJson<CreativeRecord & OwnerTag>(path.join(await groupDir("creatives"), safeId(creativeId) + ".json"));
    return await visible(record);
  }
  async listCreatives() {
    return (await readAll<CreativeRecord & OwnerTag>("creatives")) as CreativeRecord[];
  }
  async findCreativeByVersion(taskId: string, versionId: string) {
    const all = await this.listCreatives();
    return all.find((item) => item.taskId === taskId && item.versionId === versionId) || null;
  }
  async queryCreatives(filter: CreativeQuery) {
    const all = await this.listCreatives();
    return all.filter((item) => {
      if (filter.productId && item.productId !== filter.productId) return false;
      if (filter.platform && item.platform !== filter.platform) return false;
      if (filter.strategyKey && item.strategyKey !== filter.strategyKey) return false;
      if (filter.primarySellingPoint && item.primarySellingPoint !== filter.primarySellingPoint) return false;
      if (filter.taskId && item.taskId !== filter.taskId) return false;
      if (filter.sourceType && item.sourceType !== filter.sourceType) return false;
      if (filter.tag && !(item.tags || []).includes(filter.tag)) return false;
      return true;
    }).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
  async updateCreative(creativeId: string, patch: Partial<CreativeRecord>) {
    const current = await this.getCreative(creativeId);
    if (!current) return null;
    const next: CreativeRecord = { ...current, ...patch, creativeId: current.creativeId, createdAt: current.createdAt, updatedAt: new Date().toISOString() };
    await atomicWrite(path.join(await groupDir("creatives"), next.creativeId + ".json"), await stampOwner(next));
    return next;
  }

  async savePerformance(record: PerformanceRecord) {
    const owned = await stampOwner(record);
    await atomicWrite(path.join(await groupDir("performance"), owned.performanceId + ".json"), owned);
    return owned;
  }
  async listPerformance(filter?: { creativeId?: string }) {
    const all = (await readAll<PerformanceRecord & OwnerTag>("performance")) as PerformanceRecord[];
    const filtered = filter?.creativeId ? all.filter((item) => item.creativeId === filter.creativeId) : all;
    return filtered.sort((a, b) => (a.publishedAt || a.createdAt).localeCompare(b.publishedAt || b.createdAt));
  }
  async deletePerformance(performanceId: string) {
    const target = await readJson<PerformanceRecord & OwnerTag>(path.join(await groupDir("performance"), safeId(performanceId) + ".json"));
    if (!target || !(await visible(target))) return false;
    try {
      await unlink(path.join(await groupDir("performance"), safeId(performanceId) + ".json"));
      return true;
    } catch {
      return false;
    }
  }

  async saveExperiment(record: Experiment) {
    const owned = await stampOwner(record);
    await atomicWrite(path.join(await groupDir("experiments"), owned.experimentId + ".json"), owned);
    return owned;
  }
  async getExperiment(experimentId: string) {
    const record = await readJson<Experiment & OwnerTag>(path.join(await groupDir("experiments"), safeId(experimentId) + ".json"));
    return await visible(record);
  }
  async listExperiments() {
    const all = (await readAll<Experiment & OwnerTag>("experiments")) as Experiment[];
    return all.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async saveReview(record: MarketingReview) {
    const owned = await stampOwner(record);
    await atomicWrite(path.join(await groupDir("reviews"), owned.reviewId + ".json"), owned);
    return owned;
  }
  async listReviews(filter?: { experimentId?: string; creativeId?: string }) {
    const all = (await readAll<MarketingReview & OwnerTag>("reviews")) as MarketingReview[];
    const filtered = all.filter((item) => {
      if (filter?.experimentId && item.experimentId !== filter.experimentId) return false;
      if (filter?.creativeId && !item.creativeIds.includes(filter.creativeId)) return false;
      return true;
    });
    return filtered.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
}

export const marketingLearningStore: MarketingLearningStore = new FileMarketingLearningStore();

export async function learningDataRoot() {
  return path.join(await ensureCommerceImageDataRoot(), "learning");
}

async function groupDir(group: "creatives" | "performance" | "experiments" | "reviews") {
  const dir = path.join(await learningDataRoot(), group);
  await mkdir(dir, { recursive: true, mode: 0o700 });
  return dir;
}

async function readJson<T>(filePath: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(filePath, "utf8")) as T;
  } catch {
    return null;
  }
}

async function readAll<T>(group: "creatives" | "performance" | "experiments" | "reviews"): Promise<T[]> {
  const dir = await groupDir(group);
  let names: string[] = [];
  try {
    names = await readdir(dir);
  } catch {
    return [];
  }
  const items = await Promise.all(names.filter((name) => name.endsWith(".json")).map((name) => readJson<T & OwnerTag>(path.join(dir, name))));
  const nonNull = items.filter((item) => item !== null) as (T & OwnerTag)[];
  const scope = await ownershipScope();
  if (scope.kind === "system") return nonNull as T[];
  return nonNull.filter((item) => recordVisibleToScope(item.userId, scope)) as T[];
}

/** 写入前打上当前登录用户归属标记；桌面端/后台上下文没有标记（保留原值）。 */
async function stampOwner<T>(record: T): Promise<T> {
  const owner = await ownershipStamp();
  if (!owner) return record;
  const tagged = record as OwnerTag;
  return { ...record, userId: tagged.userId ?? owner } as T;
}

/** 读取单条时检查归属；不可见视同不存在。 */
async function visible<T>(record: T | null): Promise<T | null> {
  if (!record) return null;
  const scope = await ownershipScope();
  if (scope.kind === "system") return record;
  const owner = (record as OwnerTag).userId;
  return recordVisibleToScope(owner, scope) ? record : null;
}

async function atomicWrite(filePath: string, value: unknown) {
  const temp = filePath + "." + Date.now() + ".tmp";
  await writeFile(temp, JSON.stringify(value, null, 2), { encoding: "utf8", mode: 0o600 });
  await rename(temp, filePath);
}

function safeId(value: string) {
  return String(value).replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 120);
}

export function learningRootHint() {
  return commerceImageDataRoot();
}
