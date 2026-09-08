import { ModuleGate } from "@/app/_lib/merchant-console/module-gate";
import { NewOrderView } from "@/app/_lib/merchant-console/new-order-view";

export default function MerchantNewOrderPage() {
  return (
    <ModuleGate moduleId="dispatch">
      <NewOrderView />
    </ModuleGate>
  );
}
