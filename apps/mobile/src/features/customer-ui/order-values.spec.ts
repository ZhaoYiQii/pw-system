import { describe, expect, it } from "vitest";
import {
  collectOrderValues,
  missingRequiredLabels,
  type OrderConfigLike,
} from "./order-values";

function config(overrides: Partial<OrderConfigLike> = {}): OrderConfigLike {
  return {
    sections: [
      { stableKey: "basic", label: "基本信息", enabled: true, sortOrder: 0 },
      { stableKey: "extra", label: "补充信息", enabled: true, sortOrder: 1 },
    ],
    components: [
      {
        kind: "FIELD",
        stableKey: "memo",
        sectionKey: "basic",
        label: "备注",
        enabled: true,
        sortOrder: 0,
        fieldType: "TEXT",
        required: true,
      },
      {
        kind: "FIELD",
        stableKey: "mode",
        sectionKey: "basic",
        label: "模式",
        enabled: true,
        sortOrder: 1,
        fieldType: "SINGLE_SELECT",
        required: true,
        options: [
          { value: "ranked", label: "排位", priceDeltaFen: "1500" },
          { value: "normal", label: "匹配" },
        ],
      },
      {
        kind: "NOTE",
        stableKey: "notice",
        sectionKey: "basic",
        label: "须知",
        enabled: true,
        sortOrder: 2,
        text: "开打后不支持改人数",
      },
    ],
    staffingSource: { kind: "FIXED", count: 1 },
    ...overrides,
  };
}

describe("collectOrderValues：草稿值 → 提交体", () => {
  it("值类型按服务端口径转换：文本去空格、选择取选项值、空值不提交", () => {
    const result = collectOrderValues(config(), {
      memo: "  上分  ",
      mode: "ranked",
      notice: "不该被提交",
    });

    expect(result.errors).toEqual([]);
    expect(result.values).toEqual({ memo: "上分", mode: "ranked" });
  });

  it("只收集启用区块内启用组件的值（停用区块 / 停用组件都不提交）", () => {
    const base = config();
    const result = collectOrderValues(
      {
        ...base,
        sections: [
          {
            stableKey: "basic",
            label: "基本信息",
            enabled: true,
            sortOrder: 0,
          },
          {
            stableKey: "extra",
            label: "补充信息",
            enabled: false,
            sortOrder: 1,
          },
        ],
        components: [
          ...base.components,
          {
            kind: "FIELD",
            stableKey: "disabled_in_active_section",
            sectionKey: "basic",
            label: "已停用",
            enabled: false,
            sortOrder: 3,
            fieldType: "TEXT",
            required: false,
          },
          {
            kind: "FIELD",
            stableKey: "in_disabled_section",
            sectionKey: "extra",
            label: "停用区块里的字段",
            enabled: true,
            sortOrder: 4,
            fieldType: "TEXT",
            required: true,
          },
        ],
      },
      {
        memo: "备注",
        mode: "normal",
        disabled_in_active_section: "不进提交体",
        in_disabled_section: "也不进提交体",
      },
    );

    expect(result.values).toEqual({ memo: "备注", mode: "normal" });
    // 停用区块里的"必填"不该拦住客户（V-10）
    expect(
      missingRequiredLabels(config(), { memo: "备注", mode: "normal" }),
    ).toEqual([]);
  });

  it("必填缺失与选项越界都会给出可读错误，且不进入提交体", () => {
    const missing = collectOrderValues(config(), { mode: "ranked" });
    expect(missing.errors).toEqual(["请填写 备注"]);
    expect(missing.values).toEqual({ mode: "ranked" });

    const badOption = collectOrderValues(config(), {
      memo: "备注",
      mode: "not-in-options",
    });
    expect(badOption.errors).toEqual(["模式 的值不在模板选项中"]);
    expect(badOption.values).toEqual({ memo: "备注" });
  });

  it("多选按选项值数组提交，重复选择被拦下", () => {
    const multi = config();
    const withMulti: OrderConfigLike = {
      ...multi,
      components: [
        ...multi.components.slice(0, 2),
        {
          kind: "FIELD",
          stableKey: "extras",
          sectionKey: "basic",
          label: "附加服务",
          enabled: true,
          sortOrder: 3,
          fieldType: "MULTI_SELECT",
          required: false,
          options: [
            { value: "voice", label: "语音" },
            { value: "video", label: "视频" },
          ],
        },
      ],
    };

    const ok = collectOrderValues(withMulti, {
      memo: "备注",
      mode: "ranked",
      extras: ["voice", "video"],
    });
    expect(ok.errors).toEqual([]);
    expect(ok.values.extras).toEqual(["voice", "video"]);

    const duplicated = collectOrderValues(withMulti, {
      memo: "备注",
      mode: "ranked",
      extras: ["voice", "voice"],
    });
    expect(duplicated.errors).toEqual(["附加服务 不能重复选择同一选项"]);
  });

  it("数字与金额：NUMBER 转数字、MONEY_FEN 用整数分字符串", () => {
    const withNumbers = config();
    const base: OrderConfigLike = {
      ...withNumbers,
      components: [
        ...withNumbers.components.slice(0, 2),
        {
          kind: "FIELD",
          stableKey: "rounds",
          sectionKey: "basic",
          label: "局数",
          enabled: true,
          sortOrder: 3,
          fieldType: "NUMBER",
          required: false,
        },
        {
          kind: "FIELD",
          stableKey: "budget",
          sectionKey: "basic",
          label: "预算",
          enabled: true,
          sortOrder: 4,
          fieldType: "MONEY_FEN",
          required: false,
        },
      ],
    };

    const ok = collectOrderValues(base, {
      memo: "备注",
      mode: "ranked",
      rounds: "3",
      budget: "1500",
    });
    expect(ok.errors).toEqual([]);
    expect(ok.values).toEqual({
      memo: "备注",
      mode: "ranked",
      rounds: 3,
      budget: "1500",
    });

    const bad = collectOrderValues(base, {
      memo: "备注",
      mode: "ranked",
      rounds: "三局",
      budget: "15.00",
    });
    expect(bad.errors).toEqual(["局数 必须是数字", "预算 必须是非负整数分"]);
  });

  it("DATETIME：接受「2026-09-19 20:00」并提交带时区的 ISO", () => {
    const withTime = config();
    const base: OrderConfigLike = {
      ...withTime,
      components: [
        ...withTime.components.slice(0, 2),
        {
          kind: "FIELD",
          stableKey: "start_at",
          sectionKey: "basic",
          label: "开打时间",
          enabled: true,
          sortOrder: 3,
          fieldType: "DATETIME",
          required: true,
        },
      ],
    };

    const ok = collectOrderValues(base, {
      memo: "备注",
      mode: "ranked",
      start_at: "2026-09-19 20:00",
    });
    expect(ok.errors).toEqual([]);
    expect(String(ok.values.start_at)).toMatch(
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/,
    );

    const bad = collectOrderValues(base, {
      memo: "备注",
      mode: "ranked",
      start_at: "今晚八点",
    });
    expect(bad.errors).toEqual(["开打时间 需要时间，例如 2026-09-19 20:00"]);
  });
});

describe("人数表格：可重复表格的提交口径", () => {
  function tableConfig(): OrderConfigLike {
    return {
      sections: [
        { stableKey: "basic", label: "基本信息", enabled: true, sortOrder: 0 },
      ],
      components: [
        {
          kind: "REPEATABLE_TABLE",
          stableKey: "roster",
          sectionKey: "basic",
          label: "岗位与人数",
          enabled: true,
          sortOrder: 0,
          columns: [
            {
              stableKey: "position",
              label: "位置",
              columnType: "TEXT",
              required: true,
            },
            {
              stableKey: "count",
              label: "人数",
              columnType: "NUMBER",
              required: true,
            },
          ],
        },
      ],
      staffingSource: {
        kind: "REPEATABLE_TABLE_SUM",
        componentKey: "roster",
        columnKey: "count",
      },
    };
  }

  it("数量列提交数字、空行丢弃、文本去空格", () => {
    const result = collectOrderValues(tableConfig(), {
      roster: [
        { position: " 打野 ", count: "1" },
        { position: "", count: "" },
        { position: "辅助", count: "2" },
      ],
    });

    expect(result.errors).toEqual([]);
    expect(result.values.roster).toEqual([
      { position: "打野", count: 1 },
      { position: "辅助", count: 2 },
    ]);
  });

  it("人数来源表格至少要有一行，行内必填缺失或人数非法都会拦下", () => {
    expect(collectOrderValues(tableConfig(), {}).errors).toEqual([
      "请至少添加一行 岗位与人数",
    ]);

    const missingCell = collectOrderValues(tableConfig(), {
      roster: [{ position: "打野", count: "" }],
    });
    expect(missingCell.errors).toEqual(["岗位与人数 第 1 行 人数 不能为空"]);

    const badCount = collectOrderValues(tableConfig(), {
      roster: [{ position: "打野", count: "0" }],
    });
    expect(badCount.errors).toEqual([
      "岗位与人数 第 1 行 人数 必须是 1-500 的整数",
    ]);
  });

  it("人数来源是数字字段时，值必须是 1-500 的整数", () => {
    const fieldConfig: OrderConfigLike = {
      sections: [
        { stableKey: "basic", label: "基本信息", enabled: true, sortOrder: 0 },
      ],
      components: [
        {
          kind: "FIELD",
          stableKey: "players",
          sectionKey: "basic",
          label: "人数",
          enabled: true,
          sortOrder: 0,
          fieldType: "NUMBER",
          required: true,
        },
      ],
      staffingSource: { kind: "NUMBER_FIELD", componentKey: "players" },
    };

    expect(collectOrderValues(fieldConfig, { players: "2" }).values).toEqual({
      players: 2,
    });
    expect(collectOrderValues(fieldConfig, { players: "1.5" }).errors).toEqual([
      "人数 必须是 1-500 的整数",
    ]);
  });
});

describe("missingRequiredLabels：只提示该端口可见的必填", () => {
  it("列出未填的必填项与表格必填单元格", () => {
    expect(missingRequiredLabels(config(), {})).toEqual(["备注", "模式"]);

    const tableConfig: OrderConfigLike = {
      sections: [
        { stableKey: "basic", label: "基本信息", enabled: true, sortOrder: 0 },
      ],
      components: [
        {
          kind: "REPEATABLE_TABLE",
          stableKey: "roster",
          sectionKey: "basic",
          label: "岗位与人数",
          enabled: true,
          sortOrder: 0,
          columns: [
            {
              stableKey: "position",
              label: "位置",
              columnType: "TEXT",
              required: true,
            },
            {
              stableKey: "count",
              label: "人数",
              columnType: "NUMBER",
              required: true,
            },
          ],
        },
      ],
      staffingSource: {
        kind: "REPEATABLE_TABLE_SUM",
        componentKey: "roster",
        columnKey: "count",
      },
    };

    expect(
      missingRequiredLabels(tableConfig, {
        roster: [
          { position: "打野", count: "1" },
          { position: "", count: "2" },
        ],
      }),
    ).toEqual(["岗位与人数 第 2 行 位置"]);

    // 整行空白（点了「添加行」没填）不算一行，也不报错
    expect(
      missingRequiredLabels(tableConfig, {
        roster: [
          { position: "打野", count: "1" },
          { position: "", count: "" },
        ],
      }),
    ).toEqual([]);
  });
});
