import { notFound } from "next/navigation";
import { ModuleGate } from "@/app/_lib/merchant-console/module-gate";
import { OrderDetailView } from "@/app/_lib/merchant-console/order-detail";

export default async function MerchantOrderDetailPage({
  params,
}: {
  params: Promise<{ orderId: string }>;
}) {
  const { orderId } = await params;
  if (!/^\d+$/.test(orderId)) {
    notFound();
  }
  return (
    <ModuleGate moduleId="dispatch">
      <OrderDetailView orderId={orderId} />
    </ModuleGate>
  );
}
