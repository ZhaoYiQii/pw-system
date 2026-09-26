import "reflect-metadata";
import { describe, expect, it } from "vitest";
import type { ExecutionContext } from "@nestjs/common";
import { PermissionsGuard } from "./permissions.guard.js";
import { Permissions } from "./decorators.js";
import type { AccessPrincipal } from "../../modules/identity-access/domain/principal.js";

class ProbeController {
  @Permissions("dispatch.manage")
  playerOnly(): void {}

  @Permissions("order.manage")
  customerOnly(): void {}
}

function contextFor(
  handler: () => void,
  principal: AccessPrincipal | undefined,
): ExecutionContext {
  const request = { principal };
  return {
    getHandler: () => handler,
    getClass: () => ProbeController,
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
}

const base = {
  sub: "11111111-1111-4111-8111-111111111111",
  scope: "tenant",
  username: "bossone",
  tenantId: "22222222-2222-4222-8222-222222222222",
} as const;

const customerOnly: AccessPrincipal = { ...base, role: "CUSTOMER" };
const multiRole: AccessPrincipal = {
  ...base,
  role: "CUSTOMER",
  roles: ["CUSTOMER", "PLAYER"],
};

const guard = new PermissionsGuard();

describe("PermissionsGuard", () => {
  it("单 CUSTOMER 角色被拒绝 dispatch.manage", () => {
    expect(() =>
      guard.canActivate(
        contextFor(ProbeController.prototype.playerOnly, customerOnly),
      ),
    ).toThrow(/missing permissions: dispatch\.manage/);
  });

  it("roles 并集授予 PLAYER 独有权限（多角色账号）", () => {
    expect(
      guard.canActivate(
        contextFor(ProbeController.prototype.playerOnly, multiRole),
      ),
    ).toBe(true);
  });

  it("同一个多角色 principal 同时满足老板端权限", () => {
    expect(
      guard.canActivate(
        contextFor(ProbeController.prototype.customerOnly, multiRole),
      ),
    ).toBe(true);
  });

  it("无 roles 字段（旧 token）回退到 [role]：不越权", () => {
    expect(() =>
      guard.canActivate(
        contextFor(ProbeController.prototype.playerOnly, customerOnly),
      ),
    ).toThrow();
    expect(
      guard.canActivate(
        contextFor(ProbeController.prototype.customerOnly, customerOnly),
      ),
    ).toBe(true);
  });

  it("roles 为空数组时按无权限处理（fail-closed）", () => {
    const empty: AccessPrincipal = { ...base, role: "CUSTOMER", roles: [] };
    expect(() =>
      guard.canActivate(
        contextFor(ProbeController.prototype.customerOnly, empty),
      ),
    ).toThrow();
  });

  it("未认证（无 principal）时放行，由 AuthGuard 负责 401", () => {
    expect(
      guard.canActivate(
        contextFor(ProbeController.prototype.playerOnly, undefined),
      ),
    ).toBe(true);
  });
});
