import { Badge } from "@/components/ui/badge";
import type { ProductReferenceSnapshot } from "@/lib/pipeline-types";

export function ProductReferenceCard({ product }: { product?: ProductReferenceSnapshot }) {
  if (!product) return null;

  const sellingPoint = [product.coreSellingPoints, product.secondarySellingPoints].filter(Boolean).join("；");
  const audience = [product.targetAudience, product.painPoints].filter(Boolean).join("；");
  const constraints = [product.forbiddenWords, product.forbiddenClaims].filter(Boolean).join("；");

  return (
    <div className="rounded-2xl border border-emerald-200/80 bg-emerald-50/60 p-4 dark:border-emerald-900/70 dark:bg-emerald-950/20">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-semibold text-slate-950 dark:text-slate-100">已引用产品资料：{product.name}</span>
        {product.category ? <Badge variant="secondary">{product.category}</Badge> : null}
        {product.sourceDocumentName ? <Badge variant="secondary">Word 导入</Badge> : null}
      </div>
      <div className="mt-3 grid gap-2 text-xs leading-5 text-slate-600 dark:text-slate-300">
        {sellingPoint ? <p><span className="font-medium text-slate-800 dark:text-slate-200">卖点：</span>{sellingPoint}</p> : null}
        {audience ? <p><span className="font-medium text-slate-800 dark:text-slate-200">人群与痛点：</span>{audience}</p> : null}
        {constraints ? <p><span className="font-medium text-slate-800 dark:text-slate-200">内容约束：</span>{constraints}</p> : null}
      </div>
    </div>
  );
}
