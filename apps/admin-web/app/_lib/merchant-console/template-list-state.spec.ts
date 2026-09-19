import { describe, expect, it } from "vitest";
import {
  DEFAULT_TEMPLATE_LIST_SEARCH,
  buildTemplateListSearch,
  parseTemplateListSearch,
  toListQuery,
} from "./template-list-state";

const UUID = "3f1a6d0e-6f3b-4a9c-9f2e-2c8a1b7d5e40";

describe("template-list-state：游戏筛选的服务端参数", () => {
  it("未归类走 gameScope=UNCLASSIFIED，且不再发 gameId", () => {
    const query = toListQuery(parseTemplateListSearch("?game=unclassified"));

    expect(query.gameScope).toBe("UNCLASSIFIED");
    expect(query.gameId).toBeUndefined();
  });

  it("具体游戏仍走 gameId，且不带 gameScope", () => {
    const query = toListQuery(parseTemplateListSearch(`?game=${UUID}`));

    expect(query.gameId).toBe(UUID);
    expect(query.gameScope).toBeUndefined();
  });

  it("全部游戏：两个参数都不发", () => {
    const query = toListQuery(parseTemplateListSearch(""));

    expect(query.gameId).toBeUndefined();
    expect(query.gameScope).toBeUndefined();
  });
});

describe("template-list-state：URL 状态 ⇄ 查询", () => {
  it("默认状态：不写任何参数，解析空串也得到默认值", () => {
    expect(DEFAULT_TEMPLATE_LIST_SEARCH).toMatchObject({
      game: "all",
      status: "all",
      q: "",
      sort: "UPDATED_DESC",
      id: null,
      tab: "content",
    });
    expect(buildTemplateListSearch(DEFAULT_TEMPLATE_LIST_SEARCH)).toBe("");
    expect(parseTemplateListSearch("")).toEqual(DEFAULT_TEMPLATE_LIST_SEARCH);
  });

  it("往返稳定：非默认值经过 URL 后完全还原（含中文与空格）", () => {
    const search = {
      game: UUID,
      status: "UNPUBLISHED_CHANGES" as const,
      q: "排位 陪练",
      sort: "NAME_ASC" as const,
      id: UUID,
      tab: "binding" as const,
    };
    const encoded = buildTemplateListSearch(search);
    expect(parseTemplateListSearch(encoded)).toEqual(search);
    // 第二次编码必须与第一次一致（避免刷新后 URL 抖动）
    expect(buildTemplateListSearch(parseTemplateListSearch(encoded))).toBe(
      encoded,
    );
  });

  it("非法值回退默认：未知 status/sort/tab、非 UUID 的 id、超长 q", () => {
    const parsed = parseTemplateListSearch(
      "?game=not-a-uuid&status=WHATEVER&sort=DROP%20TABLE&tab=secret&id=abc&q=" +
        "字".repeat(200),
    );
    expect(parsed.game).toBe("all");
    expect(parsed.status).toBe("all");
    expect(parsed.sort).toBe("UPDATED_DESC");
    expect(parsed.tab).toBe("content");
    expect(parsed.id).toBeNull();
    expect(parsed.q.length).toBe(100);
  });

  it("URL 只包含白名单键，绝不包含表单值或客户隐私", () => {
    const encoded = buildTemplateListSearch({
      game: UUID,
      status: "DRAFT",
      q: "测试",
      sort: "LAST_USED_DESC",
      id: UUID,
      tab: "release",
    });
    const keys = [...new URLSearchParams(encoded).keys()].sort();
    expect(keys).toEqual(["game", "id", "q", "sort", "status", "tab"]);
  });

  it("未归类：解析为 unclassified 且查询不发送 gameId（该过滤由界面在已加载结果内完成）", () => {
    const parsed = parseTemplateListSearch("?game=unclassified");
    expect(parsed.game).toBe("unclassified");
    expect(buildTemplateListSearch(parsed)).toBe("?game=unclassified");
    const query = toListQuery(parsed);
    expect(query).not.toHaveProperty("gameId");
  });

  it("toListQuery：游戏筛选、状态、搜索、排序与分页映射到契约查询", () => {
    expect(
      toListQuery({
        game: UUID,
        status: "PUBLISHED",
        q: "  钻石  ",
        sort: "UPDATED_ASC",
        id: null,
        tab: "content",
      }),
    ).toMatchObject({
      gameId: UUID,
      status: "PUBLISHED",
      q: "钻石",
      sort: "UPDATED_ASC",
    });

    const all = toListQuery(DEFAULT_TEMPLATE_LIST_SEARCH);
    expect(all).not.toHaveProperty("gameId");
    expect(all).not.toHaveProperty("status");
    expect(all).not.toHaveProperty("q");
    expect(all).not.toHaveProperty("cursor");
  });
});
