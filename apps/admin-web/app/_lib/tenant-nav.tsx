"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { apiFetch, clearAccessToken, getAccessToken } from "./api";

const LINKS = [
  { href: "/customers", label: "客户" },
  { href: "/orders", label: "订单" },
  { href: "/players", label: "陪玩" },
  { href: "/catalog", label: "服务目录" },
  { href: "/game-templates", label: "陪玩模板" },
  { href: "/notifications", label: "通知" },
  { href: "/audit", label: "审计" },
  { href: "/disputes", label: "争议" },
  { href: "/settings", label: "门店设置" },
  { href: "/finance", label: "财务" },
];

/** D2：仅当租户已开通对应 addon 时才显示可选入口。 */
const ADDON_LINKS: Array<{
  featureKey: string;
  href: string;
  label: string;
}> = [
  {
    featureKey: "addon.ai_requirement_parser",
    href: "/ai",
    label: "AI 需求助手",
  },
];

export function TenantNav() {
  const router = useRouter();
  const [addonLinks, setAddonLinks] = useState<typeof ADDON_LINKS>([]);

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
