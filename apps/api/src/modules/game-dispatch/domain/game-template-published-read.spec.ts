import { describe, expect, it } from "vitest";
import type { PublishedConfigV2 } from "./game-template-config-v2.js";
import {
  readPublishedConfig,
  selectPublishedGames,
  selectPublishedTemplates,
  type PublishedGameCandidate,
  type PublishedTemplateCandidate,
} from "./game-template-published-read.js";

function candidate(
  overrides: Partial<PublishedTemplateCandidate>,
): PublishedTemplateCandidate {
  return {
    id: "t1",
    gameId: "g1",
    name: "模板",
    description: null,
    activeVersionId: "v1",
    activeVersionNo: 1,
    isDefault: false,
    lastUsedAt: null,
    updatedAt: new Date("2026-09-01T00:00:00.000Z"),
    archivedAt: null,
    ...overrides,
  };
}

function publishedConfig(): PublishedConfigV2 {
  return {
    schemaVersion: 2,
    documentRendererVersion: 1,
    sections: [
      {
        stableKey: "basic",
        label: "基本信息",
        enabled: true,
        sortOrder: 0,
        layout: { columns: 2 },
      },
    ],
    components: [
      {
        kind: "FIELD",
        stableKey: "mode",
        sectionKey: "basic",
        label: "游戏模式",
        enabled: true,
        sortOrder: 0,
        layout: { colSpan: 1, rowBreakBefore: false },
        fieldType: "SINGLE_SELECT",
        semanticRole: "MODE",
        required: true,
        options: [
          { value: "ranked", label: "排位" },
          { value: "normal", label: "匹配" },
        ],
      },
    ],
    staffingSource: { kind: "FIXED", count: 1 },
  };
}

function gameCandidate(
  overrides: Partial<PublishedGameCandidate>,
): PublishedGameCandidate {
  return {
    gameId: "g1",
    gameName: "英雄联盟",
    archivedAt: null,
    activeVersionId: "v1",
    ...overrides,
  };
}

describe("selectPublishedGames：该店可下单的游戏", () => {
  it("只要有未归档且有生效版本的模板，游戏就算可下单（同游戏多模板只出一条）", () => {
    const selected = selectPublishedGames([
      gameCandidate({ gameId: "g1", gameName: "英雄联盟" }),
      gameCandidate({ gameId: "g1", gameName: "英雄联盟" }),
      gameCandidate({ gameId: "g2", gameName: "无畏契约" }),
    ]);

    expect(selected).toEqual([
      { gameId: "g2", name: "无畏契约" },
      { gameId: "g1", name: "英雄联盟" },
    ]);
  });

  it("排除只有草稿、已归档与未归类（game_id 为空）的模板", () => {
    const selected = selectPublishedGames([
      gameCandidate({ gameId: "draft-only", activeVersionId: null }),
      gameCandidate({
        gameId: "archived",
        archivedAt: new Date("2026-09-02T00:00:00.000Z"),
      }),
      gameCandidate({ gameId: null, gameName: null }),
      gameCandidate({ gameId: "ok", gameName: "可下单" }),
    ]);

    expect(selected).toEqual([{ gameId: "ok", name: "可下单" }]);
  });

  it("回查不到游戏名（数据不一致）时宁可少给，也不返回无名游戏", () => {
    const selected = selectPublishedGames([
      gameCandidate({ gameId: "ghost", gameName: null }),
    ]);

    expect(selected).toEqual([]);
  });

  it("同名游戏按 id 升序，保证返回顺序稳定", () => {
    const selected = selectPublishedGames([
      gameCandidate({ gameId: "b", gameName: "同名" }),
      gameCandidate({ gameId: "a", gameName: "同名" }),
    ]);

    expect(selected.map((row) => row.gameId)).toEqual(["a", "b"]);
  });
});

describe("selectPublishedTemplates：该游戏可派单的模板", () => {
  it("排除已归档与没有生效版本的模板", () => {
    const selected = selectPublishedTemplates([
      candidate({ id: "ok" }),
      candidate({
        id: "archived",
        archivedAt: new Date("2026-09-02T00:00:00.000Z"),
      }),
      candidate({
        id: "no-version",
        activeVersionId: null,
        activeVersionNo: null,
      }),
    ]);

    expect(selected.map((row) => row.templateId)).toEqual(["ok"]);
  });

  it("默认模板排首位，其后按最近使用，未使用过的按最近更新", () => {
    const selected = selectPublishedTemplates([
      candidate({
        id: "recent",
        lastUsedAt: new Date("2026-09-10T00:00:00.000Z"),
      }),
      candidate({
        id: "never-old",
        updatedAt: new Date("2026-08-01T00:00:00.000Z"),
      }),
      candidate({
        id: "default",
        isDefault: true,
        updatedAt: new Date("2026-07-01T00:00:00.000Z"),
      }),
      candidate({
        id: "never-new",
        updatedAt: new Date("2026-09-05T00:00:00.000Z"),
      }),
    ]);

    expect(selected.map((row) => row.templateId)).toEqual([
      "default",
      "recent",
      "never-new",
      "never-old",
    ]);
  });

  it("只输出派单选择所需的版本信息", () => {
    const [summary] = selectPublishedTemplates([
      candidate({
        id: "t1",
        name: "排位陪练",
        description: "通用说明",
        activeVersionId: "v7",
        activeVersionNo: 7,
      }),
    ]);

    expect(summary).toEqual({
      templateId: "t1",
      name: "排位陪练",
      description: "通用说明",
      versionId: "v7",
      versionNo: 7,
      isDefault: false,
      lastUsedAt: null,
    });
  });

  it("排序相同时按模板 id 升序，保证返回顺序稳定", () => {
    const selected = selectPublishedTemplates([
      candidate({ id: "b" }),
      candidate({ id: "a" }),
    ]);

    expect(selected.map((row) => row.templateId)).toEqual(["a", "b"]);
  });
});

describe("readPublishedConfig：发布配置读取", () => {
  it("接受 schemaVersion 2 且渲染器版本受支持的发布配置", () => {
    const config = publishedConfig();

    expect(readPublishedConfig(config)).toEqual(config);
  });

  it("拒绝 schemaVersion 1 或缺少 documentRendererVersion 的历史数据", () => {
    expect(readPublishedConfig({ schemaVersion: 1 })).toBeNull();

    const withoutRenderer: Record<string, unknown> = {
      ...publishedConfig(),
    };
    delete withoutRenderer.documentRendererVersion;

    expect(readPublishedConfig(withoutRenderer)).toBeNull();
  });

  it("拒绝结构损坏的配置", () => {
    expect(
      readPublishedConfig({ ...publishedConfig(), components: "broken" }),
    ).toBeNull();
  });
});
