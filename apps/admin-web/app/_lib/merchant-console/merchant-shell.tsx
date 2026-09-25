"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { ChevronDown, LogOut, Menu, X } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { apiFetch, logoutSession } from "../api";
import { CONSOLE_BASE } from "./console-path";
import { DOMAIN_ICONS, MODULE_ICONS } from "./icons";
import {
  getModuleDomain,
  getVisibleNavDomains,
  MERCHANT_ROLE_META,
  resolveMerchantBreadcrumb,
  type MerchantNavChild,
  type MerchantNavDomainId,
  type MerchantNavItem,
} from "./modules";
import { useMerchantRole } from "./role-context";

interface EffectiveConfig {
  config: { brand?: { logoText?: string } } | null;
}

/** 去掉 `/merchant-console` 前缀，得到面包屑解析用的 console 相对路径。 */
function consoleRelativePath(pathname: string): string {
  if (pathname === CONSOLE_BASE) return "";
  if (pathname.startsWith(`${CONSOLE_BASE}/`)) {
    return pathname.slice(CONSOLE_BASE.length + 1);
  }
  return "";
}

export function MerchantShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const breadcrumb = resolveMerchantBreadcrumb(consoleRelativePath(pathname));
  const moduleId = breadcrumb.moduleId;
  const currentDomainId = getModuleDomain(moduleId)?.id ?? "business";
  const { role, principal, ready, unauthorized, forbidden } = useMerchantRole();
  const [menuOpen, setMenuOpen] = useState(false);
  const [expandedDomain, setExpandedDomain] =
    useState<MerchantNavDomainId>(currentDomainId);
  const [expandedGroup, setExpandedGroup] = useState<string | null>(null);
  const [previewItem, setPreviewItem] = useState<MerchantNavItem | null>(null);

  const isChildActive = (href: string) =>
    pathname === href || pathname.startsWith(`${href}/`);

  /** 三级菜单命中：取匹配 href 最长的一项，避免父级把子级页面也点亮。 */
  const findActiveChildId = (
    children: readonly MerchantNavChild[],
  ): string | undefined =>
    children
      .filter((child) => isChildActive(child.href))
      .reduce<MerchantNavChild | undefined>(
        (best, child) =>
          !best || child.href.length > best.href.length ? child : best,
        undefined,
      )?.id;

  const storeQuery = useQuery({
    queryKey: ["merchant", "store-config"],
    queryFn: () => apiFetch<EffectiveConfig>("/api/v1/tenant/config"),
    enabled: ready && !unauthorized && !forbidden,
    retry: false,
  });

  const navDomains = useMemo(() => getVisibleNavDomains(role), [role]);
  const roleMeta = MERCHANT_ROLE_META[role];
  const previewDomain = previewItem
    ? navDomains.find((domain) => domain.id === previewItem.domain)
    : undefined;
  const storeLabel =
    storeQuery.data?.config?.brand?.logoText?.trim() ||
    principal?.username ||
    "陪玩门店";

  useEffect(() => {
    setMenuOpen(false);
    setExpandedDomain(currentDomainId);
    // 只在当前模块内自动展开分组：`/dispatch/audit` 的模块是 review，
    // 不该顺手把「订单中心」弹开（那会展开一个组内没有任何高亮项的面板）。
    const activeGroup = navDomains
      .flatMap((domain) => domain.activeItems)
      .find(
        (item) =>
          item.moduleId === moduleId &&
          (item.children ?? []).some(
            (child) =>
              pathname === child.href || pathname.startsWith(`${child.href}/`),
          ),
      );
    setExpandedGroup(activeGroup?.id ?? null);
  }, [currentDomainId, moduleId, navDomains, pathname]);

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
      <a className="mc-skip-link" href="#merchant-main-content">
        跳到主要内容
      </a>
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
              <span>{roleMeta.label} · 真实角色授权</span>
            </div>
          </div>

          <nav className="mc-nav" aria-label="商家端模块">
            {navDomains.map((domain) => {
              const DomainIcon = DOMAIN_ICONS[domain.id];
              const expanded = expandedDomain === domain.id;
              const panelId = `merchant-nav-${domain.id}`;
              const futureCount =
                domain.previewItems.length + domain.plannedItems.length;
              return (
                <div className="mc-nav-domain" key={domain.id}>
                  <button
                    type="button"
                    className={
                      expanded
                        ? "mc-domain-trigger is-open"
                        : "mc-domain-trigger"
                    }
                    aria-expanded={expanded}
                    aria-controls={panelId}
                    onClick={() =>
                      setExpandedDomain((current) =>
                        current === domain.id ? "business" : domain.id,
                      )
                    }
                  >
                    <DomainIcon className="mc-icon" size={17} />
                    <span className="mc-domain-copy">
                      <b>{domain.label}</b>
                      <small>{domain.description}</small>
                    </span>
                    {futureCount > 0 ? (
                      <span
                        className="mc-domain-count"
                        title={`${futureCount} 项建设能力`}
                      >
                        {futureCount}
                      </span>
                    ) : null}
                    <ChevronDown className="mc-domain-chevron" size={14} />
                  </button>

                  {expanded ? (
                    <div id={panelId} className="mc-nav-children">
                      {domain.activeItems.map((item) => {
                        const itemId = item.moduleId;
                        if (!itemId) return null;
                        const Icon = MODULE_ICONS[itemId];
                        const children = item.children ?? [];
                        if (children.length > 0) {
                          const groupOpen = expandedGroup === item.id;
                          const groupId = `merchant-nav-group-${item.id}`;
                          const activeChildId =
                            itemId === moduleId
                              ? findActiveChildId(children)
                              : undefined;
                          const childActive = activeChildId !== undefined;
                          return (
                            <div className="mc-nav-group" key={item.id}>
                              <button
                                type="button"
                                className={
                                  groupOpen
                                    ? "mc-nav-group-trigger is-open"
                                    : "mc-nav-group-trigger"
                                }
                                aria-expanded={groupOpen}
                                aria-controls={groupId}
                                onClick={() =>
                                  setExpandedGroup((current) =>
                                    current === item.id ? null : item.id,
                                  )
                                }
                              >
                                <Icon className="mc-icon" size={15} />
                                <span>{item.label}</span>
                                {childActive ? (
                                  <i
                                    className="mc-state-dot mc-state-active"
                                    title="当前所在"
                                  />
                                ) : null}
                                <ChevronDown
                                  className="mc-nav-group-chevron"
                                  size={13}
                                />
                              </button>
                              {groupOpen ? (
                                <div id={groupId} className="mc-nav-sub">
                                  {children.map((child) => {
                                    const childIsActive =
                                      child.id === activeChildId;
                                    return (
                                      <Link
                                        key={child.id}
                                        href={child.href}
                                        className={
                                          childIsActive
                                            ? "mc-active"
                                            : undefined
                                        }
                                        aria-current={
                                          childIsActive ? "page" : undefined
                                        }
                                        onClick={() => setMenuOpen(false)}
                                      >
                                        <span>{child.label}</span>
                                      </Link>
                                    );
                                  })}
                                </div>
                              ) : null}
                            </div>
                          );
                        }
                        const active = itemId === moduleId;
                        return (
                          <Link
                            key={item.id}
                            href={`${CONSOLE_BASE}/${itemId}`}
                            className={active ? "mc-active" : undefined}
                            aria-current={active ? "page" : undefined}
                            onClick={() => setMenuOpen(false)}
                          >
                            <Icon className="mc-icon" size={15} />
                            <span>{item.label}</span>
                            <i
                              className="mc-state-dot mc-state-active"
                              title="已启用"
                            />
                          </Link>
                        );
                      })}
                      {domain.previewItems.map((item) => (
                        <button
                          type="button"
                          className="mc-preview-trigger"
                          key={item.id}
                          onClick={() => setPreviewItem(item)}
                        >
                          <span>{item.label}</span>
                          <span className="mc-state-tag">预览</span>
                        </button>
                      ))}
                      {domain.plannedItems.length > 0 ? (
                        <button
                          type="button"
                          className="mc-planned-trigger"
                          onClick={() =>
                            setPreviewItem(domain.plannedItems[0] ?? null)
                          }
                        >
                          <span>规划中的功能</span>
                          <span>{domain.plannedItems.length}</span>
                        </button>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              );
            })}
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
              <b aria-current="page">{breadcrumb.label}</b>
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
          <main id="merchant-main-content" className="mc-main" tabIndex={-1}>
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

      {previewItem ? (
        <div
          className="mc-preview-backdrop"
          role="presentation"
          onClick={() => setPreviewItem(null)}
        >
          <section
            className="mc-preview-panel"
            role="dialog"
            aria-modal="true"
            aria-labelledby="merchant-preview-title"
            onClick={(event) => event.stopPropagation()}
          >
            <header>
              <div>
                <span className={`mc-preview-status is-${previewItem.status}`}>
                  {previewItem.status === "preview" ? "功能预览" : "规划中"}
                </span>
                <h2 id="merchant-preview-title">{previewItem.label}</h2>
                <p>{previewItem.description}</p>
              </div>
              <button
                type="button"
                aria-label="关闭功能预览"
                className="mc-preview-close"
                onClick={() => setPreviewItem(null)}
              >
                <X size={17} />
              </button>
            </header>

            <div className="mc-preview-notice">
              {previewItem.status === "preview"
                ? "UI 方向已经纳入当前产品，但业务尚未接入。这里不会生成订单、金额或成功结果。"
                : "该能力已进入产品路线图，完成数据、权限和接口后才会开放。"}
            </div>

            {previewDomain ? (
              <div className="mc-preview-roadmap">
                <b>{previewDomain.label} · 建设清单</b>
                {[
                  ...previewDomain.previewItems,
                  ...previewDomain.plannedItems,
                ].map((item) => (
                  <button
                    type="button"
                    className={
                      item.id === previewItem.id ? "is-current" : undefined
                    }
                    key={item.id}
                    onClick={() => setPreviewItem(item)}
                  >
                    <span>{item.label}</span>
                    <small>{item.status === "preview" ? "预览" : "规划"}</small>
                  </button>
                ))}
              </div>
            ) : null}
          </section>
        </div>
      ) : null}
    </div>
  );
}
