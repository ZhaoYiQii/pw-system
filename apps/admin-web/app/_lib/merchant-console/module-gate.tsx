"use client";

import Link from "next/link";
import { ShieldAlert } from "lucide-react";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import {
  canAccessModule,
  getFirstAllowedModule,
  getMerchantModule,
  MERCHANT_ROLE_META,
  type MerchantModuleId,
} from "./modules";
import { useMerchantRole } from "./role-context";

export function ModuleGate({
  moduleId,
  children,
}: {
  moduleId: MerchantModuleId;
  children: ReactNode;
}) {
  const { role } = useMerchantRole();

  if (!canAccessModule(role, moduleId)) {
    return <ForbiddenModule moduleId={moduleId} />;
  }

  return <>{children}</>;
}

function ForbiddenModule({ moduleId }: { moduleId: MerchantModuleId }) {
  const { role } = useMerchantRole();
  const roleMeta = MERCHANT_ROLE_META[role];
  const moduleLabel = getMerchantModule(moduleId)?.label ?? "该模块";
  const fallback = getFirstAllowedModule(role);

  return (
    <section className="mc-panel mc-forbidden">
      <div className="mc-forbidden-mark" aria-hidden="true">
        <ShieldAlert size={26} />
      </div>
      <h1>无权访问 · 403</h1>
      <p>
        当前为「{roleMeta.label}」角色，{moduleLabel}
        不在其导航权限内。UI
        隐藏不等于授权；接入后端后，真实访问控制仍由后端执行。
      </p>
      {fallback ? (
        <Link href={`/merchant-console/${fallback.id}`}>
          <Button variant="default">回到{fallback.label}</Button>
        </Link>
      ) : null}
    </section>
  );
}
