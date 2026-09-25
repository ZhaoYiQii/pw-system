"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";
import { ReconciliationPanel } from "../../../_lib/payments/reconciliation-panel";
import { TenantShell } from "../../../_lib/tenant-shell";

export default function PaymentsReconciliationPage() {
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
      <h1 className="text-2xl font-semibold tracking-tight">对账处理工作台</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        微信账单与门店账本的比对结果，以及每条差异的处理单：认领、处理、提交复核、复核关闭或带理由忽略。
      </p>
      <div className="mt-6">
        <QueryClientProvider client={queryClient}>
          <ReconciliationPanel />
        </QueryClientProvider>
      </div>
    </TenantShell>
  );
}
