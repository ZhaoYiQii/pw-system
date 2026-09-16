// S4 一次性 E2E 夹具脚本：只在已授权的一次性测试库上创建/清理固定门店与两个游戏。
// 用法：
//   DATABASE_URL=postgresql://pw:pw_dev_only@127.0.0.1:5433/pw_saas_s2_task2_20260916?schema=public node work/s4-e2e-seed.mjs seed
//   ... node work/s4-e2e-seed.mjs clean
// 模板与发布版本不在这里造：由 E2E 经真实 API 创建并发布，避免夹具复制领域逻辑。
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

const mode = process.argv[2] ?? "seed";
const tenantCode = process.env.S4_E2E_TENANT_CODE ?? "s4e2e";
const password = process.env.S4_E2E_PASSWORD ?? "zcloud1024";
const gameNames = (process.env.S4_E2E_GAMES ?? "英雄联盟 S4,无畏契约 S4")
  .split(",")
  .map((name) => name.trim())
  .filter((name) => name !== "");
const client = createDatabaseClient(url);

try {
  if (mode === "clean") {
    const tenant = await client.tenant.findUnique({
      where: { code: tenantCode },
    });
    if (!tenant) {
      console.log("nothing to clean");
    } else {
      const tenantId = tenant.id;
      await client.gameDispatchTemplateSnapshot.deleteMany({
        where: { tenantId },
      });
      await client.gameDispatchOrder.deleteMany({ where: { tenantId } });
      await client.idempotencyRecord.deleteMany({ where: { tenantId } });
      await client.order.deleteMany({ where: { tenantId } });
      await client.customerProfile.deleteMany({ where: { tenantId } });
      await client.gameDispatchTemplate.updateMany({
        where: { tenantId },
        data: { activeVersionId: null },
      });
      await client.gameDispatchTemplateVersion.deleteMany({
        where: { tenantId },
      });
      await client.gameDispatchTemplate.deleteMany({ where: { tenantId } });
      await client.auditLog.deleteMany({ where: { tenantId } });
      await client.tenantAccountRole.deleteMany({ where: { tenantId } });
      await client.tenantAccount.deleteMany({ where: { tenantId } });
      await client.game.deleteMany({ where: { tenantId } });
      await client.tenant.delete({ where: { id: tenantId } });
      console.log(`cleaned tenant ${tenantCode}`);
    }
  } else {
    const hash = await hashPassword(password);
    const tenant = await client.tenant.upsert({
      where: { code: tenantCode },
      update: {},
      create: { code: tenantCode, name: "S4 E2E 门店" },
    });
    const existing = await client.tenantAccount.findFirst({
      where: { tenantId: tenant.id, username: "owner" },
    });
    const account =
      existing ??
      (await client.tenantAccount.create({
        data: { tenantId: tenant.id, username: "owner", passwordHash: hash },
      }));
    const hasRole = await client.tenantAccountRole.findFirst({
      where: {
        tenantId: tenant.id,
        tenantAccountId: account.id,
        role: "TENANT_OWNER",
      },
    });
    if (!hasRole) {
      await client.tenantAccountRole.create({
        data: {
          tenantId: tenant.id,
          tenantAccountId: account.id,
          role: "TENANT_OWNER",
        },
      });
    }
    for (const name of gameNames) {
      const game = await client.game.findFirst({
        where: { tenantId: tenant.id, name },
      });
      if (!game) {
        await client.game.create({ data: { tenantId: tenant.id, name } });
      }
    }
    const customer = await client.customerProfile.findFirst({
      where: { tenantId: tenant.id, name: "S4 E2E 客户" },
    });
    if (!customer) {
      await client.customerProfile.create({
        data: { tenantId: tenant.id, name: "S4 E2E 客户" },
      });
    }
    console.log(
      JSON.stringify({
        tenantCode,
        username: "owner",
        databaseName,
        gameNames,
      }),
    );
  }
} finally {
  await client.$disconnect();
}
