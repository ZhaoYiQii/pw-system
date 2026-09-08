import { describe, expect, it } from "vitest";
import {
  canAccessModule,
  getVisibleNavGroups,
  MERCHANT_MODULES,
  MERCHANT_ROLES,
} from "./modules";

describe("merchant navigation and UI permission mock", () => {
  it("keeps 17 registered modules across four roles", () => {
    expect(MERCHANT_MODULES).toHaveLength(17);
    expect(MERCHANT_ROLES).toEqual(["OWNER", "ADMIN", "CS", "FINANCE"]);
  });

  it("keeps role-visible module counts aligned with the approved demo matrix", () => {
    const counts = Object.fromEntries(
      MERCHANT_ROLES.map((role) => [
        role,
        getVisibleNavGroups(role).flatMap((group) => group.items).length,
      ]),
    );
    expect(counts).toEqual({
      OWNER: 17,
      ADMIN: 15,
      CS: 9,
      FINANCE: 10,
    });
  });

  it("hides settings from ADMIN and keeps audit read-only visible to FINANCE", () => {
    expect(canAccessModule("ADMIN", "settings")).toBe(false);
    expect(canAccessModule("ADMIN", "audit")).toBe(false);
    expect(canAccessModule("FINANCE", "audit")).toBe(true);
    expect(canAccessModule("CS", "finance")).toBe(false);
    expect(canAccessModule("OWNER", "settings")).toBe(true);
  });
});
