import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { permissionsFor } from "../../modules/identity-access/domain/roles.js";
import { REQUIRED_PERMISSIONS_KEY } from "./decorators.js";
import type { AuthenticatedRequest } from "./auth.guard.js";

/**
 * 基于角色→权限矩阵的细粒度授权（主规格 7.2：前端隐藏按钮不是授权，后端必须重复检查）。
 * Reflector 仅包装 Reflect metadata，按调用即时创建，避免 @UseGuards 的 DI 解析差异。
 * 无 principal（未认证）时不在此拦截——由全局 AuthGuard 统一返回 401。
 */
@Injectable()
export class PermissionsGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const reflector = new Reflector();
    const required = reflector.getAllAndOverride<string[] | undefined>(REQUIRED_PERMISSIONS_KEY, [
      context.getHandler(),
      context.getClass()
    ]);
    if (!required || required.length === 0) return true;

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const principal = request.principal;
    if (!principal) return true;
    const granted = permissionsFor(principal.role);
    const missing = required.filter((key) => !granted.includes(key as never));
    if (missing.length > 0) throw new ForbiddenException(`missing permissions: ${missing.join(",")}`);
    return true;
  }
}
