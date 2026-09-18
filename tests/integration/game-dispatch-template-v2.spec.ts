import "reflect-metadata";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Test } from "@nestjs/testing";
import request from "supertest";
import type { INestApplication } from "@nestjs/common";
import { AppModule } from "../../apps/api/src/app.module.js";
import { hashPassword } from "../../apps/api/src/modules/identity-access/infrastructure/password.js";
import { PrismaGenericGameTemplateRepository } from "../../apps/api/src/modules/game-dispatch/infrastructure/prisma-generic-game-template.repository.js";
import { createDatabaseClient } from "@pw/database";
import type { PrismaClient } from "@pw/database";

const PW = "Template-V2-Password-1";
const suffix = Date.now().toString(36);
const tenantCode = `gdv2_${suffix}`;
const otherTenantCode = `gdv2b_${suffix}`;

function envOrThrow(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`missing env ${name}`);
  return v;
}

interface DraftView {
  id: string;
  name: string;
  description: string | null;
  status: string;
  revision: number;
  isDefault: boolean;
  activeVersionNo: number | null;
  hasUnpublishedChanges: boolean;
  updatedBy: string | null;
  game: { id: string; name: string };
  config: Record<string, unknown>;
  activeVersion: null | { id: string; versionNo: number };
}

interface SummaryView {
  id: string;
  name: string;
  status: string;
  revision: number;
  isDefault: boolean;
  hasUnpublishedChanges: boolean;
  game: { id: string; name: string };
}

interface ListBody {
  data: SummaryView[];
  page: { nextCursor: string | null };
}

const MINIMAL_DRAFT = {
  schemaVersion: 2,
  sections: [],
  components: [],
  staffingSource: { kind: "FIXED", count: 1 },
} as const;

/** 一个含启用数字字段（人数来源）与禁用说明组件的合法草稿。 */
function draftWithDisabledNote(noteEnabled: boolean): Record<string, unknown> {
  return {
    schemaVersion: 2,
    sections: [
      {
        stableKey: "base",
        label: "基础信息",
        enabled: true,
        sortOrder: 0,
        layout: { columns: 2 },
      },
    ],
    components: [
      {
        kind: "FIELD",
        stableKey: "player_count",
        sectionKey: "base",
        label: "人数",
        enabled: true,
        sortOrder: 0,
        layout: { colSpan: 1, rowBreakBefore: false },
        fieldType: "NUMBER",
        semanticRole: "STAFFING_COUNT",
        required: true,
      },
      {
        kind: "NOTE",
        stableKey: "notice",
        sectionKey: "base",
        label: "须知",
        enabled: noteEnabled,
        sortOrder: 1,
        layout: { colSpan: 2, rowBreakBefore: true },
        text: "上号前请确认订单",
      },
    ],
    staffingSource: { kind: "NUMBER_FIELD", componentKey: "player_count" },
  };
}

/**
 * 端口可见性夹具：分组声明 CUSTOMER，数字字段按参数覆盖（`undefined` = 不声明、跟随分组），
 * 说明组件始终不声明。用来分别覆盖"组件覆盖分组"与"未声明继承"两种情况。
 */
function audienceDraft(
  componentAudiences: string[] | undefined,
): Record<string, unknown> {
  const draft = draftWithDisabledNote(true);
  const sections = draft.sections as Array<Record<string, unknown>>;
  if (sections[0]) sections[0].audiences = ["CUSTOMER"];
  const components = draft.components as Array<Record<string, unknown>>;
  if (components[0] && componentAudiences !== undefined) {
    components[0].audiences = componentAudiences;
  }
  return draft;
}

/** 读取草稿 / 发布快照里某个区块或组件的端口标记（未声明时为 undefined）。 */
function audiencesAt(
  config: Record<string, unknown>,
  list: "sections" | "components",
  index: number,
): unknown {
  const entries = config[list] as Array<Record<string, unknown>> | undefined;
  return entries?.[index]?.audiences;
}

/** 统计 Prisma 调用次数，用于证明列表查询不随模板数量增长。 */
function countingPrisma(base: PrismaClient): {
  client: PrismaClient;
  calls: string[];
} {
  const calls: string[] = [];
  const client = new Proxy(base as unknown as Record<string, unknown>, {
    get(target, prop: string) {
      const value = target[prop];
      if (typeof value === "function") {
        return (...args: unknown[]): unknown => {
          calls.push(prop);
          return (value as (...a: unknown[]) => unknown).apply(base, args);
        };
      }
      if (value !== null && typeof value === "object") {
        return new Proxy(value as Record<string, unknown>, {
          get(inner, method: string) {
            const fn = inner[method];
            if (typeof fn !== "function") return fn;
            return (...args: unknown[]): unknown => {
              calls.push(`${prop}.${method}`);
              return (fn as (...a: unknown[]) => unknown).apply(value, args);
            };
          },
        });
      }
      return value;
    },
  });
  return { client: client as unknown as PrismaClient, calls };
}

describe("Game Dispatch generic templates v2（摘要列表/草稿竖切）", () => {
  let app: INestApplication;
  let client: PrismaClient;
  let tenantId: string;
  let otherTenantId: string;
  let gameAId: string;
  let gameBId: string;
  let foreignGameId: string;
  let ownerId: string;
  let ownerToken: string;
  let csToken: string;
  let playerToken: string;

  beforeAll(async () => {
    client = createDatabaseClient(envOrThrow("PW_TEST_MIGRATION_URL"));
    const hash = await hashPassword(PW);
    const tenant = await client.tenant.create({
      data: { code: tenantCode, name: "通用模板店" },
    });
    tenantId = tenant.id;
    const other = await client.tenant.create({
      data: { code: otherTenantCode, name: "别家店" },
    });
    otherTenantId = other.id;
    // S5 门禁是 opt-in：夹具必须显式开通 v2 addon。
    await client.tenantEntitlement.create({
      data: {
        tenantId: tenantId,
        featureKey: "addon.game_dispatch_template_v2",
        enabled: true,
      },
    });
    // S5 门禁是 opt-in：夹具必须显式开通 v2 addon。
    await client.tenantEntitlement.create({
      data: {
        tenantId: otherTenantId,
        featureKey: "addon.game_dispatch_template_v2",
        enabled: true,
      },
    });

    async function addAccount(
      tid: string,
      username: string,
      role: string,
    ): Promise<string> {
      const account = await client.tenantAccount.create({
        data: { tenantId: tid, username, passwordHash: hash },
      });
      await client.tenantAccountRole.create({
        data: { tenantId: tid, tenantAccountId: account.id, role },
      });
      return account.id;
    }

    ownerId = await addAccount(tenantId, "boss", "TENANT_OWNER");
    await addAccount(tenantId, "manager", "TENANT_ADMIN");
    await addAccount(tenantId, "service", "CUSTOMER_SERVICE");
    await addAccount(tenantId, `p_${suffix}`, "PLAYER");

    const gameA = await client.game.create({
      data: { tenantId, name: `英雄联盟-${suffix}` },
    });
    const gameB = await client.game.create({
      data: { tenantId, name: `无畏契约-${suffix}` },
    });
    const foreign = await client.game.create({
      data: { tenantId: otherTenantId, name: `别家游戏-${suffix}` },
    });
    gameAId = gameA.id;
    gameBId = gameB.id;
    foreignGameId = foreign.id;

    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();

    async function login(code: string, username: string): Promise<string> {
      const res = await request(app.getHttpServer())
        .post("/api/v1/auth/login")
        .send({ kind: "tenant", tenantCode: code, username, password: PW })
        .expect(201);
      return (res.body as { data: { accessToken: string } }).data.accessToken;
    }

    ownerToken = await login(tenantCode, "boss");
    csToken = await login(tenantCode, "service");
    playerToken = await login(tenantCode, `p_${suffix}`);
  });

  afterAll(async () => {
    if (client) {
      const tids = [tenantId, otherTenantId];
      // active_version_id 是 templates → versions 的外键，必须先解引用再删版本。
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
      await client.auditLog.deleteMany({ where: { tenantId: { in: tids } } });
      await client.tenantAccountRole.deleteMany({
        where: { tenantId: { in: tids } },
      });
      await client.tenantAccount.deleteMany({
        where: { tenantId: { in: tids } },
      });
      await client.game.deleteMany({ where: { tenantId: { in: tids } } });
      // S5 门禁是 opt-in：夹具写入了 entitlement，收尾必须先删（外键 Restrict）。
      await client.tenantEntitlement.deleteMany({
        where: { tenantId: { in: tids } },
      });
      await client.tenant.deleteMany({ where: { id: { in: tids } } });
      await client.$disconnect();
    }
    if (app) await app.close();
  });

  function req(token: string) {
    const h = { authorization: `Bearer ${token}` };
    return {
      get: (u: string) => request(app.getHttpServer()).get(u).set(h),
      post: (u: string, b?: unknown) =>
        request(app.getHttpServer())
          .post(u)
          .set(h)
          .send(b ?? {}),
      patch: (u: string, b: unknown) =>
        request(app.getHttpServer()).patch(u).set(h).send(b),
      delete: (u: string) => request(app.getHttpServer()).delete(u).set(h),
    };
  }

  const base = "/api/v1/tenant/game-dispatch-templates";

  async function createTemplate(input: {
    gameId: string;
    name: string;
    description?: string;
  }): Promise<DraftView> {
    const res = await req(ownerToken).post(base, input).expect(201);
    return (res.body as { data: DraftView }).data;
  }

  it("create：生成最小 v2 草稿并写入同事务审计", async () => {
    const created = await createTemplate({
      gameId: gameAId,
      name: `新建草稿-${suffix}`,
    });
    expect(created.status).toBe("DRAFT");
    expect(created.revision).toBe(1);
    expect(created.isDefault).toBe(false);
    expect(created.activeVersion).toBeNull();
    expect(created.activeVersionNo).toBeNull();
    expect(created.game).toEqual({ id: gameAId, name: `英雄联盟-${suffix}` });
    expect(created.config).toMatchObject({
      schemaVersion: 2,
      sections: [],
      components: [],
      staffingSource: { kind: "FIXED", count: 1 },
    });

    const audit = await client.auditLog.findFirst({
      where: {
        tenantId,
        action: "game_template.v2.create",
        resourceId: created.id,
      },
    });
    expect(audit).not.toBeNull();
    expect(audit?.summary ?? "").not.toContain("staffingSource");
  });

  it("权限：客服可 list/get，不能 create/save；PLAYER 403", async () => {
    const created = await createTemplate({
      gameId: gameAId,
      name: `权限样板-${suffix}`,
    });

    await req(csToken).get(base).expect(200);
    await req(csToken).get(`${base}/${created.id}/draft`).expect(200);
    await req(csToken)
      .post(base, { gameId: gameAId, name: `客服越权-${suffix}` })
      .expect(403);
    await req(csToken)
      .patch(`${base}/${created.id}/draft`, {
        expectedRevision: 1,
        config: MINIMAL_DRAFT,
      })
      .expect(403);
    await req(playerToken).get(base).expect(403);
  });

  it("create：未知游戏/其他租户游戏 422，同游戏重名 409", async () => {
    const unknown = await req(ownerToken)
      .post(base, {
        gameId: "00000000-0000-4000-8000-000000000000",
        name: `未知游戏-${suffix}`,
      })
      .expect(422);
    expect((unknown.body as { code: string }).code).toBe(
      "TEMPLATE_BINDING_INVALID",
    );

    await req(ownerToken)
      .post(base, { gameId: foreignGameId, name: `跨租户游戏-${suffix}` })
      .expect(422);

    const name = `重名样板-${suffix}`;
    await createTemplate({ gameId: gameAId, name });
    const dup = await req(ownerToken)
      .post(base, { gameId: gameAId, name })
      .expect(409);
    expect((dup.body as { code: string }).code).toBe("TEMPLATE_NAME_CONFLICT");
  });

  it("list：筛选、摘要字段与游标分页（相同排序值按 id 稳定）", async () => {
    const names = [`分页一-${suffix}`, `分页二-${suffix}`, `分页三-${suffix}`];
    const created: string[] = [];
    for (const name of names) {
      created.push((await createTemplate({ gameId: gameBId, name })).id);
    }
    const fixedIso = new Date(
      Math.floor(Date.now() / 1000) * 1000,
    ).toISOString();
    await client.$executeRaw`
      UPDATE game_dispatch_templates
      SET updated_at = ${fixedIso}::timestamp
      WHERE tenant_id = ${tenantId}::uuid AND game_id = ${gameBId}::uuid`;

    const first = await req(ownerToken)
      .get(`${base}?gameId=${gameBId}&limit=2`)
      .expect(200);
    const page1 = first.body as ListBody;
    expect(page1.data).toHaveLength(2);
    expect(page1.page.nextCursor).not.toBeNull();
    for (const row of page1.data) {
      expect(row.game.id).toBe(gameBId);
      expect(row).not.toHaveProperty("config");
      expect(row).not.toHaveProperty("fields");
      expect(row).not.toHaveProperty("positions");
      expect(row).not.toHaveProperty("rankRules");
      expect(row).not.toHaveProperty("copyLines");
      expect(typeof row.hasUnpublishedChanges).toBe("boolean");
    }

    const second = await req(ownerToken)
      .get(
        `${base}?gameId=${gameBId}&limit=2&cursor=${encodeURIComponent(page1.page.nextCursor as string)}`,
      )
      .expect(200);
    const page2 = second.body as ListBody;
    expect(page2.data).toHaveLength(1);
    expect(page2.page.nextCursor).toBeNull();

    const collected = [...page1.data, ...page2.data].map((row) => row.id);
    expect(new Set(collected).size).toBe(collected.length);
    expect(collected.sort()).toEqual([...created].sort());

    const byStatus = (
      await req(ownerToken).get(`${base}?status=DRAFT&limit=100`).expect(200)
    ).body as ListBody;
    expect(byStatus.data.length).toBeGreaterThanOrEqual(created.length);
    for (const row of byStatus.data) expect(row.status).toBe("DRAFT");

    const byQuery = (
      await req(ownerToken)
        .get(`${base}?q=${encodeURIComponent(names[0] as string)}`)
        .expect(200)
    ).body as ListBody;
    expect(byQuery.data).toHaveLength(1);
    expect(byQuery.data[0]?.id).toBe(created[0]);
  });

  it("list：查询数不随模板数量增长（无 N+1）", async () => {
    const { client: counting, calls } = countingPrisma(client);
    const repository = new PrismaGenericGameTemplateRepository(counting);
    const query = {
      gameId: gameBId,
      sort: "UPDATED_DESC" as const,
      limit: 100,
    };

    calls.length = 0;
    const before = await repository.list(tenantId, query);
    const beforeCalls = calls.length;
    expect(beforeCalls).toBeGreaterThan(0);

    for (const name of [`批量一-${suffix}`, `批量二-${suffix}`]) {
      await createTemplate({ gameId: gameBId, name });
    }

    calls.length = 0;
    const after = await repository.list(tenantId, query);
    expect(after.data.length).toBe(before.data.length + 2);
    expect(calls.length).toBe(beforeCalls);
  });

  it("save：revision+1、activeVersionId 不变、禁用组件保留", async () => {
    const created = await createTemplate({
      gameId: gameAId,
      name: `保存样板-${suffix}`,
    });
    const config = draftWithDisabledNote(false);
    const saved = await req(ownerToken)
      .patch(`${base}/${created.id}/draft`, { expectedRevision: 1, config })
      .expect(200);
    const result = (
      saved.body as {
        data: {
          revision: number;
          updatedBy: string;
          validationWarnings: unknown[];
        };
      }
    ).data;
    expect(result.revision).toBe(2);
    expect(result.updatedBy).toBe(ownerId);
    expect(result.validationWarnings).toEqual([]);

    const detail = (
      await req(ownerToken).get(`${base}/${created.id}/draft`).expect(200)
    ).body as { data: DraftView };
    expect(detail.data.revision).toBe(2);
    expect(detail.data.activeVersion).toBeNull();
    expect(detail.data.status).toBe("DRAFT");
    expect(detail.data.config).toMatchObject({
      schemaVersion: 2,
      staffingSource: { kind: "NUMBER_FIELD", componentKey: "player_count" },
    });
    const components = detail.data.config.components as Array<
      Record<string, unknown>
    >;
    expect(components.find((c) => c.stableKey === "notice")?.enabled).toBe(
      false,
    );

    const audit = await client.auditLog.findFirst({
      where: {
        tenantId,
        action: "game_template.v2.draft_save",
        resourceId: created.id,
      },
    });
    expect(audit).not.toBeNull();
  });

  it("save：旧 revision 返回 409 且不覆盖数据库草稿", async () => {
    const created = await createTemplate({
      gameId: gameAId,
      name: `并发样板-${suffix}`,
    });
    const config = draftWithDisabledNote(true);
    await req(ownerToken)
      .patch(`${base}/${created.id}/draft`, { expectedRevision: 1, config })
      .expect(200);

    const conflict = await req(ownerToken)
      .patch(`${base}/${created.id}/draft`, {
        expectedRevision: 1,
        config: MINIMAL_DRAFT,
      })
      .expect(409);
    const body = conflict.body as {
      code: string;
      details: {
        expectedRevision: number;
        currentRevision: number;
        currentEditor: string;
        currentUpdatedAt: string;
      };
    };
    expect(body.code).toBe("TEMPLATE_REVISION_CONFLICT");
    expect(body.details.expectedRevision).toBe(1);
    expect(body.details.currentRevision).toBe(2);
    expect(body.details.currentEditor).toBe(ownerId);
    expect(typeof body.details.currentUpdatedAt).toBe("string");

    const detail = (
      await req(ownerToken).get(`${base}/${created.id}/draft`).expect(200)
    ).body as { data: DraftView };
    expect(detail.data.revision).toBe(2);
    expect(detail.data.config).toEqual(config);
  });

  it("save：非法配置返回结构化 422 且不写入", async () => {
    const created = await createTemplate({
      gameId: gameAId,
      name: `非法配置-${suffix}`,
    });
    const invalid = {
      ...draftWithDisabledNote(true),
      staffingSource: { kind: "NUMBER_FIELD", componentKey: "ghost_field" },
    };
    const res = await req(ownerToken)
      .patch(`${base}/${created.id}/draft`, {
        expectedRevision: 1,
        config: invalid,
      })
      .expect(422);
    const body = res.body as {
      code: string;
      details: {
        issues: Array<{ code: string; path: string; message: string }>;
      };
    };
    expect(body.code).toBe("TEMPLATE_BINDING_INVALID");
    expect(Array.isArray(body.details.issues)).toBe(true);
    expect(body.details.issues.length).toBeGreaterThan(0);
    expect(body.details.issues[0]?.path).toBeTruthy();

    const detail = (
      await req(ownerToken).get(`${base}/${created.id}/draft`).expect(200)
    ).body as { data: DraftView };
    expect(detail.data.revision).toBe(1);
    expect(detail.data.config).toMatchObject({
      schemaVersion: 2,
      sections: [],
    });
  });

  it("归档模板：可读取但不能保存", async () => {
    const created = await createTemplate({
      gameId: gameAId,
      name: `归档样板-${suffix}`,
    });
    await client.gameDispatchTemplate.update({
      where: { id: created.id },
      data: { status: "ARCHIVED", archivedAt: new Date() },
    });
    await req(ownerToken).get(`${base}/${created.id}/draft`).expect(200);

    const res = await req(ownerToken)
      .patch(`${base}/${created.id}/draft`, {
        expectedRevision: 1,
        config: MINIMAL_DRAFT,
      })
      .expect(409);
    expect((res.body as { code: string }).code).toBe("TEMPLATE_ARCHIVED");
  });

  it("无 v2 草稿的模板：显式拒绝而不回退猜测", async () => {
    const legacy = await client.gameDispatchTemplate.create({
      data: {
        tenantId,
        gameId: gameAId,
        name: `旧模板-${suffix}`,
        copyLines: [],
      },
    });
    const detail = await req(ownerToken)
      .get(`${base}/${legacy.id}/draft`)
      .expect(422);
    expect((detail.body as { code: string }).code).toBe(
      "TEMPLATE_VERSION_UNAVAILABLE",
    );
    const saved = await req(ownerToken)
      .patch(`${base}/${legacy.id}/draft`, {
        expectedRevision: 1,
        config: MINIMAL_DRAFT,
      })
      .expect(422);
    expect((saved.body as { code: string }).code).toBe(
      "TEMPLATE_VERSION_UNAVAILABLE",
    );
  });

  it("API 边界：客户端 tenantId 与未知字段被拒绝", async () => {
    await req(ownerToken)
      .post(base, { gameId: gameAId, name: `越权租户-${suffix}`, tenantId })
      .expect(400);
    await req(ownerToken)
      .post(base, { gameId: gameAId, name: `多余字段-${suffix}`, revision: 1 })
      .expect(400);
  });

  it("读取：不存在的模板返回受控 404", async () => {
    const res = await req(ownerToken)
      .get(`${base}/00000000-0000-4000-8000-000000000000/draft`)
      .expect(404);
    expect((res.body as { code: string }).code).toBe("TEMPLATE_NOT_FOUND");
  });

  async function publishDraft(
    id: string,
    expectedRevision: number,
    extra: Record<string, unknown> = {},
  ): Promise<DraftView> {
    const res = await req(ownerToken)
      .post(`${base}/${id}/publish`, { expectedRevision, ...extra })
      .expect(201);
    return (res.body as { data: DraftView }).data;
  }

  async function versionRow(
    templateId: string,
    versionNo: number,
  ): Promise<{
    id: string;
    configJson: unknown;
    changeNote: string | null;
    publishedBy: string | null;
    sourceVersionId: string | null;
  }> {
    return await client.gameDispatchTemplateVersion.findFirstOrThrow({
      where: { tenantId, templateId, versionNo },
    });
  }

  async function templateRow(templateId: string) {
    return await client.gameDispatchTemplate.findUniqueOrThrow({
      where: { id: templateId },
    });
  }

  it("publish：有效草稿发布生成 version 1、PUBLISHED 与 revision+1", async () => {
    const created = await createTemplate({
      gameId: gameAId,
      name: `发布样板-${suffix}`,
    });
    await req(ownerToken)
      .patch(`${base}/${created.id}/draft`, {
        expectedRevision: 1,
        config: draftWithDisabledNote(true),
      })
      .expect(200);

    const view = await publishDraft(created.id, 2, { changeNote: "首次发布" });
    expect(view.status).toBe("PUBLISHED");
    expect(view.revision).toBe(3);
    expect(view.activeVersionNo).toBe(1);
    expect(view.activeVersion?.versionNo).toBe(1);
    expect(view.hasUnpublishedChanges).toBe(false);

    const version = await versionRow(created.id, 1);
    const config = version.configJson as Record<string, unknown>;
    expect(config.documentRendererVersion).toBe(1);
    expect(config).not.toHaveProperty("legacyCompatibility");
    expect(config.schemaVersion).toBe(2);
    expect(version.changeNote).toBe("首次发布");
    expect(version.publishedBy).toBe(ownerId);
    expect(version.sourceVersionId).toBeNull();

    const stored = await templateRow(created.id);
    expect(stored.activeVersionId).toBe(version.id);
    expect(stored.status).toBe("PUBLISHED");

    const audit = await client.auditLog.findFirst({
      where: {
        tenantId,
        action: "game_template.v2.publish",
        resourceId: created.id,
      },
    });
    expect(audit).not.toBeNull();
    expect(audit?.summary ?? "").toContain("v1");
    expect(audit?.summary ?? "").not.toContain("staffingSource");
  });

  it("publish：发布后保存草稿不动旧 version，再次 publish 生成 version 2 且旧版本字节不变", async () => {
    const created = await createTemplate({
      gameId: gameAId,
      name: `二次发布-${suffix}`,
    });
    await req(ownerToken)
      .patch(`${base}/${created.id}/draft`, {
        expectedRevision: 1,
        config: draftWithDisabledNote(true),
      })
      .expect(200);
    await publishDraft(created.id, 2);

    const firstVersion = await versionRow(created.id, 1);
    const activeBefore = (await templateRow(created.id)).activeVersionId;
    expect(activeBefore).toBe(firstVersion.id);

    await req(ownerToken)
      .patch(`${base}/${created.id}/draft`, {
        expectedRevision: 3,
        config: draftWithDisabledNote(false),
      })
      .expect(200);
    const afterSave = await templateRow(created.id);
    expect(afterSave.activeVersionId).toBe(activeBefore);
    expect(afterSave.status).toBe("PUBLISHED");
    expect(JSON.stringify((await versionRow(created.id, 1)).configJson)).toBe(
      JSON.stringify(firstVersion.configJson),
    );

    const unpublished = (
      await req(ownerToken)
        .get(`${base}?status=UNPUBLISHED_CHANGES&limit=100`)
        .expect(200)
    ).body as ListBody;
    expect(unpublished.data.map((row) => row.id)).toContain(created.id);

    const second = await publishDraft(created.id, 4);
    expect(second.activeVersionNo).toBe(2);
    expect(second.revision).toBe(5);
    expect(second.hasUnpublishedChanges).toBe(false);
    expect(JSON.stringify((await versionRow(created.id, 1)).configJson)).toBe(
      JSON.stringify(firstVersion.configJson),
    );

    const versions = await client.gameDispatchTemplateVersion.findMany({
      where: { tenantId, templateId: created.id },
      orderBy: { versionNo: "asc" },
    });
    expect(versions.map((row) => row.versionNo)).toEqual([1, 2]);
  });

  it("publish：非法绑定/选项金额/未处理 legacy 规则分别返回精确 422 且不产生 version 或审计", async () => {
    const cases = [
      {
        name: `非法绑定-${suffix}`,
        expected: "TEMPLATE_BINDING_INVALID",
        config: {
          ...draftWithDisabledNote(true),
          staffingSource: { kind: "NUMBER_FIELD", componentKey: "ghost" },
        },
      },
      {
        name: `非法金额-${suffix}`,
        expected: "TEMPLATE_PRICE_RULE_INVALID",
        config: {
          schemaVersion: 2,
          sections: [
            {
              stableKey: "base",
              label: "基础信息",
              enabled: true,
              sortOrder: 0,
              layout: { columns: 2 },
            },
          ],
          components: [
            {
              kind: "FIELD",
              stableKey: "mode",
              sectionKey: "base",
              label: "模式",
              enabled: true,
              sortOrder: 0,
              layout: { colSpan: 1, rowBreakBefore: false },
              fieldType: "SINGLE_SELECT",
              semanticRole: "MODE",
              required: true,
              options: [{ value: "ranked", label: "排位", priceDeltaFen: 100 }],
            },
          ],
          staffingSource: { kind: "FIXED", count: 1 },
        },
      },
    ] as const;

    for (const testCase of cases) {
      const created = await createTemplate({
        gameId: gameAId,
        name: testCase.name,
      });
      // 直接写库模拟历史遗留草稿：发布阶段仍必须拒绝，不能信任库内旧值。
      await client.gameDispatchTemplate.update({
        where: { id: created.id },
        data: {
          draftConfigJson: testCase.config as never,
          draftSchemaVersion: 2,
        },
      });

      const res = await req(ownerToken)
        .post(`${base}/${created.id}/publish`, { expectedRevision: 1 })
        .expect(422);
      expect((res.body as { code: string }).code).toBe(testCase.expected);

      const stored = await templateRow(created.id);
      expect(stored.revision).toBe(1);
      expect(stored.activeVersionId).toBeNull();
      expect(
        await client.gameDispatchTemplateVersion.count({
          where: { tenantId, templateId: created.id },
        }),
      ).toBe(0);
      expect(
        await client.auditLog.count({
          where: {
            tenantId,
            action: "game_template.v2.publish",
            resourceId: created.id,
          },
        }),
      ).toBe(0);
    }

    const legacy = await createTemplate({
      gameId: gameAId,
      name: `未处理旧规则-${suffix}`,
    });
    await req(ownerToken)
      .patch(`${base}/${legacy.id}/draft`, {
        expectedRevision: 1,
        config: {
          ...draftWithDisabledNote(true),
          legacyCompatibility: {
            unboundPriceRules: [
              { label: "铂金", priceDeltaFen: "3000", sortOrder: 0 },
            ],
          },
        },
      })
      .expect(200);
    const legacyRes = await req(ownerToken)
      .post(`${base}/${legacy.id}/publish`, { expectedRevision: 2 })
      .expect(422);
    expect((legacyRes.body as { code: string }).code).toBe(
      "TEMPLATE_LEGACY_REVIEW_REQUIRED",
    );
    const legacyStored = await templateRow(legacy.id);
    expect(legacyStored.revision).toBe(2);
    expect(legacyStored.activeVersionId).toBeNull();
    expect(
      await client.gameDispatchTemplateVersion.count({
        where: { tenantId, templateId: legacy.id },
      }),
    ).toBe(0);
  });

  it("publish：客户端 rendererVersion/config 被 API 边界拒绝，发布只读服务器草稿", async () => {
    const created = await createTemplate({
      gameId: gameAId,
      name: `边界发布-${suffix}`,
    });
    await req(ownerToken)
      .post(`${base}/${created.id}/publish`, {
        expectedRevision: 1,
        rendererVersion: 1,
      })
      .expect(400);
    await req(ownerToken)
      .post(`${base}/${created.id}/publish`, {
        expectedRevision: 1,
        config: MINIMAL_DRAFT,
      })
      .expect(400);

    const draft = draftWithDisabledNote(true);
    await req(ownerToken)
      .patch(`${base}/${created.id}/draft`, {
        expectedRevision: 1,
        config: draft,
      })
      .expect(200);
    await publishDraft(created.id, 2);

    const version = await versionRow(created.id, 1);
    const published = version.configJson as Record<string, unknown>;
    expect(published.components).toEqual(draft.components);
    expect(published.staffingSource).toEqual(draft.staffingSource);
  });

  it("端口可见性：空标记与未知端口在 API 边界 400，合法标记保存并发布原样落地", async () => {
    const created = await createTemplate({
      gameId: gameAId,
      name: `端口可见性-${suffix}`,
    });

    // V-2：至少一个端口。空数组由边界拒绝，并指明出错字段，不写库。
    const empty = await req(ownerToken)
      .patch(`${base}/${created.id}/draft`, {
        expectedRevision: 1,
        config: audienceDraft([]),
      })
      .expect(400);
    // 报错必须来自"至少一个端口"这条规则本身，而不是"未知字段被拒"。
    const emptyErrors = (
      empty.body as { fieldErrors?: Record<string, string[]> }
    ).fieldErrors;
    expect(emptyErrors?.config?.join(" ")).toContain("端口");
    expect((await templateRow(created.id)).revision).toBe(1);

    // 枚举之外的端口同样被边界拒绝。
    await req(ownerToken)
      .patch(`${base}/${created.id}/draft`, {
        expectedRevision: 1,
        config: audienceDraft(["BOSS"]),
      })
      .expect(400);
    expect((await templateRow(created.id)).revision).toBe(1);

    // 合法标记：组件覆盖分组（CS），说明组件继承分组（CUSTOMER）。
    const draft = audienceDraft(["CS"]);
    await req(ownerToken)
      .patch(`${base}/${created.id}/draft`, {
        expectedRevision: 1,
        config: draft,
      })
      .expect(200);

    const view = await req(ownerToken)
      .get(`${base}/${created.id}/draft`)
      .expect(200);
    const saved = (view.body as { data: DraftView }).data;
    expect(audiencesAt(saved.config, "sections", 0)).toEqual(["CUSTOMER"]);
    expect(audiencesAt(saved.config, "components", 0)).toEqual(["CS"]);
    expect(audiencesAt(saved.config, "components", 1)).toBeUndefined();

    // 发布：版本快照与草稿逐字节一致，不凭空补未声明的键，因此发布后没有未发布改动。
    const published = await publishDraft(created.id, 2);
    expect(published.hasUnpublishedChanges).toBe(false);

    const version = await versionRow(created.id, 1);
    const config = version.configJson as Record<string, unknown>;
    expect(audiencesAt(config, "sections", 0)).toEqual(["CUSTOMER"]);
    expect(audiencesAt(config, "components", 0)).toEqual(["CS"]);
    expect(audiencesAt(config, "components", 1)).toBeUndefined();
    expect(config.components).toEqual(draft.components);
    expect(config.sections).toEqual(draft.sections);
  });

  it("端口可见性：历史模板没有标记照常发布（V-8 回落两个端口全选）", async () => {
    const created = await createTemplate({
      gameId: gameAId,
      name: `历史无标记-${suffix}`,
    });
    const draft = draftWithDisabledNote(true);
    await req(ownerToken)
      .patch(`${base}/${created.id}/draft`, {
        expectedRevision: 1,
        config: draft,
      })
      .expect(200);

    const published = await publishDraft(created.id, 2);
    expect(published.hasUnpublishedChanges).toBe(false);

    const version = await versionRow(created.id, 1);
    const config = version.configJson as Record<string, unknown>;
    expect(audiencesAt(config, "sections", 0)).toBeUndefined();
    expect(audiencesAt(config, "components", 0)).toBeUndefined();
    expect(config.components).toEqual(draft.components);
  });

  it("值类内容只给客户时：草稿可存，发布被拒（客服是唯一能填写下单的端口）", async () => {
    const created = await createTemplate({
      gameId: gameAId,
      name: `端口阻断-${suffix}`,
    });
    const draft = draftWithDisabledNote(true);
    const components = draft.components as Array<Record<string, unknown>>;
    if (components[0]) components[0].audiences = ["CUSTOMER"];

    // 草稿保存不设这条规则（只有发布才阻断），否则店主没法在半成品上继续改
    await req(ownerToken)
      .patch(`${base}/${created.id}/draft`, {
        expectedRevision: 1,
        config: draft,
      })
      .expect(200);

    const rejected = await req(ownerToken)
      .post(`${base}/${created.id}/publish`, { expectedRevision: 2 })
      .expect(422);
    const issues = (
      rejected.body as {
        details: { issues: Array<{ code: string; componentKey?: string }> };
      }
    ).details.issues;
    expect(issues).toContainEqual(
      expect.objectContaining({
        code: "TEMPLATE_COMPONENT_INVALID",
        componentKey: "player_count",
      }),
    );
    // 没有产生版本，也没有推进 revision
    expect(
      await client.gameDispatchTemplateVersion.count({
        where: { tenantId, templateId: created.id },
      }),
    ).toBe(0);
    expect((await templateRow(created.id)).revision).toBe(2);
  });

  it("versions：游标分页只返回摘要，schemaVersion 1 版本可列出", async () => {
    const created = await createTemplate({
      gameId: gameAId,
      name: `版本历史-${suffix}`,
    });
    await client.gameDispatchTemplateVersion.create({
      data: {
        tenantId,
        templateId: created.id,
        versionNo: 1,
        configJson: { schemaVersion: 1, sentinel: "v1" },
        changeNote: "旧模板迁移生成",
        publishedAt: new Date(Date.now() - 60_000),
      },
    });
    await req(ownerToken)
      .patch(`${base}/${created.id}/draft`, {
        expectedRevision: 1,
        config: draftWithDisabledNote(true),
      })
      .expect(200);
    await publishDraft(created.id, 2, { changeNote: "v2 发布" });

    const firstPage = (
      await req(ownerToken)
        .get(`${base}/${created.id}/versions?limit=1`)
        .expect(200)
    ).body as {
      data: Array<Record<string, unknown>>;
      page: { nextCursor: string | null };
    };
    expect(firstPage.data).toHaveLength(1);
    expect(firstPage.data[0]?.versionNo).toBe(2);
    expect(firstPage.data[0]?.schemaVersion).toBe(2);
    expect(firstPage.data[0]).not.toHaveProperty("config");
    expect(firstPage.data[0]).not.toHaveProperty("configJson");
    expect(firstPage.page.nextCursor).not.toBeNull();

    const secondPage = (
      await req(ownerToken)
        .get(
          `${base}/${created.id}/versions?limit=1&cursor=${encodeURIComponent(
            firstPage.page.nextCursor as string,
          )}`,
        )
        .expect(200)
    ).body as {
      data: Array<Record<string, unknown>>;
      page: { nextCursor: string | null };
    };
    expect(secondPage.data).toHaveLength(1);
    expect(secondPage.data[0]?.versionNo).toBe(1);
    expect(secondPage.data[0]?.schemaVersion).toBe(1);
    expect(secondPage.page.nextCursor).toBeNull();

    const tampered = await req(ownerToken)
      .get(`${base}/${created.id}/versions?cursor=not-a-cursor`)
      .expect(400);
    expect((tampered.body as { code: string }).code).toBe(
      "TEMPLATE_CURSOR_INVALID",
    );

    await req(ownerToken)
      .get(`${base}/00000000-0000-4000-8000-000000000000/versions`)
      .expect(404);
  });

  it("restore：v2 版本还原为草稿，activeVersion/status 不变并返回 sourceVersionId", async () => {
    const created = await createTemplate({
      gameId: gameAId,
      name: `还原样板-${suffix}`,
    });
    await req(ownerToken)
      .patch(`${base}/${created.id}/draft`, {
        expectedRevision: 1,
        config: draftWithDisabledNote(true),
      })
      .expect(200);
    await publishDraft(created.id, 2);
    const version1 = await versionRow(created.id, 1);
    await req(ownerToken)
      .patch(`${base}/${created.id}/draft`, {
        expectedRevision: 3,
        config: draftWithDisabledNote(false),
      })
      .expect(200);

    const res = await req(ownerToken)
      .post(`${base}/${created.id}/restore`, {
        versionId: version1.id,
        expectedRevision: 4,
      })
      .expect(201);
    const view = (res.body as { data: DraftView & { sourceVersionId: string } })
      .data;
    expect(view.sourceVersionId).toBe(version1.id);
    expect(view.revision).toBe(5);
    expect(view.status).toBe("PUBLISHED");
    expect(view.activeVersion?.id).toBe(version1.id);
    expect(view.hasUnpublishedChanges).toBe(false);
    expect(view.config).not.toHaveProperty("documentRendererVersion");
    expect(view.config.components).toEqual(
      draftWithDisabledNote(true).components,
    );

    const stored = await templateRow(created.id);
    expect(stored.activeVersionId).toBe(version1.id);
    expect(stored.status).toBe("PUBLISHED");
    expect(stored.draftSchemaVersion).toBe(2);
    expect(stored.draftConfigJson).not.toHaveProperty(
      "documentRendererVersion",
    );
    expect(JSON.stringify((await versionRow(created.id, 1)).configJson)).toBe(
      JSON.stringify(version1.configJson),
    );
    expect(
      await client.auditLog.count({
        where: {
          tenantId,
          action: "game_template.v2.restore",
          resourceId: created.id,
        },
      }),
    ).toBe(1);

    const other = await createTemplate({
      gameId: gameAId,
      name: `还原他模板-${suffix}`,
    });
    const crossTemplate = await req(ownerToken)
      .post(`${base}/${other.id}/restore`, {
        versionId: version1.id,
        expectedRevision: 1,
      })
      .expect(422);
    expect((crossTemplate.body as { code: string }).code).toBe(
      "TEMPLATE_VERSION_UNAVAILABLE",
    );

    const legacy = await createTemplate({
      gameId: gameAId,
      name: `v1还原-${suffix}`,
    });
    const legacyVersion = await client.gameDispatchTemplateVersion.create({
      data: {
        tenantId,
        templateId: legacy.id,
        versionNo: 1,
        configJson: { schemaVersion: 1, sentinel: "v1" },
      },
    });
    const legacyRes = await req(ownerToken)
      .post(`${base}/${legacy.id}/restore`, {
        versionId: legacyVersion.id,
        expectedRevision: 1,
      })
      .expect(422);
    expect((legacyRes.body as { code: string }).code).toBe(
      "TEMPLATE_VERSION_UNAVAILABLE",
    );
    expect((await templateRow(legacy.id)).revision).toBe(1);
  });

  it("copy：复制当前 v2 草稿到目标游戏生成独立 DRAFT，不复制版本/默认/归档状态", async () => {
    const source = await createTemplate({
      gameId: gameAId,
      name: `复制源-${suffix}`,
    });
    await req(ownerToken)
      .patch(`${base}/${source.id}/draft`, {
        expectedRevision: 1,
        config: draftWithDisabledNote(true),
      })
      .expect(200);
    await publishDraft(source.id, 2);
    await req(ownerToken)
      .post(`${base}/${source.id}/default`, { expectedRevision: 3 })
      .expect(201);
    const sourceRow = await templateRow(source.id);
    expect(sourceRow.isDefault).toBe(true);

    const copied = (
      await req(ownerToken)
        .post(`${base}/${source.id}/copy`, {
          targetGameId: gameBId,
          newName: `复制品-${suffix}`,
        })
        .expect(201)
    ).body as { data: DraftView };
    expect(copied.data.game.id).toBe(gameBId);
    expect(copied.data.status).toBe("DRAFT");
    expect(copied.data.revision).toBe(1);
    expect(copied.data.isDefault).toBe(false);
    expect(copied.data.activeVersion).toBeNull();
    expect(copied.data.game.id).not.toBe(sourceRow.gameId);

    const copyRow = await templateRow(copied.data.id);
    expect(copyRow.activeVersionId).toBeNull();
    expect(copyRow.archivedAt).toBeNull();
    expect(copyRow.lastUsedAt).toBeNull();
    expect(copyRow.isDefault).toBe(false);
    expect(copyRow.copyLines).toEqual([]);
    expect(JSON.stringify(copyRow.draftConfigJson)).toBe(
      JSON.stringify(sourceRow.draftConfigJson),
    );
    expect(
      await client.gameDispatchTemplateVersion.count({
        where: { tenantId, templateId: copied.data.id },
      }),
    ).toBe(0);
    expect(
      await client.auditLog.count({
        where: {
          tenantId,
          action: "game_template.v2.copy",
          resourceId: copied.data.id,
        },
      }),
    ).toBe(1);

    // 源模板归档后仍可复制。
    await req(ownerToken)
      .post(`${base}/${source.id}/archive`, { expectedRevision: 4 })
      .expect(201);
    await req(ownerToken)
      .post(`${base}/${source.id}/copy`, {
        targetGameId: gameBId,
        newName: `归档复制-${suffix}`,
      })
      .expect(201);

    await req(ownerToken)
      .post(`${base}/${source.id}/copy`, {
        targetGameId: foreignGameId,
        newName: `越权复制-${suffix}`,
      })
      .expect(422);
    const duplicate = await req(ownerToken)
      .post(`${base}/${source.id}/copy`, {
        targetGameId: gameBId,
        newName: `复制品-${suffix}`,
      })
      .expect(409);
    expect((duplicate.body as { code: string }).code).toBe(
      "TEMPLATE_NAME_CONFLICT",
    );
  });

  it("default：只有已发布未归档模板可设默认，切换后同游戏仅一个默认", async () => {
    const first = await createTemplate({
      gameId: gameBId,
      name: `默认一-${suffix}`,
    });
    const second = await createTemplate({
      gameId: gameBId,
      name: `默认二-${suffix}`,
    });

    const notPublished = await req(ownerToken)
      .post(`${base}/${first.id}/default`, { expectedRevision: 1 })
      .expect(422);
    expect((notPublished.body as { code: string }).code).toBe(
      "TEMPLATE_VERSION_UNAVAILABLE",
    );

    for (const template of [first, second]) {
      await req(ownerToken)
        .patch(`${base}/${template.id}/draft`, {
          expectedRevision: 1,
          config: draftWithDisabledNote(true),
        })
        .expect(200);
      await publishDraft(template.id, 2);
    }

    await req(ownerToken)
      .post(`${base}/${first.id}/default`, { expectedRevision: 3 })
      .expect(201);
    const switched = (
      await req(ownerToken)
        .post(`${base}/${second.id}/default`, { expectedRevision: 3 })
        .expect(201)
    ).body as { data: DraftView };
    expect(switched.data.isDefault).toBe(true);

    const defaults = await client.gameDispatchTemplate.findMany({
      where: { tenantId, gameId: gameBId, isDefault: true, archivedAt: null },
      select: { id: true },
    });
    expect(defaults).toHaveLength(1);
    expect(defaults[0]?.id).toBe(second.id);
    expect((await templateRow(first.id)).isDefault).toBe(false);
    expect((await templateRow(first.id)).revision).toBe(4);

    await req(ownerToken)
      .post(`${base}/${second.id}/archive`, { expectedRevision: 4 })
      .expect(201);
    const archivedDefault = await req(ownerToken)
      .post(`${base}/${second.id}/default`, { expectedRevision: 5 })
      .expect(409);
    expect((archivedDefault.body as { code: string }).code).toBe(
      "TEMPLATE_ARCHIVED",
    );
  });

  it("archive：清除默认并保留版本与草稿，归档后只读", async () => {
    const created = await createTemplate({
      gameId: gameBId,
      name: `归档生命周期-${suffix}`,
    });
    await req(ownerToken)
      .patch(`${base}/${created.id}/draft`, {
        expectedRevision: 1,
        config: draftWithDisabledNote(true),
      })
      .expect(200);
    await publishDraft(created.id, 2);
    await req(ownerToken)
      .post(`${base}/${created.id}/default`, { expectedRevision: 3 })
      .expect(201);
    const versionsBefore = await client.gameDispatchTemplateVersion.count({
      where: { tenantId, templateId: created.id },
    });

    const archived = await req(ownerToken)
      .post(`${base}/${created.id}/archive`, { expectedRevision: 4 })
      .expect(201);
    const view = (archived.body as { data: DraftView }).data;
    expect(view.status).toBe("ARCHIVED");
    expect(view.isDefault).toBe(false);
    expect(view.activeVersionNo).toBe(1);

    const row = await templateRow(created.id);
    expect(row.archivedAt).not.toBeNull();
    expect(row.activeVersionId).not.toBeNull();
    expect(row.isDefault).toBe(false);
    expect(
      await client.gameDispatchTemplateVersion.count({
        where: { tenantId, templateId: created.id },
      }),
    ).toBe(versionsBefore);

    await req(ownerToken).get(`${base}/${created.id}/draft`).expect(200);
    await req(ownerToken).get(`${base}/${created.id}/versions`).expect(200);

    await req(ownerToken)
      .patch(`${base}/${created.id}/draft`, {
        expectedRevision: 5,
        config: MINIMAL_DRAFT,
      })
      .expect(409);
    await req(ownerToken)
      .post(`${base}/${created.id}/publish`, { expectedRevision: 5 })
      .expect(409);
    await req(ownerToken)
      .post(`${base}/${created.id}/default`, { expectedRevision: 5 })
      .expect(409);
    await req(ownerToken)
      .post(`${base}/${created.id}/restore`, {
        versionId: row.activeVersionId as string,
        expectedRevision: 5,
      })
      .expect(409);
    await req(ownerToken)
      .post(`${base}/${created.id}/archive`, { expectedRevision: 5 })
      .expect(409);
  });

  it("unarchive：有生效版本回到 PUBLISHED，无版本回到 DRAFT", async () => {
    const published = await createTemplate({
      gameId: gameBId,
      name: `取消归档已发布-${suffix}`,
    });
    await req(ownerToken)
      .patch(`${base}/${published.id}/draft`, {
        expectedRevision: 1,
        config: draftWithDisabledNote(true),
      })
      .expect(200);
    await publishDraft(published.id, 2);
    await req(ownerToken)
      .post(`${base}/${published.id}/archive`, { expectedRevision: 3 })
      .expect(201);

    const restored = (
      await req(ownerToken)
        .post(`${base}/${published.id}/unarchive`, { expectedRevision: 4 })
        .expect(201)
    ).body as { data: DraftView };
    expect(restored.data.status).toBe("PUBLISHED");
    expect(restored.data.revision).toBe(5);
    const row = await templateRow(published.id);
    expect(row.archivedAt).toBeNull();
    expect(row.activeVersionId).not.toBeNull();

    const neverPublished = await createTemplate({
      gameId: gameBId,
      name: `取消归档未发布-${suffix}`,
    });
    await req(ownerToken)
      .post(`${base}/${neverPublished.id}/archive`, { expectedRevision: 1 })
      .expect(201);
    const backToDraft = (
      await req(ownerToken)
        .post(`${base}/${neverPublished.id}/unarchive`, { expectedRevision: 2 })
        .expect(201)
    ).body as { data: DraftView };
    expect(backToDraft.data.status).toBe("DRAFT");
  });

  it("delete：仅未发布且无引用可删除，其他返回 TEMPLATE_DELETE_RESTRICTED", async () => {
    const disposable = await createTemplate({
      gameId: gameAId,
      name: `可删-${suffix}`,
    });
    await req(ownerToken)
      .delete(`${base}/${disposable.id}?expectedRevision=1`)
      .expect(200);
    await req(ownerToken).get(`${base}/${disposable.id}/draft`).expect(404);
    // audit_logs 无模板级外键：删除后审计仍在。
    expect(
      await client.auditLog.count({
        where: {
          tenantId,
          action: "game_template.v2.delete",
          resourceId: disposable.id,
        },
      }),
    ).toBe(1);

    const published = await createTemplate({
      gameId: gameAId,
      name: `已发布不可删-${suffix}`,
    });
    await req(ownerToken)
      .patch(`${base}/${published.id}/draft`, {
        expectedRevision: 1,
        config: draftWithDisabledNote(true),
      })
      .expect(200);
    await publishDraft(published.id, 2);
    const restricted = await req(ownerToken)
      .delete(`${base}/${published.id}?expectedRevision=3`)
      .expect(409);
    const restrictedBody = restricted.body as {
      code: string;
      details: { versionCount: number };
    };
    expect(restrictedBody.code).toBe("TEMPLATE_DELETE_RESTRICTED");
    expect(restrictedBody.details.versionCount).toBeGreaterThan(0);
    expect((await templateRow(published.id)).activeVersionId).not.toBeNull();

    await req(ownerToken)
      .post(`${base}/${published.id}/archive`, { expectedRevision: 3 })
      .expect(201);
    await req(ownerToken)
      .delete(`${base}/${published.id}?expectedRevision=4`)
      .expect(409);

    const staleTarget = await createTemplate({
      gameId: gameAId,
      name: `旧修订删除-${suffix}`,
    });
    const stale = await req(ownerToken)
      .delete(`${base}/${staleTarget.id}?expectedRevision=9`)
      .expect(409);
    expect((stale.body as { code: string }).code).toBe(
      "TEMPLATE_REVISION_CONFLICT",
    );
    expect(await templateRow(staleTarget.id)).toBeTruthy();
  });

  it("restore/copy/default/archive/unarchive/delete：客服与 PLAYER 全部 403", async () => {
    const created = await createTemplate({
      gameId: gameAId,
      name: `权限生命周期-${suffix}`,
    });
    await req(ownerToken)
      .patch(`${base}/${created.id}/draft`, {
        expectedRevision: 1,
        config: draftWithDisabledNote(true),
      })
      .expect(200);
    await publishDraft(created.id, 2);
    const versionId = (await templateRow(created.id)).activeVersionId as string;

    for (const token of [csToken, playerToken]) {
      await req(token)
        .post(`${base}/${created.id}/restore`, {
          versionId,
          expectedRevision: 3,
        })
        .expect(403);
      await req(token)
        .post(`${base}/${created.id}/copy`, {
          targetGameId: gameBId,
          newName: `越权复制-${suffix}`,
        })
        .expect(403);
      await req(token)
        .post(`${base}/${created.id}/default`, { expectedRevision: 3 })
        .expect(403);
      await req(token)
        .post(`${base}/${created.id}/archive`, { expectedRevision: 3 })
        .expect(403);
      await req(token)
        .post(`${base}/${created.id}/unarchive`, { expectedRevision: 3 })
        .expect(403);
      await req(token)
        .delete(`${base}/${created.id}?expectedRevision=3`)
        .expect(403);
    }

    await req(csToken).get(`${base}/${created.id}/draft`).expect(200);
    await req(csToken).get(`${base}/${created.id}/versions`).expect(200);
  });

  it("列表：gameScope=UNCLASSIFIED 只返回未归类模板，且与 gameId 互斥", async () => {
    const bound = await createTemplate({
      gameId: gameAId,
      name: `已归类-${suffix}`,
    });
    // 未归类旧模板没有 gameId：这里直接落库模拟历史数据（API 不接受空 gameId）。
    const legacy = await client.gameDispatchTemplate.create({
      data: { tenantId, name: `未归类-${suffix}`, copyLines: [] },
    });

    const unclassified = await req(ownerToken)
      .get(`${base}?gameScope=UNCLASSIFIED`)
      .expect(200);
    const unclassifiedIds = (unclassified.body as ListBody).data.map(
      (row) => row.id,
    );
    expect(unclassifiedIds).toContain(legacy.id);
    expect(unclassifiedIds).not.toContain(bound.id);

    const scoped = await req(ownerToken)
      .get(`${base}?gameId=${gameAId}`)
      .expect(200);
    const scopedIds = (scoped.body as ListBody).data.map((row) => row.id);
    expect(scopedIds).toContain(bound.id);
    expect(scopedIds).not.toContain(legacy.id);

    // 互斥：同时给出即 400，避免"未归类 + 具体游戏"的模糊语义
    await req(ownerToken)
      .get(`${base}?gameId=${gameAId}&gameScope=UNCLASSIFIED`)
      .expect(400);
  });
});
