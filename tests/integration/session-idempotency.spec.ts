import "reflect-metadata";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Test } from "@nestjs/testing";
import request from "supertest";
import type { INestApplication } from "@nestjs/common";
import { AppModule } from "../../apps/api/src/app.module.js";
import { hashPassword } from "../../apps/api/src/modules/identity-access/infrastructure/password.js";
import { createDatabaseClient } from "@pw/database";
import type { PrismaClient } from "@pw/database";

const PW = "Slice7-Password-1";
const suffix = Date.now().toString(36);
function envOrThrow(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`missing env ${name}`);
  return v;
}
interface Data {
  accessToken?: string;
}

describe("Slice 7 session (服务器时钟/幂等/调整)", () => {
  let app: INestApplication;
  let client: PrismaClient;
  let tenantId: string;
  let tenantCode: string;
  let ownerToken: string;
  let pToken: string;
  let orderId = "";
  let otherTenantCode: string | undefined;

  beforeAll(async () => {
    client = createDatabaseClient(envOrThrow("PW_TEST_MIGRATION_URL"));
    const hash = await hashPassword(PW);
    tenantCode = `s7_${suffix}`;
    const t = await client.tenant.create({
      data: { code: tenantCode, name: "场次店" },
    });
    tenantId = t.id;
    await client.tenantEntitlement.createMany({
      data: [
        {
          tenantId: tenantId,
          featureKey: "addon.customer_self_service",
          enabled: true,
          source: "test",
        },
        {
          tenantId: tenantId,
          featureKey: "addon.player_order_hall",
          enabled: true,
          source: "test",
        },
      ],
    });
    const owner = await client.tenantAccount.create({
      data: { tenantId, username: "boss", passwordHash: hash },
    });
    await client.tenantAccountRole.create({
      data: { tenantId, tenantAccountId: owner.id, role: "TENANT_OWNER" },
    });
    const cust = await client.customerProfile.create({
      data: { tenantId, name: "场次客" },
    });
    const game = await client.game.create({
      data: { tenantId, name: "永劫无间" },
    });
    const product = await client.serviceProduct.create({
      data: { tenantId, gameId: game.id, name: "双排上分" },
    });
    await client.pricingRule.create({
      data: {
        tenantId,
        serviceProductId: product.id,
        durationSeconds: 3600,
        priceFen: BigInt(2600),
        playerCostFen: BigInt(1300),
      },
    });
    const acc = await client.tenantAccount.create({
      data: { tenantId, username: "p7", passwordHash: hash },
    });
    await client.tenantAccountRole.create({
      data: { tenantId, tenantAccountId: acc.id, role: "PLAYER" },
    });
    const prof = await client.playerProfile.create({
      data: { tenantId, name: "场次陪玩", tenantAccountId: acc.id },
    });
    await client.playerSkill.create({
      data: { tenantId, playerId: prof.id, gameId: game.id },
    });

    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    async function login(username: string) {
      const res = await request(app.getHttpServer())
        .post("/api/v1/auth/login")
        .send({ kind: "tenant", tenantCode, username, password: PW })
        .expect(201);
      return (res.body as { data: Data }).data.accessToken as string;
    }
    ownerToken = await login("boss");
    pToken = await login("p7");

    const created = await request(app.getHttpServer())
      .post("/api/v1/tenant/orders")
      .set("authorization", `Bearer ${ownerToken}`)
      .send({
        customerProfileId: cust.id,
        requirement: {
          description: "双排一晚上分",
          serviceProductId: product.id,
          durationSeconds: 3600,
        },
      })
      .expect(201);
    orderId = (created.body.data as { id: string }).id;
    await request(app.getHttpServer())
      .post(`/api/v1/tenant/orders/${orderId}/confirm`)
      .set("authorization", `Bearer ${ownerToken}`)
      .expect(201);
    await request(app.getHttpServer())
      .post(`/api/v1/tenant/orders/${orderId}/publish`)
      .set("authorization", `Bearer ${ownerToken}`)
      .expect(201);
    await request(app.getHttpServer())
      .post(`/api/v1/tenant/player/orders/${orderId}/applications`)
      .set("authorization", `Bearer ${pToken}`)
      .expect(201);
    const apps = (
      await request(app.getHttpServer())
        .get(`/api/v1/tenant/orders/${orderId}/applications`)
        .set("authorization", `Bearer ${ownerToken}`)
        .expect(200)
    ).body.data as Array<{ id: string }>;
    await request(app.getHttpServer())
      .post(`/api/v1/tenant/orders/${orderId}/assignment`)
      .set("authorization", `Bearer ${ownerToken}`)
      .send({ applicationId: apps[0]?.id })
      .expect(201);
  });

  afterAll(async () => {
    if (client) {
      await client.auditLog.deleteMany({ where: { tenantId } });
      await client.outboxEvent.deleteMany({ where: { tenantId } });
      await client.evidenceAsset.deleteMany({ where: { tenantId } });
      const sessions = await client.serviceSession.findMany({
        where: { tenantId },
      });
      for (const s of sessions) {
        await client.sessionAdjustment.deleteMany({
          where: { sessionId: s.id },
        });
        await client.sessionEvent.deleteMany({ where: { sessionId: s.id } });
      }
      await client.serviceSession.deleteMany({ where: { tenantId } });
      await client.assignment.deleteMany({ where: { tenantId } });
      await client.application.deleteMany({ where: { tenantId } });
      await client.dispatchPublication.deleteMany({ where: { tenantId } });
      const orders = await client.order.findMany({ where: { tenantId } });
      for (const o of orders) {
        await client.orderEvent.deleteMany({ where: { orderId: o.id } });
        await client.orderPriceSnapshot.deleteMany({
          where: { orderId: o.id },
        });
        await client.orderRequirement.deleteMany({ where: { orderId: o.id } });
      }
      await client.order.deleteMany({ where: { tenantId } });
      await client.playerSkill.deleteMany({ where: { tenantId } });
      await client.playerProfile.deleteMany({ where: { tenantId } });
      await client.pricingRule.deleteMany({ where: { tenantId } });
      await client.serviceProduct.deleteMany({ where: { tenantId } });
      await client.game.deleteMany({ where: { tenantId } });
      await client.customerProfile.deleteMany({ where: { tenantId } });
      await client.tenantAccountRole.deleteMany({ where: { tenantId } });
      await client.tenantAccount.deleteMany({ where: { tenantId } });
      await client.tenantEntitlement.deleteMany({ where: { tenantId } });
      await client.tenant.deleteMany({ where: { id: tenantId } });
      if (otherTenantCode) {
        const otherTenants = await client.tenant.findMany({
          where: { code: otherTenantCode },
        });
        for (const ot of otherTenants) {
          await client.auditLog.deleteMany({ where: { tenantId: ot.id } });
          const accounts = await client.tenantAccount.findMany({
            where: { tenantId: ot.id },
          });
          await client.refreshSession.deleteMany({
            where: {
              accountId: { in: accounts.map((a) => a.id) },
            },
          });
          await client.tenantAccountRole.deleteMany({
            where: { tenantId: ot.id },
          });
          await client.tenantAccount.deleteMany({
            where: { tenantId: ot.id },
          });
          await client.tenant.deleteMany({ where: { id: ot.id } });
        }
      }
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
    };
  }

  it("开始/结束用服务器时间；重复开始/结束幂等只产生一个事件", async () => {
    const start = (
      await req(pToken)
        .post(`/api/v1/tenant/orders/${orderId}/session/start`)
        .expect(201)
    ).body.data as {
      id: string;
      status: string;
      startedAt: string;
      events: unknown[];
    };
    expect(start.status).toBe("STARTED");
    expect(start.startedAt).toBeTruthy();
    await new Promise((r) => setTimeout(r, 1100));

    const start2 = (
      await req(pToken)
        .post(`/api/v1/tenant/orders/${orderId}/session/start`)
        .expect(201)
    ).body.data as { id: string };
    expect(start2.id).toBe(start.id);

    // 主规格 10.3：结束场次前必须有真实图片证据。
    await req(pToken)
      .post(`/api/v1/tenant/orders/${orderId}/session/end`)
      .expect(400);
    await request(app.getHttpServer())
      .post(`/api/v1/tenant/sessions/${start.id}/evidence`)
      .set("authorization", `Bearer ${pToken}`)
      .set("content-type", "application/octet-stream")
      .set("x-file-name", "shot.png")
      .send(
        Buffer.from([
          0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0, 0, 0, 0,
          0,
        ]),
      )
      .expect(201);

    const end = (
      await req(pToken)
        .post(`/api/v1/tenant/orders/${orderId}/session/end`)
        .expect(201)
    ).body.data as {
      status: string;
      durationSeconds: number;
    };
    expect(end.status).toBe("ENDED");
    expect(end.durationSeconds).toBeGreaterThanOrEqual(1);

    const end2 = (
      await req(pToken)
        .post(`/api/v1/tenant/orders/${orderId}/session/end`)
        .expect(201)
    ).body.data as { durationSeconds: number; status: string };
    expect(end2.durationSeconds).toBe(end.durationSeconds);
    expect(end2.status).toBe("ENDED");

    const session = (
      await req(ownerToken)
        .get(`/api/v1/tenant/orders/${orderId}/session`)
        .expect(200)
    ).body.data as { events: Array<{ eventType: string }> };
    const starts = session.events.filter(
      (e) => e.eventType === "SESSION_STARTED",
    ).length;
    const ends = session.events.filter(
      (e) => e.eventType === "SESSION_ENDED",
    ).length;
    expect(starts).toBe(1);
    expect(ends).toBe(1);
  });

  it("陪玩可申请时长调整，客服复核通过后更新（不覆盖原始事件）", async () => {
    const session = (
      await req(pToken)
        .get(`/api/v1/tenant/orders/${orderId}/session`)
        .expect(200)
    ).body.data as { id: string; durationSeconds: number };
    const original = session.durationSeconds as number;
    const adj = await req(pToken)
      .post(`/api/v1/tenant/sessions/${session.id}/adjustments`, {
        requestedDurationSeconds: original + 600,
        reason: "开局等待 10 分钟",
      })
      .expect(201);
    expect((adj.body.data as { status: string }).status).toBe(
      "ADJUSTMENT_PENDING",
    );
    const detail = (
      await req(ownerToken)
        .get(`/api/v1/tenant/orders/${orderId}/session`)
        .expect(200)
    ).body.data as { adjustments: Array<{ id: string; status: string }> };
    expect(detail.adjustments[0]?.status).toBe("PENDING");
    await req(ownerToken)
      .post(
        `/api/v1/tenant/sessions/${session.id}/adjustments/${detail.adjustments[0]?.id}/review`,
        { approve: true, comment: "同意" },
      )
      .expect(201);
    const after = (
      await req(ownerToken)
        .get(`/api/v1/tenant/orders/${orderId}/session`)
        .expect(200)
    ).body.data as { durationSeconds: number };
    expect(after.durationSeconds).toBe(original + 600);
  });

  it("证据上传：伪装图片/超大文件被拒，真实 PNG 可上传下载", async () => {
    // 先开始场次
    await req(pToken)
      .post(`/api/v1/tenant/orders/${orderId}/session/start`)
      .expect(201);
    const png = Buffer.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0, 0, 0, 0, 0,
    ]);
    const server = app.getHttpServer();
    // 先拿 session id
    const sess = (
      await req(pToken)
        .get(`/api/v1/tenant/orders/${orderId}/session`)
        .expect(200)
    ).body.data as { id: string };
    // 伪装：文本冒充 jpg
    await request(server)
      .post(`/api/v1/tenant/sessions/${sess.id}/evidence`)
      .set("authorization", `Bearer ${pToken}`)
      .set("content-type", "application/octet-stream")
      .set("x-file-name", "fake.jpg")
      .send(Buffer.from("hello fake image"))
      .expect(400);
    // 超大
    const big = Buffer.alloc(10 * 1024 * 1024 + 1, 1);
    await request(server)
      .post(`/api/v1/tenant/sessions/${sess.id}/evidence`)
      .set("authorization", `Bearer ${pToken}`)
      .set("content-type", "application/octet-stream")
      .set("x-file-name", "big.png")
      .send(big)
      .expect(400);
    // 真实 PNG
    const up = await request(server)
      .post(`/api/v1/tenant/sessions/${sess.id}/evidence`)
      .set("authorization", `Bearer ${pToken}`)
      .set("content-type", "application/octet-stream")
      .set("x-file-name", "shot.png")
      .send(png)
      .expect(201);
    const evId = (up.body.data as { id: string }).id;
    expect((up.body.data as { mimeType: string }).mimeType).toBe("image/png");
    const dl = await request(server)
      .get(`/api/v1/tenant/evidence/${evId}`)
      .set("authorization", `Bearer ${ownerToken}`)
      .expect(200);
    expect(dl.body.length).toBe(png.length);
    // 跨租户下载 404（防枚举）
    const t2 = await client.tenant.create({
      data: { code: `s7b_${suffix}`, name: "隔壁店" },
    });
    otherTenantCode = t2.code;
    const o2 = await client.tenantAccount.create({
      data: {
        tenantId: t2.id,
        username: "boss2",
        passwordHash: await hashPassword(PW),
      },
    });
    await client.tenantAccountRole.create({
      data: { tenantId: t2.id, tenantAccountId: o2.id, role: "TENANT_OWNER" },
    });
    const login2 = await request(server)
      .post("/api/v1/auth/login")
      .send({
        kind: "tenant",
        tenantCode: otherTenantCode,
        username: "boss2",
        password: PW,
      })
      .expect(201);
    const token2 = (login2.body as { data: Data }).data.accessToken as string;
    await request(server)
      .get(`/api/v1/tenant/evidence/${evId}`)
      .set("authorization", `Bearer ${token2}`)
      .expect(404);
  });
});
