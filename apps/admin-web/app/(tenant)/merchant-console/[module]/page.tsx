import { notFound } from "next/navigation";
import { ModuleView } from "@/app/_lib/merchant-console/module-view";
import { getMerchantModule } from "@/app/_lib/merchant-console/modules";

export default async function MerchantModulePage({
  params,
}: {
  params: Promise<{ module: string }>;
}) {
  const { module: moduleId } = await params;
  const meta = getMerchantModule(moduleId);

  if (!meta) {
    notFound();
  }

  return <ModuleView moduleId={meta.id} />;
}
