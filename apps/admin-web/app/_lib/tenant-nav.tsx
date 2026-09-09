"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { apiFetch, getAccessToken, logoutSession } from "./api";
import {
  TENANT_ADDON_LINKS as ADDON_LINKS,
  tenantNavGroupsWithAddons,
} from "./tenant-links";

export function TenantNav() {
  const router = useRouter();
  const [addonLinks, setAddonLinks] = useState<
    Array<{ featureKey: string; href: string; label: string }>
  >([]);

  useEffect(() => {
    const token = getAccessToken();
    if (!token) return;
    void apiFetch<Array<{ featureKey: string; enabled: boolean }>>(
      "/api/v1/tenant/features",
    )
      .then((features) => {
        const enabled = new Set(
          features.filter((f) => f.enabled).map((f) => f.featureKey),
        );
        setAddonLinks(ADDON_LINKS.filter((l) => enabled.has(l.featureKey)));
      })
      .catch(() => {
        setAddonLinks([]);
      });
  }, []);

  const logout = () => {
    void logoutSession().finally(() => router.push("/store/login"));
  };
  return (
    <header className="sticky top-0 z-10 border-b bg-white">
      <div className="mx-auto flex max-w-[1440px] items-center gap-4 px-5 py-3">
        <span className="whitespace-nowrap font-semibold">PW SaaS</span>
        <nav className="flex min-w-0 flex-1 items-center gap-4 overflow-x-auto text-sm">
          {tenantNavGroupsWithAddons(addonLinks).map((group) => (
            <div
              key={group.id}
              className="flex items-center gap-2 border-r pr-3 last:border-r-0"
            >
              <span className="text-xs text-muted-foreground">
                {group.label}
              </span>
              {group.items.map((link) => (
                <Link
                  key={link.href}
                  href={link.href}
                  className="whitespace-nowrap text-muted-foreground transition-colors hover:text-foreground"
                >
                  {link.label}
                </Link>
              ))}
            </div>
          ))}
        </nav>
        <Button variant="outline" size="sm" onClick={logout}>
          退出
        </Button>
      </div>
    </header>
  );
}
