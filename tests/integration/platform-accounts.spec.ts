import "reflect-metadata";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Test } from "@nestjs/testing";
import request from "supertest";
import type { INestApplication } from "@nestjs/common";
import { AppModule } from "../../apps/api/src/app.module.js";
import { hashPassword } from "../../apps/api/src/modules/identity-access/infrastructure/password.js";
import { createDatabaseClient } from "@pw/database";
import type { PrismaClient } from "@pw/database";

const PW = "Platform-Account-Password-1";
const suffix = Date.now().toString(36);
const actorUsername = `p2a_${suffix}`;
const supportUsername = `p2s_${suffix}`;

function envOrThrow(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`missing env ${name}`);
  return v;
}

interface Data {
  accessToken?: string;
}

describe("P-B2a 平台账号管理（列表/创建/启停/改角色/权限/审计）", () => {
  let app: INestApplication;
  let client: PrismaClient;
  let actorToken: string;
  let actorId = "";
  let supportId = "";
  const createdIds: string[] = [];

  beforeAll(async () => {
    client = createDatabaseClient(envOrThrow("PW_TEST_MIGRATION_URL"));
    const hash = await hashPassword(PW);
    const actor = await client.platformAccount.create({
      data: {
        username: actorUsername,
        passwordHash: hash,
        role: "PLATFORM_SUPER_ADMIN",
      },
    });
    actorId = actor.id;
    createdIds.push(actor.id);

    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    const login = await request(app.getHttpServer())
      .post("/api/v1/auth/login")
      .send({ kind: "platform", username: actorUsername, password: PW })
      .expect(201);
    actorToken = (login.body as { data: Data }).data.accessToken as string;
  });

  afterAll(async () => {
    if (client) {
      await client.platformAuditEvent.deleteMany({
        where: {
          actorPlatformAccountId: { in: [actorId, ...createdIds] },
        },
      });
      await client.refreshSession.deleteMany({
        where: { accountId: { in: createdIds } },
      });
      await client.platformAccount.deleteMany({
        where: { id: { in: createdIds } },
      });
      await client.platformAccount.deleteMany({
        where: { username: supportUsername },
      });
      await client.$disconnect();
    }
    if (app) await app.close();
  });

  function req(token: string) {
    return {
      get: (u: string) =>
        request(app.getHttpServer()).get(u).set("authorization", `Bearer ${token}`),
      post: (u: string, b: unknown) =>
        request(app.getHttpServer())
          .post(u)
          .set("authorization", `Bearer ${token}`)
          .send(b),
      patch: (u: string, b: unknown) =>
        request(app.getHttpServer())
          .patch(u)
          .set("authorization", `Bearer ${token}`)
          .send(b),
    };
  }

  it("超级管理员可列出账号", async () => {
    const res = await req(actorToken).get("/api/v1/platform/accounts").expect(200);
    const rows = (res.body as { data: Array<{ username: string; role: string }> }).data;
    expect(rows.some((r) => r.username === actorUsername)).toBe(true);
  });

  it("创建平台运营并写审计；运营不能管理账号", async () => {
    const created = await req(actorToken)
      .post("/api/v1/platform/accounts", {
        username: supportUsername,
        password: PW,
        role: "PLATFORM_SUPPORT",
      })
      .expect(201);
    supportId = (created.body as { data: { id: string } }).data.id;
    createdIds.push(supportId);

    const auditCount = await client.platformAuditEvent.count({
      where: {
        actorPlatformAccountId: actorId,
        action: "platform.account.create",
      },
    });
    expect(auditCount).toBeGreaterThanOrEqual(1);

    const supportLogin = await request(app.getHttpServer())
      .post("/api/v1/auth/login")
      .send({ kind: "platform", username: supportUsername, password: PW })
      .expect(201);
    const supportToken = (supportLogin.body as { data: Data }).data
      .accessToken as string;
    await req(supportToken).get("/api/v1/platform/accounts").expect(403);
  });

  it("停用后无法登录；启用后恢复；可改角色", async () => {
    await req(actorToken)
      .patch(`/api/v1/platform/accounts/${supportId}/status`, {
        status: "DISABLED",
      })
      .expect(200);
    await request(app.getHttpServer())
      .post("/api/v1/auth/login")
      .send({ kind: "platform", username: supportUsername, password: PW })
      .expect(401);

    await req(actorToken)
      .patch(`/api/v1/platform/accounts/${supportId}/status`, {
        status: "ACTIVE",
      })
      .expect(200);
    await req(actorToken)
      .patch(`/api/v1/platform/accounts/${supportId}/role`, {
        role: "PLATFORM_SUPER_ADMIN",
      })
      .expect(200);
    const list = await req(actorToken).get("/api/v1/platform/accounts").expect(200);
    const row = (list.body as { data: Array<{ id: string; role: string }> }).data.find(
      (r) => r.id === supportId,
    );
    expect(row?.role).toBe("PLATFORM_SUPER_ADMIN");
  });

  it("不能停用或改自己的角色", async () => {
    await req(actorToken)
      .patch(`/api/v1/platform/accounts/${actorId}/status`, {
        status: "DISABLED",
      })
      .expect(400);
    await req(actorToken)
      .patch(`/api/v1/platform/accounts/${actorId}/role`, {
        role: "PLATFORM_SUPPORT",
      })
      .expect(400);
  });

  it("非法角色/状态被拒绝", async () => {
    await req(actorToken)
      .patch(`/api/v1/platform/accounts/${supportId}/role`, {
        role: "TENANT_OWNER",
      })
      .expect(400);
    await req(actorToken)
      .patch(`/api/v1/platform/accounts/${supportId}/status`, {
        status: "FROZEN",
      })
      .expect(400);
  });
});
