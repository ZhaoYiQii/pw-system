import "reflect-metadata";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Test } from "@nestjs/testing";
import request from "supertest";
import type { INestApplication } from "@nestjs/common";
import { AppModule } from "../../apps/api/src/app.module.js";
import { drainOutbox } from "../../apps/api/src/modules/notifications/outbox.relay.js";
import { hashPassword } from "../../apps/api/src/modules/identity-access/infrastructure/password.js";
import { createDatabaseClient } from "@pw/database";
import type { PrismaClient } from "@pw/database";

const PW = "Outbox-Password-1";
const suffix = Date.now().toString(36);
function envOrThrow(name: string): string { const v = process.env[name]; if (!v) throw new Error(`missing env ${name}`); return v; }
interface Data { accessToken?: string }

describe("Slice 9 outbox recovery (重放不重复)", () => {
  let app: INestApplication;
  let client: PrismaClient;
  let tenantId: string;
  let ownerToken: string;

  beforeAll(async () => {
    client = createDatabaseClient(envOrThrow("PW_TEST_MIGRATION_URL"));
    const hash = await hashPassword(PW);
    const t = await client.tenant.create({ data: { code: `ox_${suffix}`, name: "outbox店" } });
    tenantId = t.id;
    const owner = await client.tenantAccount.create({ data: { tenantId, username: "boss", passwordHash: hash } });
    await client.tenantAccountRole.create({ data: { tenantId, tenantAccountId: owner.id, role: "TENANT_OWNER" } });
    await client.outboxEvent.createMany({
      data: [
        { tenantId, aggregateType: "order", aggregateId: "00000000-0000-0000-0000-000000000001", eventType: "order.confirmed", payload: { orderNo: "A1" }, createdAt: new Date(Date.now() - 7200 * 1000) },
        { tenantId, aggregateType: "order", aggregateId: "00000000-0000-0000-0000-000000000002", eventType: "order.accounted", payload: { orderNo: "A2" }, createdAt: new Date(Date.now() - 7100 * 1000) }
      ]
    });
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    const login = await request(app.getHttpServer()).post("/api/v1/auth/login").send({ kind: "tenant", tenantCode: t.code, username: "boss", password: PW }).expect(201);
    ownerToken = (login.body as { data: Data }).data.accessToken as string;
  });

  afterAll(async () => {
    if (client) {
      await client.notificationDelivery.deleteMany({ where: { tenantId } });
      await client.outboxEvent.deleteMany({ where: { tenantId } });
      await client.tenantAccountRole.deleteMany({ where: { tenantId } });
      await client.tenantAccount.deleteMany({ where: { tenantId } });
      await client.tenant.deleteMany({ where: { id: tenantId } });
      await client.$disconnect();
    }
    if (app) await app.close();
  });

  it("drain 写入站内通知且 PROCESSED；重放不重复", async () => {
    const first = await drainOutbox(client);
    expect(first).toBeGreaterThanOrEqual(2);
    const notifs = await client.notificationDelivery.findMany({ where: { tenantId } });
    expect(notifs).toHaveLength(2);
    const processed = await client.outboxEvent.count({ where: { tenantId, status: "PROCESSED" } });
    expect(processed).toBe(2);

    // 再次 drain：无新事件、不重复通知
    await drainOutbox(client);
    expect(await client.notificationDelivery.count({ where: { tenantId } })).toBe(2);
    expect(await client.outboxEvent.count({ where: { tenantId, status: "PROCESSED" } })).toBe(2);

    const res = await request(app.getHttpServer()).get("/api/v1/tenant/notifications").set("authorization", `Bearer ${ownerToken}`).expect(200);
    expect((res.body.data as unknown[]).length).toBe(2);
  });
});