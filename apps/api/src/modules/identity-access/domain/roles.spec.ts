import { describe, expect, it } from "vitest";
import {
  ROLE_KEYS,
  ROLE_PRIORITY,
  permissionsForAny,
  sortRolesByPriority,
} from "./roles.js";

describe("ROLE_PRIORITY", () => {
  it("恰好覆盖全部角色键且无重复", () => {
    expect([...ROLE_PRIORITY].sort()).toEqual([...ROLE_KEYS].sort());
    expect(new Set(ROLE_PRIORITY).size).toBe(ROLE_PRIORITY.length);
  });

  it("CUSTOMER 先于 PLAYER（默认落地老板端）", () => {
    expect(ROLE_PRIORITY.indexOf("CUSTOMER")).toBeLessThan(
      ROLE_PRIORITY.indexOf("PLAYER"),
    );
  });

  it("管理类角色先于 CUSTOMER", () => {
    for (const role of [
      "PLATFORM_SUPER_ADMIN",
      "PLATFORM_SUPPORT",
      "TENANT_OWNER",
      "TENANT_ADMIN",
      "CUSTOMER_SERVICE",
      "FINANCE",
    ] as const) {
      expect(ROLE_PRIORITY.indexOf(role)).toBeLessThan(
        ROLE_PRIORITY.indexOf("CUSTOMER"),
      );
    }
  });
});

describe("sortRolesByPriority", () => {
  it("把多角色排成确定顺序，首元素即主角色", () => {
    expect(sortRolesByPriority(["PLAYER", "CUSTOMER"])).toEqual([
      "CUSTOMER",
      "PLAYER",
    ]);
  });

  it("排序与输入顺序无关", () => {
    expect(sortRolesByPriority(["PLAYER", "CUSTOMER"])).toEqual(
      sortRolesByPriority(["CUSTOMER", "PLAYER"]),
    );
  });

  it("管理类角色排在 CUSTOMER 之前", () => {
    expect(sortRolesByPriority(["PLAYER", "CUSTOMER", "TENANT_OWNER"])[0]).toBe(
      "TENANT_OWNER",
    );
  });

  it("丢弃未知角色值", () => {
    expect(sortRolesByPriority(["NOT_A_ROLE", "PLAYER"])).toEqual(["PLAYER"]);
  });

  it("空输入返回空数组", () => {
    expect(sortRolesByPriority([])).toEqual([]);
  });
});

describe("permissionsForAny", () => {
  it("返回并集：老板 + 陪玩同时拿到两端的权限", () => {
    const granted = permissionsForAny(["CUSTOMER", "PLAYER"]);
    expect(granted).toContain("order.manage"); // 仅 CUSTOMER 有
    expect(granted).toContain("dispatch.manage"); // 仅 PLAYER 有
    expect(granted).toContain("dispute.view.own"); // 两者都有
  });

  it("单角色等价于 permissionsFor", () => {
    expect([...permissionsForAny(["PLAYER"])].sort()).toEqual(
      [
        "dispatch.manage",
        "dispute.view.own",
        "session.manage",
        "tenant.view",
      ].sort(),
    );
  });

  it("空角色集返回空权限（fail-closed）", () => {
    expect(permissionsForAny([])).toEqual([]);
  });
});
