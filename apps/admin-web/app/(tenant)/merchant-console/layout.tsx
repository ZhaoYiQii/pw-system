"use client";

import type { ReactNode } from "react";
import { MerchantRoleProvider } from "@/app/_lib/merchant-console/role-context";
import { MerchantShell } from "@/app/_lib/merchant-console/merchant-shell";
import { DemoStoreProvider } from "@/app/_lib/merchant-console/demo-store";

export default function MerchantConsoleLayout({
  children,
}: {
  children: ReactNode;
}) {
  return (
    <DemoStoreProvider>
      <MerchantRoleProvider>
        <MerchantShell>{children}</MerchantShell>
      </MerchantRoleProvider>
    </DemoStoreProvider>
  );
}
