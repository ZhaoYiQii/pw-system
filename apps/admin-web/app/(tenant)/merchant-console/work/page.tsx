import { ModuleGate } from "@/app/_lib/merchant-console/module-gate";
import { WorkView } from "@/app/_lib/merchant-console/work-view";

export default function MerchantWorkPage() {
  return (
    <ModuleGate moduleId="work">
      <WorkView />
    </ModuleGate>
  );
}
