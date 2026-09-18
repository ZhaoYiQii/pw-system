import { describe, expect, it } from "vitest";
import {
  GAME_DISPATCH_TEMPLATE_V2_FEATURE,
  isTemplateV2Enabled,
} from "./feature-flags";

describe("feature-flags：通用派单模板 v2 的租户开关", () => {
  it("未加载（undefined）按未开通处理", () => {
    expect(isTemplateV2Enabled(undefined)).toBe(false);
  });

  it("能力位里没有该 key 视为未开通（opt-in）", () => {
    expect(
      isTemplateV2Enabled([
        { featureKey: "addon.open_api", enabled: true },
        { featureKey: "core.orders", enabled: true },
      ]),
    ).toBe(false);
  });

  it("显式 enabled=false 视为未开通，enabled=true 才算开通", () => {
    expect(
      isTemplateV2Enabled([
        { featureKey: GAME_DISPATCH_TEMPLATE_V2_FEATURE, enabled: false },
      ]),
    ).toBe(false);
    expect(
      isTemplateV2Enabled([
        { featureKey: GAME_DISPATCH_TEMPLATE_V2_FEATURE, enabled: true },
      ]),
    ).toBe(true);
  });
});
