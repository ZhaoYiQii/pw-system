import "reflect-metadata";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Test } from "@nestjs/testing";
import request from "supertest";
import type { INestApplication } from "@nestjs/common";
import { AppModule } from "../../apps/api/src/app.module.js";
import {
  drainOutbox,
  requeueFailedOutboxEvent,
} from "../../apps/api/src/modules/notifications/outbox.relay.js";
import { hashPassword } from "../../apps/api/src/modules/identity-access/infrastructure/password.js";
import { createDatabaseClient } from "@pw/database";
import type { PrismaClient } from "@pw/database";

const PW = "Outbox-Password-1";
const suffix = Date.now().toString(36);
function envOrThrow(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`missing env ${name}`);
  return v;
}
interface Data {
  accessToken?: string;
}

describe("C3 outbox relay: tenant scope / lease recovery (重放不重复)", () => {
  let app: INestApplication;
  let client: PrismaClient;
  let tenantId: string;
  let staleTenantId: string;
  let ownerToken: string;

  beforeAll(async () => {
    client = createDatabaseClient(envOrThrow("PW_TEST_MIGRATION_URL"));
    const hash = await hashPassword(PW);
    const t = await client.tenant.create({
      data: { code: `ox_${suffix}`, name: "outbox店" },
    });
    tenantId = t.id;
    const staleT = await client.tenant.create({
      data: { code: `oxs_${suffix}`, name: "outbox残留店" },
    });
    staleTenantId = staleT.id;
    const owner = await client.tenantAccount.create({
      data: { tenantId, username: "boss", passwordHash: hash },
    });
    await client.tenantAccountRole.create({
      data: { tenantId, tenantAccountId: owner.id, role: "TENANT_OWNER" },
    });
    // 历史残留：其他租户更早的 25 条 PENDING（当前 relay 若不按租户隔离会把它们先消费掉）
    await client.outboxEvent.createMany({
      data: Array.from({ length: 25 }, (_, i) => ({
        tenantId: staleTenantId,
        aggregateType: "order",
        aggregateId: `stale-${i}`,
        eventType: "order.confirmed",
        payload: { orderNo: `STALE${i}` },
        createdAt: new Date(Date.now() - 2 * 3600 * 1000 - i * 1000),
      })),
    });
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    const login = await request(app.getHttpServer())
      .post("/api/v1/auth/login")
      .send({
        kind: "tenant",
        tenantCode: t.code,
        username: "boss",
        password: PW,
      })
      .expect(201);
    ownerToken = (login.body as { data: Data }).data.accessToken as string;
  });

  async function seedOwnPending(): Promise<string[]> {
    const created = await client.outboxEvent.createMany({
      data: [
        {
          tenantId,
          aggregateType: "order",
          aggregateId: `own-1-${suffix}`,
          eventType: "order.confirmed",
          payload: { orderNo: "A1" },
        },
        {
          tenantId,
          aggregateType: "order",
          aggregateId: `own-2-${suffix}`,
          eventType: "order.accounted",
          payload: { orderNo: "A2" },
        },
      ],
    });
    expect(created.count).toBe(2);
    const rows = await client.outboxEvent.findMany({
      where: { tenantId, status: "PENDING" },
      select: { id: true },
    });
    return rows.map((r) => r.id);
  }

  afterAll(async () => {
    if (client) {
      await client.notificationDelivery.deleteMany({ where: { tenantId } });
      await client.notificationDelivery.deleteMany({
        where: { tenantId: staleTenantId },
      });
      await client.outboxEvent.deleteMany({ where: { tenantId } });
      await client.outboxEvent.deleteMany({
        where: { tenantId: staleTenantId },
      });
      await client.auditLog.deleteMany({ where: { tenantId } });
      await client.tenantAccountRole.deleteMany({ where: { tenantId } });
      await client.tenantAccount.deleteMany({ where: { tenantId } });
      await client.tenant.deleteMany({ where: { id: tenantId } });
      await client.tenant.deleteMany({ where: { id: staleTenantId } });
      await client.$disconnect();
    }
    if (app) await app.close();
  });

  it("drain 写入站内通知且 PROCESSED；重放不重复", async () => {
    await seedOwnPending();
    const first = await drainOutbox(client, 20, tenantId);
    expect(first).toBe(2);
    const notifs = await client.notificationDelivery.findMany({
      where: { tenantId },
    });
    expect(notifs).toHaveLength(2);
    const processed = await client.outboxEvent.count({
      where: { tenantId, status: "PROCESSED" },
    });
    expect(processed).toBe(2);

    // 再次 drain：无新事件、不重复通知
    await drainOutbox(client, 20, tenantId);
    expect(
      await client.notificationDelivery.count({ where: { tenantId } }),
    ).toBe(2);
    expect(
      await client.outboxEvent.count({
        where: { tenantId, status: "PROCESSED" },
      }),
    ).toBe(2);

    const res = await request(app.getHttpServer())
      .get("/api/v1/tenant/notifications")
      .set("authorization", `Bearer ${ownerToken}`)
      .expect(200);
    expect((res.body.data as unknown[]).length).toBe(2);
  });

  it("PROCESSING 超过租约时间会被回收并重新消费（不永久卡死）", async () => {
    const stuck = await client.outboxEvent.create({
      data: {
        tenantId,
        aggregateType: "order",
        aggregateId: `stuck-${suffix}`,
        eventType: "order.confirmed",
        payload: { orderNo: "STUCK" },
        status: "PROCESSING",
        attempts: 1,
        availableAt: new Date(Date.now() - 10 * 60 * 1000),
        createdAt: new Date(Date.now() - 11 * 60 * 1000),
      },
    });

    const n = await drainOutbox(client, 20, tenantId);
    expect(n).toBe(1);
    const after = await client.outboxEvent.findUnique({
      where: { id: stuck.id },
      select: { status: true },
    });
    expect(after?.status).toBe("PROCESSED");
    const notif = await client.notificationDelivery.findFirst({
      where: { tenantId, outboxEventId: stuck.id },
    });
    expect(notif).not.toBeNull();
  });

  it("FAILED 事件可人工重放：reset 后重新 drain 成功", async () => {
    const failed = await client.outboxEvent.create({
      data: {
        tenantId,
        aggregateType: "order",
        aggregateId: `failed-${suffix}`,
        eventType: "order.accounted",
        payload: { orderNo: "RETRY" },
        status: "FAILED",
        attempts: 10,
        lastError: "模拟投递失败",
        availableAt: new Date(Date.now() - 60 * 60 * 1000),
      },
    });

    expect(await requeueFailedOutboxEvent(client, failed.id)).toBe(true);
    const n = await drainOutbox(client, 20, tenantId);
    expect(n).toBe(1);
    const after = await client.outboxEvent.findUnique({
      where: { id: failed.id },
      select: { status: true, attempts: true },
    });
    expect(after?.status).toBe("PROCESSED");
    expect(after?.attempts).toBe(1);
  });
});
