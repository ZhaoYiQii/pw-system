"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { MerchantRoleProvider } from "@/app/_lib/merchant-console/role-context";
import { MerchantShell } from "@/app/_lib/merchant-console/merchant-shell";

export default function MerchantConsoleLayout({
  children,
}: {
  children: ReactNode;
}) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: { staleTime: 15_000, retry: 1, refetchOnWindowFocus: false },
        },
      }),
  );
  return (
    <QueryClientProvider client={queryClient}>
      <MerchantRoleProvider>
        <MerchantShell>{children}</MerchantShell>
      </MerchantRoleProvider>
    </QueryClientProvider>
  );
}
