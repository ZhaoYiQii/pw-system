/**
 * P3 / D2：报单审批「申报时长 vs 证据计时」对照（设计规格 §5）。
 *
 * 只做展示判定：差值超过 max(10 分钟, 15% × 申报) 时高亮提示，不参与结算、不写库。
 */
import { describe, expect, it } from "vitest";
import { GAP_ABS_MINUTES, GAP_RATIO, durationGap } from "./duration-gap.js";

describe("P3 / D2：申报与证据计时差异判定", () => {
  it("阈值常量与规格一致（10 分钟 / 15%）", () => {
    expect(GAP_ABS_MINUTES).toBe(10);
    expect(GAP_RATIO).toBe(0.15);
  });

  it("正好等于绝对阈值 10 分钟 → 不告警", () => {
    // 申报 60 分钟、证据 50 分钟 → 差 10 分钟；阈值 max(10, 9) = 10
    const gap = durationGap(60, 50 * 60);
    expect(gap.deltaMinutes).toBe(10);
    expect(gap.tone).toBe("ok");
  });

  it("超过绝对阈值（10.1 分钟）→ 告警", () => {
    const gap = durationGap(60, Math.round((60 - 10.1) * 60));
    expect(gap.tone).toBe("warn");
  });

  it("申报更长或更短都按绝对值判定", () => {
    // 申报 60、证据 75 分钟 → 差 -15，阈值 max(10, 9) = 10 → 告警
    expect(durationGap(60, 75 * 60).tone).toBe("warn");
  });

  it("正好等于比例阈值（15%）→ 不告警；超过则告警", () => {
    // 申报 100 分钟：15% = 15 分钟 > 绝对阈值 10 → 阈值取 15
    expect(durationGap(100, 85 * 60).tone).toBe("ok");
    expect(durationGap(100, 84 * 60).tone).toBe("warn");
  });

  it("证据计时缺失 → unknown（界面显示「证据计时缺失」）", () => {
    const gap = durationGap(95, null);
    expect(gap.evidenceMinutes).toBeNull();
    expect(gap.deltaMinutes).toBeNull();
    expect(gap.tone).toBe("unknown");
  });

  it("申报缺失或非正数 → unknown（保护异常输入）", () => {
    expect(durationGap(null, 3600).tone).toBe("unknown");
    expect(durationGap(0, 3600).tone).toBe("unknown");
    expect(durationGap(-5, 3600).tone).toBe("unknown");
  });

  it("证据计时的秒数换算参与差值（非整分钟）", () => {
    // 申报 60 分钟、证据 1800 秒 = 30 分钟 → 差 30
    const gap = durationGap(60, 1800);
    expect(gap.evidenceMinutes).toBe(30);
    expect(gap.deltaMinutes).toBe(30);
    expect(gap.tone).toBe("warn");
  });
});
