import "reflect-metadata";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Test } from "@nestjs/testing";
import request from "supertest";
import type { INestApplication } from "@nestjs/common";
import { AppModule } from "../../apps/api/src/app.module.js";
import { hashPassword } from "../../apps/api/src/modules/identity-access/infrastructure/password.js";
import { createDatabaseClient } from "@pw/database";
import type { PrismaClient } from "@pw/database";

const PW = "NotifyRead-Password-1";
const suffix = Date.now().toString(36);

function envOrThrow(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`missing env ${name}`);
  return v;
}

describe("C4 通知已读（readAt/read-all + 可见性越权负例）", () => {
  let app: INestApplication;
  let client: PrismaClient;
  let tenantId: string;
  let ownerToken: string;
  let customerToken: string;
  let unrelatedNotificationId: string;
  let relatedNotificationId: string;

  beforeAll(async () => {
    client = createDatabaseClient(envOrThrow("PW_TEST_MIGRATION_URL"));
    const hash = await hashPassword(PW);
    const code = `nr_${suffix}`;
    const tenant = await client.tenant.create({
      data: { code, name: "通知店" },
    });
    tenantId = tenant.id;

    const owner = await client.tenantAccount.create({
      data: { tenantId, username: "owner", passwordHash: hash },
    });
    await client.tenantAccountRole.create({
      data: { tenantId, tenantAccountId: owner.id, role: "TENANT_OWNER" },
    });
    const customerAcc = await client.tenantAccount.create({
      data: { tenantId, username: "customer", passwordHash: hash },
    });
    await client.tenantAccountRole.create({
      data: {
        tenantId,
        tenantAccountId: customerAcc.id,
        role: "CUSTOMER",
      },
    });
    const profile = await client.customerProfile.create({
      data: {
        tenantId,
        name: "通知客户",
        tenantAccountId: customerAcc.id,
      },
    });
    const order = await client.order.create({
      data: {
        tenantId,
        orderNo: `nr_${suffix}`,
        customerProfileId: profile.id,
      },
    });
    const unrelated = await client.notificationDelivery.create({
      data: {
        tenantId,
        channel: "INAPP",
        title: "无关订单通知",
        content: "其他客户的订单动态",
        recipientType: "order",
        recipientId: "00000000-0000-4000-8000-000000000001",
      },
    });
    const related = await client.notificationDelivery.create({
      data: {
        tenantId,
        channel: "INAPP",
        title: "我的订单通知",
        content: "订单已确认",
        recipientType: "order",
        recipientId: order.id,
      },
    });
    unrelatedNotificationId = unrelated.id;
    relatedNotificationId = related.id;

    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    async function login(username: string) {
      const res = await request(app.getHttpServer())
        .post("/api/v1/auth/login")
        .send({ kind: "tenant", tenantCode: code, username, password: PW })
        .expect(201);
      return (
        res.body as {
          data: { accessToken?: string };
        }
      ).data.accessToken as string;
    }
    ownerToken = await login("owner");
    customerToken = await login("customer");
  });

  afterAll(async () => {
    if (client) {
      await client.auditLog.deleteMany({ where: { tenantId } });
      await client.notificationDelivery.deleteMany({ where: { tenantId } });
      await client.order.deleteMany({ where: { tenantId } });
      await client.customerProfile.deleteMany({ where: { tenantId } });
      await client.tenantAccountRole.deleteMany({ where: { tenantId } });
      await client.tenantAccount.deleteMany({ where: { tenantId } });
      await client.tenant.deleteMany({ where: { id: tenantId } });
      await client.$disconnect();
    }
    if (app) await app.close();
  });

  function req(token: string) {
    const headers = { authorization: `Bearer ${token}` };
    return {
      get: (url: string) => request(app.getHttpServer()).get(url).set(headers),
      post: (url: string) =>
        request(app.getHttpServer()).post(url).set(headers),
    };
  }

  it("员工可 read-all；单项标记已读后 readAt 非空", async () => {
    const all = (
      await req(ownerToken).get("/api/v1/tenant/notifications").expect(200)
    ).body.data as Array<{ id: string; readAt: string | null }>;
    expect(all).toHaveLength(2);
    expect(all.every((n) => n.readAt === null)).toBe(true);

    const marked = (
      await req(ownerToken)
        .post(`/api/v1/tenant/notifications/${relatedNotificationId}/read`)
        .expect(201)
    ).body.data as { id: string; read: boolean };
    expect(marked).toEqual({ id: relatedNotificationId, read: true });

    const afterRead = (
      await req(ownerToken).get("/api/v1/tenant/notifications").expect(200)
    ).body.data as Array<{ id: string; readAt: string | null }>;
    expect(
      afterRead.find((n) => n.id === relatedNotificationId)?.readAt,
    ).not.toBeNull();

    const cleared = await client.notificationDelivery.update({
      where: { id: relatedNotificationId },
      data: { readAt: null },
    });
    expect(cleared.readAt).toBeNull();
    const bulk = (
      await req(ownerToken)
        .post("/api/v1/tenant/notifications/read-all")
        .expect(201)
    ).body.data as { updated: number };
    expect(bulk.updated).toBe(2);
  });

  it("客户只能看到/标记自己订单的通知；越权 404", async () => {
    const visible = (
      await req(customerToken).get("/api/v1/tenant/notifications").expect(200)
    ).body.data as Array<{ id: string }>;
    expect(visible.map((n) => n.id)).toEqual([relatedNotificationId]);

    await req(customerToken)
      .post(`/api/v1/tenant/notifications/${unrelatedNotificationId}/read`)
      .expect(404);

    await client.notificationDelivery.update({
      where: { id: relatedNotificationId },
      data: { readAt: null },
    });
    await req(customerToken)
      .post(`/api/v1/tenant/notifications/${relatedNotificationId}/read`)
      .expect(201);
    const after = await client.notificationDelivery.findFirstOrThrow({
      where: { id: relatedNotificationId },
      select: { readAt: true },
    });
    expect(after.readAt).not.toBeNull();
  });
});
