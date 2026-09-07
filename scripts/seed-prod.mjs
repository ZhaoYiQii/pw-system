// 生产演示门店初始化：平台超管 + 演示租户（域名绑定）+ 四角色账号。
// 用法（owner 连接）：
//   DATABASE_URL=<owner url> SEED_PLATFORM_PASSWORD=... SEED_TENANT_PASSWORD=... node scripts/seed-prod.mjs
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
if (!url) throw new Error("DATABASE_URL is required (owner/migration role)");
const platformPassword = process.env.SEED_PLATFORM_PASSWORD;
const tenantPassword = process.env.SEED_TENANT_PASSWORD;
if (!platformPassword || !tenantPassword) {
  throw new Error(
    "SEED_PLATFORM_PASSWORD and SEED_TENANT_PASSWORD are required",
  );
}

const platformUsername = process.env.SEED_PLATFORM_USER ?? "admin";
const tenantCode = process.env.SEED_TENANT_CODE ?? "demo";
const tenantName = process.env.SEED_TENANT_NAME ?? "演示门店";
const hosts = (process.env.SEED_TENANT_HOSTS ?? "")
  .split(",")
  .map((v) => v.trim())
  .filter(Boolean);

const client = createDatabaseClient(url);
const platformHash = await hashPassword(platformPassword);
const tenantHash = await hashPassword(tenantPassword);

await client.platformAccount.upsert({
  where: { username: platformUsername },
  update: {
    passwordHash: platformHash,
    status: "ACTIVE",
    role: "PLATFORM_SUPER_ADMIN",
  },
  create: {
    username: platformUsername,
    passwordHash: platformHash,
    role: "PLATFORM_SUPER_ADMIN",
  },
});

const tenant = await client.tenant.upsert({
  where: { code: tenantCode },
  update: { name: tenantName, status: "ACTIVE" },
  create: { code: tenantCode, name: tenantName },
});

for (const [index, host] of hosts.entries()) {
  const existing = await client.tenantDomain.findFirst({
    where: { tenantId: tenant.id, host },
  });
  if (existing) {
    await client.tenantDomain.update({
      where: { id: existing.id },
      data: { isPrimary: index === 0 },
    });
  } else {
    await client.tenantDomain.create({
      data: {
        tenantId: tenant.id,
        host,
        isPrimary: index === 0,
      },
    });
  }
}

async function ensureAccount(username, role) {
  const existing = await client.tenantAccount.findFirst({
    where: { tenantId: tenant.id, username },
    include: { roles: true },
  });
  if (!existing) {
    const account = await client.tenantAccount.create({
      data: {
        tenantId: tenant.id,
        username,
        passwordHash: tenantHash,
      },
    });
    await client.tenantAccountRole.create({
      data: { tenantId: tenant.id, tenantAccountId: account.id, role },
    });
    return;
  }
  await client.tenantAccount.update({
    where: { id: existing.id },
    data: { passwordHash: tenantHash, status: "ACTIVE" },
  });
  const hasRole = existing.roles.some((r) => r.role === role);
  if (!hasRole) {
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
console.log(
  `seed-prod ok: platform=${platformUsername}, tenant=${tenantCode}, hosts=${hosts.join(",")}`,
);
