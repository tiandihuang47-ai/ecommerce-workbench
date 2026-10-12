import { ToolWorkspace } from "@/components/tool-workspace";
import { toolDefinitions } from "@/lib/tool-config";

export default function InterviewPage() {
  return <ToolWorkspace definition={toolDefinitions.interview} />;
}
