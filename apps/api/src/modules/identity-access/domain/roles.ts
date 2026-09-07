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
    "report.view",
    "audit.view",
  ],
  TENANT_ADMIN: [
    "tenant.view",
    "catalog.manage",
    "customer.manage",
    "player.manage",
    "gameDispatch.manage",
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
