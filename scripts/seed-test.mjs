// 测试库 seed：仅用于 pw_saas_test/CI 测试数据库，幂等 upsert（平台超管 + 演示门店账号）。
// 与 seed-dev 同源语义；账号密码为测试固定值，禁止生产使用。
import { createDatabaseClient } from "@pw/database";
import { randomBytes, scrypt as scryptCb } from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(scryptCb);

async function hashPassword(password) {
  const salt = randomBytes(16);
  const hash = await scrypt(password, salt, 64, { N: 16384, r: 8, p: 1 });
  return `scrypt:16384:8:1:${salt.toString("base64")}:${Buffer.from(hash).toString("base64")}`;
}

const url = process.env.PW_TEST_MIGRATION_URL ?? process.env.DATABASE_URL;
if (!url)
  throw new Error("PW_TEST_MIGRATION_URL (or DATABASE_URL) is required");

const client = createDatabaseClient(url);
const testPassword = "Test-Password-123";
const hash = await hashPassword(testPassword);

const platformUsername = process.env.SEED_PLATFORM_USER ?? "admin";
await client.platformAccount.upsert({
  where: { username: platformUsername },
  update: {
    passwordHash: hash,
    status: "ACTIVE",
    role: "PLATFORM_SUPER_ADMIN",
  },
  create: {
    username: platformUsername,
    passwordHash: hash,
    role: "PLATFORM_SUPER_ADMIN",
  },
});

const tenantCode = process.env.SEED_TENANT_CODE ?? "seedtest";
const tenant = await client.tenant.upsert({
  where: { code: tenantCode },
  update: {},
  create: { code: tenantCode, name: "Seed 测试门店" },
});

async function ensureAccount(username, role) {
  const existing = await client.tenantAccount.findFirst({
    where: { tenantId: tenant.id, username },
    include: { roles: true },
  });
  if (!existing) {
    const account = await client.tenantAccount.create({
      data: { tenantId: tenant.id, username, passwordHash: hash },
    });
    await client.tenantAccountRole.create({
      data: { tenantId: tenant.id, tenantAccountId: account.id, role },
    });
    return;
  }
  if (!existing.roles.some((r) => r.role === role)) {
    await client.tenantAccountRole
      .create({
        data: { tenantId: tenant.id, tenantAccountId: existing.id, role },
      })
      .catch(() => undefined);
  }
}

await ensureAccount("owner", "TENANT_OWNER");
await ensureAccount("service", "CUSTOMER_SERVICE");
await ensureAccount("player", "PLAYER");
await ensureAccount("customer", "CUSTOMER");

await client.$disconnect();
console.log(`seed test ok: platform=${platformUsername}, tenant=${tenantCode}`);
