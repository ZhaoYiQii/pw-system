import "reflect-metadata";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Test } from "@nestjs/testing";
import request from "supertest";
import type { INestApplication } from "@nestjs/common";
import { AppModule } from "../../apps/api/src/app.module.js";
import { hashPassword } from "../../apps/api/src/modules/identity-access/infrastructure/password.js";
import { createDatabaseClient } from "@pw/database";
import type { PrismaClient } from "@pw/database";

const PW = "Slice4-Password-1";
const suffix = Date.now().toString(36);

function envOrThrow(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`missing env ${name}`);
  return v;
}

interface Data {
  accessToken?: string;
}

describe("Slice 4 catalog/customers/players HTTP (权限/价格边界/跨租户/重叠)", () => {
  let app: INestApplication;
  let client: PrismaClient;
  let tenantCode: string;
  let otherTenantCode: string;
  let ownerToken: string;
  let serviceToken: string;
  let otherGameId: string;

  beforeAll(async () => {
    client = createDatabaseClient(envOrThrow("PW_TEST_MIGRATION_URL"));
    const hash = await hashPassword(PW);
    tenantCode = `s4_${suffix}`;
    otherTenantCode = `s4b_${suffix}`;
    const t1 = await client.tenant.create({ data: { code: tenantCode, name: "S4店" } });
    const t2 = await client.tenant.create({ data: { code: otherTenantCode, name: "S4隔壁店" } });
    const owner = await client.tenantAccount.create({ data: { tenantId: t1.id, username: "owner", passwordHash: hash } });
    const service = await client.tenantAccount.create({ data: { tenantId: t1.id, username: "service", passwordHash: hash } });
    await client.tenantAccountRole.create({ data: { tenantId: t1.id, tenantAccountId: owner.id, role: "TENANT_OWNER" } });
    await client.tenantAccountRole.create({ data: { tenantId: t1.id, tenantAccountId: service.id, role: "CUSTOMER_SERVICE" } });
    const otherGame = await client.game.create({ data: { tenantId: t2.id, name: "隔壁游戏" } });
    otherGameId = otherGame.id;

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();

    async function login(username: string) {
      const res = await request(app.getHttpServer())
        .post("/api/v1/auth/login")
        .send({ kind: "tenant", tenantCode, username, password: PW })
        .expect(201);
      return (res.body as { data: Data }).data.accessToken as string;
    }
    ownerToken = await login("owner");
    serviceToken = await login("service");
  });

  afterAll(async () => {
    if (client) {
      for (const code of [tenantCode, otherTenantCode]) {
        const tenants = await client.tenant.findMany({ where: { code } });
        for (const t of tenants) {
          await client.playerAvailability.deleteMany({ where: { tenantId: t.id } });
          await client.playerSkill.deleteMany({ where: { tenantId: t.id } });
          await client.pricingRule.deleteMany({ where: { tenantId: t.id } });
          await client.serviceProduct.deleteMany({ where: { tenantId: t.id } });
          await client.gameRegion.deleteMany({ where: { tenantId: t.id } });
          await client.game.deleteMany({ where: { tenantId: t.id } });
          await client.customerProfile.deleteMany({ where: { tenantId: t.id } });
          await client.playerProfile.deleteMany({ where: { tenantId: t.id } });
          await client.tenantAccountRole.deleteMany({ where: { tenantId: t.id } });
          await client.tenantAccount.deleteMany({ where: { tenantId: t.id } });
          await client.tenant.deleteMany({ where: { id: t.id } });
        }
      }
      await client.$disconnect();
    }
    if (app) await app.close();
  });

  function req(token: string) {
    const headers = { authorization: `Bearer ${token}` };
    return {
      get: (url: string) => request(app.getHttpServer()).get(url).set(headers),
      post: (url: string) => request(app.getHttpServer()).post(url).set(headers),
      patch: (url: string) => request(app.getHttpServer()).patch(url).set(headers),
      del: (url: string) => request(app.getHttpServer()).delete(url).set(headers)
    };
  }

  it("权限：owner 可建客户/陪玩；service 可建客户但建陪玩 403（全局 PermissionsGuard）", async () => {
    await req(ownerToken).post("/api/v1/tenant/customers").send({ name: "客户甲" }).expect(201);
    await req(serviceToken).post("/api/v1/tenant/customers").send({ name: "客服建客户" }).expect(201);
    await req(serviceToken).post("/api/v1/tenant/players").send({ name: "越权陪玩" }).expect(403);
  });

  it("catalog：owner 建游戏/区服/产品/价格，价格读取为整数分", async () => {
    const gameRes = await req(ownerToken).post("/api/v1/tenant/catalog/games").send({ name: "王者荣耀" }).expect(201);
    const gameId = (gameRes.body.data as { id: string }).id;
    const regionRes = await req(ownerToken)
      .post(`/api/v1/tenant/catalog/games/${gameId}/regions`)
      .send({ name: "微信1区" })
      .expect(201);
    const regionId = (regionRes.body.data as { id: string }).id;
    const productRes = await req(ownerToken)
      .post("/api/v1/tenant/catalog/products")
      .send({ gameId, gameRegionId: regionId, name: "王者1小时" })
      .expect(201);
    const productId = (productRes.body.data as { id: string }).id;
    const ruleRes = await req(ownerToken)
      .post(`/api/v1/tenant/catalog/products/${productId}/pricing`)
      .send({ durationSeconds: 3600, priceFen: 1500, playerCostFen: 800 })
      .expect(201);
    expect((ruleRes.body.data as { priceFen: number }).priceFen).toBe(1500);
    const list = await req(ownerToken).get(`/api/v1/tenant/catalog/products/${productId}/pricing`).expect(200);
    expect((list.body.data as Array<{ priceFen: number }>)[0]?.priceFen).toBe(1500);
  });

  it("价格边界：负价/浮点/非正时长被拒；重复时长 409", async () => {
    const games = await req(ownerToken).get("/api/v1/tenant/catalog/games").expect(200);
    const gameId = (games.body.data as Array<{ id: string }>)[0]?.id as string;
    const productRes = await req(ownerToken)
      .post("/api/v1/tenant/catalog/products")
      .send({ gameId, name: "价格测试产品" })
      .expect(201);
    const productId = (productRes.body.data as { id: string }).id;
    await req(ownerToken)
      .post(`/api/v1/tenant/catalog/products/${productId}/pricing`)
      .send({ durationSeconds: 1800, priceFen: -100 })
      .expect(400);
    await req(ownerToken)
      .post(`/api/v1/tenant/catalog/products/${productId}/pricing`)
      .send({ durationSeconds: 1800, priceFen: 12.5 })
      .expect(400);
    await req(ownerToken)
      .post(`/api/v1/tenant/catalog/products/${productId}/pricing`)
      .send({ durationSeconds: 0, priceFen: 500 })
      .expect(400);
    await req(ownerToken)
      .post(`/api/v1/tenant/catalog/products/${productId}/pricing`)
      .send({ durationSeconds: 1800, priceFen: 500 })
      .expect(201);
    await req(ownerToken)
      .post(`/api/v1/tenant/catalog/products/${productId}/pricing`)
      .send({ durationSeconds: 1800, priceFen: 600 })
      .expect(409);
  });

  it("跨租户技能关联被拒（引用他店游戏 → 400）", async () => {
    const playerRes = await req(ownerToken).post("/api/v1/tenant/players").send({ name: "阿伟" }).expect(201);
    const playerId = (playerRes.body.data as { id: string }).id;
    await req(ownerToken)
      .post(`/api/v1/tenant/players/${playerId}/skills`)
      .send({ gameId: otherGameId })
      .expect(400);
  });

  it("重叠不可用时间被拒，非重叠与开关正常", async () => {
    const players = await req(ownerToken).get("/api/v1/tenant/players").expect(200);
    const playerId = (players.body.data as Array<{ id: string }>)[0]?.id as string;
    await req(ownerToken)
      .post(`/api/v1/tenant/players/${playerId}/availability`)
      .send({ startsAt: "2030-01-01T10:00:00Z", endsAt: "2030-01-01T12:00:00Z", reason: "有事" })
      .expect(201);
    await req(ownerToken)
      .post(`/api/v1/tenant/players/${playerId}/availability`)
      .send({ startsAt: "2030-01-01T11:30:00Z", endsAt: "2030-01-01T13:00:00Z" })
      .expect(409);
    await req(ownerToken)
      .post(`/api/v1/tenant/players/${playerId}/availability`)
      .send({ startsAt: "2030-01-02T10:00:00Z", endsAt: "2030-01-02T11:00:00Z" })
      .expect(201);
    const detail = await req(ownerToken).get(`/api/v1/tenant/players/${playerId}`).expect(200);
    expect((detail.body.data as { availability: unknown[] }).availability).toHaveLength(2);
    await req(ownerToken)
      .patch(`/api/v1/tenant/players/${playerId}`)
      .send({ acceptingOrders: false })
      .expect(200);
    const after = await req(ownerToken).get(`/api/v1/tenant/players/${playerId}`).expect(200);
    expect((after.body.data as { acceptingOrders: boolean }).acceptingOrders).toBe(false);
  });
  it("绑定 PLAYER 账号后陪玩自助 me/接单/排期可用；非 PLAYER 403", async () => {
    // 建 PLAYER 账号
    const playerUsername = `player_${suffix}`;
    const ph = await hashPassword(PW);
    const t1 = await client.tenant.findUnique({ where: { code: tenantCode } });
    const tenantId = t1?.id as string;
    const acc = await client.tenantAccount.create({
      data: { tenantId, username: playerUsername, passwordHash: ph }
    });
    await client.tenantAccountRole.create({
      data: { tenantId, tenantAccountId: acc.id, role: "PLAYER" }
    });

    // owner 创建陪玩并绑定到该账号
    const playerRes = await req(ownerToken).post("/api/v1/tenant/players").send({ name: "自助陪玩" }).expect(201);
    const playerId = (playerRes.body.data as { id: string }).id;
    await req(ownerToken).post(`/api/v1/tenant/players/${playerId}/account`).send({ accountId: acc.id }).expect(201);

    // 绑定到非 PLAYER 账号被拒
    const serviceAcc = await client.tenantAccount.findFirst({ where: { tenantId, username: "service" } });
    if (serviceAcc) {
      await req(ownerToken).post(`/api/v1/tenant/players/${playerId}/account`).send({ accountId: serviceAcc.id }).expect(400);
    }

    const playerLogin = await request(app.getHttpServer())
      .post("/api/v1/auth/login")
      .send({ kind: "tenant", tenantCode, username: playerUsername, password: PW })
      .expect(201);
    const pToken = (playerLogin.body as { data: Data }).data.accessToken as string;

    const me = await req(pToken).get("/api/v1/tenant/player/me").expect(200);
    expect((me.body.data as { name: string }).name).toBe("自助陪玩");
    expect((me.body.data as { acceptingOrders: boolean }).acceptingOrders).toBe(true);

    await req(pToken).patch("/api/v1/tenant/player/me").send({ acceptingOrders: false }).expect(200);
    const me2 = await req(pToken).get("/api/v1/tenant/player/me").expect(200);
    expect((me2.body.data as { acceptingOrders: boolean }).acceptingOrders).toBe(false);

    // 自助添加/移除不可用时间
    await req(pToken)
      .post("/api/v1/tenant/player/availability")
      .send({ startsAt: "2030-02-01T10:00:00Z", endsAt: "2030-02-01T12:00:00Z", reason: "约了朋友" })
      .expect(201);
    const me3 = await req(pToken).get("/api/v1/tenant/player/me").expect(200);
    const av = (me3.body.data as { availability: Array<{ id: string }> }).availability;
    expect(av).toHaveLength(1);
    await req(pToken).del(`/api/v1/tenant/player/availability/${av[0]?.id as string}`).expect(200);

    // 客服/店主角色不能使用陪玩自助端点
    await req(serviceToken).get("/api/v1/tenant/player/me").expect(403);
    await req(ownerToken).get("/api/v1/tenant/player/me").expect(403);
  });
});