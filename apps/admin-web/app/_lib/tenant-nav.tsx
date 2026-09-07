"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { apiFetch, clearAccessToken, getAccessToken } from "./api";
import {
  TENANT_ADDON_LINKS as ADDON_LINKS,
  TENANT_LINKS as LINKS,
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
    clearAccessToken();
    router.push("/store/login");
  };
  return (
    <nav className="topnav">
      <span className="brand">PW SaaS</span>
      {LINKS.map((l) => (
        <Link key={l.href} href={l.href}>
          {l.label}
        </Link>
      ))}
      {addonLinks.map((l) => (
        <Link key={l.href} href={l.href}>
          {l.label}
        </Link>
      ))}
      <span className="spacer" />
      <button className="btn" onClick={logout}>
        退出
      </button>
    </nav>
  );
}
