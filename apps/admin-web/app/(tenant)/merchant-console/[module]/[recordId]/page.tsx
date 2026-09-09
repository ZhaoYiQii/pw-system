import { notFound } from "next/navigation";
import { ModuleGate } from "@/app/_lib/merchant-console/module-gate";
import { getMerchantModule } from "@/app/_lib/merchant-console/modules";
import { RecordDetailView } from "@/app/_lib/merchant-console/record-detail-view";

export default async function MerchantRecordDetailPage({
  params,
}: {
  params: Promise<{ module: string; recordId: string }>;
}) {
  const { module, recordId } = await params;
  const meta = getMerchantModule(module);

  if (!meta) {
    notFound();
  }

  return (
    <ModuleGate moduleId={meta.id}>
      <RecordDetailView moduleId={meta.id} recordId={recordId} />
    </ModuleGate>
  );
}
