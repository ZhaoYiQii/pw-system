import "reflect-metadata";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Test } from "@nestjs/testing";
import request from "supertest";
import type { INestApplication } from "@nestjs/common";
import { AppModule } from "../../apps/api/src/app.module.js";
import { createDatabaseClient } from "@pw/database";
import type { PrismaClient } from "@pw/database";

const suffix = Date.now().toString(36);
const passwordTenantCode = `acctreg_${suffix}`;
const passwordPhone = "13900003333";
const FIRST_PASSWORD = "first-password-123";
const SECOND_PASSWORD = "second-password-456";
const THIRD_PASSWORD = "third-password-789";

/**
 * 注册用例按租户分组：注册限流键是 `{ip}:register:{tenantCode}`，同租户共享 5 次/15 分钟额度，
 * 不同租户互不影响——所以每组一个独立租户，组内次数按下面注释分配，不得改动分组。
 */
const groupA = `acctreg_a_${suffix}`;
const groupB = `acctreg_b_${suffix}`;
const groupMissing = `acctreg_ne_${suffix}`;
const groupRateLimit = `acctreg_rl_${suffix}`;
const groupCode = `acctreg_code_${suffix}`;
const ACCOUNT_PASSWORD = "self-register-123";
const A_PHONE = "13900004444";
const E_PHONE = "13900005555";

function envOrThrow(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`missing env ${name}`);
  return v;
}

/**
 * SP2 §5.1/§5.2 的 HTTP 边界：自助注册（手机的短信码、限流、租户内唯一）与设置/修改密码。
 *
 * 改密部分的账号用手机号登录自动建号得到（password_set_by_user=false）——这正是「存量随机密码账号」
 * 的等价场景：第一次设置免验原密码，此后修改必验，失败路径一行都不写。
 */
describe("SP2 注册与密码（HTTP 边界）", () => {
  let app: INestApplication;
  let client: PrismaClient;
  let cleanupTenantIds: string[] = [];
  let passwordTenantId = "";
  let groupATenantId = "";
  let groupBTenantId = "";
  let groupDTenantId = "";
  let groupETenantId = "";

  // —— 改密场景的共享状态 ——
  let accountId = "";
  let username = "";
  let accessToken = "";

  async function createTenant(code: string, name: string): Promise<string> {
    const tenant = await client.tenant.create({ data: { code, name } });
    cleanupTenantIds.push(tenant.id);
    return tenant.id;
  }

  function issueCodeFor(
    tenantId: string,
    tenantCode: string,
    phone: string,
  ): Promise<string> {
    return client.phoneVerificationCode
      .deleteMany({ where: { tenantId } })
      .then(() =>
        request(app.getHttpServer())
          .post("/api/v1/auth/phone-verification-code")
          .send({ tenantCode, phone })
          .expect(201),
      )
      .then(
        (sent) =>
          (sent.body as { data: { debugCode?: string } }).data.debugCode ?? "",
      );
  }

  function accountCount(tenantId: string): Promise<number> {
    return client.tenantAccount.count({ where: { tenantId } });
  }

  function register(body: {
    tenantCode: string;
    username: string;
    password: string;
    phone?: string;
    code?: string;
  }) {
    return request(app.getHttpServer())
      .post("/api/v1/auth/register")
      .send(body);
  }

  function passwordLogin(tenantCode: string, name: string, password: string) {
    return request(app.getHttpServer())
      .post("/api/v1/auth/login")
      .send({ kind: "tenant", tenantCode, username: name, password });
  }

  async function cleanupTenant(tenantId: string): Promise<void> {
    const accounts = await client.tenantAccount.findMany({
      where: { tenantId },
      select: { id: true },
    });
    const accountIds = accounts.map((a) => a.id);
    await client.auditLog.deleteMany({ where: { tenantId } });
    await client.phoneVerificationCode.deleteMany({ where: { tenantId } });
    await client.customerProfile.deleteMany({ where: { tenantId } });
    if (accountIds.length > 0) {
      await client.tenantAccountRole.deleteMany({
        where: { tenantId, tenantAccountId: { in: accountIds } },
      });
      await client.tenantAccount.deleteMany({
        where: { id: { in: accountIds } },
      });
    }
    await client.tenant.deleteMany({ where: { id: tenantId } });
  }

  beforeAll(async () => {
    client = createDatabaseClient(envOrThrow("PW_TEST_MIGRATION_URL"));
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();

    passwordTenantId = await createTenant(passwordTenantCode, "账号密码店");
    groupATenantId = await createTenant(groupA, "注册甲店");
    groupBTenantId = await createTenant(groupB, "注册乙店");
    groupDTenantId = await createTenant(groupRateLimit, "注册限流店");
    groupETenantId = await createTenant(groupCode, "注册码店");

    const code = await issueCodeFor(
      passwordTenantId,
      passwordTenantCode,
      passwordPhone,
    );
    const login = await request(app.getHttpServer())
      .post("/api/v1/auth/phone-login")
      .send({ tenantCode: passwordTenantCode, phone: passwordPhone, code })
      .expect(201);
    const data = (
      login.body as {
        data: {
          accessToken: string;
          principal: { sub: string; username: string };
        };
      }
    ).data;
    accessToken = data.accessToken;
    accountId = data.principal.sub;
    username = data.principal.username;
  });

  afterAll(async () => {
    if (client) {
      for (const tenantId of cleanupTenantIds) {
        await cleanupTenant(tenantId);
      }
      cleanupTenantIds = [];
      await client.$disconnect();
    }
    if (app) await app.close();
  });

  describe("设置/修改密码", () => {
    function passwordSetByUser(): Promise<boolean | null> {
      return client.tenantAccount
        .findUnique({
          where: { id: accountId },
          select: { passwordSetByUser: true },
        })
        .then((row) => row?.passwordSetByUser ?? null);
    }

    function auditCount(): Promise<number> {
      return client.auditLog.count({
        where: { tenantId: passwordTenantId, action: "auth.password.set" },
      });
    }

    function changePassword(body: {
      newPassword: string;
      currentPassword?: string;
    }) {
      return request(app.getHttpServer())
        .post("/api/v1/auth/password")
        .set("authorization", `Bearer ${accessToken}`)
        .send(body);
    }

    it("未认证 → 401（Bearer 缺失）", async () => {
      await request(app.getHttpServer())
        .post("/api/v1/auth/password")
        .send({ newPassword: FIRST_PASSWORD })
        .expect(401);
    });

    it("初次设置（系统随机密码账号）→ 免验原密码；置 password_set_by_user 并记审计", async () => {
      expect(await passwordSetByUser()).toBe(false);
      const res = await changePassword({ newPassword: FIRST_PASSWORD }).expect(
        200,
      );
      expect(res.body).toEqual({ data: { ok: true } });
      expect(await passwordSetByUser()).toBe(true);
      expect(await auditCount()).toBe(1);
      // 新密码可用账号密码登录（此前该账号只有系统随机密码）
      await passwordLogin(passwordTenantCode, username, FIRST_PASSWORD).expect(
        201,
      );
    });

    it("修改时缺 currentPassword → 400，且一行都不写（密码与审计均不变）", async () => {
      await changePassword({ newPassword: SECOND_PASSWORD }).expect(400);
      expect(await passwordSetByUser()).toBe(true);
      expect(await auditCount()).toBe(1);
      await passwordLogin(passwordTenantCode, username, FIRST_PASSWORD).expect(
        201,
      );
    });

    it("修改时 currentPassword 错误 → 400，且一行都不写", async () => {
      await changePassword({
        newPassword: SECOND_PASSWORD,
        currentPassword: "wrong-password-000",
      }).expect(400);
      expect(await auditCount()).toBe(1);
      await passwordLogin(passwordTenantCode, username, FIRST_PASSWORD).expect(
        201,
      );
    });

    it("修改时 currentPassword 正确 → 成功，新密码生效、旧密码失效", async () => {
      await changePassword({
        newPassword: THIRD_PASSWORD,
        currentPassword: FIRST_PASSWORD,
      }).expect(200);
      expect(await auditCount()).toBe(2);
      await passwordLogin(passwordTenantCode, username, THIRD_PASSWORD).expect(
        201,
      );
      await passwordLogin(passwordTenantCode, username, FIRST_PASSWORD).expect(
        401,
      );
    });
  });

  describe("自助注册", () => {
    it("A1 注册成功 → 201 + CUSTOMER 会话、客户档案与审计；账号随即可用密码登录", async () => {
      const res = await register({
        tenantCode: groupA,
        username: "a_customer",
        password: ACCOUNT_PASSWORD,
      }).expect(201);
      const data = (
        res.body as {
          data: {
            accessToken: string;
            principal: {
              sub: string;
              role: string;
              roles: string[];
              tenantId: string;
              username: string;
            };
          };
        }
      ).data;
      expect(data.principal.role).toBe("CUSTOMER");
      expect(data.principal.roles).toContain("CUSTOMER");
      expect(data.principal.tenantId).toBe(groupATenantId);
      expect(data.principal.username).toBe("a_customer");
      expect(data.accessToken.length).toBeGreaterThan(0);
      expect(await accountCount(groupATenantId)).toBe(1);
      expect(
        await client.customerProfile.count({ where: { tenantId: groupATenantId } }),
      ).toBe(1);
      expect(
        await client.auditLog.count({
          where: { tenantId: groupATenantId, action: "auth.register" },
        }),
      ).toBe(1);
      await passwordLogin(groupA, "a_customer", ACCOUNT_PASSWORD).expect(201);
    });

    it("A2 同租户重复用户名 → 409，账号数不变", async () => {
      await register({
        tenantCode: groupA,
        username: "a_customer",
        password: ACCOUNT_PASSWORD,
      }).expect(409);
      expect(await accountCount(groupATenantId)).toBe(1);
    });

    it("A3 注册时绑定手机号 → 手机号快捷登录命中同一账号", async () => {
      const regCode = await issueCodeFor(groupATenantId, groupA, A_PHONE);
      const res = await register({
        tenantCode: groupA,
        username: "a_phone_user",
        password: ACCOUNT_PASSWORD,
        phone: A_PHONE,
        code: regCode,
      }).expect(201);
      const registeredId = (res.body as { data: { principal: { sub: string } } })
        .data.principal.sub;
      expect(await accountCount(groupATenantId)).toBe(2);

      const loginCode = await issueCodeFor(groupATenantId, groupA, A_PHONE);
      const login = await request(app.getHttpServer())
        .post("/api/v1/auth/phone-login")
        .send({ tenantCode: groupA, phone: A_PHONE, code: loginCode })
        .expect(201);
      expect(
        (login.body as { data: { principal: { sub: string } } }).data.principal
          .sub,
      ).toBe(registeredId);
    });

    it("A4 手机号已被占用 → 409，且不产生第二个账号", async () => {
      const regCode = await issueCodeFor(groupATenantId, groupA, A_PHONE);
      await register({
        tenantCode: groupA,
        username: "a_third",
        password: ACCOUNT_PASSWORD,
        phone: A_PHONE,
        code: regCode,
      }).expect(409);
      expect(await accountCount(groupATenantId)).toBe(2);
    });

    it("B 跨租户同名 → 201（用户名只在本租户内唯一）", async () => {
      await register({
        tenantCode: groupB,
        username: "a_customer",
        password: ACCOUNT_PASSWORD,
      }).expect(201);
      expect(await accountCount(groupBTenantId)).toBe(1);
    });

    it("C 门店不存在 → 404，且不会凭空建出门店", async () => {
      await register({
        tenantCode: groupMissing,
        username: "c_customer",
        password: ACCOUNT_PASSWORD,
      }).expect(404);
      expect(
        await client.tenant.findUnique({ where: { code: groupMissing } }),
      ).toBeNull();
    });

    it("D 注册尝试按次数计数：第 6 次 → 429，失败路径不产生任何账号", async () => {
      for (let attempt = 0; attempt < 5; attempt += 1) {
        await register({
          tenantCode: groupRateLimit,
          username: "x",
          password: ACCOUNT_PASSWORD,
        }).expect(400);
      }
      await register({
        tenantCode: groupRateLimit,
        username: "x",
        password: ACCOUNT_PASSWORD,
      }).expect(429);
      expect(await accountCount(groupDTenantId)).toBe(0);
    });

    it("E 短信码错误 → 400，且不产生账号", async () => {
      await issueCodeFor(groupETenantId, groupCode, E_PHONE);
      await register({
        tenantCode: groupCode,
        username: "e_customer",
        password: ACCOUNT_PASSWORD,
        phone: E_PHONE,
        code: "000000",
      }).expect(400);
      expect(await accountCount(groupETenantId)).toBe(0);
    });
  });
});
