import { ModuleGate } from "@/app/_lib/merchant-console/module-gate";
import { AiAssistantView } from "@/app/_lib/merchant-console/ai-view";

export default function MerchantAiPage() {
  return (
    <ModuleGate moduleId="ai">
      <AiAssistantView />
    </ModuleGate>
  );
}
