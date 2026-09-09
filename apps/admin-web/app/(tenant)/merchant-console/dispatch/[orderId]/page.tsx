import { notFound } from "next/navigation";
import { ModuleGate } from "@/app/_lib/merchant-console/module-gate";
import { OrderDetailView } from "@/app/_lib/merchant-console/order-detail";

export default async function MerchantOrderDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ orderId: string }>;
  searchParams?: Promise<{ kind?: string }>;
}) {
  const { orderId } = await params;
  const query: { kind?: string } | null = searchParams
    ? await searchParams
    : null;
  if (!orderId) notFound();
  const kind =
    query?.kind === "GD" || query?.kind === "CLASSIC" ? query.kind : null;
  return (
    <ModuleGate moduleId="dispatch">
      <OrderDetailView orderId={orderId} kind={kind} />
    </ModuleGate>
  );
}
