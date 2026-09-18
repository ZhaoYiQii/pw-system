import "reflect-metadata";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Test } from "@nestjs/testing";
import request from "supertest";
import type { INestApplication } from "@nestjs/common";
import { AppModule } from "../../apps/api/src/app.module.js";
import { hashPassword } from "../../apps/api/src/modules/identity-access/infrastructure/password.js";
import { createDatabaseClient } from "@pw/database";
import type { PrismaClient } from "@pw/database";

const PW = "Template-V2-Concurrency-1";
const suffix = Date.now().toString(36);
const tenantCode = `gdv2c_${suffix}`;
const base = "/api/v1/tenant/game-dispatch-templates";

function envOrThrow(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`missing env ${name}`);
  return v;
}

/** 含启用数字字段（人数来源）与说明组件的合法 v2 草稿。 */
function draftConfig(label: string): Record<string, unknown> {
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
        enabled: true,
        sortOrder: 1,
        layout: { colSpan: 2, rowBreakBefore: true },
        text: label,
      },
    ],
    staffingSource: { kind: "NUMBER_FIELD", componentKey: "player_count" },
  };
}

describe("Game Dispatch generic templates v2 并发发布与版本不可变", () => {
  let app: INestApplication;
  let client: PrismaClient;
  let tenantId: string;
  let gameId: string;
  let ownerToken: string;

  beforeAll(async () => {
    client = createDatabaseClient(envOrThrow("PW_TEST_MIGRATION_URL"));
    const hash = await hashPassword(PW);
    const tenant = await client.tenant.create({
      data: { code: tenantCode, name: "并发模板店" },
    });
    tenantId = tenant.id;
    // S5 门禁是 opt-in：夹具必须显式开通 v2 addon。
    await client.tenantEntitlement.create({
      data: {
        tenantId: tenantId,
        featureKey: "addon.game_dispatch_template_v2",
        enabled: true,
      },
    });
    const owner = await client.tenantAccount.create({
      data: { tenantId, username: "boss", passwordHash: hash },
    });
    await client.tenantAccountRole.create({
      data: { tenantId, tenantAccountId: owner.id, role: "TENANT_OWNER" },
    });
    const game = await client.game.create({
      data: { tenantId, name: `并发游戏-${suffix}` },
    });
    gameId = game.id;

    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();

    const res = await request(app.getHttpServer())
      .post("/api/v1/auth/login")
      .send({ kind: "tenant", tenantCode, username: "boss", password: PW })
      .expect(201);
    ownerToken = (res.body as { data: { accessToken: string } }).data
      .accessToken;
  });

  afterAll(async () => {
    if (client) {
      // active_version_id 是 templates → versions 的外键，必须先解引用再删版本。
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
      // S5 门禁是 opt-in：夹具写入了 entitlement，收尾必须先删（外键 Restrict）。
      await client.tenantEntitlement.deleteMany({ where: { tenantId } });
      await client.tenant.deleteMany({ where: { id: tenantId } });
      await client.$disconnect();
    }
    if (app) await app.close();
  });

  function req(token: string) {
    const header = { authorization: `Bearer ${token}` };
    return {
      get: (url: string) => request(app.getHttpServer()).get(url).set(header),
      post: (url: string, body?: unknown) =>
        request(app.getHttpServer())
          .post(url)
          .set(header)
          .send(body ?? {}),
      patch: (url: string, body: unknown) =>
        request(app.getHttpServer()).patch(url).set(header).send(body),
    };
  }

  async function createTemplate(name: string): Promise<{ id: string }> {
    const res = await req(ownerToken).post(base, { gameId, name }).expect(201);
    return (res.body as { data: { id: string } }).data;
  }

  function publish(id: string, expectedRevision: number, extra = {}) {
    return req(ownerToken).post(`${base}/${id}/publish`, {
      expectedRevision,
      ...extra,
    });
  }

  function save(id: string, expectedRevision: number, label: string) {
    return req(ownerToken).patch(`${base}/${id}/draft`, {
      expectedRevision,
      config: draftConfig(label),
    });
  }

  async function templateRow(id: string) {
    return await client.gameDispatchTemplate.findUniqueOrThrow({
      where: { id },
    });
  }

  async function versionRows(templateId: string) {
    return await client.gameDispatchTemplateVersion.findMany({
      where: { tenantId, templateId },
      orderBy: { versionNo: "asc" },
    });
  }

  it("两个连接以同一 expectedRevision 并发 publish：三轮均恰一个成功，versionNo 唯一、无悬空 activeVersionId", async () => {
    const template = await createTemplate(`并发发布-${suffix}`);
    const snapshots = new Map<number, string>();

    for (let round = 1; round <= 3; round += 1) {
      const before = await templateRow(template.id);
      const [first, second] = await Promise.all([
        publish(template.id, before.revision),
        publish(template.id, before.revision),
      ]);

      const statuses = [first.status, second.status].sort((a, b) => a - b);
      expect(statuses).toEqual([201, 409]);

      const conflict = first.status === 409 ? first : second;
      const conflictBody = conflict.body as {
        code: string;
        details: { currentRevision: number };
      };
      expect(conflictBody.code).toBe("TEMPLATE_REVISION_CONFLICT");
      expect(conflictBody.details.currentRevision).toBe(before.revision + 1);

      const after = await templateRow(template.id);
      expect(after.revision).toBe(before.revision + 1);
      expect(after.status).toBe("PUBLISHED");
      expect(after.activeVersionId).not.toBeNull();

      const rows = await versionRows(template.id);
      expect(rows.map((row) => row.versionNo)).toEqual(
        Array.from({ length: round }, (_unused, index) => index + 1),
      );
      expect(rows.some((row) => row.id === after.activeVersionId)).toBe(true);

      // 旧版本字节不变：已捕获的快照必须与当前一致。
      for (const row of rows) {
        const current = JSON.stringify(row.configJson);
        const snapshot = snapshots.get(row.versionNo);
        if (snapshot === undefined) snapshots.set(row.versionNo, current);
        else expect(current).toBe(snapshot);
      }

      expect(
        await client.auditLog.count({
          where: {
            tenantId,
            action: "game_template.v2.publish",
            resourceId: template.id,
          },
        }),
      ).toBe(round);

      if (round < 3) {
        const saved = await save(
          template.id,
          after.revision,
          `第 ${round} 轮草稿`,
        );
        expect(saved.status).toBe(200);
      }
    }

    const rows = await versionRows(template.id);
    expect(rows).toHaveLength(3);
    for (const row of rows) {
      const config = row.configJson as Record<string, unknown>;
      expect(config.documentRendererVersion).toBe(1);
      expect(config).not.toHaveProperty("legacyCompatibility");
    }
  });

  it("并发 save 与 publish：恰一个生效，revision 只前进一次且审计与结果一致", async () => {
    const template = await createTemplate(`并发保存发布-${suffix}`);
    const before = await templateRow(template.id);

    const [saveRes, publishRes] = await Promise.all([
      save(template.id, before.revision, "并发草稿"),
      publish(template.id, before.revision),
    ]);

    const statuses = [saveRes.status, publishRes.status];
    expect(statuses.filter((status) => status < 300)).toHaveLength(1);
    expect(statuses).toContain(409);

    const after = await templateRow(template.id);
    expect(after.revision).toBe(before.revision + 1);

    const rows = await versionRows(template.id);
    if (publishRes.status === 201) {
      expect(rows).toHaveLength(1);
      expect(after.activeVersionId).toBe(rows[0]?.id ?? null);
      expect(after.status).toBe("PUBLISHED");
    } else {
      expect(rows).toHaveLength(0);
      expect(after.activeVersionId).toBeNull();
    }
    expect(
      await client.auditLog.count({
        where: {
          tenantId,
          action: "game_template.v2.publish",
          resourceId: template.id,
        },
      }),
    ).toBe(publishRes.status === 201 ? 1 : 0);
    expect(
      await client.auditLog.count({
        where: {
          tenantId,
          action: "game_template.v2.draft_save",
          resourceId: template.id,
        },
      }),
    ).toBe(saveRes.status === 200 ? 1 : 0);
  });

  it("publish：sourceVersionId 只接受同租户同模板版本，且不参与发布配置", async () => {
    const source = await createTemplate(`溯源源-${suffix}`);
    const other = await createTemplate(`溯源他-${suffix}`);
    expect((await save(source.id, 1, "溯源源草稿")).status).toBe(200);

    const first = await publish(source.id, 2);
    expect(first.status).toBe(201);
    const firstBody = first.body as {
      data: { activeVersion: { id: string; versionNo: number } };
    };
    const version1Id = firstBody.data.activeVersion.id;

    // 引用另一个模板的版本：拒绝且不改动目标模板。
    const bad = await publish(other.id, 1, { sourceVersionId: version1Id });
    expect(bad.status).toBe(422);
    expect((bad.body as { code: string }).code).toBe(
      "TEMPLATE_VERSION_UNAVAILABLE",
    );
    const untouched = await templateRow(other.id);
    expect(untouched.activeVersionId).toBeNull();
    expect(await versionRows(other.id)).toHaveLength(0);

    // 同模板引用：写入溯源信息，发布配置仍来自服务器当前草稿。
    const second = await publish(source.id, 3, { sourceVersionId: version1Id });
    expect(second.status).toBe(201);

    const rows = await versionRows(source.id);
    expect(rows.map((row) => row.versionNo)).toEqual([1, 2]);
    expect(rows[1]?.sourceVersionId).toBe(version1Id);
    expect(JSON.stringify(rows[1]?.configJson)).toBe(
      JSON.stringify(rows[0]?.configJson),
    );
  });

  it("default：并发切换默认后同游戏最多一个默认，且各自 revision 只前进一次", async () => {
    const a = await createTemplate(`默认并发A-${suffix}`);
    const b = await createTemplate(`默认并发B-${suffix}`);
    for (const template of [a, b]) {
      expect(
        (await save(template.id, 1, `默认并发-${template.id}`)).status,
      ).toBe(200);
      expect((await publish(template.id, 2)).status).toBe(201);
    }

    // 先把 A 设为默认，制造“已有默认”的切换前提。
    expect(
      (
        await req(ownerToken).post(`${base}/${a.id}/default`, {
          expectedRevision: 3,
        })
      ).status,
    ).toBe(201);

    const beforeA = await templateRow(a.id);
    const beforeB = await templateRow(b.id);
    const [first, second] = await Promise.all([
      req(ownerToken).post(`${base}/${a.id}/default`, {
        expectedRevision: beforeA.revision,
      }),
      req(ownerToken).post(`${base}/${b.id}/default`, {
        expectedRevision: beforeB.revision,
      }),
    ]);

    // 不允许出现 500：冲突必须是受控 409（唯一索引兜底）或成功。
    for (const res of [first, second]) {
      expect([201, 409]).toContain(res.status);
    }

    const defaults = await client.gameDispatchTemplate.findMany({
      where: { tenantId, gameId, isDefault: true },
      select: { id: true },
    });
    expect(defaults).toHaveLength(1);
    expect([a.id, b.id]).toContain(defaults[0]?.id);

    const afterA = await templateRow(a.id);
    const afterB = await templateRow(b.id);
    expect(afterA.revision).toBe(
      beforeA.revision + (first.status === 201 ? 1 : 0),
    );
    expect(afterB.revision).toBe(
      beforeB.revision + (second.status === 201 ? 1 : 0),
    );
  });

  it("revision：并发 archive 与 publish 恰一个生效，不产生悬空 activeVersionId", async () => {
    const template = await createTemplate(`并发归档发布-${suffix}`);
    expect((await save(template.id, 1, "并发归档草稿")).status).toBe(200);
    const before = await templateRow(template.id);

    const [archiveRes, publishRes] = await Promise.all([
      req(ownerToken).post(`${base}/${template.id}/archive`, {
        expectedRevision: before.revision,
      }),
      publish(template.id, before.revision),
    ]);

    const statuses = [archiveRes.status, publishRes.status];
    expect(statuses.filter((status) => status < 300)).toHaveLength(1);
    expect(statuses).toContain(409);

    const after = await templateRow(template.id);
    expect(after.revision).toBe(before.revision + 1);
    const rows = await versionRows(template.id);

    if (publishRes.status === 201) {
      expect(after.status).toBe("PUBLISHED");
      expect(rows).toHaveLength(1);
      expect(after.activeVersionId).toBe(rows[0]?.id ?? null);
    } else {
      expect(after.status).toBe("ARCHIVED");
      expect(after.archivedAt).not.toBeNull();
      expect(rows).toHaveLength(0);
      expect(after.activeVersionId).toBeNull();
    }

    expect(
      await client.auditLog.count({
        where: {
          tenantId,
          action: "game_template.v2.publish",
          resourceId: template.id,
        },
      }),
    ).toBe(publishRes.status === 201 ? 1 : 0);
    expect(
      await client.auditLog.count({
        where: {
          tenantId,
          action: "game_template.v2.archive",
          resourceId: template.id,
        },
      }),
    ).toBe(archiveRes.status === 201 ? 1 : 0);
  });
});
