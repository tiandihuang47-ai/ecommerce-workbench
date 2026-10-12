/**
 * 脚本改动的意图判定。
 *
 * 客户端用它决定「主按钮叫什么、走仿写还是重新创作」，服务端用它决定提示词里的执行强度，
 * 两边共用一份，避免按钮说的和后端做的不一致。
 *
 * 核心约定：**只有用户明确说「重写 / 重新创作 / 另起 / 不用管原稿」，才允许改变原稿结构**；
 * 其余情况一律保留原结构、信息顺序与信息量。
 */

export type ScriptEditIntent = "adapt" | "polish" | "replace_product" | "partial" | "rewrite";

export function detectScriptIntent(instruction: string): ScriptEditIntent {
  const text = String(instruction || "");
  if (/换(成|到)?(我|我们)的?产品|替换产品|改成我的产品|换成.*产品|产品换/.test(text)) return "replace_product";
  if (/重写|重新写|重新创作|重新组织|重构|推翻|换一个完全|彻底改|另起|从零|不用管原稿|不用管原|不要照(这个|原)结构|不要沿用/.test(text)) return "rewrite";
  if (/仿写|照着|模仿|按这个|按原稿|按原结构|结构不变|同样的结构|套用|同款结构|根据这份逐字稿|基于这份逐字稿|根据原稿|基于原稿/.test(text)) return "adapt";
  if (/这一段|这一句|这句话|某一段|开头|结尾|前\s*\d+\s*秒|前几秒|最后一句|只改/.test(text)) return "partial";
  return "polish";
}

export const intentDirective: Record<ScriptEditIntent, string> = {
  adapt: "意图=仿写：保留原稿的结构、节奏、信息顺序和表达逻辑，换一套自己的说法；不要新增或删除关键信息，不要照抄原句。",
  polish: "意图=优化：保留原结构和全部信息，只把语言变得更口语、更顺、更抓人；不要重排结构，不要删信息。",
  replace_product: "意图=换产品：保持原结构和表达逻辑，把产品、卖点、场景、人群替换成【当前产品资料】里的真实信息；资料里没有的参数一律不写。",
  partial: "意图=局部修改：只改用户点名的那一部分，其余内容原样保留，不要顺手改别的地方。",
  rewrite: "意图=重写：可以重新组织结构，但必须保留原稿的核心信息和真实事实，不要编造。"
};
