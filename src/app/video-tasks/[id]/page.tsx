import { VideoTaskDetailPage } from "@/components/production-modules";

export default async function VideoTaskDetailRoute({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <VideoTaskDetailPage taskId={id} />;
}
