/**
 * 角色可见性与域视图投影（纯逻辑，只向下读注册表数据）。
 * 前端状态只控制呈现，后端授权仍是安全边界。
 */
import {
  MERCHANT_GROUPS,
  MERCHANT_MODULES,
  type MerchantGroupId,
  type MerchantModule,
  type MerchantModuleId,
  type MerchantRole,
} from "./nav-registry";
import {
  MERCHANT_FUTURE_MODULES,
  MERCHANT_NAV_CHILDREN,
  MERCHANT_NAV_DOMAINS,
  type MerchantNavDomainId,
  type MerchantNavItem,
} from "./nav-domains";

export const MERCHANT_ROLE_META: Record<
  MerchantRole,
  { label: string; desc: string }
> = {
  OWNER: { label: "店老板", desc: "全模块" },
  ADMIN: { label: "店长", desc: "经营与配置" },
  CS: { label: "客服", desc: "订单与派单" },
  FINANCE: { label: "财务", desc: "结算与风控" },
};

const ROLE_MODULE_IDS: Record<MerchantRole, readonly MerchantModuleId[]> = {
  OWNER: [
    "work",
    "ai",
    "dispatch",
    "review",
    "sessions",
    "customers",
    "players",
    "player-applications",
    "breaches",
    "catalog",
    "pricing",
    "finance",
    "settlements",
    "disputes",
    "audit",
    "overview",
    "live",
    "risk",
    "finrisk",
    "health",
    "settings",
    "payments-ledger",
    "payments-reconciliation",
    "payments-settings",
    "payments-wallets",
    "fund-ledger",
  ],
  ADMIN: [
    "work",
    "ai",
    "dispatch",
    "review",
    "sessions",
    "customers",
    "players",
    "player-applications",
    "breaches",
    "catalog",
    "pricing",
    "finance",
    "settlements",
    "disputes",
    "overview",
    "live",
    "risk",
    "finrisk",
    "health",
  ],
  CS: [
    "work",
    "ai",
    "dispatch",
    "review",
    "sessions",
    "customers",
    "players",
    "breaches",
    "disputes",
    "live",
    "risk",
  ],
  FINANCE: [
    "work",
    "dispatch",
    "review",
    "sessions",
    "finance",
    "settlements",
    "disputes",
    "audit",
    "overview",
    "risk",
    "finrisk",
    "health",
    "payments-wallets",
    "payments-ledger",
    "payments-reconciliation",
    "fund-ledger",
  ],
};

/**
 * 侧栏显示名覆盖表。模块 `label` 描述模块本身，这里描述它在侧栏里的名字；
 * 只有 `getVisibleNavDomains` 消费它，所以保持文件私有，不外扩公开面。
 */
const ACTIVE_NAV_LABELS: Partial<Record<MerchantModuleId, string>> = {
  work: "经营工作台",
  overview: "经营总览",
  live: "进行中服务",
  health: "消息与任务",
  ai: "智能助手",
  dispatch: "订单中心",
  review: "审核台",
  disputes: "售后纠纷",
  finance: "经营入账",
  settings: "门店与套餐",
};

export function canAccessModule(
  role: MerchantRole,
  moduleId: MerchantModuleId,
): boolean {
  return ROLE_MODULE_IDS[role].includes(moduleId);
}

export function getVisibleNavGroups(role: MerchantRole): Array<{
  id: MerchantGroupId;
  label: string;
  items: MerchantModule[];
}> {
  return MERCHANT_GROUPS.map((group) => ({
    id: group.id,
    label: group.label,
    items: MERCHANT_MODULES.filter(
      (item) => item.group === group.id && canAccessModule(role, item.id),
    ),
  })).filter((group) => group.items.length > 0);
}

export function getModuleDomain(
  moduleId: MerchantModuleId,
): (typeof MERCHANT_NAV_DOMAINS)[number] | undefined {
  return MERCHANT_NAV_DOMAINS.find((domain) =>
    domain.activeModuleIds.some((id) => id === moduleId),
  );
}

export function getVisibleNavDomains(role: MerchantRole): Array<{
  id: MerchantNavDomainId;
  label: string;
  description: string;
  activeItems: MerchantNavItem[];
  previewItems: MerchantNavItem[];
  plannedItems: MerchantNavItem[];
}> {
  const allowedModuleIds = new Set(ROLE_MODULE_IDS[role]);
  const moduleById = new Map(
    MERCHANT_MODULES.map((module) => [module.id, module] as const),
  );
  const ownerFutureItems =
    role === "OWNER" ? MERCHANT_FUTURE_MODULES : ([] as const);

  return MERCHANT_NAV_DOMAINS.map((domain) => {
    const activeItems = domain.activeModuleIds.flatMap((moduleId) => {
      if (!allowedModuleIds.has(moduleId)) return [];
      const module = moduleById.get(moduleId);
      if (!module) return [];
      return [
        {
          id: module.id,
          domain: domain.id,
          label: ACTIVE_NAV_LABELS[module.id] ?? module.label,
          description: module.description,
          status: "active" as const,
          moduleId: module.id,
          ...(MERCHANT_NAV_CHILDREN[module.id]
            ? { children: MERCHANT_NAV_CHILDREN[module.id] }
            : {}),
        },
      ];
    });
    const domainFutureItems = ownerFutureItems.filter(
      (item) => item.domain === domain.id,
    );

    return {
      id: domain.id,
      label: domain.label,
      description: domain.description,
      activeItems,
      previewItems: domainFutureItems.filter(
        (item) => item.status === "preview",
      ),
      plannedItems: domainFutureItems.filter(
        (item) => item.status === "planned",
      ),
    };
  }).filter(
    (domain) =>
      domain.activeItems.length > 0 ||
      domain.previewItems.length > 0 ||
      domain.plannedItems.length > 0,
  );
}

export function getFirstAllowedModule(
  role: MerchantRole,
): MerchantModule | undefined {
  return getVisibleNavGroups(role)[0]?.items[0];
}
