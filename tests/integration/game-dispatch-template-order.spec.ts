import "reflect-metadata";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Test } from "@nestjs/testing";
import request from "supertest";
import type { INestApplication } from "@nestjs/common";
import { AppModule } from "../../apps/api/src/app.module.js";
import { hashPassword } from "../../apps/api/src/modules/identity-access/infrastructure/password.js";
import { createDatabaseClient } from "@pw/database";
import type { PrismaClient } from "@pw/database";

const PW = "Template-Order-Password-1";
const suffix = Date.now().toString(36);
const tenantCode = `gdo_${suffix}`;
const otherTenantCode = `gdob_${suffix}`;
const BASE = "/api/v1/tenant/game-dispatch-templates";

/** 合法 v2 草稿：一个区块 + 一个必填单选 + 固定人数来源。 */
function draftConfig(): Record<string, unknown> {
  return {
    schemaVersion: 2,
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

interface DraftBody {
  data: { id: string; revision: number; activeVersion: null | { id: string } };
}

interface PublishedListBody {
  data: Array<{
    templateId: string;
    name: string;
    description: string | null;
    versionId: string;
    versionNo: number;
    isDefault: boolean;
    lastUsedAt: string | null;
  }>;
}

interface CreateOrderResult {
  orderId: string;
  dispatchOrderId: string;
  templateVersionId: string;
  staffingSummary: { total: number; rows: { label: string; count: number }[] };
  priceAdjustmentFen: string;
  document: {
    schemaVersion: number;
    rendererVersion: number;
    plainText: string;
  };
}

interface OrderDetailDocument {
  schemaVersion: number;
  rendererVersion: number;
  rows: { sectionLabel: string; fieldLabel: string; value: string }[];
  plainText: string;
  generatedFromSnapshotAt: string;
}
interface OrderDetailBody {
  data: {
    orderId: string;
    copyText: string;
    applyUrl: string;
    bossUrl: string;
    document: OrderDetailDocument | null;
  };
}

interface FormBody {
  data: {
    templateId: string;
    gameId: string | null;
    versionId: string;
    versionNo: number;
    config: { schemaVersion: number; documentRendererVersion: number };
  };
}

describe("S4 新建派单：模板读取与创建", () => {
  let app: INestApplication;
  let client: PrismaClient;
  let tenantId = "";
  let otherTenantId = "";
  let gameId = "";
  let foreignGameId = "";
  let ownerToken = "";
  let csToken = "";
  let playerToken = "";
  let foreignToken = "";
  let main: { templateId: string; versionId: string } = {
    templateId: "",
    versionId: "",
  };
  let secondaryVersionId = "";
  let customerId = "";

  beforeAll(async () => {
    client = createDatabaseClient(
      process.env.PW_TEST_MIGRATION_URL ??
        (() => {
          throw new Error("missing env PW_TEST_MIGRATION_URL");
        })(),
    );
    const hash = await hashPassword(PW);

    const tenant = await client.tenant.create({
      data: { code: tenantCode, name: "S4 派单测试店" },
    });
    tenantId = tenant.id;
    const other = await client.tenant.create({
      data: { code: otherTenantCode, name: "S4 别家店" },
    });
    otherTenantId = other.id;

    async function addAccount(tid: string, username: string, role: string) {
      const account = await client.tenantAccount.create({
        data: { tenantId: tid, username, passwordHash: hash },
      });
      await client.tenantAccountRole.create({
        data: { tenantId: tid, tenantAccountId: account.id, role },
      });
    }

    await addAccount(tenantId, "boss", "TENANT_OWNER");
    await addAccount(tenantId, "service", "CUSTOMER_SERVICE");
    await addAccount(tenantId, `p_${suffix}`, "PLAYER");
    await addAccount(otherTenantId, "boss", "TENANT_OWNER");

    const game = await client.game.create({
      data: { tenantId, name: `英雄联盟-${suffix}` },
    });
    gameId = game.id;
    const foreign = await client.game.create({
      data: { tenantId: otherTenantId, name: `别家游戏-${suffix}` },
    });
    foreignGameId = foreign.id;

    const customer = await client.customerProfile.create({
      data: { tenantId, name: "S4 测试客户" },
    });
    customerId = customer.id;

    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();

    async function login(code: string, username: string): Promise<string> {
      const res = await request(app.getHttpServer())
        .post("/api/v1/auth/login")
        .send({ kind: "tenant", tenantCode: code, username, password: PW })
        .expect(201);
      return (res.body as { data: { accessToken: string } }).data.accessToken;
    }

    ownerToken = await login(tenantCode, "boss");
    csToken = await login(tenantCode, "service");
    playerToken = await login(tenantCode, `p_${suffix}`);
    foreignToken = await login(otherTenantCode, "boss");
  });

  afterAll(async () => {
    if (client) {
      const tids = [tenantId, otherTenantId].filter((id) => id !== "");
      // S4 创建派单会写入订单、派单、快照与幂等记录；按外键依赖顺序先删子表。
      await client.gameDispatchTemplateSnapshot.deleteMany({
        where: { tenantId: { in: tids } },
      });
      await client.gameDispatchOrder.deleteMany({
        where: { tenantId: { in: tids } },
      });
      await client.idempotencyRecord.deleteMany({
        where: { tenantId: { in: tids } },
      });
      await client.order.deleteMany({ where: { tenantId: { in: tids } } });
      await client.customerProfile.deleteMany({
        where: { tenantId: { in: tids } },
      });
      // active_version_id 是 templates → versions 的外键，必须先解引用再删版本。
      await client.gameDispatchTemplate.updateMany({
        where: { tenantId: { in: tids } },
        data: { activeVersionId: null },
      });
      await client.gameDispatchTemplateVersion.deleteMany({
        where: { tenantId: { in: tids } },
      });
      await client.gameDispatchTemplate.deleteMany({
        where: { tenantId: { in: tids } },
      });
      await client.auditLog.deleteMany({ where: { tenantId: { in: tids } } });
      await client.tenantAccountRole.deleteMany({
        where: { tenantId: { in: tids } },
      });
      await client.tenantAccount.deleteMany({
        where: { tenantId: { in: tids } },
      });
      await client.game.deleteMany({ where: { tenantId: { in: tids } } });
      await client.tenant.deleteMany({ where: { id: { in: tids } } });
      await client.$disconnect();
    }
    if (app) await app.close();
  });

  function req(token: string) {
    const h = { authorization: `Bearer ${token}` };
    return {
      get: (u: string) => request(app.getHttpServer()).get(u).set(h),
      post: (u: string, b?: unknown) =>
        request(app.getHttpServer())
          .post(u)
          .set(h)
          .send(b ?? {}),
      patch: (u: string, b: unknown) =>
        request(app.getHttpServer()).patch(u).set(h).send(b),
    };
  }

  /** 建模板 → 存合法草稿 → 发布 v1，返回模板与版本 id。 */
  async function createPublishedTemplate(
    token: string,
    name: string,
    tid: string,
    config: Record<string, unknown> = draftConfig(),
  ): Promise<{ templateId: string; versionId: string }> {
    const created = await req(token)
      .post(BASE, { gameId: tid, name, description: null })
      .expect(201);
    const templateId = (created.body as DraftBody).data.id;
    const saved = await req(token)
      .patch(`${BASE}/${templateId}/draft`, {
        expectedRevision: (created.body as DraftBody).data.revision,
        config,
      })
      .expect(200);
    const revision = (saved.body as { data: { revision: number } }).data
      .revision;
    const published = await req(token)
      .post(`${BASE}/${templateId}/publish`, {
        expectedRevision: revision,
        changeNote: "S4 Task 1 夹具",
      })
      .expect(201);
    const versionId = (
      published.body as { data: { activeVersion: { id: string } } }
    ).data.activeVersion.id;
    return { templateId, versionId };
  }

  it("只返回该游戏未归档且有生效版本的模板，默认模板排首位", async () => {
    main = await createPublishedTemplate(ownerToken, "排位陪练", gameId);
    const secondary = await createPublishedTemplate(
      ownerToken,
      "匹配陪练",
      gameId,
    );
    secondaryVersionId = secondary.versionId;

    // 仅草稿（未发布）的模板不应出现
    await req(ownerToken)
      .post(BASE, { gameId, name: "草稿模板", description: null })
      .expect(201);

    // 已归档模板不应出现
    const archived = await createPublishedTemplate(
      ownerToken,
      "归档模板",
      gameId,
    );
    const detail = await req(ownerToken)
      .get(`${BASE}/${archived.templateId}/draft`)
      .expect(200);
    await req(ownerToken)
      .post(`${BASE}/${archived.templateId}/archive`, {
        expectedRevision: (detail.body as { data: { revision: number } }).data
          .revision,
      })
      .expect(201);

    // 把「排位陪练」设为默认，应当排在非默认模板之前
    const mainDetail = await req(ownerToken)
      .get(`${BASE}/${main.templateId}/draft`)
      .expect(200);
    await req(ownerToken)
      .post(`${BASE}/${main.templateId}/default`, {
        expectedRevision: (mainDetail.body as { data: { revision: number } })
          .data.revision,
      })
      .expect(201);

    const res = await req(ownerToken)
      .get(`${BASE}/published?gameId=${gameId}`)
      .expect(200);
    const body = res.body as PublishedListBody;

    expect(body.data.map((row) => row.templateId)).toEqual([
      main.templateId,
      secondary.templateId,
    ]);
    expect(body.data[0]).toEqual({
      templateId: main.templateId,
      name: "排位陪练",
      description: null,
      versionId: main.versionId,
      versionNo: 1,
      isDefault: true,
      lastUsedAt: null,
    });
  });

  it("读取锁定版本的发布表单：返回 v2 配置与文案渲染器版本", async () => {
    const res = await req(ownerToken)
      .get(`${BASE}/versions/${main.versionId}/form`)
      .expect(200);
    const body = res.body as FormBody;

    expect(body.data.templateId).toBe(main.templateId);
    expect(body.data.gameId).toBe(gameId);
    expect(body.data.versionId).toBe(main.versionId);
    expect(body.data.versionNo).toBe(1);
    expect(body.data.config.schemaVersion).toBe(2);
    expect(body.data.config.documentRendererVersion).toBe(1);
  });

  it("版本不存在、形状非法或跨租户时返回 422 TEMPLATE_VERSION_UNAVAILABLE", async () => {
    const missing = await req(ownerToken)
      .get(`${BASE}/versions/6c547de7-3af6-4c3c-a2cb-c7d0bc71e197/form`)
      .expect(422);
    expect((missing.body as { code: string }).code).toBe(
      "TEMPLATE_VERSION_UNAVAILABLE",
    );

    // 非 uuid 路径参数不应暴露成数据库错误
    const malformed = await req(ownerToken)
      .get(`${BASE}/versions/not-a-uuid/form`)
      .expect(422);
    expect((malformed.body as { code: string }).code).toBe(
      "TEMPLATE_VERSION_UNAVAILABLE",
    );

    // 别家租户的 token 不能读到本店版本，且不能借此判断存在性
    const foreign = await req(foreignToken)
      .get(`${BASE}/versions/${main.versionId}/form`)
      .expect(422);
    expect((foreign.body as { code: string }).code).toBe(
      "TEMPLATE_VERSION_UNAVAILABLE",
    );
  });

  it("跨租户查不到别家的可派单模板", async () => {
    const res = await req(foreignToken)
      .get(`${BASE}/published?gameId=${gameId}`)
      .expect(200);

    expect((res.body as PublishedListBody).data).toEqual([]);
  });

  it("客服可读（gameDispatch.manage），PLAYER 被拒 403", async () => {
    await req(csToken).get(`${BASE}/published?gameId=${gameId}`).expect(200);
    await req(playerToken)
      .get(`${BASE}/published?gameId=${gameId}`)
      .expect(403);
    await req(playerToken)
      .get(`${BASE}/versions/${main.versionId}/form`)
      .expect(403);
  });

  it("缺少 gameId 的请求在 API 边界被拒 400", async () => {
    await req(ownerToken).get(`${BASE}/published`).expect(400);
  });

  it("别家游戏的模板不会出现在本游戏列表里", async () => {
    const res = await req(ownerToken)
      .get(`${BASE}/published?gameId=${foreignGameId}`)
      .expect(200);

    expect((res.body as PublishedListBody).data).toEqual([]);
    expect(secondaryVersionId).not.toBe("");
  });

  /** Task 2 用的发布配置：可重复表格汇总人数 + 带加价的单选 + 说明。 */
  function orderConfig(): Record<string, unknown> {
    return {
      schemaVersion: 2,
      sections: [
        {
          stableKey: "basic",
          label: "基本信息",
          enabled: true,
          sortOrder: 0,
          layout: { columns: 2 },
        },
        {
          stableKey: "roster",
          label: "组队岗位",
          enabled: true,
          sortOrder: 1,
          layout: { columns: 1 },
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
          sortOrder: 1,
          layout: { colSpan: 2, rowBreakBefore: true },
          text: "上号前请确认订单",
        },
        {
          kind: "REPEATABLE_TABLE",
          stableKey: "roster_table",
          sectionKey: "roster",
          label: "岗位与人数",
          enabled: true,
          sortOrder: 0,
          layout: { colSpan: 1, rowBreakBefore: false },
          columns: [
            {
              stableKey: "position",
              label: "位置",
              columnType: "TEXT",
              semanticRole: "STAFFING_LABEL",
              required: true,
            },
            {
              stableKey: "count",
              label: "人数",
              columnType: "NUMBER",
              semanticRole: "STAFFING_COUNT",
              required: true,
            },
          ],
          defaultRows: [{ position: "陪玩", count: 1 }],
        },
      ],
      staffingSource: {
        kind: "REPEATABLE_TABLE_SUM",
        componentKey: "roster_table",
        columnKey: "count",
      },
    };
  }

  function orderBody(overrides: Record<string, unknown> = {}) {
    return {
      gameId,
      templateId: main.templateId,
      templateVersionId: main.versionId,
      customerProfileId: customerId,
      values: {
        mode: "ranked",
        roster_table: [
          { position: "陪玩", count: 2 },
          { position: "陪练", count: 1 },
        ],
      },
      ...overrides,
    };
  }

  it("按锁定版本创建派单：服务端计算人数与加价并写入快照", async () => {
    const template = await createPublishedTemplate(
      ownerToken,
      "S4 下单模板",
      gameId,
      orderConfig(),
    );
    const key = `k-${suffix}-create`;
    const res = await request(app.getHttpServer())
      .post("/api/v1/tenant/game-dispatch/template-orders")
      .set({ authorization: `Bearer ${ownerToken}`, "idempotency-key": key })
      .send(
        orderBody({
          templateId: template.templateId,
          templateVersionId: template.versionId,
        }),
      )
      .expect(201);
    const created = (res.body as { data: CreateOrderResult }).data;

    expect(created.templateVersionId).toBe(template.versionId);
    expect(created.staffingSummary).toEqual({
      total: 3,
      rows: [
        { label: "陪玩", count: 2 },
        { label: "陪练", count: 1 },
      ],
    });
    expect(created.priceAdjustmentFen).toBe("1500");
    expect(created.document.plainText).toContain("游戏模式：排位");

    const dispatchOrder = await client.gameDispatchOrder.findFirstOrThrow({
      where: { tenantId, id: created.dispatchOrderId },
    });
    expect(dispatchOrder.templateVersionId).toBe(template.versionId);
    expect(dispatchOrder.snapshotId).not.toBeNull();
    expect(dispatchOrder.formValuesJson).toMatchObject({ mode: "ranked" });

    const snapshot = await client.gameDispatchTemplateSnapshot.findFirstOrThrow(
      {
        where: { tenantId, orderId: created.orderId },
      },
    );
    expect(snapshot.schemaVersion).toBe(2);
    expect(snapshot.templateVersionId).toBe(template.versionId);
    expect(
      (snapshot.configJson as { schemaVersion: number }).schemaVersion,
    ).toBe(2);

    const usedTemplate = await client.gameDispatchTemplate.findFirstOrThrow({
      where: { tenantId, id: template.templateId },
    });
    expect(usedTemplate.lastUsedAt).not.toBeNull();
    const audit = await client.auditLog.findFirst({
      where: { tenantId, resourceId: created.dispatchOrderId },
    });
    expect(audit?.action).toBe("game_dispatch.template_order.create");
  });

  it("同一幂等键重试回放首次结果，不同请求体 422 且只创建一个派单", async () => {
    const template = await createPublishedTemplate(
      ownerToken,
      "S4 幂等模板",
      gameId,
      orderConfig(),
    );
    const key = `k-${suffix}-idem`;
    const body = orderBody({
      templateId: template.templateId,
      templateVersionId: template.versionId,
    });
    const send = (payload: unknown) =>
      request(app.getHttpServer())
        .post("/api/v1/tenant/game-dispatch/template-orders")
        .set({ authorization: `Bearer ${ownerToken}`, "idempotency-key": key })
        .send(payload);

    const first = await send(body).expect(201);
    const replay = await send(body).expect(201);
    const firstId = (first.body as { data: CreateOrderResult }).data
      .dispatchOrderId;
    expect(
      (replay.body as { data: CreateOrderResult }).data.dispatchOrderId,
    ).toBe(firstId);
    const count = await client.gameDispatchOrder.count({
      where: { tenantId, templateVersionId: template.versionId },
    });
    expect(count).toBe(1);

    const mismatch = await send({
      ...body,
      values: {
        mode: "normal",
        roster_table: [{ position: "陪玩", count: 1 }],
      },
    }).expect(422);
    expect((mismatch.body as { code: string }).code).toBe(
      "TEMPLATE_IDEMPOTENCY_MISMATCH",
    );
  });

  it("缺少或过短的 Idempotency-Key 返回 400", async () => {
    const missing = await request(app.getHttpServer())
      .post("/api/v1/tenant/game-dispatch/template-orders")
      .set({ authorization: `Bearer ${ownerToken}` })
      .send(orderBody())
      .expect(400);
    expect((missing.body as { code: string }).code).toBe(
      "TEMPLATE_IDEMPOTENCY_REQUIRED",
    );

    await request(app.getHttpServer())
      .post("/api/v1/tenant/game-dispatch/template-orders")
      .set({
        authorization: `Bearer ${ownerToken}`,
        "idempotency-key": "short",
      })
      .send(orderBody())
      .expect(400);
  });

  it("模板归档后拒绝创建，且客户端伪造人数或价格被拒 422", async () => {
    const template = await createPublishedTemplate(
      ownerToken,
      "S4 归档模板",
      gameId,
      orderConfig(),
    );
    const detail = await req(ownerToken)
      .get(`${BASE}/${template.templateId}/draft`)
      .expect(200);
    await req(ownerToken)
      .post(`${BASE}/${template.templateId}/archive`, {
        expectedRevision: (detail.body as { data: { revision: number } }).data
          .revision,
      })
      .expect(201);

    const archived = await request(app.getHttpServer())
      .post("/api/v1/tenant/game-dispatch/template-orders")
      .set({
        authorization: `Bearer ${ownerToken}`,
        "idempotency-key": `k-${suffix}-archived`,
      })
      .send(
        orderBody({
          templateId: template.templateId,
          templateVersionId: template.versionId,
        }),
      )
      .expect(409);
    expect((archived.body as { code: string }).code).toBe("TEMPLATE_ARCHIVED");

    const forged = await request(app.getHttpServer())
      .post("/api/v1/tenant/game-dispatch/template-orders")
      .set({
        authorization: `Bearer ${ownerToken}`,
        "idempotency-key": `k-${suffix}-forged`,
      })
      .send(
        orderBody({
          values: {
            mode: "ranked",
            roster_table: [{ position: "陪玩", count: 1 }],
            totalCount: 99,
            priceAdjustmentFen: "0",
          },
        }),
      )
      .expect(422);
    expect((forged.body as { code: string }).code).toBe(
      "TEMPLATE_COMPONENT_INVALID",
    );
  });

  it("版本不属于该模板时 422，跨租户创建 404", async () => {
    const mismatched = await request(app.getHttpServer())
      .post("/api/v1/tenant/game-dispatch/template-orders")
      .set({
        authorization: `Bearer ${ownerToken}`,
        "idempotency-key": `k-${suffix}-version`,
      })
      .send(orderBody({ templateVersionId: secondaryVersionId }))
      .expect(422);
    expect((mismatched.body as { code: string }).code).toBe(
      "TEMPLATE_VERSION_UNAVAILABLE",
    );

    const foreign = await request(app.getHttpServer())
      .post("/api/v1/tenant/game-dispatch/template-orders")
      .set({
        authorization: `Bearer ${foreignToken}`,
        "idempotency-key": `k-${suffix}-foreign`,
      })
      .send(
        orderBody({
          gameId: foreignGameId,
          customerProfileId: customerId,
        }),
      )
      .expect(404);
    expect((foreign.body as { code: string }).code).toBe("TEMPLATE_NOT_FOUND");
  });

  it("PLAYER 不能创建派单（403）", async () => {
    await request(app.getHttpServer())
      .post("/api/v1/tenant/game-dispatch/template-orders")
      .set({
        authorization: `Bearer ${playerToken}`,
        "idempotency-key": `k-${suffix}-player`,
      })
      .send(orderBody())
      .expect(403);
  });

  it("订单详情按自身快照产出文案：模板再发布后不变，且不泄露内部键", async () => {
    const template = await createPublishedTemplate(
      ownerToken,
      "S4 文案模板",
      gameId,
      orderConfig(),
    );
    const created = await request(app.getHttpServer())
      .post("/api/v1/tenant/game-dispatch/template-orders")
      .set({
        authorization: `Bearer ${ownerToken}`,
        "idempotency-key": `k-${suffix}-doc`,
      })
      .send(
        orderBody({
          templateId: template.templateId,
          templateVersionId: template.versionId,
        }),
      )
      .expect(201);
    const createdResult = (created.body as { data: CreateOrderResult }).data;

    const first = await req(ownerToken)
      .get(`/api/v1/tenant/game-dispatch/orders/${createdResult.orderId}`)
      .expect(200);
    const firstDocument = (first.body as OrderDetailBody).data.document;
    expect(firstDocument).not.toBeNull();
    expect(firstDocument?.plainText).toBe(createdResult.document.plainText);
    expect(firstDocument?.generatedFromSnapshotAt).toBeTruthy();
    expect(firstDocument?.plainText).toContain("游戏模式：排位");

    // 文案本身不泄露内部键名或数据库列名（订单值按 stableKey 回显属既有设计）
    const serializedDocument = JSON.stringify(firstDocument);
    for (const internal of [
      "roster_table",
      "semanticRole",
      "staffingSource",
      "config_json",
    ]) {
      expect(serializedDocument).not.toContain(internal);
    }
    expect((first.body as OrderDetailBody).data.copyText).toBeTruthy();

    // 模板改配置并发布 v2：历史订单文案必须仍来自它自己的快照
    const changed = orderConfig();
    const sections = changed.sections as { label: string }[];
    if (sections[0]) sections[0].label = "基本信息（改）";
    const detail = await req(ownerToken)
      .get(`${BASE}/${template.templateId}/draft`)
      .expect(200);
    const revision = (detail.body as { data: { revision: number } }).data
      .revision;
    await req(ownerToken)
      .patch(`${BASE}/${template.templateId}/draft`, {
        expectedRevision: revision,
        config: changed,
      })
      .expect(200);
    const published = await req(ownerToken)
      .post(`${BASE}/${template.templateId}/publish`, {
        expectedRevision: revision + 1,
        changeNote: "S4 文案回归",
      })
      .expect(201);
    const nextVersionId = (
      published.body as { data: { activeVersion: { id: string } } }
    ).data.activeVersion.id;
    expect(nextVersionId).not.toBe(template.versionId);

    // 新版本确实变了，否则「订单文案不变」就是空证据
    const form = await req(ownerToken)
      .get(`${BASE}/versions/${nextVersionId}/form`)
      .expect(200);
    expect(JSON.stringify((form.body as { data: unknown }).data)).toContain(
      "基本信息（改）",
    );

    const second = await req(ownerToken)
      .get(`/api/v1/tenant/game-dispatch/orders/${createdResult.orderId}`)
      .expect(200);
    expect((second.body as OrderDetailBody).data.document).toEqual(
      firstDocument,
    );
  });
});
