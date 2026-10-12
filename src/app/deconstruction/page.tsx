import { Suspense } from "react";
import { ReplicaWorkbenchPage } from "@/components/replica-workbench-page";

export default function DeconstructionPage() {
  return (
    <Suspense fallback={<div className="min-h-[60vh]" />}>
      <ReplicaWorkbenchPage />
    </Suspense>
  );
}
