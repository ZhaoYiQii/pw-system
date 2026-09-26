import "reflect-metadata";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Test } from "@nestjs/testing";
import request from "supertest";
import type { INestApplication } from "@nestjs/common";
import { AppModule } from "../../apps/api/src/app.module.js";
import { hashPassword } from "../../apps/api/src/modules/identity-access/infrastructure/password.js";
import type { RoleKey } from "../../apps/api/src/modules/identity-access/domain/roles.js";
import { createDatabaseClient } from "@pw/database";
import type { PrismaClient } from "@pw/database";

const PW = "PlayerApply-1";
const suffix = Date.now().toString(36);
const tenantCode = `pa_${suffix}`;

function envOrThrow(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`missing env ${name}`);
  return v;
}

describe("P-3 player application（申请/审核/追加 PLAYER）", () => {
  let app: INestApplication;
  let client: PrismaClient;
  let tenantId = "";
  let ownerToken = "";
  let customerToken = "";
  let customerAccountId = "";

  beforeAll(async () => {
    client = createDatabaseClient(envOrThrow("PW_TEST_MIGRATION_URL"));
    const hash = await hashPassword(PW);
    const tenant = await client.tenant.create({
      data: { code: tenantCode, name: "陪玩申请店" },
    });
    tenantId = tenant.id;

    async function account(username: string, role: RoleKey) {
      const a = await client.tenantAccount.create({
        data: { tenantId, username, passwordHash: hash },
      });
      await client.tenantAccountRole.create({
        data: { tenantId, tenantAccountId: a.id, role },
      });
      return a;
    }
    const owner = await account("boss", "TENANT_OWNER");
    const customer = await account("bossone", "CUSTOMER");
    customerAccountId = customer.id;
    await client.customerProfile.create({
      data: {
        tenantId,
        tenantAccountId: customer.id,
        name: "申请老板",
      },
    });

    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();

    async function login(username: string) {
      const r = await request(app.getHttpServer())
        .post("/api/v1/auth/login")
        .send({ kind: "tenant", tenantCode, username, password: PW })
        .expect(201);
      return (r.body as { data: { accessToken?: string } }).data
        .accessToken as string;
    }
    ownerToken = await login("boss");
    customerToken = await login("bossone");
    void owner;
  });

  afterAll(async () => {
    if (client) {
      await client.auditLog.deleteMany({ where: { tenantId } });
      await client.playerApplication.deleteMany({ where: { tenantId } });
      await client.playerProfile.deleteMany({ where: { tenantId } });
      await client.customerProfile.deleteMany({ where: { tenantId } });
      await client.tenantAccountRole.deleteMany({ where: { tenantId } });
      await client.tenantAccount.deleteMany({ where: { tenantId } });
      await client.tenant.deleteMany({ where: { id: tenantId } });
      await client.$disconnect();
    }
    if (app) await app.close();
  });

  function customerReq() {
    return request(app.getHttpServer())
      .post("/api/v1/tenant/player-applications")
      .set("authorization", `Bearer ${customerToken}`);
  }

  function ownerReq(path: string) {
    return request(app.getHttpServer())
      .post(path)
      .set("authorization", `Bearer ${ownerToken}`);
  }

  it("老板申请成为陪玩 → 店长审核通过 → 同一账号追加 PLAYER 并建档", async () => {
    const created = await customerReq()
      .send({ intro: "主玩三角洲，可陪可带" })
      .expect(201);
    const appId = (created.body as { data: { id: string } }).data.id;
    expect(appId.length).toBeGreaterThan(0);

    await customerReq().send({ intro: "重复申请" }).expect(409);

    const list = await request(app.getHttpServer())
      .get("/api/v1/tenant/player-applications")
      .set("authorization", `Bearer ${ownerToken}`)
      .expect(200);
    expect(
      (list.body as { data: Array<{ id: string }> }).data.some(
        (item) => item.id === appId,
      ),
    ).toBe(true);

    await ownerReq(`/api/v1/tenant/player-applications/${appId}/approve`)
      .send({})
      .expect(201);

    const profile = await client.playerProfile.findFirst({
      where: { tenantId, tenantAccountId: customerAccountId },
    });
    expect(profile).not.toBeNull();
    const roles = await client.tenantAccountRole.findMany({
      where: { tenantId, tenantAccountId: customerAccountId },
    });
    expect(roles.some((r) => r.role === "PLAYER")).toBe(true);
    const updated = await client.playerApplication.findUniqueOrThrow({
      where: { id: appId },
    });
    expect(updated.status).toBe("APPROVED");

    const switched = await request(app.getHttpServer())
      .post("/api/v1/auth/switch-context")
      .set("authorization", `Bearer ${customerToken}`)
      .send({ context: "PLAYER" })
      .expect(201);
    expect(
      (switched.body as { data: { principal: { role: string } } }).data
        .principal.role,
    ).toBe("PLAYER");
  });

  // 依赖声明：本用例依赖上一个用例已完成 approve（同一 describe 顺序执行）。
  // 断言顺序刻意把「权限并集」放在最前：它是本缺陷的决定性判据，且在修复前
  // 恒为红灯（role=PLAYER 时 PLAYER 权限集无 order.manage）。角色解析与 claim
  // 形态的断言在修复前是随机的（取决于 DB 返回顺序），放后面避免掩盖真因。
  it("多角色（SP1 回归）：默认落地老板端，且切换端上下文后仍保有另一端权限", async () => {
    const login = await request(app.getHttpServer())
      .post("/api/v1/auth/login")
      .send({ kind: "tenant", tenantCode, username: "bossone", password: PW })
      .expect(201);
    const bundle = (
      login.body as {
        data: {
          accessToken: string;
          principal: { role: string; roles?: readonly string[] };
        };
      }
    ).data;

    // 1) 切到陪玩端上下文
    const switched = await request(app.getHttpServer())
      .post("/api/v1/auth/switch-context")
      .set("authorization", `Bearer ${bundle.accessToken}`)
      .send({ context: "PLAYER" })
      .expect(201);
    const playerToken = (switched.body as { data: { accessToken: string } })
      .data.accessToken;

    // 2) 决定性判据：切到陪玩端后，老板端权限接口仍必须可用（权限并集；修复前为 403）
    await request(app.getHttpServer())
      .get("/api/v1/tenant/orders")
      .set("authorization", `Bearer ${playerToken}`)
      .expect(200);

    // 3) 默认（CUSTOMER 上下文）下老板端权限接口可用
    await request(app.getHttpServer())
      .get("/api/v1/tenant/orders")
      .set("authorization", `Bearer ${bundle.accessToken}`)
      .expect(200);

    // 4) 默认落地老板端：主角色必须是 CUSTOMER（ROLE_PRIORITY 中 CUSTOMER 先于 PLAYER）
    expect(bundle.principal.role).toBe("CUSTOMER");
    // 5) 会话 principal 必须携带全部角色
    expect(bundle.principal.roles).toEqual(["CUSTOMER", "PLAYER"]);

    // 6) roles 经 JWT 签发/校验往返后不丢失
    const me = await request(app.getHttpServer())
      .get("/api/v1/auth/me")
      .set("authorization", `Bearer ${playerToken}`)
      .expect(200);
    expect(
      (me.body as { data: { roles?: readonly string[] } }).data.roles,
    ).toEqual(["CUSTOMER", "PLAYER"]);
  });

  // 端上下文切换的错误契约：账号未持有目标端角色时必须 403（「需要陪玩身份」），
  // 而不是 500。修复前 service 抛 InvalidCredentialsError（登录失败语义的域错误），
  // switchContext 控制器未做错误映射 → 全局过滤器把域错误转成 500
  // Internal server error，移动端的 403「待审核」分支因此永远走不到。
  // 依赖声明：boss 账号在 beforeAll 创建，全程只持有 TENANT_OWNER（approve 给
  // bossone 追加 PLAYER，不影响 boss），因此它是稳定的「无陪玩角色」夹具。
  it("未持有陪玩角色：switch-context 返回 403 而非 500", async () => {
    const res = await request(app.getHttpServer())
      .post("/api/v1/auth/switch-context")
      .set("authorization", `Bearer ${ownerToken}`)
      .send({ context: "PLAYER" });
    expect(res.status).toBe(403);
    const body = res.body as { code?: string; status?: number; message?: string };
    expect(body.status).toBe(403);
    expect(body.code).not.toBe("INTERNAL_ERROR");
    expect(typeof body.message).toBe("string");
  });

  it("非法 context：switch-context 返回 400（非法入参不升级为 5xx）", async () => {
    await request(app.getHttpServer())
      .post("/api/v1/auth/switch-context")
      .set("authorization", `Bearer ${ownerToken}`)
      .send({ context: "ADMIN" })
      .expect(400);
  });

  // 账号被禁用后不得继续签发新上下文 token：客户端 401 分支据此清 token 退回登录卡。
  // 若此处返回 403，被禁账号会看到「陪玩申请审核中」的误导提示，因此单独钉住 401。
  it("账号被禁用：switch-context 返回 401（会话不可继续）", async () => {
    const hash = await hashPassword(PW);
    const disabled = await client.tenantAccount.create({
      data: { tenantId, username: "disabledone", passwordHash: hash },
    });
    await client.tenantAccountRole.create({
      data: { tenantId, tenantAccountId: disabled.id, role: "CUSTOMER" },
    });
    const login = await request(app.getHttpServer())
      .post("/api/v1/auth/login")
      .send({
        kind: "tenant",
        tenantCode,
        username: "disabledone",
        password: PW,
      })
      .expect(201);
    const token = (login.body as { data: { accessToken: string } }).data
      .accessToken;
    await client.tenantAccount.update({
      where: { id: disabled.id },
      data: { status: "DISABLED" },
    });
    await request(app.getHttpServer())
      .post("/api/v1/auth/switch-context")
      .set("authorization", `Bearer ${token}`)
      .send({ context: "CUSTOMER" })
      .expect(401);
  });
});
