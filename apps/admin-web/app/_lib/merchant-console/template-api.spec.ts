import { describe, expect, it } from "vitest";
import type { TemplateDraftConfig } from "./template-api";
import {
  TemplateApiError,
  configureTemplateClient,
  deleteTemplate,
  fetchTemplateDraft,
  fetchTemplateList,
  publishTemplate,
  saveTemplateDraft,
  toTemplateApiError,
} from "./template-api";

const ORIGIN = "https://api.test";

const MINIMAL_CONFIG: TemplateDraftConfig = {
  schemaVersion: 2,
  sections: [],
  components: [],
  staffingSource: { kind: "FIXED", count: 1 },
};

interface StubbedCall {
  url: string;
  method: string;
  authorization: string | null;
  body: unknown;
}

interface StubResponse {
  status?: number;
  body: unknown;
}

/** 用注入的 fetch 替换网络：记录请求，按队列返回响应。 */
function stubFetch(queue: StubResponse[]): {
  calls: StubbedCall[];
  fetchImpl: typeof fetch;
} {
  const calls: StubbedCall[] = [];
  const fetchImpl = (async (input: Request) => {
    const request = input as Request;
    const text = await request.text();
    calls.push({
      url: request.url,
      method: request.method,
      authorization: request.headers.get("authorization"),
      body: text ? JSON.parse(text) : undefined,
    });
    const next = queue.shift() ?? { status: 200, body: { data: null } };
    return new Response(JSON.stringify(next.body), {
      status: next.status ?? 200,
      headers: { "content-type": "application/json" },
    });
  }) as unknown as typeof fetch;
  return { calls, fetchImpl };
}

function configure(
  fetchImpl: typeof fetch,
  token: string | null = "t-1",
): void {
  configureTemplateClient({
    origin: ORIGIN,
    getToken: () => token,
    fetch: fetchImpl,
  });
}

describe("template-api：S2 契约的客户端封装", () => {
  it("列表：带 Authorization、按契约序列化 query，并直接返回 { data, page }", async () => {
    const { calls, fetchImpl } = stubFetch([
      {
        body: {
          data: [{ id: "tpl-1", name: "排位陪练", status: "DRAFT" }],
          page: { nextCursor: "cursor-1" },
        },
      },
    ]);
    configure(fetchImpl);

    const page = await fetchTemplateList({ sort: "NAME_ASC", limit: 30 });
    expect(calls).toHaveLength(1);
    const url = new URL(calls[0]!.url);
    expect(url.origin + url.pathname).toBe(
      `${ORIGIN}/api/v1/tenant/game-dispatch-templates`,
    );
    expect(url.searchParams.get("sort")).toBe("NAME_ASC");
    expect(url.searchParams.get("limit")).toBe("30");
    expect(url.searchParams.has("q")).toBe(false);
    expect(calls[0]!.authorization).toBe("Bearer t-1");
    expect(page.page.nextCursor).toBe("cursor-1");
    expect(page.data).toHaveLength(1);
  });

  it("列表：未提供的过滤条件不进入 query，limit 以字符串发送", async () => {
    const { calls, fetchImpl } = stubFetch([
      { body: { data: [], page: { nextCursor: null } } },
    ]);
    configure(fetchImpl);

    await fetchTemplateList({ sort: "UPDATED_DESC", limit: 100 });
    const url = new URL(calls[0]!.url);
    for (const key of ["gameId", "status", "q", "cursor"]) {
      expect(url.searchParams.has(key)).toBe(false);
    }
    expect(url.searchParams.get("limit")).toBe("100");
  });

  it("读取草稿：解开 { data } 信封", async () => {
    const { calls, fetchImpl } = stubFetch([
      { body: { data: { id: "tpl-1", revision: 3, status: "PUBLISHED" } } },
    ]);
    configure(fetchImpl);

    const draft = await fetchTemplateDraft("tpl-1");
    expect(draft).toMatchObject({ id: "tpl-1", revision: 3 });
    expect(new URL(calls[0]!.url).pathname).toBe(
      "/api/v1/tenant/game-dispatch-templates/tpl-1/draft",
    );
  });

  it("保存草稿：PATCH /draft，body 带 expectedRevision 与整份 config", async () => {
    const { calls, fetchImpl } = stubFetch([
      {
        body: {
          data: {
            revision: 4,
            updatedAt: "2026-09-16T00:00:00.000Z",
            updatedBy: "u-1",
            validationWarnings: [],
          },
        },
      },
    ]);
    configure(fetchImpl);

    const config: TemplateDraftConfig = {
      schemaVersion: 2,
      sections: [],
      components: [],
      staffingSource: { kind: "FIXED", count: 1 },
    };
    const result = await saveTemplateDraft("tpl-1", {
      expectedRevision: 3,
      config,
    });

    expect(calls[0]!.method).toBe("PATCH");
    expect(calls[0]!.body).toEqual({ expectedRevision: 3, config });
    expect(result.revision).toBe(4);
  });

  it("发布：POST /publish，且客户端不携带 config/rendererVersion", async () => {
    const { calls, fetchImpl } = stubFetch([
      { status: 201, body: { data: { revision: 5, status: "PUBLISHED" } } },
    ]);
    configure(fetchImpl);

    await publishTemplate("tpl-1", {
      expectedRevision: 4,
      changeNote: "首次发布",
    });
    const body = calls[0]!.body as Record<string, unknown>;
    expect(calls[0]!.method).toBe("POST");
    expect(new URL(calls[0]!.url).pathname.endsWith("/publish")).toBe(true);
    expect(body).toEqual({ expectedRevision: 4, changeNote: "首次发布" });
    expect(body).not.toHaveProperty("config");
    expect(body).not.toHaveProperty("rendererVersion");
  });

  it("删除：DELETE 且 expectedRevision 走 query", async () => {
    const { calls, fetchImpl } = stubFetch([{ body: { data: { ok: true } } }]);
    configure(fetchImpl);

    await deleteTemplate("tpl-1", 5);
    expect(calls[0]!.method).toBe("DELETE");
    const url = new URL(calls[0]!.url);
    expect(url.pathname).toBe("/api/v1/tenant/game-dispatch-templates/tpl-1");
    expect(url.searchParams.get("expectedRevision")).toBe("5");
  });

  it("409 修订冲突：抛出带 code/details/status 的 TemplateApiError", async () => {
    const conflict = {
      status: 409,
      body: {
        status: 409,
        code: "TEMPLATE_REVISION_CONFLICT",
        message: "模板修订冲突",
        details: {
          expectedRevision: 3,
          currentRevision: 4,
          currentEditor: "u-9",
          currentUpdatedAt: "2026-09-16T01:00:00.000Z",
        },
      },
    };
    const { fetchImpl } = stubFetch([conflict, conflict]);
    configure(fetchImpl);

    await expect(
      saveTemplateDraft("tpl-1", {
        expectedRevision: 3,
        config: MINIMAL_CONFIG,
      }),
    ).rejects.toMatchObject({
      name: "TemplateApiError",
      code: "TEMPLATE_REVISION_CONFLICT",
    });

    try {
      await saveTemplateDraft("tpl-1", {
        expectedRevision: 3,
        config: MINIMAL_CONFIG,
      });
      throw new Error("应当抛出");
    } catch (error) {
      expect(error).toBeInstanceOf(TemplateApiError);
      const apiError = error as TemplateApiError;
      expect(apiError.status).toBe(409);
      expect(apiError.details).toMatchObject({
        currentRevision: 4,
        currentEditor: "u-9",
      });
    }
  });

  it("422 校验失败：保留 details.issues 供界面定位", async () => {
    const { fetchImpl } = stubFetch([
      {
        status: 422,
        body: {
          code: "TEMPLATE_BINDING_INVALID",
          message: "模板业务绑定无效",
          details: {
            issues: [
              {
                code: "TEMPLATE_BINDING_INVALID",
                path: "$.staffingSource",
                message: "人数来源无效",
              },
            ],
          },
        },
      },
    ]);
    configure(fetchImpl);

    try {
      await saveTemplateDraft("tpl-1", {
        expectedRevision: 1,
        config: MINIMAL_CONFIG,
      });
      throw new Error("应当抛出");
    } catch (error) {
      const apiError = error as TemplateApiError;
      expect(apiError.code).toBe("TEMPLATE_BINDING_INVALID");
      expect(apiError.issueList()).toHaveLength(1);
      expect(apiError.issueList()[0]).toMatchObject({
        path: "$.staffingSource",
      });
    }
  });

  it("未知错误：回退 UNKNOWN 并保留原始信息，不把技术细节当业务码", () => {
    expect(toTemplateApiError("boom")).toMatchObject({
      code: "UNKNOWN",
      message: "boom",
    });
    expect(toTemplateApiError(new Error("network down"))).toMatchObject({
      code: "UNKNOWN",
      message: "network down",
    });
    expect(toTemplateApiError({ message: "no code" })).toMatchObject({
      code: "UNKNOWN",
    });
  });

  it("未登录（无 token）时不发送 Authorization 头", async () => {
    const { calls, fetchImpl } = stubFetch([
      { body: { data: [], page: { nextCursor: null } } },
    ]);
    configure(fetchImpl, null);

    await fetchTemplateList({ sort: "UPDATED_DESC", limit: 30 });
    expect(calls[0]!.authorization).toBeNull();
  });
});
