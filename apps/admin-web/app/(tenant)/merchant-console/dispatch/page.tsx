import { ModuleGate } from "@/app/_lib/merchant-console/module-gate";
import { DispatchListView } from "@/app/_lib/merchant-console/dispatch-view";

export default function MerchantDispatchPage() {
  return (
    <ModuleGate moduleId="dispatch">
      <DispatchListView />
    </ModuleGate>
  );
}
