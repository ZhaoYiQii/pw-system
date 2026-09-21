// 本地 E2E 辅助：在一次性测试库上补出「门店账号 + 平台账号」并设为已知密码，
// 这样浏览器（跑在 3006，指向 3100 API）能完成真实登录。
// 只用于本地测试库，密码固定 zcloud1024（与其它 E2E 约定一致）。
import { createDatabaseClient } from "@pw/database";
import { hashPassword } from "../apps/api/dist/modules/identity-access/infrastructure/password.js";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is required");
const client = createDatabaseClient(url);
const password = "zcloud1024";
const hash = await hashPassword(password);

const tenants = [
  { code: "s4e2e", name: "S4 E2E 门店" },
  { code: "s3e2e", name: "S3 E2E 门店" },
];

for (const tenant of tenants) {
  const row = await client.tenant.upsert({
    where: { code: tenant.code },
    update: {},
    create: tenant,
  });
  const account = await client.tenantAccount.upsert({
    where: {
      tenantId_username: { tenantId: row.id, username: "owner" },
    },
    update: { passwordHash: hash, status: "ACTIVE" },
    create: {
      tenantId: row.id,
      username: "owner",
      passwordHash: hash,
      status: "ACTIVE",
    },
  });
  const hasRole = await client.tenantAccountRole.findFirst({
    where: { tenantId: row.id, tenantAccountId: account.id },
  });
  if (!hasRole) {
    await client.tenantAccountRole.create({
      data: {
        tenantId: row.id,
        tenantAccountId: account.id,
        role: "TENANT_OWNER",
      },
    });
  }
}

await client.platformAccount.upsert({
  where: { username: "admin" },
  update: { passwordHash: hash, status: "ACTIVE", role: "PLATFORM_SUPER_ADMIN" },
  create: {
    username: "admin",
    passwordHash: hash,
    role: "PLATFORM_SUPER_ADMIN",
  },
});

await client.$disconnect();
console.log("e2e login seed ok: s4e2e/s3e2e owner + platform admin");
