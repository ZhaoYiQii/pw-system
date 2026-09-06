import "reflect-metadata";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Test } from "@nestjs/testing";
import request from "supertest";
import type { INestApplication } from "@nestjs/common";
import { AppModule } from "../../apps/api/src/app.module.js";
import { hashPassword } from "../../apps/api/src/modules/identity-access/infrastructure/password.js";
import { createDatabaseClient } from "@pw/database";
import type { PrismaClient } from "@pw/database";

const PW = "Authz-Password-1";
const suffix = Date.now().toString(36);

function envOrThrow(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`missing env ${name}`);
  return v;
}

interface Data {
  accessToken?: string;
}

describe("A1 authz: audit/notifications/disputes ownership (HTTP negative cases)", () => {
  let app: INestApplication;
  let client: PrismaClient;
  let tenantId: string;
  let tenantCode: string;
  let ownerToken: string;
  let customerAToken: string;
  let customerBToken: string;
  let playerToken: string;
  let orderAId = "";
  let orderBId = "";
  let notifAId = "";
  let notifBId = "";

  beforeAll(async () => {
    client = createDatabaseClient(envOrThrow("PW_TEST_MIGRATION_URL"));
    const hash = await hashPassword(PW);
    tenantCode = `az_${suffix}`;
    const t = await client.tenant.create({
      data: { code: tenantCode, name: "授权店" },
    });
    tenantId = t.id;

    const owner = await client.tenantAccount.create({
      data: { tenantId, username: "boss", passwordHash: hash },
    });
    await client.tenantAccountRole.create({
      data: { tenantId, tenantAccountId: owner.id, role: "TENANT_OWNER" },
    });

    const custAAcc = await client.tenantAccount.create({
      data: { tenantId, username: "cust_a", passwordHash: hash },
    });
    await client.tenantAccountRole.create({
      data: { tenantId, tenantAccountId: custAAcc.id, role: "CUSTOMER" },
    });
    const profileA = await client.customerProfile.create({
      data: { tenantId, name: "客户A", tenantAccountId: custAAcc.id },
    });

    const custBAcc = await client.tenantAccount.create({
      data: { tenantId, username: "cust_b", passwordHash: hash },
    });
    await client.tenantAccountRole.create({
      data: { tenantId, tenantAccountId: custBAcc.id, role: "CUSTOMER" },
    });
    const profileB = await client.customerProfile.create({
      data: { tenantId, name: "客户B", tenantAccountId: custBAcc.id },
    });

    const playerAcc = await client.tenantAccount.create({
      data: { tenantId, username: "player_a", passwordHash: hash },
    });
    await client.tenantAccountRole.create({
      data: { tenantId, tenantAccountId: playerAcc.id, role: "PLAYER" },
    });
    const playerProfile = await client.playerProfile.create({
      data: { tenantId, name: "陪玩A", tenantAccountId: playerAcc.id },
    });

    const orderA = await client.order.create({
      data: {
        tenantId,
        orderNo: `azA_${suffix}`,
        customerProfileId: profileA.id,
      },
    });
    orderAId = orderA.id;
    const orderB = await client.order.create({
      data: {
        tenantId,
        orderNo: `azB_${suffix}`,
        customerProfileId: profileB.id,
      },
    });
    orderBId = orderB.id;

    // 陪玩 A 被指派到 order A（用于通知可见性与“无 earning 开争议”）
    await client.assignment.create({
      data: {
        tenantId,
        orderId: orderAId,
        playerId: playerProfile.id,
        createdBy: owner.id,
      },
    });
    await client.earning.create({
      data: {
        tenantId,
        orderId: orderAId,
        playerId: playerProfile.id,
        amountFen: BigInt(7700),
      },
    });

    const notifs = await client.notificationDelivery.createMany({
      data: [
        {
          tenantId,
          recipientType: "order",
          recipientId: orderAId,
          channel: "INAPP",
          title: "订单A通知",
          content: "order A",
          status: "PENDING",
        },
        {
          tenantId,
          recipientType: "order",
          recipientId: orderBId,
          channel: "INAPP",
          title: "订单B通知",
          content: "order B",
          status: "PENDING",
        },
      ],
    });
    const rows = await client.notificationDelivery.findMany({
      where: { tenantId },
      orderBy: { createdAt: "asc" },
      select: { id: true, recipientId: true },
    });
    notifAId = rows.find((r) => r.recipientId === orderAId)?.id as string;
    notifBId = rows.find((r) => r.recipientId === orderBId)?.id as string;
    expect(notifs.count).toBe(2);

    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();

    async function login(username: string): Promise<string> {
      const res = await request(app.getHttpServer())
        .post("/api/v1/auth/login")
        .send({ kind: "tenant", tenantCode, username, password: PW })
        .expect(201);
      return (res.body as { data: Data }).data.accessToken as string;
    }
    ownerToken = await login("boss");
    customerAToken = await login("cust_a");
    customerBToken = await login("cust_b");
    playerToken = await login("player_a");
  });

  afterAll(async () => {
    if (client) {
      await client.notificationDelivery.deleteMany({ where: { tenantId } });
      await client.disputeEvent.deleteMany({ where: { tenantId } });
      await client.dispute.deleteMany({ where: { tenantId } });
      await client.auditLog.deleteMany({ where: { tenantId } });
      await client.earning.deleteMany({ where: { tenantId } });
      await client.assignment.deleteMany({ where: { tenantId } });
      await client.order.deleteMany({ where: { tenantId } });
      await client.playerProfile.deleteMany({ where: { tenantId } });
      await client.customerProfile.deleteMany({ where: { tenantId } });
      await client.tenantAccountRole.deleteMany({ where: { tenantId } });
      await client.tenantAccount.deleteMany({ where: { tenantId } });
      await client.tenant.deleteMany({ where: { id: tenantId } });
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

  it("审计：TENANT_OWNER 可读，CUSTOMER/PLAYER 403", async () => {
    await req(ownerToken).get("/api/v1/tenant/audit").expect(200);
    await req(customerAToken).get("/api/v1/tenant/audit").expect(403);
    await req(playerToken).get("/api/v1/tenant/audit").expect(403);
  });

  it("通知：按角色可见性过滤（客户只看自己订单；陪玩只看自己被指派/报名的订单）", async () => {
    const ownerRows = (
      await req(ownerToken).get("/api/v1/tenant/notifications").expect(200)
    ).body.data as Array<{ id: string }>;
    expect(ownerRows.map((r) => r.id).sort()).toEqual(
      [notifAId, notifBId].sort(),
    );

    const aRows = (
      await req(customerAToken).get("/api/v1/tenant/notifications").expect(200)
    ).body.data as Array<{ id: string }>;
    expect(aRows.map((r) => r.id)).toEqual([notifAId]);

    const bRows = (
      await req(customerBToken).get("/api/v1/tenant/notifications").expect(200)
    ).body.data as Array<{ id: string }>;
    expect(bRows.map((r) => r.id)).toEqual([notifBId]);

    const pRows = (
      await req(playerToken).get("/api/v1/tenant/notifications").expect(200)
    ).body.data as Array<{ id: string }>;
    expect(pRows.map((r) => r.id)).toEqual([notifAId]);
  });

  it("争议列表：客户只能看自己的订单；陪玩不能看；员工可看", async () => {
    await req(ownerToken)
      .get(`/api/v1/tenant/orders/${orderAId}/disputes`)
      .expect(200);
    await req(customerAToken)
      .get(`/api/v1/tenant/orders/${orderAId}/disputes`)
      .expect(200);
    await req(customerBToken)
      .get(`/api/v1/tenant/orders/${orderAId}/disputes`)
      .expect(403);
    await req(playerToken)
      .get(`/api/v1/tenant/orders/${orderAId}/disputes`)
      .expect(403);
  });

  it("争议开单：客户不能对他人的订单开争议；陪玩不能开；无 earning 但有指派时可开", async () => {
    await req(customerBToken)
      .post(`/api/v1/tenant/orders/${orderAId}/disputes`, {
        reason: "别人的订单不应可开",
      })
      .expect(403);
    await req(playerToken)
      .post(`/api/v1/tenant/orders/${orderAId}/disputes`, {
        reason: "陪玩不应开",
      })
      .expect(403);

    // 客户 A 对自有订单、无 earningId：有指派 → 应成功（去掉零 UUID 占位）
    const d = (
      await req(customerAToken)
        .post(`/api/v1/tenant/orders/${orderAId}/disputes`, {
          reason: "服务体验问题（未核算）",
        })
        .expect(201)
    ).body.data as { id: string; status: string; earningId: string | null };
    expect(d.status).toBe("OPEN");
    expect(d.earningId).toBeNull();

    // earning 不属于该订单 → 400，且不产生零 UUID 记录
    await req(ownerToken)
      .post(`/api/v1/tenant/orders/${orderBId}/disputes`, {
        reason: "错误关联",
        earningId: (
          await client.earning.findFirst({
            where: { tenantId, orderId: orderAId },
          })
        )?.id,
      })
      .expect(400);
  });
});
