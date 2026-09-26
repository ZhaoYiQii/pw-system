// 主规格 7：固定角色与集中式权限矩阵。禁止散落魔法字符串。
export const ROLE_KEYS = [
  "PLATFORM_SUPER_ADMIN",
  "PLATFORM_SUPPORT",
  "TENANT_OWNER",
  "TENANT_ADMIN",
  "CUSTOMER_SERVICE",
  "FINANCE",
  "PLAYER",
  "CUSTOMER",
] as const;

export type RoleKey = (typeof ROLE_KEYS)[number];

export const PERMISSION_KEYS = [
  "platform.manage",
  "platform.support",
  "tenant.manage",
  "tenant.view",
  "catalog.manage",
  "customer.manage",
  "player.manage",
  "order.manage",
  "dispatch.manage",
  "session.manage",
  "finance.manage",
  "settlement.manage",
  "dispute.manage",
  "dispute.view.own",
  "gameDispatch.manage",
  "gameDispatch.create",
  "gamePricing.manage",
  "gameTemplate.view",
  "gameTemplate.edit",
  "gameTemplate.publish",
  "gameTemplate.archive",
  "audit.view",
  "report.view",
  "ai.view",
] as const;

export type PermissionKey = (typeof PERMISSION_KEYS)[number];

// 第一期最小权限矩阵；随业务切片（Slice 3-11）扩充，必须集中维护。
export const ROLE_PERMISSIONS: Record<RoleKey, readonly PermissionKey[]> = {
  PLATFORM_SUPER_ADMIN: [
    "platform.manage",
    "platform.support",
    "tenant.manage",
    "tenant.view",
    "audit.view",
  ],
  PLATFORM_SUPPORT: ["platform.support", "tenant.view", "audit.view"],
  TENANT_OWNER: [
    "tenant.manage",
    "tenant.view",
    "catalog.manage",
    "customer.manage",
    "player.manage",
    "order.manage",
    "dispatch.manage",
    "session.manage",
    "finance.manage",
    "settlement.manage",
    "dispute.manage",
    "gameDispatch.manage",
    "gameDispatch.create",
    "gamePricing.manage",
    "gameTemplate.view",
    "gameTemplate.edit",
    "gameTemplate.publish",
    "gameTemplate.archive",
    "report.view",
    "audit.view",
  ],
  TENANT_ADMIN: [
    "tenant.view",
    "catalog.manage",
    "customer.manage",
    "player.manage",
    "gameDispatch.manage",
    "gameDispatch.create",
    "gamePricing.manage",
    "gameTemplate.view",
    "gameTemplate.edit",
    "gameTemplate.publish",
    "gameTemplate.archive",
    "report.view",
  ],
  CUSTOMER_SERVICE: [
    "tenant.view",
    "customer.manage",
    "order.manage",
    "dispatch.manage",
    "session.manage",
    "dispute.manage",
    "gameDispatch.manage",
    "gameDispatch.create",
    "gameTemplate.view",
  ],
  FINANCE: [
    "tenant.view",
    "finance.manage",
    "settlement.manage",
    "report.view",
  ],
  PLAYER: [
    "tenant.view",
    "session.manage",
    "dispatch.manage",
    "dispute.view.own",
  ],
  CUSTOMER: [
    "tenant.view",
    "order.manage",
    "dispute.manage",
    "dispute.view.own",
  ],
};

export function permissionsFor(role: RoleKey): readonly PermissionKey[] {
  return ROLE_PERMISSIONS[role] ?? [];
}

/**
 * 多角色账号的主角色优先级（ADR-0009 决定 7，2026-09-26 用户确认）：
 * 管理类角色在前，CUSTOMER 先于 PLAYER —— 老板端是所有账号的基线落地面，
 * 陪玩端是叠加态，只在账号持有 PLAYER 时才能切入。
 */
export const ROLE_PRIORITY: readonly RoleKey[] = [
  "PLATFORM_SUPER_ADMIN",
  "PLATFORM_SUPPORT",
  "TENANT_OWNER",
  "TENANT_ADMIN",
  "CUSTOMER_SERVICE",
  "FINANCE",
  "CUSTOMER",
  "PLAYER",
];

/** 过滤未知角色值并按 ROLE_PRIORITY 升序排列；首元素即默认落地端的主角色。 */
export function sortRolesByPriority(roles: readonly string[]): RoleKey[] {
  const known = roles.filter((role): role is RoleKey =>
    (ROLE_KEYS as readonly string[]).includes(role),
  );
  return [...known].sort(
    (a, b) => ROLE_PRIORITY.indexOf(a) - ROLE_PRIORITY.indexOf(b),
  );
}

/** 多角色的有效权限 = 各角色权限集的并集（ADR-0009 决定四 C）。 */
export function permissionsForAny(
  roles: readonly RoleKey[],
): readonly PermissionKey[] {
  const granted = new Set<PermissionKey>();
  for (const role of roles) {
    for (const permission of permissionsFor(role)) granted.add(permission);
  }
  return [...granted];
}
