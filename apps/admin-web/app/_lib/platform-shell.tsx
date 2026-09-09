"use client";

import type { ComponentType, ReactNode } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  BadgePercent,
  Boxes,
  Building2,
  ChevronRight,
  ClipboardCheck,
  CreditCard,
  LayoutDashboard,
  LogOut,
  Menu,
  ShieldCheck,
  Store,
  Users,
  X,
} from "lucide-react";
import { useEffect, useState } from "react";
import { apiFetch, logoutSession } from "./api";

interface Principal {
  sub: string;
  scope: string;
  role: string;
  username: string;
}

interface NavItem {
  href: string;
  label: string;
  icon: ComponentType<{
    size?: number;
    strokeWidth?: number;
    "aria-hidden"?: boolean;
  }>;
}

const NAV_SECTIONS: { label: string; items: NavItem[] }[] = [
  {
    label: "经营",
    items: [{ href: "/overview", label: "平台总览", icon: LayoutDashboard }],
  },
  {
    label: "门店",
    items: [
      { href: "/tenants", label: "门店管理", icon: Building2 },
      { href: "/onboard", label: "一键开店", icon: Store },
    ],
  },
  {
    label: "商业化",
    items: [
      { href: "/packages", label: "套餐与增值功能", icon: Boxes },
      { href: "/subscriptions", label: "订阅与用量", icon: CreditCard },
      { href: "/billing-rules", label: "平台费率", icon: BadgePercent },
    ],
  },
  {
    label: "治理",
    items: [
      { href: "/accounts", label: "平台账号与授权", icon: Users },
      { href: "/platform/audit", label: "审计与访问", icon: ClipboardCheck },
    ],
  },
];

/** 平台运营（PLATFORM_SUPPORT）仅展示门店管理与单店审计；管理/聚合入口仅超管可见。 */
const SUPPORT_VISIBLE_HREFS = new Set(["/tenants", "/platform/audit"]);

const CRUMB_TITLES: Record<string, string> = {
  "/overview": "平台总览",
  "/tenants": "门店管理",
  "/onboard": "一键开店",
  "/packages": "套餐与增值功能",
  "/subscriptions": "订阅与用量",
  "/billing-rules": "平台费率",
  "/accounts": "平台账号与授权",
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

function Navigation({
  pathname,
  onNavigate,
  role,
}: {
  pathname: string;
  onNavigate?: () => void;
  role?: string | null;
}) {
  const sections = NAV_SECTIONS.map((section) => ({
    ...section,
    items:
      role === "PLATFORM_SUPPORT"
        ? section.items.filter((item) => SUPPORT_VISIBLE_HREFS.has(item.href))
        : section.items,
  })).filter((section) => section.items.length > 0);
  return (
    <nav className="pw-nav" aria-label="平台导航">
      {sections.map((section) => (
        <div key={section.label}>
          <div className="pw-nav-label">{section.label}</div>
          {section.items.map((item) => {
            const Icon = item.icon;
            const active = isActive(item.href, pathname);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={active ? "pw-active" : undefined}
                aria-current={active ? "page" : undefined}
                {...(onNavigate ? { onClick: onNavigate } : {})}
              >
                <Icon size={16} strokeWidth={1.8} aria-hidden />
                <span>{item.label}</span>
                {active ? (
                  <ChevronRight className="pw-nav-arrow" size={14} />
                ) : null}
              </Link>
            );
          })}
        </div>
      ))}
    </nav>
  );
}

export function PlatformShell({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [principal, setPrincipal] = useState<Principal | null>(null);
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    apiFetch<Principal>("/api/v1/platform/me")
      .then(setPrincipal)
      .catch(() => setPrincipal(null));
  }, []);

  useEffect(() => setMobileOpen(false), [pathname]);

  const logout = () => {
    void logoutSession().finally(() => router.push("/login"));
  };

  const crumb = pathname.startsWith("/tenants/")
    ? "门店详情"
    : (CRUMB_TITLES[pathname] ?? "平台控制台");
  const roleLabel = principal?.role
    ? (ROLE_LABELS[principal.role] ?? principal.role)
    : "平台账号";

  return (
    <div className="pw-platform">
      <a className="pw-skip" href="#pw-platform-main">
        跳到主要内容
      </a>
      <div className="pw-app">
        <aside className="pw-sidebar">
          <Link href="/overview" className="pw-brand">
            <span className="pw-mark">PL</span>
            <span>
              <b>陪玩门店 SaaS</b>
              <small>PLATFORM CONSOLE</small>
            </span>
          </Link>

          <Navigation pathname={pathname} role={principal?.role ?? null} />

          <div className="pw-side-foot">
            <span className="pw-avatar">
              {principal?.username?.slice(0, 1).toUpperCase() ?? "管"}
            </span>
            <span className="pw-account-copy">
              <b>{principal?.username ?? "平台账号"}</b>
              <span>{roleLabel}</span>
            </span>
            <button
              type="button"
              className="pw-icon-btn pw-side-logout"
              onClick={logout}
              aria-label="退出登录"
            >
              <LogOut size={15} />
            </button>
          </div>
        </aside>

        <section className="pw-shell">
          <header className="pw-topbar">
            <button
              type="button"
              className="pw-icon-btn pw-menu-btn"
              onClick={() => setMobileOpen(true)}
              aria-label="打开导航"
            >
              <Menu size={18} />
            </button>
            <div className="pw-crumb">
              平台控制台 <span>/</span> <b>{crumb}</b>
            </div>
            <div className="pw-top-actions">
              <span className="pw-env">
                <i /> 本地开发
              </span>
              <span className="pw-top-role">
                <ShieldCheck size={14} aria-hidden /> {roleLabel}
              </span>
            </div>
          </header>
          <main className="pw-main" id="pw-platform-main">
            {children}
          </main>
        </section>
      </div>

      {mobileOpen ? (
        <div
          className="pw-mobile-nav"
          role="dialog"
          aria-modal="true"
          aria-label="平台导航"
        >
          <button
            className="pw-mobile-backdrop"
            type="button"
            aria-label="关闭导航"
            onClick={() => setMobileOpen(false)}
          />
          <aside>
            <div className="pw-mobile-head">
              <span className="pw-mark">PL</span>
              <b>平台控制台</b>
              <button
                type="button"
                className="pw-icon-btn"
                onClick={() => setMobileOpen(false)}
                aria-label="关闭导航"
              >
                <X size={17} />
              </button>
            </div>
            <Navigation
              pathname={pathname}
              onNavigate={() => setMobileOpen(false)}
              role={principal?.role ?? null}
            />
          </aside>
        </div>
      ) : null}
    </div>
  );
}
