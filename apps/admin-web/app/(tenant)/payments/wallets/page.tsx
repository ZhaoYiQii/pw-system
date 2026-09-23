"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";
import { WalletPanel } from "../../../_lib/payments/wallet-panel";
import { TenantShell } from "../../../_lib/tenant-shell";

export default function PaymentWalletsPage() {
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
      <h1 className="text-2xl font-semibold tracking-tight">客户钱包</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        客户余额与充值 / 退款流水（只读）。
      </p>
      <div className="mt-6">
        <QueryClientProvider client={queryClient}>
          <WalletPanel />
        </QueryClientProvider>
      </div>
    </TenantShell>
  );
}
