import { describe, expect, it } from "vitest";
import {
  buildDeliveryText,
  resolveDeliveryUrls,
  type OnboardDeliveryInfo,
} from "../onboard-delivery";

const INFO: OnboardDeliveryInfo = {
  tenantId: "t1",
  tenantCode: "xingchen",
  primaryHost: "xingchen.shop.17ai.club",
  tenantName: "星尘电竞",
  ownerUsername: "owner",
  ownerPassword: "Temp-123456",
  packageLabel: "基础版（30 天）",
};

describe("平台开通交付链接", () => {
  it("配置通配域时生成正式 H5 地址", () => {
    const urls = resolveDeliveryUrls(INFO, {
      wildcardRoot: "shop.17ai.club",
      consoleOrigin: "https://console.shop.17ai.club",
    });
    expect(urls.h5.href).toBe("https://xingchen.shop.17ai.club");
    expect(urls.ownerConsole.href).toBe(
      "https://console.shop.17ai.club/store/login",
    );
  });

  it("未配置通配域时使用 H5 短码直达", () => {
    const urls = resolveDeliveryUrls(INFO, {
      h5Origin: "http://localhost:3101",
      consoleOrigin: "",
    });
    expect(urls.h5.href).toBe("http://localhost:3101/?t=xingchen");
  });

  it("交付文案包含密码与关键入口，便于复制", () => {
    const urls = resolveDeliveryUrls(INFO, { h5Origin: "http://localhost:3101" });
    const text = buildDeliveryText(INFO, urls);
    expect(text).toContain("星尘电竞（xingchen）");
    expect(text).toContain("临时密码：Temp-123456");
    expect(text).toContain("H5 门面：http://localhost:3101/?t=xingchen");
  });
});
