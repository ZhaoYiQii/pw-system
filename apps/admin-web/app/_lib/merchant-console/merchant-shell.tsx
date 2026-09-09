"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { LogOut, Menu } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { apiFetch, logoutSession } from "../api";
import { MODULE_ICONS } from "./icons";
import {
  getMerchantModule,
  getVisibleNavGroups,
  MERCHANT_ROLE_META,
  type MerchantModuleId,
} from "./modules";
import { useMerchantRole } from "./role-context";

const CONSOLE_BASE = "/merchant-console";

interface EffectiveConfig {
  config: { brand?: { logoText?: string } } | null;
}

function moduleIdFromPath(pathname: string): MerchantModuleId | "work" {
  if (pathname === CONSOLE_BASE) return "work";
  if (pathname.startsWith(`${CONSOLE_BASE}/`)) {
    const candidate =
      pathname.slice(CONSOLE_BASE.length + 1).split("/")[0] ?? "";
    return (getMerchantModule(candidate)?.id ?? "work") as MerchantModuleId;
  }
  return "work";
}

export function MerchantShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { role, principal, ready, unauthorized, forbidden } =
    useMerchantRole();
  const [menuOpen, setMenuOpen] = useState(false);

  const storeQuery = useQuery({
    queryKey: ["merchant", "store-config"],
    queryFn: () => apiFetch<EffectiveConfig>("/api/v1/tenant/config"),
    enabled: ready && !unauthorized && !forbidden,
    retry: false,
  });

  const moduleId = moduleIdFromPath(pathname);
  const currentModule = getMerchantModule(moduleId);
  const navGroups = useMemo(() => getVisibleNavGroups(role), [role]);
  const roleMeta = MERCHANT_ROLE_META[role];
  const storeLabel =
    storeQuery.data?.config?.brand?.logoText?.trim() ||
    principal?.username ||
    "陪玩门店";

  useEffect(() => {
    setMenuOpen(false);
  }, [pathname]);

  if (!ready) {
    return (
      <div className="pw-merchant">
        <section className="mc-shell">
          <main className="mc-main">
            <div className="mc-inner">
              <div className="mc-loading">正在校验门店会话…</div>
            </div>
          </main>
        </section>
      </div>
    );
  }

  if (unauthorized || forbidden) {
    return (
      <section className="mc-panel mc-forbidden">
        <div className="mc-forbidden-mark" aria-hidden="true">
          {unauthorized ? "401" : "403"}
        </div>
        <h1>{unauthorized ? "尚未登录门店账号" : "非商家角色 · 无权访问"}</h1>
        <p>
          {unauthorized
            ? "商家控制台需要以店老板、店长、客服或财务角色登录。"
            : `当前会话角色无法访问商家控制台（${principal?.role ?? "-"}）。`}
        </p>
        {unauthorized ? (
          <Link href="/store/login" className="mc-btn mc-btn-primary">
            去门店登录
          </Link>
        ) : (
          <Link href="/store/login" className="mc-btn mc-btn-primary">
            重新登录
          </Link>
        )}
      </section>
    );
  }

  const logout = () => {
    void logoutSession().finally(() => router.push("/store/login"));
  };

  return (
    <div className="pw-merchant">
      <div className={`mc-app${menuOpen ? " mc-menu-open" : ""}`}>
        <aside
          id="merchant-console-sidebar"
          className="mc-sidebar"
          aria-label="商家端导航"
        >
          <Link
            href={`${CONSOLE_BASE}/work`}
            className="mc-brand"
            onClick={() => setMenuOpen(false)}
          >
            <span className="mc-mark">PW</span>
            <span>
              <strong>{storeLabel}</strong>
              <small>STORE CONSOLE</small>
            </span>
          </Link>

          <div className="mc-store">
            <i aria-hidden="true" />
            <div>
              <b>{principal?.username ?? "商家员工"}</b>
              <span>
                {roleMeta.label} · 真实角色授权
              </span>
            </div>
          </div>

          <nav className="mc-nav" aria-label="商家端模块">
            {navGroups.map((group) => (
              <div key={group.id}>
                <div className="mc-nav-label">{group.label}</div>
                {group.items.map((item) => {
                  const Icon = MODULE_ICONS[item.id];
                  const href = `${CONSOLE_BASE}/${item.id}`;
                  const active = item.id === moduleId;
                  return (
                    <Link
                      key={item.id}
                      href={href}
                      className={active ? "mc-active" : undefined}
                      aria-current={active ? "page" : undefined}
                      onClick={() => setMenuOpen(false)}
                    >
                      <Icon className="mc-icon" size={16} />
                      <span>{item.label}</span>
                    </Link>
                  );
                })}
              </div>
            ))}
          </nav>

          <div className="mc-side-foot">
            <span className="mc-avatar" aria-hidden="true">
              {principal?.username?.slice(0, 1)?.toUpperCase() ?? "商"}
            </span>
            <span>
              <b>{principal?.username ?? "-"}</b>
              <span className="mc-foot-caption">
                {roleMeta.label} · {roleMeta.desc}
              </span>
            </span>
          </div>
        </aside>

        <section className="mc-shell">
          <header className="mc-topbar">
            <button
              type="button"
              className="mc-menu-btn"
              aria-expanded={menuOpen}
              aria-controls="merchant-console-sidebar"
              onClick={() => setMenuOpen((open) => !open)}
            >
              <Menu size={17} />
              菜单
            </button>
            <div className="mc-crumb">
              <span>{storeLabel}</span>
              <b aria-current="page">{currentModule?.label ?? "工作台"}</b>
            </div>
            <div className="mc-top-actions">
              <span className="mc-mode-chip mc-mode-live">
                {roleMeta.label} · 已连接后端
              </span>
              <button
                type="button"
                className="mc-btn mc-btn-ghost mc-btn-small"
                onClick={logout}
              >
                <LogOut size={14} />
                退出
              </button>
            </div>
          </header>
          <main className="mc-main">
            <div className="mc-inner">{children}</div>
          </main>
        </section>
      </div>

      {menuOpen ? (
        <button
          type="button"
          className="mc-scrim"
          aria-label="关闭菜单"
          onClick={() => setMenuOpen(false)}
        />
      ) : null}
    </div>
  );
}
