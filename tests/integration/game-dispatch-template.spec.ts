import "reflect-metadata";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Test } from "@nestjs/testing";
import request from "supertest";
import type { INestApplication } from "@nestjs/common";
import { AppModule } from "../../apps/api/src/app.module.js";
import { hashPassword } from "../../apps/api/src/modules/identity-access/infrastructure/password.js";
import { createDatabaseClient } from "@pw/database";
import type { PrismaClient } from "@pw/database";

const PW = "Template-Password-1";
const suffix = Date.now().toString(36);
const tenantCode = `gdt_${suffix}`;
function envOrThrow(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`missing env ${name}`);
  return v;
}
interface Data {
  accessToken?: string;
}

describe("Game Dispatch templates (模板 CRUD/复制/权限)", () => {
  let app: INestApplication;
  let client: PrismaClient;
  let tenantId: string;
  let ownerToken: string;
  let playerToken: string;

  beforeAll(async () => {
    client = createDatabaseClient(envOrThrow("PW_TEST_MIGRATION_URL"));
    const hash = await hashPassword(PW);
    const tenant = await client.tenant.create({
      data: { code: tenantCode, name: "模板店" },
    });
    tenantId = tenant.id;
    const owner = await client.tenantAccount.create({
      data: { tenantId, username: "boss", passwordHash: hash },
    });
    await client.tenantAccountRole.create({
      data: { tenantId, tenantAccountId: owner.id, role: "TENANT_OWNER" },
    });
    const player = await client.tenantAccount.create({
      data: { tenantId, username: `p_${suffix}`, passwordHash: hash },
    });
    await client.tenantAccountRole.create({
      data: { tenantId, tenantAccountId: player.id, role: "PLAYER" },
    });

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
    playerToken = await login(`p_${suffix}`);
  });

  afterAll(async () => {
    if (client) {
      await client.gameDispatchRankRule.deleteMany({
        where: { tenantId },
      });
      await client.gameDispatchPosition.deleteMany({
        where: { tenantId },
      });
      await client.gameDispatchTemplateField.deleteMany({
        where: { tenantId },
      });
      await client.gameDispatchTemplate.deleteMany({
        where: { tenantId },
      });
      await client.auditLog.deleteMany({ where: { tenantId } });
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
      patch: (u: string, b: unknown) =>
        request(app.getHttpServer()).patch(u).set(h).send(b),
      delete: (u: string) => request(app.getHttpServer()).delete(u).set(h),
    };
  }

  it("创建/读取/复制/更新/删除模板；PLAYER 无权访问", async () => {
    const created = await req(ownerToken)
      .post("/api/v1/tenant/game-templates", {
        name: "英雄联盟",
        fields: [
          {
            fieldKey: "region",
            label: "区",
            fieldType: "text",
            required: true,
            sortOrder: 0,
          },
          {
            fieldKey: "rank",
            label: "目标段位",
            fieldType: "select",
            options: ["翡翠", "钻石", "大师"],
            sortOrder: 1,
          },
        ],
        positions: [
          { label: "打野", defaultCount: 2, sortOrder: 0 },
          { label: "辅助", defaultCount: 1, sortOrder: 1 },
        ],
        rankRules: [
          { rankLabel: "翡翠", addPriceFen: "1000", sortOrder: 0 },
          { rankLabel: "钻石", addPriceFen: "2000", sortOrder: 1 },
        ],
        copyLines: [
          { label: "派单编号", valueKey: "dispatchNo" },
          { label: "区", valueKey: "region" },
        ],
      })
      .expect(201);
    const template = (created.body as { data: { id: string } }).data;

    const detail = (
      await req(ownerToken)
        .get(`/api/v1/tenant/game-templates/${template.id}`)
        .expect(200)
    ).body.data as {
      name: string;
      fields: Array<{ fieldKey: string }>;
      positions: Array<{ label: string; defaultCount: number }>;
      rankRules: Array<{ rankLabel: string; addPriceFen: string }>;
    };
    expect(detail.name).toBe("英雄联盟");
    expect(detail.fields).toHaveLength(2);
    expect(detail.positions[0]).toMatchObject({
      label: "打野",
      defaultCount: 2,
    });
    expect(detail.rankRules[0]?.addPriceFen).toBe("1000");

    await req(playerToken).get("/api/v1/tenant/game-templates").expect(403);

    const copied = (
      await req(ownerToken)
        .post(`/api/v1/tenant/game-templates/${template.id}/copy`)
        .expect(201)
    ).body.data as { id: string; name: string };
    expect(copied.name).toBe("英雄联盟 副本");

    await req(ownerToken)
      .patch(`/api/v1/tenant/game-templates/${copied.id}`, {
        name: "英雄联盟定制",
        enabled: false,
      })
      .expect(200);

    await req(ownerToken)
      .delete(`/api/v1/tenant/game-templates/${copied.id}`)
      .expect(200);
    await req(ownerToken)
      .delete(`/api/v1/tenant/game-templates/${template.id}`)
      .expect(200);
  });
});
