"use client";

import { useQuery } from "@tanstack/react-query";
import {
  createContext,
  useContext,
  useMemo,
  type ReactNode,
} from "react";
import { apiFetch } from "../api";
import { type MerchantRole } from "./modules";

export interface MerchantPrincipal {
  sub: string;
  username: string;
  role: string;
  tenantId?: string;
  scope?: string;
}

export interface MerchantRoleContextValue {
  role: MerchantRole;
  principal: MerchantPrincipal | null;
  ready: boolean;
  unauthorized: boolean;
  forbidden: boolean;
  loginHref: string;
  setRole: (role: MerchantRole) => void;
}

const ROLE_MAP: Record<string, MerchantRole> = {
  TENANT_OWNER: "OWNER",
  TENANT_ADMIN: "ADMIN",
  CUSTOMER_SERVICE: "CS",
  FINANCE: "FINANCE",
};

const MerchantRoleContext = createContext<MerchantRoleContextValue | null>(
  null,
);

export function MerchantRoleProvider({ children }: { children: ReactNode }) {
  const meQuery = useQuery({
    queryKey: ["merchant", "me"],
    queryFn: () => apiFetch<MerchantPrincipal>("/api/v1/tenant/me"),
    retry: false,
  });

  const principal = meQuery.data ?? null;
  const rawRole = principal?.role ?? "";
  const role: MerchantRole = ROLE_MAP[rawRole] ?? "OWNER";
  const is401 =
    meQuery.isError &&
    meQuery.error instanceof Error &&
    (meQuery.error as { status?: number }).status === 401;
  const unauthorized = Boolean(is401);
  const forbidden = principal !== null && !(rawRole in ROLE_MAP);
  const ready = meQuery.isSuccess || meQuery.isError;

  const value = useMemo<MerchantRoleContextValue>(
    () => ({
      role,
      principal,
      ready,
      unauthorized,
      forbidden,
      loginHref: "/store/login",
      setRole: () => {
        /* 角色来自后端会话，不允许前端切换。 */
      },
    }),
    [role, principal, ready, unauthorized, forbidden],
  );

  return (
    <MerchantRoleContext.Provider value={value}>
      {children}
    </MerchantRoleContext.Provider>
  );
}

export function useMerchantRole(): MerchantRoleContextValue {
  const ctx = useContext(MerchantRoleContext);
  if (!ctx) {
    throw new Error(
      "useMerchantRole 必须在 MerchantRoleProvider 内使用（merchant-console layout）",
    );
  }
  return ctx;
}
