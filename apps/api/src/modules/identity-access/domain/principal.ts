import type { RoleKey } from "./roles.js";

export type Scope = "platform" | "tenant";

export interface AccessPrincipal {
  sub: string;
  scope: Scope;
  role: RoleKey;
  username: string;
  tenantId?: string;
}
