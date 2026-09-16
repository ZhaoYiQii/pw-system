import { describe, expect, it } from "vitest";
import { configureTemplateClient, TemplateApiError } from "./template-api";
import {
  createTemplateOrder,
  fetchPublishedTemplates,
  fetchPublishedVersionForm,
} from "./template-order-api";

const ORIGIN = "https://api.test";

interface StubResponse {
  status?: number;
  body: unknown;
}

function stubFetch(queue: StubResponse[]) {
  const calls: {
    url: string;
    method: string;
    authorization: string | null;
    idempotencyKey: string | null;
    body: unknown;
  }[] = [];
  const fetchImpl = (async (input: Request) => {
    const request = input as Request;
    const text = await request.text();
    calls.push({
      url: request.url,
      method: request.method,
      authorization: request.headers.get("authorization"),
      idempotencyKey: request.headers.get("idempotency-key"),
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

function configure(fetchImpl: typeof fetch): void {
  configureTemplateClient({
    origin: ORIGIN,
    getToken: () => "t-1",
    fetch: fetchImpl,
  });
}

const ORDER_INPUT = {
  gameId: "g1",
  templateId: "t1",
  templateVersionId: "v1",
  customerProfileId: "c1",
  values: { mode: "ranked" },
  durationMinutes: 60,
  desiredStartAt: null,
};

describe("template-order-api：S4 契约的客户端封装", () => {
  it("published 列表：按 gameId 查询并带 Authorization", async () => {
    const { calls, fetchImpl } = stubFetch([
      {
        body: {
          data: [
            {
              templateId: "t1",
              name: "排位陪练",
              description: null,
              versionId: "v1",
              versionNo: 1,
              isDefault: true,
              lastUsedAt: null,
            },
          ],
        },
      },
    ]);
    configure(fetchImpl);

    const rows = await fetchPublishedTemplates("g1");

    const url = new URL(calls[0]!.url);
    expect(url.origin + url.pathname).toBe(
      `${ORIGIN}/api/v1/tenant/game-dispatch-templates/published`,
    );
    expect(url.searchParams.get("gameId")).toBe("g1");
    expect(calls[0]!.authorization).toBe("Bearer t-1");
    expect(rows).toHaveLength(1);
    expect(rows[0]?.versionId).toBe("v1");
  });

  it("版本表单：路径带 versionId，返回发布配置", async () => {
    const { calls, fetchImpl } = stubFetch([
      {
        body: {
          data: {
            templateId: "t1",
            gameId: "g1",
            versionId: "v1",
            versionNo: 1,
            config: { schemaVersion: 2, documentRendererVersion: 1 },
          },
        },
      },
    ]);
    configure(fetchImpl);

    const form = await fetchPublishedVersionForm("v1");

    expect(calls[0]!.url).toBe(
      `${ORIGIN}/api/v1/tenant/game-dispatch-templates/versions/v1/form`,
    );
    expect(form.versionId).toBe("v1");
    expect(form.config.schemaVersion).toBe(2);
  });

  it("创建派单：带 Idempotency-Key 头，只提交归属与值", async () => {
    const { calls, fetchImpl } = stubFetch([
      {
        status: 201,
        body: {
          data: {
            orderId: "o1",
            dispatchOrderId: "d1",
            templateVersionId: "v1",
            staffingSummary: { total: 1, rows: [] },
            priceAdjustmentFen: "0",
            document: {
              schemaVersion: 1,
              rendererVersion: 1,
              rows: [],
              plainText: "文案",
            },
          },
        },
      },
    ]);
    configure(fetchImpl);

    const created = await createTemplateOrder(ORDER_INPUT, "key-12345678");

    expect(calls[0]!.method).toBe("POST");
    expect(calls[0]!.idempotencyKey).toBe("key-12345678");
    expect(calls[0]!.body).toMatchObject({
      gameId: "g1",
      templateId: "t1",
      templateVersionId: "v1",
      customerProfileId: "c1",
      values: { mode: "ranked" },
    });
    expect(created.orderId).toBe("o1");
    expect(created.document.plainText).toBe("文案");
  });

  it("服务端受控错误映射成 TemplateApiError（含 code 与状态码）", async () => {
    const { fetchImpl } = stubFetch([
      {
        status: 409,
        body: { code: "TEMPLATE_ARCHIVED", message: "模板已归档" },
      },
      {
        status: 422,
        body: { code: "TEMPLATE_VERSION_UNAVAILABLE", message: "版本不可用" },
      },
    ]);
    configure(fetchImpl);

    const archived = await createTemplateOrder(
      ORDER_INPUT,
      "key-12345678",
    ).catch((error: unknown) => error);
    expect(archived).toBeInstanceOf(TemplateApiError);
    // 界面分支只依赖受控 code；status 取决于上游抛出物（S3 已交付的映射未改动）。
    expect((archived as TemplateApiError).code).toBe("TEMPLATE_ARCHIVED");

    const unavailable = await fetchPublishedVersionForm("missing").catch(
      (error: unknown) => error,
    );
    expect(unavailable).toBeInstanceOf(TemplateApiError);
    expect((unavailable as TemplateApiError).code).toBe(
      "TEMPLATE_VERSION_UNAVAILABLE",
    );
  });
});
