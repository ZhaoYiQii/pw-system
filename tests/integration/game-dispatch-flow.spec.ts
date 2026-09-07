import "reflect-metadata";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Test } from "@nestjs/testing";
import request from "supertest";
import type { INestApplication } from "@nestjs/common";
import { AppModule } from "../../apps/api/src/app.module.js";
import { hashPassword } from "../../apps/api/src/modules/identity-access/infrastructure/password.js";
import { createDatabaseClient } from "@pw/database";
import type { PrismaClient } from "@pw/database";

const PW = "Dispatch-Password-1";
const suffix = Date.now().toString(36);
const tenantCode = `gdf_${suffix}`;
function envOrThrow(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`missing env ${name}`);
  return v;
}
interface Data {
  accessToken?: string;
}

describe("Game Dispatch flow (草稿→发布→报名→选人)", () => {
  let app: INestApplication;
  let client: PrismaClient;
  let tenantId: string;
  let customerId: string;
  let ownerToken: string;
  let customerToken = "";
  let templateId = "";
  let playerTokens: Record<string, string> = {};
  let orderId = "";
  const lineIds: Record<string, string> = {};

  beforeAll(async () => {
    client = createDatabaseClient(envOrThrow("PW_TEST_MIGRATION_URL"));
    const hash = await hashPassword(PW);
    const tenant = await client.tenant.create({
      data: { code: tenantCode, name: "派单测试店" },
    });
    tenantId = tenant.id;
    async function account(username: string, role: string, name?: string) {
      const acc = await client.tenantAccount.create({
        data: { tenantId, username, passwordHash: hash },
      });
      await client.tenantAccountRole.create({
        data: { tenantId, tenantAccountId: acc.id, role: role as never },
      });
      let profile: { id: string } | null = null;
      if (role === "PLAYER") {
        profile = await client.playerProfile.create({
          data: {
            tenantId,
            name: name ?? username,
            tenantAccountId: acc.id,
            basePricePerHourFen: BigInt(5000),
          },
        });
      }
      return { acc, profile };
    }
    await account("boss", "TENANT_OWNER");
    const p1 = await account(`p1_${suffix}`, "PLAYER", "阿一");
    const p2 = await account(`p2_${suffix}`, "PLAYER", "阿二");
    const p3 = await account(`p3_${suffix}`, "PLAYER", "阿三");
    const customer = await client.customerProfile.create({
      data: { tenantId, name: "老板一号" },
    });
    customerId = customer.id;
    const customerAcc = await client.tenantAccount.create({
      data: { tenantId, username: `cb_${suffix}`, passwordHash: hash },
    });
    await client.tenantAccountRole.create({
      data: {
        tenantId,
        tenantAccountId: customerAcc.id,
        role: "CUSTOMER",
      },
    });
    await client.customerProfile.update({
      where: { id: customer.id },
      data: { tenantAccountId: customerAcc.id },
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
    customerToken = await login(`cb_${suffix}`);
    playerTokens = {
      p1: await login(`p1_${suffix}`),
      p2: await login(`p2_${suffix}`),
      p3: await login(`p3_${suffix}`),
    };

    const templateRes = await request(app.getHttpServer())
      .post("/api/v1/tenant/game-templates")
      .set("authorization", `Bearer ${ownerToken}`)
      .send({
        name: "英雄联盟",
        fields: [
          { fieldKey: "region", label: "区", fieldType: "text" },
          {
            fieldKey: "rank",
            label: "目标段位",
            fieldType: "select",
            options: ["翡翠", "钻石"],
          },
        ],
        positions: [
          { label: "打野", defaultCount: 2 },
          { label: "辅助", defaultCount: 1 },
        ],
        rankRules: [
          { rankLabel: "翡翠", addPriceFen: "1000" },
          { rankLabel: "钻石", addPriceFen: "2000" },
        ],
        copyLines: [
          { label: "派单编号", valueKey: "dispatchNo" },
          { label: "位置", valueKey: "positions" },
        ],
      })
      .expect(201);
    templateId = (templateRes.body as { data: { id: string } }).data.id;
    void p1;
    void p2;
    void p3;
  });

  afterAll(async () => {
    if (client) {
      await client.orderSlot.deleteMany({ where: { tenantId } });
      await client.gameDispatchApplication.deleteMany({
        where: { tenantId },
      });
      await client.gameDispatchRound.deleteMany({ where: { tenantId } });
      await client.gameDispatchLine.deleteMany({ where: { tenantId } });
      await client.gameDispatchOrder.deleteMany({ where: { tenantId } });
      await client.gameDispatchTemplateSnapshot.deleteMany({
        where: { tenantId },
      });
      await client.orderRequirement.deleteMany({ where: { tenantId } });
      await client.orderEvent.deleteMany({ where: { tenantId } });
      await client.auditLog.deleteMany({ where: { tenantId } });
      await client.order.deleteMany({ where: { tenantId } });
      await client.playerSkill.deleteMany({ where: { tenantId } });
      await client.playerProfile.deleteMany({ where: { tenantId } });
      await client.customerProfile.deleteMany({ where: { tenantId } });
      await client.gameDispatchRankRule.deleteMany({ where: { tenantId } });
      await client.gameDispatchPosition.deleteMany({ where: { tenantId } });
      await client.gameDispatchTemplateField.deleteMany({
        where: { tenantId },
      });
      await client.gameDispatchTemplate.deleteMany({ where: { tenantId } });
      const accounts = await client.tenantAccount.findMany({
        where: { tenantId },
        select: { id: true },
      });
      await client.refreshSession.deleteMany({
        where: { accountId: { in: accounts.map((a) => a.id) } },
      });
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
      delete: (u: string) => request(app.getHttpServer()).delete(u).set(h),
    };
  }

  it("草稿→发布→报名/取消→选多人并结算单价", async () => {
    const draft = await req(ownerToken)
      .post("/api/v1/tenant/game-dispatch/orders", {
        templateId,
        customerProfileId: customerId,
        formValues: { region: "艾欧尼亚", rank: "钻石", mode: "排位" },
        durationMinutes: 120,
        lines: [
          { positionLabel: "打野", requiredCount: 2 },
          { positionLabel: "辅助", requiredCount: 1 },
        ],
      })
      .expect(201);
    orderId = (draft.body as { data: { orderId: string } }).data.orderId;

    const published = await req(ownerToken)
      .post(`/api/v1/tenant/game-dispatch/orders/${orderId}/publish`)
      .expect(201);
    const publishedData = (
      published.body as {
        data: {
          dispatchNo: string;
          lines: Array<{
            id: string;
            positionLabel: string;
            requiredCount: number;
          }>;
          copyText: string;
          round: { status: string };
        };
      }
    ).data;
    expect(publishedData.dispatchNo).toMatch(/^GD/);
    expect(publishedData.round.status).toBe("OPEN");
    expect(publishedData.copyText).toContain("派单编号");
    const classicOrders = (
      await req(ownerToken)
        .get("/api/v1/tenant/orders?status=DISPATCHING")
        .expect(200)
    ).body.data as unknown[];
    expect(classicOrders).toHaveLength(0);
    for (const line of publishedData.lines) {
      lineIds[line.positionLabel] = line.id;
    }

    await req(playerTokens.p1)
      .post(
        `/api/v1/tenant/game-dispatch/orders/${orderId}/lines/${lineIds["打野"]}/applications`,
      )
      .expect(201);
    await req(playerTokens.p2)
      .post(
        `/api/v1/tenant/game-dispatch/orders/${orderId}/lines/${lineIds["打野"]}/applications`,
      )
      .expect(201);
    await req(playerTokens.p1)
      .post(
        `/api/v1/tenant/game-dispatch/orders/${orderId}/lines/${lineIds["打野"]}/applications`,
      )
      .expect(409);
    await req(playerTokens.p3)
      .post(
        `/api/v1/tenant/game-dispatch/orders/${orderId}/lines/${lineIds["辅助"]}/applications`,
      )
      .expect(201);

    const apps = (
      await req(ownerToken)
        .get(`/api/v1/tenant/game-dispatch/orders/${orderId}/applications`)
        .expect(200)
    ).body.data as Array<{
      id: string;
      positionLabel: string;
      applications: Array<{ id: string }>;
    }>;
    const jungle = apps.find((a) => a.positionLabel === "打野");
    expect(jungle?.applications).toHaveLength(2);

    // 本人取消后重报名仍可（同轮内刷新）。
    const withdrawApp = jungle?.applications[0];
    await req(playerTokens.p1)
      .post(
        `/api/v1/tenant/game-dispatch/applications/${withdrawApp?.id}/withdraw`,
      )
      .expect(201);
    await req(playerTokens.p1)
      .post(
        `/api/v1/tenant/game-dispatch/orders/${orderId}/lines/${lineIds["打野"]}/applications`,
      )
      .expect(201);

    const refreshed = (
      await req(ownerToken)
        .get(`/api/v1/tenant/game-dispatch/orders/${orderId}/applications`)
        .expect(200)
    ).body.data as Array<{
      applications: Array<{ id: string }>;
    }>;
    const ids = refreshed.flatMap((a) => a.applications.map((x) => x.id));
    const selectView = (
      await req(customerToken)
        .get(`/api/v1/tenant/game-dispatch/customer/orders/${orderId}/select`)
        .expect(200)
    ).body.data as { lines: Array<{ applications: Array<{ id: string }> }> };
    expect(selectView.lines.flatMap((l) => l.applications)).toHaveLength(3);

    const finalAssign = await req(customerToken)
      .post(
        `/api/v1/tenant/game-dispatch/customer/orders/${orderId}/assignment`,
        { applicationIds: ids },
      )
      .expect(201);
    expect((finalAssign.body as { data: { status: string } }).data.status).toBe(
      "ASSIGNED",
    );

    const slots = await client.orderSlot.findMany({ where: { tenantId } });
    expect(slots).toHaveLength(3);
    expect(slots.every((s) => s.unitPriceFen === BigInt(7000))).toBe(true);
  });
});
