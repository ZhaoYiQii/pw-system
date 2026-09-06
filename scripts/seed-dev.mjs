// 开发 seed：创建平台超管 + 演示门店账号（owner/客服/陪玩/客户）。
// 幂等（upsert）。仅本地开发使用；密码为开发默认值，生产禁止。
// 用法：DATABASE_URL=postgresql://pw:pw_dev_only@127.0.0.1:5433/pw_saas?schema=public node scripts/seed-dev.mjs
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

const client = createDatabaseClient(url);
const devPassword = "Dev-Password-123";
const hash = await hashPassword(devPassword);

// 平台超管
const platformUsername = process.env.SEED_PLATFORM_USER ?? "admin";
await client.platformAccount.upsert({
  where: { username: platformUsername },
  update: { passwordHash: hash, status: "ACTIVE", role: "PLATFORM_SUPER_ADMIN" },
  create: { username: platformUsername, passwordHash: hash, role: "PLATFORM_SUPER_ADMIN" }
});

// 演示门店
const tenantCode = process.env.SEED_TENANT_CODE ?? "demo";
const tenant = await client.tenant.upsert({
  where: { code: tenantCode },
  update: {},
  create: { code: tenantCode, name: "演示门店" }
});

async function ensureAccount(username, role) {
  const existing = await client.tenantAccount.findFirst({
    where: { tenantId: tenant.id, username },
    include: { roles: true }
  });
  if (!existing) {
    const account = await client.tenantAccount.create({
      data: { tenantId: tenant.id, username, passwordHash: hash }
    });
    await client.tenantAccountRole.create({
      data: { tenantId: tenant.id, tenantAccountId: account.id, role }
    });
    return;
  }
  const hasRole = existing.roles.some((r) => r.role === role);
  if (!hasRole) {
    await client.tenantAccountRole.create({
      data: { tenantId: tenant.id, tenantAccountId: existing.id, role }
    }).catch(() => undefined);
  }
}

await ensureAccount("owner", "TENANT_OWNER");
await ensureAccount("service", "CUSTOMER_SERVICE");
await ensureAccount("player", "PLAYER");
await ensureAccount("customer", "CUSTOMER");

await client.$disconnect();
console.log(`seed ok: platform=admin/${platformUsername}, tenant=${tenantCode}, password=${devPassword}`);
