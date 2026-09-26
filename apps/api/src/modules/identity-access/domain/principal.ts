import type { RoleKey } from "./roles.js";

export type Scope = "platform" | "tenant";

export interface AccessPrincipal {
  sub: string;
  scope: Scope;
  role: RoleKey;
  /**
   * 账号持有的全部角色，按 ROLE_PRIORITY 排列，优先级最高者在前，其值等于 role。
   * 可选：旧 token 不含此 claim，校验后保持 undefined，授权层回退到 [role]。
   */
  roles?: readonly RoleKey[];
  username: string;
  tenantId?: string;
}
