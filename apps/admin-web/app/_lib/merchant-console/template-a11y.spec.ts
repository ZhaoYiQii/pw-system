import { describe, expect, it } from "vitest";
import {
  addComponent,
  addSection,
  insertPreset,
  moveComponent,
  moveSection,
  type DraftConfigV2,
} from "./template-draft-state";
import {
  announceIssue,
  announceOrderChange,
  componentOrderIsStable,
  focusSelectorAfterMove,
} from "./template-a11y";

const EMPTY: DraftConfigV2 = {
  schemaVersion: 2,
  sections: [],
  components: [],
  staffingSource: { kind: "FIXED", count: 1 },
};

describe("template-a11y：键盘顺序与焦点契约", () => {
  it("组件顺序不变量：数组顺序与 sortOrder 一致，且每个区块从 0 连续编号", () => {
    const section = addSection(EMPTY, { label: "下单信息", columns: 2 });
    if (!section.ok) throw new Error("addSection failed");
    const first = addComponent(section.config, "FIELD", section.stableKey);
    if (!first.ok) throw new Error("first failed");
    const second = addComponent(first.config, "NOTE", section.stableKey);
    if (!second.ok) throw new Error("second failed");

    expect(componentOrderIsStable(second.config)).toBe(true);
    const moved = moveComponent(second.config, second.stableKey, "up");
    expect(componentOrderIsStable(moved)).toBe(true);
    expect(moved.components.map((component) => component.stableKey)).toEqual([
      second.stableKey,
      first.stableKey,
    ]);

    // 人为打乱：数组顺序与 sortOrder 不一致 → 不可视为稳定
    const broken: DraftConfigV2 = {
      ...moved,
      components: [...moved.components].reverse(),
    };
    expect(componentOrderIsStable(broken)).toBe(false);
  });

  it("区块顺序不变量：移动区块后仍然连续", () => {
    const first = addSection(EMPTY, { label: "A", columns: 1 });
    if (!first.ok) throw new Error("first failed");
    const second = addSection(first.config, { label: "B", columns: 1 });
    if (!second.ok) throw new Error("second failed");

    const moved = moveSection(second.config, second.stableKey, "up");
    expect(componentOrderIsStable(moved)).toBe(true);
    expect(moved.sections.map((section) => section.label)).toEqual(["B", "A"]);
  });

  it("键盘移动后焦点回到同一个按钮（选择器契约）", () => {
    expect(focusSelectorAfterMove("component", "abc", "up")).toBe(
      '[data-component-key="abc"] button[data-action="move-up"]',
    );
    expect(focusSelectorAfterMove("component", "abc", "down")).toBe(
      '[data-component-key="abc"] button[data-action="move-down"]',
    );
    expect(focusSelectorAfterMove("section", "base", "up")).toBe(
      '[data-section-key="base"] button[data-action="move-up"]',
    );
  });

  it("播报文案包含位置与原因，供 aria-live 使用", () => {
    expect(
      announceOrderChange(
        [
          { stableKey: "a", label: "游戏模式" },
          { stableKey: "b", label: "目标段位" },
        ],
        "b",
        "up",
      ),
    ).toBe("已把「目标段位」上移到第 1 位");

    expect(
      announceIssue({
        code: "TEMPLATE_BINDING_INVALID",
        tab: "binding",
        componentKey: "player_count",
        message: "人数来源指向的组件已停用",
      }),
    ).toContain("人数来源指向的组件已停用");
    expect(
      announceIssue({
        code: "TEMPLATE_COMPONENT_INVALID",
        tab: "content",
        sectionKey: "base",
        message: "区块名称无效",
      }),
    ).toContain("区块");
  });

  it("预设插入后顺序依然稳定（键盘路径与鼠标路径同一函数）", () => {
    const section = addSection(EMPTY, { label: "下单信息", columns: 2 });
    if (!section.ok) throw new Error("addSection failed");
    const preset = insertPreset(
      section.config,
      section.stableKey,
      "STAFFING_TABLE",
    );
    if (!preset.ok) throw new Error("preset failed");
    expect(componentOrderIsStable(preset.config)).toBe(true);
  });
});
