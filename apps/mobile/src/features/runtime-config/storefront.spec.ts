import { describe, expect, it } from "vitest";
import { parseStorefrontConfigPayload } from "./storefront";

const okConfig = {
  schemaVersion: "v1",
  brand: {
    primaryColor: "#2f54eb",
    accentColor: "#fa8c16",
    logoText: "演示店",
    borderRadius: 8,
  },
  storefront: { allowCustomerSelection: true, showServiceDuration: true },
};

describe("runtime-config storefront parse（品牌 token 防御性解析）", () => {
  it("active + 合法配置 → ok，读取品牌 token", () => {
    const result = parseStorefrontConfigPayload({
      state: "active",
      tenant: { id: "t1", code: "demo", name: "演示门店" },
      version: 3,
      config: okConfig,
    });
    expect(result.state).toBe("ok");
    expect(result.brand?.primaryColor).toBe("#2f54eb");
    expect(result.brand?.logoText).toBe("演示店");
    expect(result.storefront?.showServiceDuration).toBe(true);
    expect(result.version).toBe(3);
  });

  it("非 hex 颜色 → config_error，不猜测默认值", () => {
    const result = parseStorefrontConfigPayload({
      state: "active",
      config: {
        ...okConfig,
        brand: { ...okConfig.brand, primaryColor: "red" },
      },
    });
    expect(result.state).toBe("config_error");
    expect(result.brand).toBeNull();
  });

  it("storefront 布尔缺失 → config_error", () => {
    const result = parseStorefrontConfigPayload({
      state: "active",
      config: { ...okConfig, storefront: { allowCustomerSelection: true } },
    });
    expect(result.state).toBe("config_error");
  });

  it("logoText 超长/空 → config_error", () => {
    const long = parseStorefrontConfigPayload({
      state: "active",
      config: {
        ...okConfig,
        brand: { ...okConfig.brand, logoText: "x".repeat(41) },
      },
    });
    expect(long.state).toBe("config_error");
    const empty = parseStorefrontConfigPayload({
      state: "active",
      config: { ...okConfig, brand: { ...okConfig.brand, logoText: "   " } },
    });
    expect(empty.state).toBe("config_error");
  });

  it("inactive / config_error / 未知状态映射正确", () => {
    expect(parseStorefrontConfigPayload({ state: "inactive" }).state).toBe(
      "inactive",
    );
    expect(
      parseStorefrontConfigPayload({ state: "config_error", version: 2 }).state,
    ).toBe("config_error");
    expect(parseStorefrontConfigPayload({ state: "weird" }).state).toBe(
      "error",
    );
    expect(parseStorefrontConfigPayload(null).state).toBe("error");
    expect(parseStorefrontConfigPayload("x").state).toBe("error");
  });
});
