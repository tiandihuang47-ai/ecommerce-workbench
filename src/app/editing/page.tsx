import { ToolWorkspace } from "@/components/tool-workspace";
import { toolDefinitions } from "@/lib/tool-config";

export default function EditingPage() {
  return <ToolWorkspace definition={toolDefinitions.editing} />;
}
