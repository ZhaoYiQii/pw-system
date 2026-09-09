import { describe, expect, it } from "vitest";
import {
  CUSTOMER_UI_MODULES,
  getCustomerNavItem,
} from "../../components/customer-ui/modules";

describe("老板端 UI 模块注册表", () => {
  it("完整覆盖设计模板的 10 个界面状态", () => {
    expect(CUSTOMER_UI_MODULES.map((module) => module.id)).toEqual([
      "home",
      "orders",
      "game-order",
      "game-select",
      "order-detail",
      "wallet",
      "profile",
      "disputes",
      "dispute-create",
      "service-off",
    ]);
  });

  it("每个界面都能归属到底部四栏导航", () => {
    expect(
      CUSTOMER_UI_MODULES.every((module) => getCustomerNavItem(module.id)),
    ).toBe(true);
  });
});
