import { notFound } from "next/navigation";
import { ModuleGate } from "@/app/_lib/merchant-console/module-gate";
import { getRecordModule } from "@/app/_lib/merchant-console/record-data";
import { RecordDetailView } from "@/app/_lib/merchant-console/record-detail-view";

export default async function MerchantRecordDetailPage({
  params,
}: {
  params: Promise<{ module: string; recordId: string }>;
}) {
  const { module, recordId } = await params;
  const config = getRecordModule(module);

  if (!config) {
    notFound();
  }

  const row = config.rows.find((item) => item.id === recordId);
  if (!row) {
    notFound();
  }

  return (
    <ModuleGate moduleId={config.id}>
      <RecordDetailView moduleId={config.id} recordId={row.id} />
    </ModuleGate>
  );
}
