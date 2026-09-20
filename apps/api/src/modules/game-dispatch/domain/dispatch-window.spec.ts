/**
 * P3 / D4：报名窗口与关单窗口的单一配置源（设计规格 §7）。
 *
 * 背景：`publish` 与 `releaseSlot` 原先各自硬编码 10 分钟报名窗口，而无人报名自动关单
 * 默认 5 分钟——订单会在报名窗口还剩 5 分钟时被系统取消（口径冲突）。
 * 这里把两个窗口收敛成纯函数，便于单测边界，也避免再次漂移。
 */
import { describe, expect, it } from "vitest";
import {
  DEFAULT_ROUND_WINDOW_MS,
  MAX_ROUND_WINDOW_MS,
  MIN_ROUND_WINDOW_MS,
  resolveNoApplicationTimeoutMs,
  resolveRoundWindowMs,
} from "./dispatch-window.js";

describe("P3 / D4：报名窗口与关单窗口配置解析", () => {
  it("常量与规格一致（默认 10 分钟，范围 1–120 分钟）", () => {
    expect(DEFAULT_ROUND_WINDOW_MS).toBe(600_000);
    expect(MIN_ROUND_WINDOW_MS).toBe(60_000);
    expect(MAX_ROUND_WINDOW_MS).toBe(7_200_000);
  });

  it("未配置或非法值 → 回退默认 10 分钟", () => {
    expect(resolveRoundWindowMs({})).toBe(600_000);
    expect(resolveRoundWindowMs({ DISPATCH_ROUND_WINDOW_MS: "" })).toBe(
      600_000,
    );
    expect(resolveRoundWindowMs({ DISPATCH_ROUND_WINDOW_MS: "abc" })).toBe(
      600_000,
    );
    expect(resolveRoundWindowMs({ DISPATCH_ROUND_WINDOW_MS: "-1" })).toBe(
      600_000,
    );
    expect(resolveRoundWindowMs({ DISPATCH_ROUND_WINDOW_MS: "NaN" })).toBe(
      600_000,
    );
  });

  it("越界（<1 分钟 或 >120 分钟）→ 回退默认", () => {
    expect(resolveRoundWindowMs({ DISPATCH_ROUND_WINDOW_MS: "59000" })).toBe(
      600_000,
    );
    expect(resolveRoundWindowMs({ DISPATCH_ROUND_WINDOW_MS: "7200001" })).toBe(
      600_000,
    );
  });

  it("范围内的合法值原样生效（含边界）", () => {
    expect(resolveRoundWindowMs({ DISPATCH_ROUND_WINDOW_MS: "60000" })).toBe(
      60_000,
    );
    expect(resolveRoundWindowMs({ DISPATCH_ROUND_WINDOW_MS: "120000" })).toBe(
      120_000,
    );
    expect(resolveRoundWindowMs({ DISPATCH_ROUND_WINDOW_MS: "7200000" })).toBe(
      7_200_000,
    );
  });

  it("关单窗口未配置 → 跟随报名窗口（默认与自定义都跟）", () => {
    expect(resolveNoApplicationTimeoutMs({})).toBe(600_000);
    expect(
      resolveNoApplicationTimeoutMs({ DISPATCH_ROUND_WINDOW_MS: "120000" }),
    ).toBe(120_000);
  });

  it("关单窗口显式配置可覆盖报名窗口；显式 0 表示关闭该规则", () => {
    expect(
      resolveNoApplicationTimeoutMs({
        DISPATCH_ROUND_WINDOW_MS: "120000",
        DISPATCH_NO_APPLICATION_TIMEOUT_MS: "60000",
      }),
    ).toBe(60_000);
    expect(
      resolveNoApplicationTimeoutMs({
        DISPATCH_NO_APPLICATION_TIMEOUT_MS: "0",
      }),
    ).toBe(0);
  });

  it("关单窗口显式值非法 → 视为未配置（回退到报名窗口）", () => {
    expect(
      resolveNoApplicationTimeoutMs({
        DISPATCH_ROUND_WINDOW_MS: "120000",
        DISPATCH_NO_APPLICATION_TIMEOUT_MS: "-5",
      }),
    ).toBe(120_000);
    expect(
      resolveNoApplicationTimeoutMs({
        DISPATCH_ROUND_WINDOW_MS: "120000",
        DISPATCH_NO_APPLICATION_TIMEOUT_MS: "oops",
      }),
    ).toBe(120_000);
  });
});
