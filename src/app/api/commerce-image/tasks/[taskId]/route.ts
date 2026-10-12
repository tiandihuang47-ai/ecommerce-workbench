import { denyIfUnauthenticated } from "@/lib/auth/guard";
import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { isCommerceImageModel, isCommerceImageOutputRatio } from "@/lib/commerce-image-models";
import { getCommerceImageTask, saveCommerceImageTask, toPublicCommerceImageTask } from "@/lib/commerce-image-store";
import { recoverStalledCommerceImageTask } from "@/lib/commerce-image-runner";
import type { CommerceImageMarketingStrategy, CommerceImageQuality, CommerceImagePanel, CommerceImageRetouchOperation, CommerceImageStoryboard, CommerceImageStoryboardCard, CommerceImageStoryboardRole, CommerceImageTextLayer } from "@/lib/commerce-image-types";

export const runtime = "nodejs";

export async function GET(request: Request, context: { params: Promise<{ taskId: string }> }) {
  const deny = await denyIfUnauthenticated(request);
  if (deny) return deny;
  const { taskId } = await context.params;
  const task = await getCommerceImageTask(taskId);
  if (!task) return failure("生图项目不存在。", 404);
  const recovered = await recoverStalledCommerceImageTask(task);
  return NextResponse.json({ success: true, task: toPublicCommerceImageTask(recovered) });
}

export async function PATCH(request: Request, context: { params: Promise<{ taskId: string }> }) {
  const deny = await denyIfUnauthenticated(request);
  if (deny) return deny;
  const { taskId } = await context.params;
  const task = await getCommerceImageTask(taskId);
  if (!task) return failure("生图项目不存在。", 404);
  if (task.status === "planning" || task.status === "queued" || task.status === "generating") return failure("AI 正在处理项目，暂时不能修改。", 409);
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return failure("请求体必须是合法 JSON。 ");
  }
  const ratio = body.ratio === undefined ? task.ratio : isCommerceImageOutputRatio(body.ratio) ? body.ratio : task.ratio;
  if (ratio === "original" && task.kind !== "retouch") return failure("仅商品修图支持保持原尺寸。 ");
  let panels = Array.isArray(body.panels) ? mergePanels(task.panels, body.panels) : task.panels;
  if (isRecord(body.panelOperation)) panels = applyPanelOperation(panels, body.panelOperation);
  const brand = recordValue(body.brandProfile);
  const brief = recordValue(body.brief);
  const publish = recordValue(body.publishPackage);
  const storyboardInput = recordValue(body.storyboard);
  const generationSetCount = body.generationSetCount === 2 || body.generationSetCount === 4 ? body.generationSetCount : body.generationSetCount === 1 ? 1 : task.generationSetCount;
  const model = isCommerceImageModel(body.model) ? body.model : task.model;
  const quality = typeof body.quality === "string" && ["standard", "high", "ultra"].includes(body.quality) ? body.quality as CommerceImageQuality : task.quality;
  const strategy = strategyValue(brief.strategy, task.brief.strategy);
  const cardCount = integerValue(
    brief.cardCount,
    task.brief.cardCount,
    1,
    task.kind === "detail_page" ? 12 : task.kind === "retouch" ? 1 : 10
  );
  let storyboard = task.kind === "xiaohongshu_post" && task.storyboard
    ? mergeStoryboard(task.storyboard, storyboardInput, panels)
    : task.storyboard;
  if (task.kind === "xiaohongshu_post" && storyboard) {
    const synced = syncStoryboardPanels(storyboard, panels);
    storyboard = synced.storyboard;
    panels = synced.panels;
  }
  const storyboardChanged = JSON.stringify(storyboard) !== JSON.stringify(task.storyboard);
  const requiresReapproval = ratio !== task.ratio || model !== task.model || generationSetCount !== task.generationSetCount
    || strategy !== task.brief.strategy || cardCount !== task.brief.cardCount
    || ["audience", "sellingPoints", "scene", "style", "extra"].some((key) => typeof brief[key] === "string" && brief[key] !== task.brief[key as keyof typeof task.brief])
    || Boolean(body.panelOperation) || storyboardChanged;
  const selectedSetId = typeof body.selectedSetId === "string" && task.generationSets.some((set) => set.id === body.selectedSetId) ? body.selectedSetId : task.selectedSetId;
  if (selectedSetId !== task.selectedSetId) {
    panels = panels.map((panel) => {
      const version = [...panel.versions].reverse().find((item) => item.setId === selectedSetId);
      return version ? { ...panel, selectedVersionId: version.id, status: "completed" as const } : { ...panel, selectedVersionId: "", status: "draft" as const };
    });
  }
  /* 任务比例是唯一真源：改比例时同步所有面板，否则「重新生成某一张」会继续用旧比例出图
   * （实测就是 9:16 任务里出现 2048×1536 的 4:3 图，看起来像被拉伸）。 */
  if (ratio !== task.ratio) {
    panels = panels.map((panel) => ({ ...panel, ratio }));
  }
  const saved = await saveCommerceImageTask({
    ...task,
    title: stringValue(body.title, task.title, 160),
    model,
    quality,
    ratio,
    generationSetCount,
    selectedSetId,
    brandProfile: {
      ...task.brandProfile,
      brandName: stringValue(brand.brandName, task.brandProfile.brandName, 160),
      primaryColor: colorValue(brand.primaryColor, task.brandProfile.primaryColor),
      secondaryColor: colorValue(brand.secondaryColor, task.brandProfile.secondaryColor),
      fontStyle: stringValue(brand.fontStyle, task.brandProfile.fontStyle, 160),
      styleNotes: stringValue(brand.styleNotes, task.brandProfile.styleNotes, 2000)
    },
    brief: {
      ...task.brief,
      audience: stringValue(brief.audience, task.brief.audience),
      sellingPoints: stringValue(brief.sellingPoints, task.brief.sellingPoints),
      scene: stringValue(brief.scene, task.brief.scene),
      style: stringValue(brief.style, task.brief.style),
      extra: stringValue(brief.extra, task.brief.extra, 4000),
      strategy,
      cardCount,
      retouchOperation: retouchOperationValue(brief.retouchOperation, task.brief.retouchOperation)
    },
    panels,
    storyboard: requiresReapproval && storyboard
      ? { ...storyboard, status: "needs_revision", confirmedAt: "", updatedAt: new Date().toISOString() }
      : storyboard,
    publishPackage: {
      ...task.publishPackage,
      title: stringValue(publish.title, task.publishPackage.title, 500),
      body: stringValue(publish.body, task.publishPackage.body, 10000),
      tags: stringArray(publish.tags, task.publishPackage.tags, 30),
      complianceWarnings: task.publishPackage.complianceWarnings
    },
    approvedAt: requiresReapproval ? "" : task.approvedAt,
    approvedPlanRevision: requiresReapproval ? 0 : task.approvedPlanRevision,
    planRevision: requiresReapproval ? task.planRevision + 1 : task.planRevision,
    generationSets: generationSetCount !== task.generationSetCount ? [] : task.generationSets,
    status: requiresReapproval && panels.length ? "awaiting_approval" : task.status
  });
  return NextResponse.json({ success: true, task: toPublicCommerceImageTask(saved) });
}

function mergeStoryboard(existing: CommerceImageStoryboard, input: Record<string, unknown>, panels: CommerceImagePanel[]): CommerceImageStoryboard {
  if (!Object.keys(input).length) return existing;
  const bible = recordValue(input.visualBible);
  const inputCards = Array.isArray(input.cards) ? input.cards.filter(isRecord) : existing.cards;
  const cards = inputCards.map((card, index): CommerceImageStoryboardCard => {
    const fallback = existing.cards[index] || existing.cards.at(-1);
    return {
      id: stringValue(card.id, fallback?.id || `commerce_image_story_card_${randomUUID()}`, 120),
      order: index,
      role: storyboardRole(card.role, fallback?.role || storyRoleForIndex(index, Math.max(panels.length, inputCards.length))),
      title: stringValue(card.title, fallback?.title || panels[index]?.title || `第 ${index + 1} 张`, 100),
      purpose: stringValue(card.purpose, fallback?.purpose || panels[index]?.description || "围绕主题继续讲故事。", 600),
      visual: stringValue(card.visual, fallback?.visual || panels[index]?.description || "真实商品画面。", 900),
      copyIntent: stringValue(card.copyIntent, fallback?.copyIntent || panels[index]?.overlay.title || "以真实资料为准", 240)
    };
  });
  return {
    ...existing,
    theme: stringValue(input.theme, existing.theme, 160),
    audience: stringValue(input.audience, existing.audience, 160),
    emotionalHook: stringValue(input.emotionalHook, existing.emotionalHook, 120),
    summary: stringValue(input.summary, existing.summary, 800),
    visualBible: {
      ...existing.visualBible,
      productAnchor: stringValue(bible.productAnchor, existing.visualBible.productAnchor, 400),
      colorMood: stringValue(bible.colorMood, existing.visualBible.colorMood, 300),
      photography: stringValue(bible.photography, existing.visualBible.photography, 300),
      typography: stringValue(bible.typography, existing.visualBible.typography, 300),
      scene: stringValue(bible.scene, existing.visualBible.scene, 300),
      subjectRule: stringValue(bible.subjectRule, existing.visualBible.subjectRule, 400),
      referenceAssetIds: Array.isArray(bible.referenceAssetIds) ? stringArray(bible.referenceAssetIds, existing.visualBible.referenceAssetIds, 16) : existing.visualBible.referenceAssetIds
    },
    cards: cards.length ? cards : existing.cards
  };
}

function syncStoryboardPanels(storyboard: CommerceImageStoryboard, panels: CommerceImagePanel[]) {
  if (!panels.length) return { storyboard, panels };
  const usedCardIds = new Set<string>();
  const cards = panels.map((panel, index): CommerceImageStoryboardCard => {
    const source = storyboard.cards.find((card) => card.id === panel.storyboardCardId) || storyboard.cards[index];
    let id = panel.storyboardCardId || source?.id || `commerce_image_story_card_${randomUUID()}`;
    if (usedCardIds.has(id)) id = `commerce_image_story_card_${randomUUID()}`;
    usedCardIds.add(id);
    return {
      id,
      order: index,
      role: source?.role || storyRoleForIndex(index, panels.length),
      title: source?.title || panel.title || `第 ${index + 1} 张`,
      purpose: source?.purpose || panel.description || "围绕主题继续讲故事。",
      visual: source?.visual || panel.description || "真实商品画面。",
      copyIntent: source?.copyIntent || panel.overlay.title || "以真实资料为准"
    };
  });
  const synchronizedPanels = panels.map((panel, index) => ({ ...panel, storyboardCardId: cards[index].id, order: index }));
  return { storyboard: { ...storyboard, cards }, panels: synchronizedPanels };
}

function storyRoleForIndex(index: number, count: number): CommerceImageStoryboardRole {
  if (index === 0) return "cover_hook";
  if (count === 2 && index === 1) return "outfit_closing";
  if (index === 1) return "scene_context";
  if (index === count - 1) return "outfit_closing";
  if (index === 2) return "fact_proof";
  return "highlight";
}

function storyboardRole(value: unknown, fallback: CommerceImageStoryboardRole): CommerceImageStoryboardRole {
  return ["cover_hook", "scene_context", "fact_proof", "outfit_closing", "highlight"].includes(String(value)) ? value as CommerceImageStoryboardRole : fallback;
}

function mergePanels(existing: CommerceImagePanel[], input: unknown[]) {
  const byId = new Map(input.filter(isRecord).map((item) => [String(item.id || ""), item]));
  const order = new Map(input.filter(isRecord).map((item, index) => [String(item.id || ""), index]));
  const reorderAll = existing.length > 0 && existing.every((panel) => order.has(panel.id));
  return existing.map((panel) => {
    const patch = byId.get(panel.id);
    if (!patch) return panel;
    const overlay = recordValue(patch.overlay);
    const selectedVersionId = typeof patch.selectedVersionId === "string" && panel.versions.some((version) => version.id === patch.selectedVersionId)
      ? patch.selectedVersionId
      : panel.selectedVersionId;
    return {
      ...panel,
      title: stringValue(patch.title, panel.title, 160),
      description: stringValue(patch.description, panel.description, 2000),
      prompt: stringValue(patch.prompt, panel.prompt, 12000),
      ratio: isCommerceImageOutputRatio(patch.ratio) ? patch.ratio : panel.ratio,
      imageFit: patch.imageFit === "contain" ? "contain" : patch.imageFit === "cover" ? "cover" : panel.imageFit,
      selectedVersionId,
      order: typeof patch.order === "number" ? patch.order : reorderAll && order.has(panel.id) ? order.get(panel.id) : panel.order,
      textLayers: Array.isArray(patch.textLayers) ? mergeTextLayers(panel.textLayers, patch.textLayers) : panel.textLayers,
      overlay: {
        ...panel.overlay,
        visible: typeof overlay.visible === "boolean" ? overlay.visible : panel.overlay.visible,
        title: stringValue(overlay.title, panel.overlay.title, 500),
        body: stringValue(overlay.body, panel.overlay.body, 1200),
        textColor: colorValue(overlay.textColor, panel.overlay.textColor),
        accentColor: colorValue(overlay.accentColor, panel.overlay.accentColor),
        position: overlay.position === "bottom" ? "bottom" : overlay.position === "top" ? "top" : panel.overlay.position,
        align: overlay.align === "center" ? "center" : overlay.align === "left" ? "left" : panel.overlay.align
      }
    };
  }).sort((a, b) => (a.order || 0) - (b.order || 0)).map((panel, index) => ({ ...panel, order: index }));
}

function mergeTextLayers(existing: CommerceImageTextLayer[], input: unknown[]) {
  const byId = new Map(input.filter(isRecord).map((item) => [String(item.id || ""), item]));
  return existing.map((layer) => {
    const patch = byId.get(layer.id);
    if (!patch) return layer;
    const weights = [400, 500, 600, 700, 800, 900] as const;
    return {
      ...layer,
      name: stringValue(patch.name, layer.name, 80),
      text: stringValue(patch.text, layer.text, 1200),
      x: numberValue(patch.x, layer.x, 0, 0.98),
      y: numberValue(patch.y, layer.y, 0, 0.98),
      width: numberValue(patch.width, layer.width, 0.02, 1),
      height: numberValue(patch.height, layer.height, 0.02, 1),
      fontFamily: patch.fontFamily === "serif" || patch.fontFamily === "rounded" ? patch.fontFamily : patch.fontFamily === "sans" ? "sans" : layer.fontFamily,
      fontSize: numberValue(patch.fontSize, layer.fontSize, 0.012, 0.2),
      fontWeight: weights.includes(patch.fontWeight as typeof weights[number]) ? patch.fontWeight as typeof weights[number] : layer.fontWeight,
      lineHeight: numberValue(patch.lineHeight, layer.lineHeight, 0.8, 2),
      color: colorValue(patch.color, layer.color),
      backgroundColor: colorValue(patch.backgroundColor, layer.backgroundColor),
      backgroundOpacity: numberValue(patch.backgroundOpacity, layer.backgroundOpacity, 0, 1),
      align: patch.align === "center" || patch.align === "right" || patch.align === "left" ? patch.align : layer.align,
      visible: typeof patch.visible === "boolean" ? patch.visible : layer.visible,
      locked: typeof patch.locked === "boolean" ? patch.locked : layer.locked
    };
  });
}

function applyPanelOperation(panels: CommerceImagePanel[], operation: Record<string, unknown>) {
  const panelId = typeof operation.panelId === "string" ? operation.panelId : "";
  const index = panels.findIndex((panel) => panel.id === panelId);
  if (index < 0) return panels;
  const type = operation.type;
  const next = [...panels];
  if (type === "delete" && panels.length > 1) next.splice(index, 1);
  if (type === "move_up" && index > 0) [next[index - 1], next[index]] = [next[index], next[index - 1]];
  if (type === "move_down" && index < next.length - 1) [next[index], next[index + 1]] = [next[index + 1], next[index]];
  if (type === "duplicate") next.splice(index + 1, 0, { ...panels[index], id: `commerce_image_panel_${randomUUID()}`, title: `${panels[index].title}（拆分）`, versions: [], selectedVersionId: "", status: "draft", textLayers: panels[index].textLayers.map((layer) => ({ ...layer, id: `commerce_image_text_${randomUUID()}` })) });
  if (type === "merge_next" && index < next.length - 1) {
    const following = next[index + 1];
    next[index] = { ...next[index], title: `${next[index].title} + ${following.title}`.slice(0, 160), description: `${next[index].description}；${following.description}`.slice(0, 2000), textLayers: [...next[index].textLayers, ...following.textLayers.map((layer) => ({ ...layer, id: `commerce_image_text_${randomUUID()}` }))] };
    next.splice(index + 1, 1);
  }
  return next.map((panel, orderIndex) => ({ ...panel, order: orderIndex }));
}

function retouchOperationValue(value: unknown, fallback: CommerceImageRetouchOperation) {
  const allowed: CommerceImageRetouchOperation[] = ["white_background", "transparent_background", "change_scene", "remove_clutter", "light_color", "upscale", "crop", "batch_consistency"];
  return allowed.includes(value as CommerceImageRetouchOperation) ? value as CommerceImageRetouchOperation : fallback;
}

function stringArray(value: unknown, fallback: string[], max: number) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string").map((item) => item.trim()).filter(Boolean).slice(0, max) : fallback;
}

function strategyValue(value: unknown, fallback: CommerceImageMarketingStrategy) {
  const allowed = ["auto", "pain_point", "contrast", "scenario", "emotion", "listicle", "evidence", "custom_skill"] as const;
  return allowed.includes(value as typeof allowed[number]) ? value as typeof allowed[number] : fallback;
}

function integerValue(value: unknown, fallback: number, min: number, max: number) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.round(Math.min(max, Math.max(min, number))) : fallback;
}

function numberValue(value: unknown, fallback: number, min: number, max: number) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : fallback;
}

function colorValue(value: unknown, fallback: string) {
  return typeof value === "string" && /^#[0-9a-fA-F]{6}$/.test(value) ? value : fallback;
}

function stringValue(value: unknown, fallback = "", max = 2000) {
  return typeof value === "string" ? value.trim().slice(0, max) : fallback;
}

function recordValue(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function failure(message: string, status = 400) {
  return NextResponse.json({ success: false, code: "TASK_ERROR", category: "validation", retryable: false, message }, { status });
}
