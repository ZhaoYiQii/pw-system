"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";
import { PaymentSettingsPanel } from "../../../_lib/payments/payment-settings-panel";
import { TenantShell } from "../../../_lib/tenant-shell";

export default function PaymentsSettingsPage() {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: { staleTime: 30_000, retry: 1, refetchOnWindowFocus: false },
        },
      }),
  );
  return (
    <TenantShell>
      <h1 className="text-2xl font-semibold tracking-tight">支付设置</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        门店收款状态、子商户号登记与状态刷新。
      </p>
      <div className="mt-6">
        <QueryClientProvider client={queryClient}>
          <PaymentSettingsPanel />
        </QueryClientProvider>
      </div>
    </TenantShell>
  );
}
