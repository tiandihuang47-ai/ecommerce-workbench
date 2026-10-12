import { ScriptDetailPage } from "@/components/simple-modules";

export default async function ScriptDetailRoute({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ScriptDetailPage scriptId={id} />;
}
