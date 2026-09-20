/**
 * 算价模型 Task 1：定价读路径切换到「陪玩×游戏底价 + 按游戏加价规则库」。
 *
 * 覆盖（设计规格 §3.1–§3.2、§5、§6）：
 * - 规则库按 dimensionKey 命中决定单价，并随订单快照落库；
 * - 陪玩×游戏底价优先于陪玩级兜底；
 * - 既无底价也无兜底时拒绝选人（不静默按 0 计）；
 * - 改规则只影响之后的新订单，历史订单单价不变；
 * - 未归类到游戏的模板与别家租户的规则都不参与计价；
 * - v2 模板下单的加价来自规则库，模板选项 priceDeltaFen 不再是定价来源。
 */
import "reflect-metadata";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Test } from "@nestjs/testing";
import request from "supertest";
import type { INestApplication } from "@nestjs/common";
import { AppModule } from "../../apps/api/src/app.module.js";
import { hashPassword } from "../../apps/api/src/modules/identity-access/infrastructure/password.js";
import { createDatabaseClient } from "@pw/database";
import type { PrismaClient } from "@pw/database";

const PW = "Order-Pricing-Password-1";
const suffix = Date.now().toString(36);
const tenantCode = `op_${suffix}`;
const otherTenantCode = `opb_${suffix}`;
const TEMPLATES = "/api/v1/tenant/game-templates";
const DISPATCH = "/api/v1/tenant/game-dispatch";
const PRICING = "/api/v1/tenant/game-pricing";
const V2_TEMPLATES = "/api/v1/tenant/game-dispatch-templates";

interface MoneyView {
  playerId: string;
  gameId: string;
  basePricePerHourFen: string | null;
  fallbackBasePricePerHourFen: string | null;
  status: string | null;
}

interface RuleView {
  gameId: string;
  enabled: boolean;
  items: {
    id: string;
    kind: string;
    dimensionKey: string;
    amountFen: string;
  }[];
  updatedAt: string | null;
}

describe("算价模型 Task 1：规则库计价与读路径切换", () => {
  let app: INestApplication;
  let client: PrismaClient;
  let tenantId = "";
  let otherTenantId = "";
  let gameId = "";
  let spareGameId = "";
  let ownerToken = "";
  let otherOwnerToken = "";
  let customerToken = "";
  let playerTokens: Record<string, string> = {};
  let playerIds: Record<string, string> = {};
  let customerId = "";
  let templateId = "";

  beforeAll(async () => {
    client = createDatabaseClient(
      process.env.PW_TEST_MIGRATION_URL ??
        (() => {
          throw new Error("missing env PW_TEST_MIGRATION_URL");
        })(),
    );
    const hash = await hashPassword(PW);
    const tenant = await client.tenant.create({
      data: { code: tenantCode, name: "算价测试店" },
    });
    tenantId = tenant.id;
    const other = await client.tenant.create({
      data: { code: otherTenantCode, name: "算价别家店" },
    });
    otherTenantId = other.id;
    // v2 模板下单入口是 opt-in addon，夹具显式开通。
    await client.tenantEntitlement.create({
      data: {
        tenantId,
        featureKey: "addon.game_dispatch_template_v2",
        enabled: true,
      },
    });

    async function addAccount(tid: string, username: string, role: string) {
      const account = await client.tenantAccount.create({
        data: { tenantId: tid, username, passwordHash: hash },
      });
      await client.tenantAccountRole.create({
        data: {
          tenantId: tid,
          tenantAccountId: account.id,
          role: role as never,
        },
      });
      return account;
    }

    await addAccount(tenantId, "boss", "TENANT_OWNER");
    await addAccount(otherTenantId, "boss", "TENANT_OWNER");
    // 阿一有陪玩级兜底底价 5000；阿二没有任何底价（默认 0 → 视为未设置）。
    const p1 = await addAccount(tenantId, `a1_${suffix}`, "PLAYER");
    const p2 = await addAccount(tenantId, `a2_${suffix}`, "PLAYER");
    const profile1 = await client.playerProfile.create({
      data: {
        tenantId,
        name: "阿一",
        tenantAccountId: p1.id,
        basePricePerHourFen: 5000n,
      },
    });
    const profile2 = await client.playerProfile.create({
      data: {
        tenantId,
        name: "阿二",
        tenantAccountId: p2.id,
      },
    });
    playerIds = { p1: profile1.id, p2: profile2.id };

    const customer = await client.customerProfile.create({
      data: { tenantId, name: "算价老板" },
    });
    customerId = customer.id;
    const customerAccount = await addAccount(
      tenantId,
      `boss_${suffix}`,
      "CUSTOMER",
    );
    await client.customerProfile.update({
      where: { id: customer.id },
      data: { tenantAccountId: customerAccount.id },
    });

    const game = await client.game.create({
      data: { tenantId, name: `英雄联盟-${suffix}` },
    });
    gameId = game.id;
    // 同租户的第二个游戏：用来证明「规则按游戏隔离」，不串到别的游戏。
    const spare = await client.game.create({
      data: { tenantId, name: `无畏契约-${suffix}` },
    });
    spareGameId = spare.id;

    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();

    async function login(username: string, code = tenantCode): Promise<string> {
      const res = await request(app.getHttpServer())
        .post("/api/v1/auth/login")
        .send({ kind: "tenant", tenantCode: code, username, password: PW })
        .expect(201);
      return (res.body as { data: { accessToken: string } }).data.accessToken;
    }

    ownerToken = await login("boss");
    otherOwnerToken = await login("boss", otherTenantCode);
    customerToken = await login(`boss_${suffix}`);
    playerTokens = {
      p1: await login(`a1_${suffix}`),
      p2: await login(`a2_${suffix}`),
    };

    // 经典派单模板（v1）：选段位；把模板归到 gameId 下模拟已归类模板。
    const template = await request(app.getHttpServer())
      .post(TEMPLATES)
      .set("authorization", `Bearer ${ownerToken}`)
      .send({
        name: `算价模板-${suffix}`,
        fields: [
          {
            fieldKey: "rank",
            label: "目标段位",
            fieldType: "select",
            options: ["翡翠", "钻石"],
          },
        ],
        positions: [{ label: "打野", defaultCount: 1 }],
        // legacy 段位加价：本版起不再是定价来源，只保留在快照里。
        rankRules: [{ rankLabel: "钻石", addPriceFen: "9900" }],
      })
      .expect(201);
    templateId = (template.body as { data: { id: string } }).data.id;
    await client.gameDispatchTemplate.update({
      where: { id: templateId },
      data: { gameId },
    });
  });

  afterAll(async () => {
    if (client) {
      // 算价模型的表先整体清理：跨租户对抗夹具里，B 店的规则行指向 A 店的游戏，
      // 逐个租户删会在 A 店删游戏时撞上 B 店的这条外键（RESTRICT）。
      const allTenants = [tenantId, otherTenantId].filter((tid) => tid !== "");
      await client.gamePricingRuleItem.deleteMany({
        where: { tenantId: { in: allTenants } },
      });
      await client.gamePricingRule.deleteMany({
        where: { tenantId: { in: allTenants } },
      });
      await client.playerGamePrice.deleteMany({
        where: { tenantId: { in: allTenants } },
      });
      for (const tid of [tenantId, otherTenantId]) {
        if (!tid) continue;
        await client.slotEvidence.deleteMany({ where: { tenantId: tid } });
        await client.slotSession.deleteMany({ where: { tenantId: tid } });
        await client.slotEarning.deleteMany({ where: { tenantId: tid } });
        await client.orderSlot.deleteMany({ where: { tenantId: tid } });
        await client.gameDispatchApplication.deleteMany({
          where: { tenantId: tid },
        });
        await client.gameDispatchRound.deleteMany({ where: { tenantId: tid } });
        await client.gameDispatchLine.deleteMany({ where: { tenantId: tid } });
        await client.gameDispatchOrder.deleteMany({ where: { tenantId: tid } });
        await client.gameDispatchTemplateSnapshot.deleteMany({
          where: { tenantId: tid },
        });
        await client.idempotencyRecord.deleteMany({ where: { tenantId: tid } });
        // active_version_id 是 templates → versions 的外键，必须先解引用再删版本。
        await client.gameDispatchTemplate.updateMany({
          where: { tenantId: tid },
          data: { activeVersionId: null },
        });
        await client.gameDispatchTemplateVersion.deleteMany({
          where: { tenantId: tid },
        });
        await client.orderRequirement.deleteMany({ where: { tenantId: tid } });
        await client.orderEvent.deleteMany({ where: { tenantId: tid } });
        await client.auditLog.deleteMany({ where: { tenantId: tid } });
        await client.notificationDelivery.deleteMany({
          where: { tenantId: tid },
        });
        await client.order.deleteMany({ where: { tenantId: tid } });
        await client.playerProfile.deleteMany({ where: { tenantId: tid } });
        await client.paymentOrder.deleteMany({ where: { tenantId: tid } });
        await client.walletEntry.deleteMany({ where: { tenantId: tid } });
        await client.bossWallet.deleteMany({ where: { tenantId: tid } });
        await client.customerProfile.deleteMany({ where: { tenantId: tid } });
        await client.gameDispatchRankRule.deleteMany({
          where: { tenantId: tid },
        });
        await client.gameDispatchPosition.deleteMany({
          where: { tenantId: tid },
        });
        await client.gameDispatchTemplateField.deleteMany({
          where: { tenantId: tid },
        });
        await client.gameDispatchTemplate.deleteMany({
          where: { tenantId: tid },
        });
        await client.game.deleteMany({ where: { tenantId: tid } });
        const accounts = await client.tenantAccount.findMany({
          where: { tenantId: tid },
          select: { id: true },
        });
        await client.refreshSession.deleteMany({
          where: { accountId: { in: accounts.map((a) => a.id) } },
        });
        await client.tenantAccountRole.deleteMany({ where: { tenantId: tid } });
        await client.tenantAccount.deleteMany({ where: { tenantId: tid } });
        await client.tenantEntitlement.deleteMany({ where: { tenantId: tid } });
        await client.tenant.deleteMany({ where: { id: tid } });
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
      put: (u: string, b?: unknown) =>
        request(app.getHttpServer())
          .put(u)
          .set(h)
          .send(b ?? {}),
      patch: (u: string, b?: unknown) =>
        request(app.getHttpServer())
          .patch(u)
          .set(h)
          .send(b ?? {}),
    };
  }

  async function putRules(
    items: { dimensionKey: string; amountFen: string; kind?: string }[],
    options: { token?: string; game?: string; enabled?: boolean } = {},
  ): Promise<RuleView> {
    const res = await req(options.token ?? ownerToken)
      .put(`${PRICING}/games/${options.game ?? gameId}`, {
        ...(options.enabled === undefined ? {} : { enabled: options.enabled }),
        items,
      })
      .expect(200);
    return (res.body as { data: RuleView }).data;
  }

  /**
   * 跑一单经典派单到「选人」：建单 → 发布 → 陪玩报名 → 老板选人。
   * 加价来源是订单快照带上的 gameId（未归类模板没有），所以模板归类要在建单之前完成。
   * 返回订单 id 与落库的单价，供各用例断言。
   */
  async function assignClassicOrder(options: {
    fieldKey?: string;
    fieldValue?: string;
    player?: "p1" | "p2";
    token?: string;
    template?: string;
  }): Promise<{ orderId: string; unitPriceFen: bigint }> {
    const player = options.player ?? "p1";
    const token = options.token ?? ownerToken;
    const fieldKey = options.fieldKey ?? "rank";
    const draft = await req(token)
      .post(`${DISPATCH}/orders`, {
        templateId: options.template ?? templateId,
        customerProfileId: customerId,
        formValues: { [fieldKey]: options.fieldValue ?? "钻石" },
        durationMinutes: 60,
        lines: [{ positionLabel: "打野", requiredCount: 1 }],
      })
      .expect(201);
    const orderId = (draft.body as { data: { orderId: string } }).data.orderId;
    const published = await req(token)
      .post(`${DISPATCH}/orders/${orderId}/publish`)
      .expect(201);
    const lineId = (published.body as { data: { lines: { id: string }[] } })
      .data.lines[0]?.id;
    if (!lineId) throw new Error("发布后没有位置行");
    await req(playerTokens[player])
      .post(`${DISPATCH}/orders/${orderId}/lines/${lineId}/applications`)
      .expect(201);
    const applications = (
      await req(token)
        .get(`${DISPATCH}/orders/${orderId}/applications`)
        .expect(200)
    ).body.data as { applications: { id: string }[] }[];
    const applicationIds = applications.flatMap((a) =>
      a.applications.map((x) => x.id),
    );
    await req(customerToken)
      .post("/api/v1/boss/wallet/recharge", { amountFen: "100000" })
      .expect(201);
    await req(token)
      .post(`${DISPATCH}/orders/${orderId}/assignment`, { applicationIds })
      .expect(201);
    const slot = await client.orderSlot.findFirstOrThrow({
      where: { tenantId, orderId, playerId: playerIds[player] },
    });
    return { orderId, unitPriceFen: slot.unitPriceFen };
  }

  it("规则库按维度键命中加价：单价 = 陪玩级底价 + 命中加价，并随订单落库", async () => {
    const view = await putRules([
      { dimensionKey: "rank=钻石", amountFen: "2000" },
      { dimensionKey: "rank=翡翠", amountFen: "1000" },
      { dimensionKey: "mode=ranked", amountFen: "2500" },
    ]);
    expect(view.items.map((i) => i.dimensionKey).sort()).toEqual([
      "mode=ranked",
      "rank=翡翠",
      "rank=钻石",
    ]);
    expect(view.items.every((i) => i.kind === "SURCHARGE")).toBe(true);

    const order = await assignClassicOrder({ fieldValue: "钻石" });
    // 陪玩级兜底 5000 + rank=钻石 2000；模板快照里的 legacy 段位加价 9900 不再参与。
    expect(order.unitPriceFen).toBe(7000n);

    const snapshot = await client.gameDispatchTemplateSnapshot.findFirstOrThrow(
      {
        where: { tenantId, orderId: order.orderId },
      },
    );
    expect(snapshot.gameId).toBe(gameId);
  });

  it("陪玩×游戏底价优先于陪玩级兜底", async () => {
    const res = await req(ownerToken)
      .put(`${PRICING}/players/${playerIds["p1"]}/games/${gameId}/base`, {
        basePricePerHourFen: "6000",
      })
      .expect(200);
    const view = (res.body as { data: MoneyView }).data;
    expect(view.basePricePerHourFen).toBe("6000");
    expect(view.fallbackBasePricePerHourFen).toBe("5000");
    expect(view.status).toBe("ACTIVE");

    const order = await assignClassicOrder({ fieldValue: "翡翠" });
    // 专属底价 6000 + rank=翡翠 1000。
    expect(order.unitPriceFen).toBe(7000n);

    // 停用专属底价 → 回退到陪玩级兜底 5000。
    await req(ownerToken)
      .put(`${PRICING}/players/${playerIds["p1"]}/games/${gameId}/base`, {
        basePricePerHourFen: "6000",
        status: "INACTIVE",
      })
      .expect(200);
    const fallbackOrder = await assignClassicOrder({ fieldValue: "翡翠" });
    expect(fallbackOrder.unitPriceFen).toBe(6000n);
  });

  it("既无陪玩×游戏底价也无陪玩级兜底时拒绝选人，不静默按 0 计", async () => {
    const draft = await req(ownerToken)
      .post(`${DISPATCH}/orders`, {
        templateId,
        customerProfileId: customerId,
        formValues: { rank: "钻石" },
        durationMinutes: 60,
        lines: [{ positionLabel: "打野", requiredCount: 1 }],
      })
      .expect(201);
    const orderId = (draft.body as { data: { orderId: string } }).data.orderId;
    const published = await req(ownerToken)
      .post(`${DISPATCH}/orders/${orderId}/publish`)
      .expect(201);
    const lineId = (published.body as { data: { lines: { id: string }[] } })
      .data.lines[0]?.id;
    await req(playerTokens["p2"])
      .post(`${DISPATCH}/orders/${orderId}/lines/${lineId}/applications`)
      .expect(201);
    const applications = (
      await req(ownerToken)
        .get(`${DISPATCH}/orders/${orderId}/applications`)
        .expect(200)
    ).body.data as { applications: { id: string }[] }[];
    const applicationIds = applications.flatMap((a) =>
      a.applications.map((x) => x.id),
    );
    await req(customerToken)
      .post("/api/v1/boss/wallet/recharge", { amountFen: "100000" })
      .expect(201);

    const failed = await req(ownerToken)
      .post(`${DISPATCH}/orders/${orderId}/assignment`, { applicationIds })
      .expect(409);
    expect((failed.body as { message: string }).message).toContain("没有底价");

    const slots = await client.orderSlot.findMany({
      where: { tenantId, orderId },
    });
    expect(slots).toHaveLength(0);
    const stillApplied = await client.gameDispatchApplication.findFirstOrThrow({
      where: { tenantId, orderId, playerId: playerIds["p2"] },
    });
    expect(stillApplied.status).toBe("APPLIED");
  });

  it("改规则库金额：新订单按新价，历史订单单价不变", async () => {
    await putRules([
      { dimensionKey: "rank=钻石", amountFen: "2000" },
      { dimensionKey: "rank=翡翠", amountFen: "1000" },
    ]);
    const before = await assignClassicOrder({ fieldValue: "钻石" });
    // 专属底价已停用 → 陪玩级兜底 5000 + rank=钻石 2000。
    expect(before.unitPriceFen).toBe(7000n);

    await putRules([
      { dimensionKey: "rank=钻石", amountFen: "3000" },
      { dimensionKey: "rank=翡翠", amountFen: "1000" },
    ]);
    const after = await assignClassicOrder({ fieldValue: "钻石" });
    expect(after.unitPriceFen).toBe(8000n);

    const historical = await client.orderSlot.findFirstOrThrow({
      where: { tenantId, orderId: before.orderId },
    });
    // 规则改成 3000 后，历史订单仍保留它落库时的 7000（快照不可回写，ADR-0003）。
    expect(historical.unitPriceFen).toBe(7000n);
  });

  it("规则按游戏隔离：别的游戏没有规则时不加价，未归类模板不参与计价", async () => {
    const otherGame = await req(ownerToken)
      .put(`${PRICING}/games/${spareGameId}`, { items: [] })
      .expect(200);
    expect((otherGame.body as { data: RuleView }).data.items).toHaveLength(0);

    const otherGameTemplate = await request(app.getHttpServer())
      .post(TEMPLATES)
      .set("authorization", `Bearer ${ownerToken}`)
      .send({
        name: `算价模板-别游戏-${suffix}`,
        fields: [
          {
            fieldKey: "rank",
            label: "目标段位",
            fieldType: "select",
            options: ["钻石"],
          },
        ],
        positions: [{ label: "打野", defaultCount: 1 }],
      })
      .expect(201);
    const otherGameTemplateId = (
      otherGameTemplate.body as { data: { id: string } }
    ).data.id;
    await client.gameDispatchTemplate.update({
      where: { id: otherGameTemplateId },
      data: { gameId: spareGameId },
    });
    const otherGameOrder = await assignClassicOrder({
      fieldValue: "钻石",
      template: otherGameTemplateId,
    });
    // spareGameId 无规则：只有底价 5000（兜底），其余游戏 8000 的规则不串过来。
    expect(otherGameOrder.unitPriceFen).toBe(5000n);

    const unclassified = await request(app.getHttpServer())
      .post(TEMPLATES)
      .set("authorization", `Bearer ${ownerToken}`)
      .send({
        name: `算价模板-未归类-${suffix}`,
        fields: [
          {
            fieldKey: "rank",
            label: "目标段位",
            fieldType: "select",
            options: ["钻石"],
          },
        ],
        positions: [{ label: "打野", defaultCount: 1 }],
      })
      .expect(201);
    const unclassifiedId = (unclassified.body as { data: { id: string } }).data
      .id;
    const unclassifiedOrder = await assignClassicOrder({
      fieldValue: "钻石",
      template: unclassifiedId,
    });
    expect(unclassifiedOrder.unitPriceFen).toBe(5000n);
  });

  it("别家租户挂在同一 gameId 上的规则不参与本租户计价", async () => {
    // 对抗性夹具：别家租户直接写一条指向本租户 gameId 的规则（外键只校验 games 存在）。
    const foreignRule = await client.gamePricingRule.create({
      data: { tenantId: otherTenantId, gameId },
    });
    await client.gamePricingRuleItem.create({
      data: {
        tenantId: otherTenantId,
        ruleId: foreignRule.id,
        dimensionKey: "rank=钻石",
        amountFen: 999999n,
      },
    });

    const visible = (
      await req(ownerToken).get(`${PRICING}/games/${gameId}`).expect(200)
    ).body.data as RuleView;
    expect(visible.items.some((item) => item.amountFen === "999999")).toBe(
      false,
    );

    const order = await assignClassicOrder({ fieldValue: "钻石" });
    expect(order.unitPriceFen).toBe(8000n);

    // 别家租户连这个游戏都读不到（游戏不在它的租户内）。
    await req(otherOwnerToken).get(`${PRICING}/games/${gameId}`).expect(404);
  });

  it("v2 模板下单：加价来自规则库，模板选项 priceDeltaFen 不再影响金额", async () => {
    await putRules([
      { dimensionKey: "rank=钻石", amountFen: "2000" },
      { dimensionKey: "rank=翡翠", amountFen: "1000" },
      { dimensionKey: "mode=ranked", amountFen: "2500" },
    ]);
    const created = await request(app.getHttpServer())
      .post(V2_TEMPLATES)
      .set("authorization", `Bearer ${ownerToken}`)
      .send({ gameId, name: `算价 v2 模板-${suffix}`, description: null })
      .expect(201);
    const createdData = (
      created.body as { data: { id: string; revision: number } }
    ).data;
    const createdId = createdData.id;
    const config = {
      schemaVersion: 2,
      sections: [
        {
          stableKey: "basic",
          label: "基本信息",
          enabled: true,
          sortOrder: 0,
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
          // legacy 选项加价：本版起不再作为定价来源。
          options: [
            { value: "ranked", label: "排位", priceDeltaFen: "1500" },
            { value: "normal", label: "匹配" },
          ],
        },
      ],
      staffingSource: { kind: "FIXED", count: 1 },
    };
    const saved = await req(ownerToken)
      .patch(`${V2_TEMPLATES}/${createdId}/draft`, {
        expectedRevision: createdData.revision,
        config,
      })
      .expect(200);
    const revision = (saved.body as { data: { revision: number } }).data
      .revision;
    const published = await req(ownerToken)
      .post(`${V2_TEMPLATES}/${createdId}/publish`, {
        expectedRevision: revision,
        changeNote: "算价模型 Task 1",
      })
      .expect(201);
    const versionId = (
      published.body as { data: { activeVersion: { id: string } } }
    ).data.activeVersion.id;

    const order = await request(app.getHttpServer())
      .post(`${DISPATCH}/template-orders`)
      .set({
        authorization: `Bearer ${ownerToken}`,
        "idempotency-key": `k-${suffix}-pricing-v2`,
      })
      .send({
        gameId,
        templateId: createdId,
        templateVersionId: versionId,
        customerProfileId: customerId,
        values: { mode: "ranked" },
      })
      .expect(201);
    const result = (order.body as { data: { priceAdjustmentFen: string } })
      .data;
    // 规则库 mode=ranked → 2500；模板选项里的 1500 不再参与。
    expect(result.priceAdjustmentFen).toBe("2500");
  });

  it("规则库写入校验：FIXED 未开放、非法命中键与重复命中键一律拒绝", async () => {
    const fixed = await req(ownerToken)
      .put(`${PRICING}/games/${gameId}`, {
        items: [
          { kind: "FIXED", dimensionKey: "mode=ranked", amountFen: "100" },
        ],
      })
      .expect(400);
    expect((fixed.body as { message: string }).message).toContain("SURCHARGE");

    await req(ownerToken)
      .put(`${PRICING}/games/${gameId}`, {
        items: [{ dimensionKey: "Mode=ranked", amountFen: "100" }],
      })
      .expect(400);

    await req(ownerToken)
      .put(`${PRICING}/games/${gameId}`, {
        items: [
          { dimensionKey: "mode=ranked", amountFen: "100" },
          { dimensionKey: "mode=ranked", amountFen: "200" },
        ],
      })
      .expect(400);

    // 金额必须是整数分字符串（禁止浮点）。
    await req(ownerToken)
      .put(`${PRICING}/games/${gameId}`, {
        items: [{ dimensionKey: "mode=ranked", amountFen: "15.5" }],
      })
      .expect(400);

    // 路由级边界校验确实挂上了：未知字段被 strictObject 拒绝
    // （服务层只看 items，能通过 400 说明拦截器注册的路径与控制器一致）。
    await req(ownerToken)
      .put(`${PRICING}/games/${gameId}`, {
        items: [],
        tenantId: otherTenantId,
      })
      .expect(400);
    // 客户端提交的 tenantId 不会进入计价：规则仍按服务端租户上下文读写。
    const view = (
      await req(ownerToken).get(`${PRICING}/games/${gameId}`).expect(200)
    ).body.data as RuleView;
    expect(view.items.map((item) => item.dimensionKey)).toEqual([
      "rank=钻石",
      "rank=翡翠",
      "mode=ranked",
    ]);
  });
});
