"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";
import { PaymentLedgerPanel } from "../../../_lib/payments/payment-ledger-panel";
import { TenantShell } from "../../../_lib/tenant-shell";

export default function PaymentOrdersPage() {
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
      <h1 className="text-2xl font-semibold tracking-tight">支付台账</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        客户充值支付单与人工退款登记（钱直接进门店自己的商户号）。
      </p>
      <div className="mt-6">
        <QueryClientProvider client={queryClient}>
          <PaymentLedgerPanel />
        </QueryClientProvider>
      </div>
    </TenantShell>
  );
}
