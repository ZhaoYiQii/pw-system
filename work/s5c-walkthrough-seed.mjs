// 一次性走查夹具（算价模型 Task 5c）：只在已授权的一次性测试库上创建/清理走查门店与场景。
// 用法（scenario 需要本地 API 在 API_BASE 上运行）：
//   DATABASE_URL=postgresql://pw:pw_dev_only@127.0.0.1:5433/pw_saas_s2_task2_20260916?schema=public \
//   API_BASE=http://127.0.0.1:3300 node work/s5c-walkthrough-seed.mjs scenario|clean
import { createDatabaseClient } from "@pw/database";
import { randomBytes, scrypt as scryptCb } from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(scryptCb);

async function hashPassword(password) {
  const salt = randomBytes(16);
  const hash = await scrypt(password, salt, 64, { N: 16384, r: 8, p: 1 });
  return `scrypt:16384:8:1:${salt.toString("base64")}:${Buffer.from(hash).toString("base64")}`;
}

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is required");
const databaseName = new URL(url).pathname.replace(/^\//, "");
if (databaseName !== "pw_saas_s2_task2_20260916") {
  throw new Error(`refusing to touch database: ${databaseName}`);
}
const apiBase = process.env.API_BASE ?? "http://127.0.0.1:3300";
const tenantCode = "s5cwalk";
const password = "zcloud1024";
const gameName = "英雄联盟 走查";
const client = createDatabaseClient(url);

const PNG = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0, 0, 0, 0, 0,
]);

async function api(path, init = {}) {
  const res = await fetch(`${apiBase}${path}`, {
    method: init.method ?? "GET",
    headers: {
      "content-type": "application/json",
      ...(init.token ? { authorization: `Bearer ${init.token}` } : {}),
    },
    ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
  });
  const text = await res.text();
  const json = text ? JSON.parse(text) : null;
  if (!res.ok) {
    throw new Error(
      `${init.method ?? "GET"} ${path} -> ${res.status} ${text.slice(0, 300)}`,
    );
  }
  return json?.data ?? json;
}

async function login(username) {
  const data = await api("/api/v1/auth/login", {
    method: "POST",
    body: { kind: "tenant", tenantCode, username, password },
  });
  return data.accessToken;
}

async function uploadEvidence(token, slotId, type) {
  const res = await fetch(
    `${apiBase}/api/v1/tenant/game-dispatch/slots/${slotId}/session/evidence?evidenceType=${type}`,
    {
      method: "POST",
      headers: {
        "content-type": "application/octet-stream",
        authorization: `Bearer ${token}`,
        "x-file-name": `${type.toLowerCase()}.png`,
      },
      body: PNG,
    },
  );
  if (!res.ok) throw new Error(`evidence ${type} -> ${res.status}`);
}

async function cleanTenant(tid) {
  await client.settlementItem.deleteMany({ where: { tenantId: tid } });
  await client.settlementBatch.deleteMany({ where: { tenantId: tid } });
  await client.slotEvidence.deleteMany({ where: { tenantId: tid } });
  await client.slotSession.deleteMany({ where: { tenantId: tid } });
  await client.slotEarning.deleteMany({ where: { tenantId: tid } });
  await client.playerBreachRecord.deleteMany({ where: { tenantId: tid } });
  await client.orderSlot.deleteMany({ where: { tenantId: tid } });
  await client.gameDispatchApplication.deleteMany({ where: { tenantId: tid } });
  await client.gameDispatchRound.deleteMany({ where: { tenantId: tid } });
  await client.gameDispatchLine.deleteMany({ where: { tenantId: tid } });
  await client.gameDispatchOrder.deleteMany({ where: { tenantId: tid } });
  await client.gameDispatchTemplateSnapshot.deleteMany({
    where: { tenantId: tid },
  });
  await client.gamePricingRuleItem.deleteMany({ where: { tenantId: tid } });
  await client.gamePricingRule.deleteMany({ where: { tenantId: tid } });
  await client.playerGamePrice.deleteMany({ where: { tenantId: tid } });
  await client.orderRequirement.deleteMany({ where: { tenantId: tid } });
  await client.orderEvent.deleteMany({ where: { tenantId: tid } });
  await client.auditLog.deleteMany({ where: { tenantId: tid } });
  await client.notificationDelivery.deleteMany({ where: { tenantId: tid } });
  await client.outboxEvent.deleteMany({ where: { tenantId: tid } });
  await client.order.deleteMany({ where: { tenantId: tid } });
  await client.walletEntry.deleteMany({ where: { tenantId: tid } });
  await client.paymentOrder.deleteMany({ where: { tenantId: tid } });
  await client.bossWallet.deleteMany({ where: { tenantId: tid } });
  await client.playerProfile.deleteMany({ where: { tenantId: tid } });
  await client.customerProfile.deleteMany({ where: { tenantId: tid } });
  await client.gameDispatchRankRule.deleteMany({ where: { tenantId: tid } });
  await client.gameDispatchPosition.deleteMany({ where: { tenantId: tid } });
  await client.gameDispatchTemplateField.deleteMany({ where: { tenantId: tid } });
  await client.gameDispatchTemplate.updateMany({
    where: { tenantId: tid },
    data: { activeVersionId: null },
  });
  await client.gameDispatchTemplateVersion.deleteMany({
    where: { tenantId: tid },
  });
  await client.gameDispatchTemplate.deleteMany({ where: { tenantId: tid } });
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
  await client.tenant.delete({ where: { id: tid } });
}

try {
  const mode = process.argv[2] ?? "scenario";
  const existingTenant = await client.tenant.findUnique({
    where: { code: tenantCode },
  });
  if (mode === "clean") {
    if (!existingTenant) console.log("nothing to clean");
    else {
      await cleanTenant(existingTenant.id);
      console.log(`cleaned tenant ${tenantCode}`);
    }
  } else if (mode === "clean-legacy") {
    // 收口 Task 2 遗留的走查门店（s6walk）：按 tenantId 逐表清理后删除租户。
    const legacy = await client.tenant.findUnique({ where: { code: "s6walk" } });
    if (!legacy) {
      console.log("no s6walk tenant");
    } else {
      const tid = legacy.id;
      const counts = {};
      async function purge(label, fn) {
        const res = await fn();
        counts[label] = res.count;
      }
      await purge("settlementItem", () =>
        client.settlementItem.deleteMany({ where: { tenantId: tid } }),
      );
      await purge("settlementBatch", () =>
        client.settlementBatch.deleteMany({ where: { tenantId: tid } }),
      );
      await purge("slotEvidence", () =>
        client.slotEvidence.deleteMany({ where: { tenantId: tid } }),
      );
      await purge("slotSession", () =>
        client.slotSession.deleteMany({ where: { tenantId: tid } }),
      );
      await purge("slotEarning", () =>
        client.slotEarning.deleteMany({ where: { tenantId: tid } }),
      );
      await purge("playerBreachRecord", () =>
        client.playerBreachRecord.deleteMany({ where: { tenantId: tid } }),
      );
      await purge("orderSlot", () =>
        client.orderSlot.deleteMany({ where: { tenantId: tid } }),
      );
      await purge("gameDispatchApplication", () =>
        client.gameDispatchApplication.deleteMany({ where: { tenantId: tid } }),
      );
      await purge("gameDispatchRound", () =>
        client.gameDispatchRound.deleteMany({ where: { tenantId: tid } }),
      );
      await purge("gameDispatchLine", () =>
        client.gameDispatchLine.deleteMany({ where: { tenantId: tid } }),
      );
      await purge("gameDispatchOrder", () =>
        client.gameDispatchOrder.deleteMany({ where: { tenantId: tid } }),
      );
      await purge("gameDispatchTemplateSnapshot", () =>
        client.gameDispatchTemplateSnapshot.deleteMany({ where: { tenantId: tid } }),
      );
      await purge("gamePricingRuleItem", () =>
        client.gamePricingRuleItem.deleteMany({ where: { tenantId: tid } }),
      );
      await purge("gamePricingRule", () =>
        client.gamePricingRule.deleteMany({ where: { tenantId: tid } }),
      );
      await purge("playerGamePrice", () =>
        client.playerGamePrice.deleteMany({ where: { tenantId: tid } }),
      );
      await purge("evidenceAsset", () =>
        client.evidenceAsset.deleteMany({ where: { tenantId: tid } }),
      );
      await purge("sessionEvent", () =>
        client.sessionEvent.deleteMany({ where: { tenantId: tid } }),
      );
      await purge("sessionAdjustment", () =>
        client.sessionAdjustment.deleteMany({ where: { tenantId: tid } }),
      );
      await purge("serviceSession", () =>
        client.serviceSession.deleteMany({ where: { tenantId: tid } }),
      );
      await purge("earning", () =>
        client.earning.deleteMany({ where: { tenantId: tid } }),
      );
      await purge("disputeEvent", () =>
        client.disputeEvent.deleteMany({ where: { tenantId: tid } }),
      );
      await purge("dispute", () =>
        client.dispute.deleteMany({ where: { tenantId: tid } }),
      );
      await purge("assignment", () =>
        client.assignment.deleteMany({ where: { tenantId: tid } }),
      );
      await purge("application", () =>
        client.application.deleteMany({ where: { tenantId: tid } }),
      );
      await purge("dispatchPublication", () =>
        client.dispatchPublication.deleteMany({ where: { tenantId: tid } }),
      );
      await purge("ledgerEntry", () =>
        client.ledgerEntry.deleteMany({ where: { tenantId: tid } }),
      );
      await purge("ledgerTransaction", () =>
        client.ledgerTransaction.deleteMany({ where: { tenantId: tid } }),
      );
      await purge("ledgerAccount", () =>
        client.ledgerAccount.deleteMany({ where: { tenantId: tid } }),
      );
      await purge("orderRequirement", () =>
        client.orderRequirement.deleteMany({ where: { tenantId: tid } }),
      );
      await purge("orderEvent", () =>
        client.orderEvent.deleteMany({ where: { tenantId: tid } }),
      );
      await purge("orderPriceSnapshot", () =>
        client.orderPriceSnapshot.deleteMany({ where: { tenantId: tid } }),
      );
      await purge("auditLog", () =>
        client.auditLog.deleteMany({ where: { tenantId: tid } }),
      );
      await purge("notificationDelivery", () =>
        client.notificationDelivery.deleteMany({ where: { tenantId: tid } }),
      );
      await purge("outboxEvent", () =>
        client.outboxEvent.deleteMany({ where: { tenantId: tid } }),
      );
      await purge("order", () =>
        client.order.deleteMany({ where: { tenantId: tid } }),
      );
      await purge("walletEntry", () =>
        client.walletEntry.deleteMany({ where: { tenantId: tid } }),
      );
      await purge("paymentOrder", () =>
        client.paymentOrder.deleteMany({ where: { tenantId: tid } }),
      );
      await purge("bossWallet", () =>
        client.bossWallet.deleteMany({ where: { tenantId: tid } }),
      );
      await purge("playerProfile", () =>
        client.playerProfile.deleteMany({ where: { tenantId: tid } }),
      );
      await purge("customerProfile", () =>
        client.customerProfile.deleteMany({ where: { tenantId: tid } }),
      );
      await purge("playerSkill", () =>
        client.playerSkill.deleteMany({ where: { tenantId: tid } }),
      );
      await purge("playerAvailability", () =>
        client.playerAvailability.deleteMany({ where: { tenantId: tid } }),
      );
      await purge("pricingRule", () =>
        client.pricingRule.deleteMany({ where: { tenantId: tid } }),
      );
      await purge("gameDispatchRankRule", () =>
        client.gameDispatchRankRule.deleteMany({ where: { tenantId: tid } }),
      );
      await purge("gameDispatchPosition", () =>
        client.gameDispatchPosition.deleteMany({ where: { tenantId: tid } }),
      );
      await purge("gameDispatchTemplateField", () =>
        client.gameDispatchTemplateField.deleteMany({ where: { tenantId: tid } }),
      );
      await purge("gameDispatchTemplateSection", () =>
        client.gameDispatchTemplateSection.deleteMany({
          where: { tenantId: tid },
        }),
      );
      await client.gameDispatchTemplate.updateMany({
        where: { tenantId: tid },
        data: { activeVersionId: null },
      });
      await purge("gameDispatchTemplateVersion", () =>
        client.gameDispatchTemplateVersion.deleteMany({ where: { tenantId: tid } }),
      );
      await purge("gameDispatchTemplate", () =>
        client.gameDispatchTemplate.deleteMany({ where: { tenantId: tid } }),
      );
      await purge("serviceProduct", () =>
        client.serviceProduct.deleteMany({ where: { tenantId: tid } }),
      );
      await purge("gameRegion", () =>
        client.gameRegion.deleteMany({ where: { tenantId: tid } }),
      );
      await purge("game", () => client.game.deleteMany({ where: { tenantId: tid } }));
      await purge("tenantConfigVersion", () =>
        client.tenantConfigVersion.deleteMany({ where: { tenantId: tid } }),
      );
      await purge("playerApplication", () =>
        client.playerApplication.deleteMany({ where: { tenantId: tid } }),
      );
      const accounts = await client.tenantAccount.findMany({
        where: { tenantId: tid },
        select: { id: true },
      });
      await purge("refreshSession", () =>
        client.refreshSession.deleteMany({
          where: { accountId: { in: accounts.map((a) => a.id) } },
        }),
      );
      await purge("tenantAccountRole", () =>
        client.tenantAccountRole.deleteMany({ where: { tenantId: tid } }),
      );
      await purge("tenantAccount", () =>
        client.tenantAccount.deleteMany({ where: { tenantId: tid } }),
      );
      await purge("tenantEntitlement", () =>
        client.tenantEntitlement.deleteMany({ where: { tenantId: tid } }),
      );
      await purge("tenantSubscription", () =>
        client.tenantSubscription.deleteMany({ where: { tenantId: tid } }),
      );
      await client.tenantDomain.deleteMany({ where: { tenantId: tid } });
      await client.tenant.delete({ where: { id: tid } });
      console.log(JSON.stringify({ cleaned: "s6walk", counts }, null, 2));
    }
  } else {
    const hash = await hashPassword(password);
    const tenant =
      existingTenant ??
      (await client.tenant.create({
        data: { code: tenantCode, name: "S5c 走查门店" },
      }));
    const tid = tenant.id;
    // 走查需要两个 addon：经典接单大厅（陪玩端入口）与客户自助（老板端选人页）。
    for (const featureKey of [
      "addon.player_order_hall",
      "addon.customer_self_service",
    ]) {
      await client.tenantEntitlement.upsert({
        where: { tenantId_featureKey: { tenantId: tid, featureKey } },
        update: { enabled: true },
        create: { tenantId: tid, featureKey, enabled: true, source: "walkthrough" },
      });
    }

    async function account(username, role) {
      const found = await client.tenantAccount.findFirst({
        where: { tenantId: tid, username },
      });
      const acc =
        found ??
        (await client.tenantAccount.create({
          data: { tenantId: tid, username, passwordHash: hash },
        }));
      const hasRole = await client.tenantAccountRole.findFirst({
        where: { tenantId: tid, tenantAccountId: acc.id, role },
      });
      if (!hasRole) {
        await client.tenantAccountRole.create({
          data: { tenantId: tid, tenantAccountId: acc.id, role },
        });
      }
      return acc;
    }

    await account("owner", "TENANT_OWNER");
    await account("cs", "CUSTOMER_SERVICE");
    const bossAcc = await account("boss", "CUSTOMER");
    const p1Acc = await account("player1", "PLAYER");
    const p2Acc = await account("player2", "PLAYER");

    const customer =
      (await client.customerProfile.findFirst({
        where: { tenantId: tid, name: "走查老板" },
      })) ??
      (await client.customerProfile.create({
        data: { tenantId: tid, name: "走查老板", tenantAccountId: bossAcc.id },
      }));
    const player1 =
      (await client.playerProfile.findFirst({
        where: { tenantId: tid, name: "走查陪玩甲" },
      })) ??
      (await client.playerProfile.create({
        data: {
          tenantId: tid,
          name: "走查陪玩甲",
          tenantAccountId: p1Acc.id,
          basePricePerHourFen: 6000n,
        },
      }));
    await client.playerProfile.upsert({
      where: {
        tenantId_tenantAccountId: { tenantId: tid, tenantAccountId: p2Acc.id },
      },
      update: {},
      create: {
        tenantId: tid,
        name: "走查陪玩乙",
        tenantAccountId: p2Acc.id,
        basePricePerHourFen: 5500n,
      },
    });

    const game =
      (await client.game.findFirst({
        where: { tenantId: tid, name: gameName },
      })) ??
      (await client.game.create({ data: { tenantId: tid, name: gameName } }));

    const ownerToken = await login("owner");
    // 模板走 API 创建（服务端负责 sections/rankRules/copyLines 等必填默认值），再归类到游戏。
    let template = await client.gameDispatchTemplate.findFirst({
      where: { tenantId: tid, name: "走查派单模板" },
    });
    if (!template) {
      const created = await api("/api/v1/tenant/game-templates", {
        method: "POST",
        token: ownerToken,
        body: {
          name: "走查派单模板",
          fields: [
            {
              fieldKey: "rank",
              label: "目标段位",
              fieldType: "select",
              options: ["钻石", "翡翠"],
            },
          ],
          positions: [{ label: "打野", defaultCount: 1 }],
        },
      });
      template = await client.gameDispatchTemplate.findFirstOrThrow({
        where: { tenantId: tid, id: created.id },
      });
    }
    await client.gameDispatchTemplate.update({
      where: { id: template.id },
      data: { gameId: game.id },
    });

    await api(`/api/v1/tenant/game-pricing/games/${game.id}`, {
      method: "PUT",
      token: ownerToken,
      body: { items: [{ dimensionKey: "rank=钻石", amountFen: "1000" }] },
    });
    const player1Token = await login("player1");
    const player2Token = await login("player2");
    const bossToken = await login("boss");

    async function draftAndPublish() {
      const draft = await api("/api/v1/tenant/game-dispatch/orders", {
        method: "POST",
        token: ownerToken,
        body: {
          templateId: template.id,
          customerProfileId: customer.id,
          formValues: { rank: "钻石" },
          durationMinutes: 60,
          lines: [{ positionLabel: "打野", requiredCount: 1 }],
        },
      });
      const published = await api(
        `/api/v1/tenant/game-dispatch/orders/${draft.orderId}/publish`,
        { method: "POST", token: ownerToken },
      );
      return { orderId: draft.orderId, lineId: published.lines[0].id };
    }

    async function applyAndAssign(playerToken) {
      const order = await draftAndPublish();
      const application = await api(
        `/api/v1/tenant/game-dispatch/orders/${order.orderId}/lines/${order.lineId}/applications`,
        { method: "POST", token: playerToken, body: {} },
      );
      await api("/api/v1/boss/wallet/recharge", {
        method: "POST",
        token: bossToken,
        body: { amountFen: "100000" },
      });
      await api(`/api/v1/tenant/game-dispatch/orders/${order.orderId}/assignment`, {
        method: "POST",
        token: ownerToken,
        body: { applicationIds: [application.id] },
      });
      return { ...order, applicationId: application.id };
    }

    // 场景 1：已发布（陪玩端可报名）。
    const orderPublished = await draftAndPublish();
    await api(
      `/api/v1/tenant/game-dispatch/orders/${orderPublished.orderId}/lines/${orderPublished.lineId}/applications`,
      { method: "POST", token: player2Token, body: {} },
    );

    // 场景 2：已选定（商家端可释放名额 / 记违约）。
    const orderAssigned = await applyAndAssign(player1Token);

    // 场景 3：服务结束 + 已报单（商家端场次详情待审批 + 截图预览）。
    const orderReported = await applyAndAssign(player1Token);
    const slot = await client.orderSlot.findFirstOrThrow({
      where: { tenantId: tid, applicationId: orderReported.applicationId },
    });
    await api(`/api/v1/tenant/game-dispatch/slots/${slot.id}/session/start`, {
      method: "POST",
      token: player1Token,
      body: {},
    });
    await new Promise((r) => setTimeout(r, 1100));
    await uploadEvidence(player1Token, slot.id, "START");
    await api(`/api/v1/tenant/game-dispatch/slots/${slot.id}/session/end`, {
      method: "POST",
      token: player1Token,
      body: {},
    });
    await uploadEvidence(player1Token, slot.id, "REPORT_START");
    await uploadEvidence(player1Token, slot.id, "REPORT_END");
    await api(`/api/v1/tenant/game-dispatch/slots/${slot.id}/report`, {
      method: "POST",
      token: player1Token,
      body: { declaredDurationMinutes: 90 },
    });
    const session = await client.slotSession.findFirstOrThrow({
      where: { tenantId: tid, orderSlotId: slot.id },
    });

    console.log(
      JSON.stringify(
        {
          tenantCode,
          password,
          apiBase,
          orderPublished: orderPublished.orderId,
          orderAssigned: orderAssigned.orderId,
          orderReportPending: orderReported.orderId,
          reportSlotId: slot.id,
          reportSessionId: session.id,
          player1Id: player1.id,
        },
        null,
        2,
      ),
    );
  }
} finally {
  await client.$disconnect();
}
