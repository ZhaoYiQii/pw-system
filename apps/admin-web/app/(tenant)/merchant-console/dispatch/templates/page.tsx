import { Suspense } from "react";
import { ModuleGate } from "@/app/_lib/merchant-console/module-gate";
import { TemplateManagerView } from "@/app/_lib/merchant-console/template-manager-view";

export default function MerchantDispatchTemplatesPage() {
  return (
    <ModuleGate moduleId="dispatch">
      <Suspense
        fallback={
          <p className="text-sm text-muted-foreground" role="status">
            正在加载模板管理…
          </p>
        }
      >
        <TemplateManagerView />
      </Suspense>
    </ModuleGate>
  );
}
