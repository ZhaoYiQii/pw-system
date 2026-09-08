"use client";

import {
  createContext,
  useCallback,
  useContext,
  useLayoutEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { MERCHANT_ROLES, type MerchantRole } from "./modules";

interface MerchantRoleContextValue {
  role: MerchantRole;
  setRole: (role: MerchantRole) => void;
}

const MerchantRoleContext = createContext<MerchantRoleContextValue | null>(
  null,
);

const ROLE_QUERY_VALUES = MERCHANT_ROLES as readonly string[];

export function MerchantRoleProvider({ children }: { children: ReactNode }) {
  const [role, setRole] = useState<MerchantRole>("OWNER");

  useLayoutEffect(() => {
    if (typeof window === "undefined") return;
    const roleParam = new URLSearchParams(window.location.search).get("role");
    if (
      typeof roleParam === "string" &&
      ROLE_QUERY_VALUES.includes(roleParam)
    ) {
      setRole(roleParam as MerchantRole);
    }
  }, []);

  const changeRole = useCallback((nextRole: MerchantRole) => {
    setRole(nextRole);
  }, []);

  const value = useMemo(
    () => ({ role, setRole: changeRole }),
    [role, changeRole],
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
