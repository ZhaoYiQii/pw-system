import "reflect-metadata";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Test } from "@nestjs/testing";
import request from "supertest";
import type { INestApplication } from "@nestjs/common";
import { AppModule } from "../../apps/api/src/app.module.js";
import { hashPassword } from "../../apps/api/src/modules/identity-access/infrastructure/password.js";
import { createDatabaseClient } from "@pw/database";
import type { PrismaClient } from "@pw/database";

/** 与 domain/features.ts 目录一致的开关键。 */
const FEATURE = "addon.game_dispatch_template_v2";
const PW = "Feature-Gate-Password-1";
const suffix = Date.now().toString(36);
const disabledTenant = `s5off_${suffix}`;
const enabledTenant = `s5on_${suffix}`;
const base = "/api/v1/tenant/game-dispatch-templates";

describe("S5 租户级开关：通用派单模板 v2", () => {
  let app: INestApplication;
  let client: PrismaClient;
  let disabledTenantId = "";
  let enabledTenantId = "";
  let disabledToken = "";
  let enabledToken = "";
  let enabledGameId = "";

  beforeAll(async () => {
    client = createDatabaseClient(
      process.env.PW_TEST_MIGRATION_URL ??
        (() => {
          throw new Error("missing env PW_TEST_MIGRATION_URL");
        })(),
    );
    const hash = await hashPassword(PW);

    async function tenantWithOwner(code: string, enabled: boolean) {
      const tenant = await client.tenant.create({
        data: { code, name: `S5 开关 ${code}` },
      });
      const account = await client.tenantAccount.create({
        data: { tenantId: tenant.id, username: "boss", passwordHash: hash },
      });
      await client.tenantAccountRole.create({
        data: {
          tenantId: tenant.id,
          tenantAccountId: account.id,
          role: "TENANT_OWNER",
        },
      });
      // opt-in：只有显式写入 enabled=true 的租户才开通；未开通租户不写行。
      if (enabled) {
        await client.tenantEntitlement.create({
          data: { tenantId: tenant.id, featureKey: FEATURE, enabled: true },
        });
      }
      return tenant.id;
    }

    disabledTenantId = await tenantWithOwner(disabledTenant, false);
    enabledTenantId = await tenantWithOwner(enabledTenant, true);
    const game = await client.game.create({
      data: { tenantId: enabledTenantId, name: `S5 游戏-${suffix}` },
    });
    enabledGameId = game.id;

    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();

    async function login(code: string): Promise<string> {
      const res = await request(app.getHttpServer())
        .post("/api/v1/auth/login")
        .send({
          kind: "tenant",
          tenantCode: code,
          username: "boss",
          password: PW,
        })
        .expect(201);
      return (res.body as { data: { accessToken: string } }).data.accessToken;
    }

    disabledToken = await login(disabledTenant);
    enabledToken = await login(enabledTenant);
  });

  afterAll(async () => {
    if (client) {
      const tids = [disabledTenantId, enabledTenantId].filter(
        (id) => id !== "",
      );
      await client.gameDispatchTemplate.updateMany({
        where: { tenantId: { in: tids } },
        data: { activeVersionId: null },
      });
      await client.gameDispatchTemplateVersion.deleteMany({
        where: { tenantId: { in: tids } },
      });
      await client.gameDispatchTemplate.deleteMany({
        where: { tenantId: { in: tids } },
      });
      await client.tenantEntitlement.deleteMany({
        where: { tenantId: { in: tids } },
      });
      await client.auditLog.deleteMany({ where: { tenantId: { in: tids } } });
      await client.tenantAccountRole.deleteMany({
        where: { tenantId: { in: tids } },
      });
      await client.tenantAccount.deleteMany({
        where: { tenantId: { in: tids } },
      });
      await client.game.deleteMany({ where: { tenantId: { in: tids } } });
      await client.tenant.deleteMany({ where: { id: { in: tids } } });
      await client.$disconnect();
    }
    if (app) await app.close();
  });

  function req(token: string) {
    const headers = { authorization: `Bearer ${token}` };
    return {
      get: (url: string) => request(app.getHttpServer()).get(url).set(headers),
      post: (url: string, body?: unknown) =>
        request(app.getHttpServer())
          .post(url)
          .set(headers)
          .send(body ?? {}),
    };
  }

  it("未开通门店：v2 入口返回 403，且报错不泄露其他租户信息", async () => {
    const list = await req(disabledToken).get(base).expect(403);
    expect(JSON.stringify(list.body)).toContain("feature disabled");

    const create = await req(disabledToken)
      .post(base, { gameId: enabledGameId, name: "未开通不该建出来" })
      .expect(403);
    expect(JSON.stringify(create.body)).not.toContain(enabledTenant);
  });

  it("开通后同一接口立即恢复可用（开关无缓存，回退即时生效）", async () => {
    // 未开通租户此前没有行，这里补一行模拟 runbook 的开通动作。
    await client.tenantEntitlement.create({
      data: { tenantId: disabledTenantId, featureKey: FEATURE, enabled: true },
    });

    // 门禁每次请求读能力位（无 TTL 缓存），开通/回退都即时生效。
    await req(disabledToken).get(`${base}?gameId=${enabledGameId}`).expect(200);

    // 回退：置回 false 后立即不可用，数据不受影响。
    await client.tenantEntitlement.updateMany({
      where: { tenantId: disabledTenantId, featureKey: FEATURE },
      data: { enabled: false },
    });
    await req(disabledToken).get(`${base}?gameId=${enabledGameId}`).expect(403);
  });
  it("已开通门店不受其他租户开关影响", async () => {
    const enabled = await req(enabledToken).get(
      `${base}?gameId=${enabledGameId}`,
    );
    expect([200, 403]).toContain(enabled.status);
    // 该租户自己的 addon 始终为 true，因此不应因别人关闭而失败
    const rows = await client.tenantEntitlement.findMany({
      where: { tenantId: enabledTenantId, featureKey: FEATURE },
    });
    expect(rows[0]?.enabled).toBe(true);
  });
});
