"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { apiFetch, clearAccessToken } from "./api";

interface Principal {
  sub: string;
  scope: string;
  role: string;
  username: string;
}

interface NavItem {
  href: string;
  label: string;
}

const NAV_SECTIONS: { label: string; items: NavItem[] }[] = [
  {
    label: "经营",
    items: [{ href: "/overview", label: "平台总览" }],
  },
  {
    label: "门店",
    items: [
      { href: "/tenants", label: "门店管理" },
      { href: "/onboard", label: "一键开店" },
    ],
  },
  {
    label: "商业化",
    items: [
      { href: "/packages", label: "套餐与增值功能" },
      { href: "/subscriptions", label: "订阅与用量" },
    ],
  },
  {
    label: "治理",
    items: [
      { href: "/accounts", label: "平台账号" },
      { href: "/platform/audit", label: "审计与访问" },
    ],
  },
];

const CRUMB_TITLES: Record<string, string> = {
  "/overview": "平台总览",
  "/tenants": "门店管理",
  "/onboard": "一键开店",
  "/packages": "套餐与增值功能",
  "/subscriptions": "订阅与用量",
  "/accounts": "平台账号",
  "/platform/audit": "审计与访问",
};

const ROLE_LABELS: Record<string, string> = {
  PLATFORM_SUPER_ADMIN: "超级管理员",
  PLATFORM_SUPPORT: "平台运营",
};

function isActive(href: string, pathname: string): boolean {
  if (href === "/tenants" && pathname.startsWith("/tenants/")) return true;
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function PlatformShell({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [principal, setPrincipal] = useState<Principal | null>(null);

  useEffect(() => {
    apiFetch<Principal>("/api/v1/platform/me")
      .then(setPrincipal)
      .catch(() => setPrincipal(null));
  }, []);

  const logout = () => {
    clearAccessToken();
    router.push("/login");
  };

  const crumb = CRUMB_TITLES[pathname] ?? "平台控制台";
  const roleLabel = principal?.role
    ? (ROLE_LABELS[principal.role] ?? principal.role)
    : "平台账号";

  return (
    <div className="pw-platform">
      <div className="pw-app">
        <aside className="pw-sidebar">
          <Link href="/overview" className="pw-brand">
            <span className="pw-mark">PL</span>
            <span>
              <b>陪玩门店 SaaS</b>
              <small>PLATFORM CONSOLE</small>
            </span>
          </Link>

          <nav className="pw-nav" aria-label="平台导航">
            {NAV_SECTIONS.map((section) => (
              <div key={section.label}>
                <div className="pw-nav-label">{section.label}</div>
                {section.items.map((item) => {
                  const active = isActive(item.href, pathname);
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      className={active ? "pw-active" : undefined}
                    >
                      {item.label}
                    </Link>
                  );
                })}
              </div>
            ))}
          </nav>

          <div className="pw-side-foot">
            <span className="pw-avatar">
              {principal?.username?.slice(0, 1).toUpperCase() ?? "管"}
            </span>
            <span style={{ minWidth: 0 }}>
              <b style={{ display: "block" }}>
                {principal?.username ?? "平台账号"}
              </b>
              <span>{roleLabel}</span>
            </span>
            <button
              type="button"
              className="pw-btn pw-small"
              style={{ marginLeft: "auto" }}
              onClick={logout}
            >
              退出
            </button>
          </div>
        </aside>

        <section className="pw-shell">
          <header className="pw-topbar">
            <div className="pw-crumb">
              平台控制台 / <b>{crumb}</b>
            </div>
          </header>
          <main className="pw-main">{children}</main>
        </section>
      </div>
    </div>
  );
}
