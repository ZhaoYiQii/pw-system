// 开发 seed：为指定门店准备「客户自助下单 + 陪玩接单大厅」联调数据。
// 幂等（upsert/更新，不删除已有数据）；账号密码沿用 seed-dev 的 Dev-Password-123。
// 用法：
//   DATABASE_URL=postgresql://pw:pw_dev_only@127.0.0.1:5433/pw_saas?schema=public \
//   SEED_TENANT_CODE=c1 node scripts/seed-store-demo.mjs
import { createDatabaseClient } from "@pw/database";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is required");

const tenantCode = process.env.SEED_TENANT_CODE ?? "demo";
const client = createDatabaseClient(url);

const tenant = await client.tenant.findUnique({ where: { code: tenantCode } });
if (!tenant) throw new Error(`tenant not found: ${tenantCode}`);
const tid = tenant.id;

async function enableAddon(featureKey) {
  await client.tenantEntitlement.upsert({
    where: { tenantId_featureKey: { tenantId: tid, featureKey } },
    update: { enabled: true },
    create: {
      tenantId: tid,
      featureKey,
      enabled: true,
      source: "platform",
    },
  });
}

await enableAddon("addon.customer_self_service");
await enableAddon("addon.player_order_hall");

async function requireAccount(username, roleHint) {
  const account = await client.tenantAccount.findFirst({
    where: { tenantId: tid, username },
  });
  if (!account)
    throw new Error(
      `账号 ${username} 不存在，请先运行 seed-dev（SEED_TENANT_CODE=${tenantCode}）`,
    );
  return account;
}

async function ensureProfile(model, name, account, extra = {}) {
  const existing = await client[model].findFirst({
    where: { tenantId: tid, name },
  });
  if (existing) {
    if (existing.tenantAccountId !== account.id) {
      await client[model].update({
        where: { id: existing.id },
        data: { tenantAccountId: account.id },
      });
    }
    return existing;
  }
  return client[model].create({
    data: {
      tenantId: tid,
      name,
      tenantAccountId: account.id,
      ...extra,
    },
  });
}

// 客户账号 customer 绑定「老王」，陪玩账号 player 绑定「阿伟」。
const customerAccount = await requireAccount("customer", "CUSTOMER");
await ensureProfile("customerProfile", "老王", customerAccount, {
  remark: "门店联调演示客户",
});

const playerAccount = await requireAccount("player", "PLAYER");
const player = await ensureProfile("playerProfile", "阿伟", playerAccount, {
  intro: "王者荣耀 荣耀王者 50星",
});

// 服务目录：王者荣耀 → 微信1区 → 王者·组队1小时（3600 秒，1500 分）。
let game = await client.game.findFirst({
  where: { tenantId: tid, name: "王者荣耀" },
});
if (!game) {
  game = await client.game.create({
    data: { tenantId: tid, name: "王者荣耀" },
  });
}

let region = await client.gameRegion.findFirst({
  where: { tenantId: tid, gameId: game.id, name: "微信1区" },
});
if (!region) {
  region = await client.gameRegion.create({
    data: { tenantId: tid, gameId: game.id, name: "微信1区" },
  });
}

let product = await client.serviceProduct.findFirst({
  where: { tenantId: tid, gameId: game.id, name: "王者·组队1小时" },
});
if (!product) {
  product = await client.serviceProduct.create({
    data: {
      tenantId: tid,
      gameId: game.id,
      gameRegionId: region.id,
      name: "王者·组队1小时",
      description: "门店联调演示服务",
    },
  });
}

await client.pricingRule.upsert({
  where: {
    tenantId_serviceProductId_durationSeconds: {
      tenantId: tid,
      serviceProductId: product.id,
      durationSeconds: 3600,
    },
  },
  update: { priceFen: 1500n, enabled: true },
  create: {
    tenantId: tid,
    serviceProductId: product.id,
    durationSeconds: 3600,
    priceFen: 1500n,
    playerCostFen: 1200n,
    enabled: true,
  },
});

// 让阿伟具备该游戏技能，便于接单/推荐校验（无排期冲突即默认可接）。
await client.playerSkill.upsert({
  where: {
    tenantId_playerId_gameId: {
      tenantId: tid,
      playerId: player.id,
      gameId: game.id,
    },
  },
  update: {},
  create: {
    tenantId: tid,
    playerId: player.id,
    gameId: game.id,
    gameRegionId: region.id,
    title: "王者 50 星",
  },
});

await client.$disconnect();
console.log(
  `store demo seed ok: tenant=${tenantCode}, addons=enabled, customer=老王(customer), player=阿伟(player)`,
);
