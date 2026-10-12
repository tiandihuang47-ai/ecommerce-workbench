import { randomUUID } from "node:crypto";
import { marketingLearningStore } from "@/lib/marketing-learning/store";
import type { Experiment, LearningGoal } from "@/lib/marketing-learning/types";

/**
 * 营销实验：把一组用于比较的 Creative 放在一起（轻量分组，不是 A/B 系统）。
 * 未来问「哪种策略更有效」时，必须先有 Experiment 才知道它们本来就在同一轮比较。
 */

export interface CreateExperimentInput {
  name: string;
  productId?: string;
  platform?: string;
  goal?: LearningGoal;
  creativeIds: string[];
  notes?: string;
}

export async function createExperiment(input: CreateExperimentInput): Promise<Experiment> {
  const ids = [...new Set((input.creativeIds || []).map((item) => String(item).trim()).filter(Boolean))];
  if (ids.length < 2) throw new Error("营销实验至少需要 2 个创意才能比较。");
  const creatives = await Promise.all(ids.map((id) => marketingLearningStore.getCreative(id)));
  if (creatives.some((item) => !item)) throw new Error("实验里有找不到的创意记录，请重新选择。");
  const now = new Date().toISOString();
  const experiment: Experiment = {
    experimentId: "experiment_" + randomUUID(),
    name: input.name.trim() || "未命名营销实验",
    productId: input.productId || creatives[0]?.productId || "",
    platform: input.platform || creatives[0]?.platform || "",
    goal: input.goal || "traffic",
    creativeIds: ids,
    createdAt: now,
    notes: input.notes || ""
  };
  return marketingLearningStore.saveExperiment(experiment);
}

export async function listExperiments() {
  const experiments = await marketingLearningStore.listExperiments();
  return Promise.all(experiments.map(async (experiment) => {
    const creatives = (await Promise.all(experiment.creativeIds.map((id) => marketingLearningStore.getCreative(id)))).filter(Boolean);
    return {
      ...experiment,
      creativeCount: experiment.creativeIds.length,
      productName: creatives[0]?.productName || "",
      rawData: undefined
    };
  }));
}
