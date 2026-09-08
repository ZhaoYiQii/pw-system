"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Menu } from "lucide-react";
import { MODULE_ICONS } from "./icons";
import {
  getMerchantModule,
  getVisibleNavGroups,
  MERCHANT_ROLE_META,
  MERCHANT_ROLES,
  type MerchantModuleId,
  type MerchantRole,
} from "./modules";
import { useMerchantRole } from "./role-context";

const CONSOLE_BASE = "/merchant-console";

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
  const { role, setRole } = useMerchantRole();
  const [menuOpen, setMenuOpen] = useState(false);

  const moduleId = moduleIdFromPath(pathname);
  const currentModule = getMerchantModule(moduleId);
  const navGroups = useMemo(() => getVisibleNavGroups(role), [role]);
  const roleMeta = MERCHANT_ROLE_META[role];

  useEffect(() => {
    setMenuOpen(false);
  }, [pathname]);

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
              <strong>陪玩门店</strong>
              <small>STORE CONSOLE</small>
            </span>
          </Link>

          <div className="mc-store">
            <i aria-hidden="true" />
            <div>
              <b>南城 · 壹号店</b>
              <span>
                营业中 · <em>{roleMeta.label} 视角</em>
              </span>
            </div>
          </div>

          <div className="mc-rolepick">
            <div className="mc-rolepick-label">原型 · 切换角色</div>
            <div className="mc-rolepick-list">
              {MERCHANT_ROLES.map((candidate) => (
                <button
                  key={candidate}
                  type="button"
                  className="mc-rolebtn"
                  aria-pressed={role === candidate}
                  onClick={() => setRole(candidate as MerchantRole)}
                >
                  {MERCHANT_ROLE_META[candidate].label}
                </button>
              ))}
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
              宁
            </span>
            <span>
              <b>宁宁</b>
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
              <span>南城 · 壹号店</span>
              <b aria-current="page">{currentModule?.label ?? "工作台"}</b>
            </div>
            <div className="mc-top-actions">
              <span className="mc-mode-chip">原型演示 · P0 · 未接后端</span>
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
