import { SetMetadata } from "@nestjs/common";

export const IS_PUBLIC_KEY = "pw:isPublic";
export const REQUIRED_SCOPE_KEY = "pw:requiredScope";
export const REQUIRED_PERMISSIONS_KEY = "pw:requiredPermissions";

/** 显式公开路由（主规格 7.2.1：默认所有 API 需要认证，公开路由必须显式标记）。 */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

/** 仅平台 token 可访问（audience=pw-platform）。 */
export const PlatformScope = () => SetMetadata(REQUIRED_SCOPE_KEY, "platform");

/** 仅门店 token 可访问（audience=pw-tenant 且携带 tenantId）。 */
export const TenantScope = () => SetMetadata(REQUIRED_SCOPE_KEY, "tenant");

/** 要求调用方角色具备全部列出的 PermissionKey，否则 403（配合 PermissionGuard）。 */
export const Permissions = (...permissions: string[]) =>
  SetMetadata(REQUIRED_PERMISSIONS_KEY, permissions);
