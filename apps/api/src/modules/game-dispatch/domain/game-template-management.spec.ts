import { describe, expect, it } from "vitest";
import "../../../common/validation/api-validation-rules.js";
import { routeValidations } from "../../../common/validation/validation-registry.js";
import {
  PERMISSION_KEYS,
  permissionsFor,
} from "../../identity-access/domain/roles.js";
import {
  GenericTemplateError,
  GameTemplateRevisionConflictError,
} from "./errors.js";
import {
  GENERIC_TEMPLATE_SORTS,
  decodeTemplateCursor,
  encodeTemplateCursor,
} from "./game-template-management.js";

const uuid = "11111111-1111-4111-8111-111111111111";

const validConfig = {
  schemaVersion: 2,
  sections: [
    {
      stableKey: "basic",
      label: "基本信息",
      enabled: true,
      sortOrder: 0,
      layout: { columns: 2 },
    },
  ],
  components: [
    {
      kind: "FIELD",
      stableKey: "rank",
      sectionKey: "basic",
      label: "段位",
      enabled: true,
      sortOrder: 0,
      layout: { colSpan: 1, rowBreakBefore: false },
      fieldType: "SINGLE_SELECT",
      semanticRole: "TARGET_RANK",
      required: true,
      options: [{ value: "gold", label: "黄金", priceDeltaFen: "1000" }],
    },
  ],
  staffingSource: { kind: "FIXED", count: 1 },
} as const;

function schemaFor(methodAndPath: string, part: "body" | "query") {
  const schema = routeValidations.get(methodAndPath as never)?.[part];
  expect(schema, `${methodAndPath} ${part} schema`).toBeDefined();
  return schema!;
}

describe("generic template management contract", () => {
  it("adds fine-grained permissions without removing the legacy grant", () => {
    const newPermissions = [
      "gameDispatch.create",
      "gameTemplate.view",
      "gameTemplate.edit",
      "gameTemplate.publish",
      "gameTemplate.archive",
    ] as const;
    expect(PERMISSION_KEYS).toEqual(
      expect.arrayContaining([...newPermissions]),
    );
    expect(permissionsFor("TENANT_OWNER")).toEqual(
      expect.arrayContaining(["gameDispatch.manage", ...newPermissions]),
    );
    expect(permissionsFor("TENANT_ADMIN")).toEqual(
      expect.arrayContaining(["gameDispatch.manage", ...newPermissions]),
    );
    expect(permissionsFor("CUSTOMER_SERVICE")).toEqual(
      expect.arrayContaining([
        "gameDispatch.manage",
        "gameDispatch.create",
        "gameTemplate.view",
      ]),
    );
    expect(permissionsFor("CUSTOMER_SERVICE")).not.toEqual(
      expect.arrayContaining([
        "gameTemplate.edit",
        "gameTemplate.publish",
        "gameTemplate.archive",
      ]),
    );
    for (const role of ["PLAYER", "FINANCE", "CUSTOMER"] as const) {
      for (const permission of newPermissions) {
        expect(permissionsFor(role)).not.toContain(permission);
      }
    }
  });

  it.each(GENERIC_TEMPLATE_SORTS)(
    "round-trips a %s cursor with its stable id tie-breaker",
    (sort) => {
      const cursor = encodeTemplateCursor({
        sort,
        value: "2026-09-15",
        id: uuid,
      });
      expect(decodeTemplateCursor(cursor, sort)).toEqual({
        v: 1,
        sort,
        value: "2026-09-15",
        id: uuid,
      });
    },
  );

  it("rejects malformed, unknown-version and sort-mismatched cursors", () => {
    expect(() =>
      decodeTemplateCursor("not-base64-json", "UPDATED_DESC"),
    ).toThrow(
      expect.objectContaining({ code: "TEMPLATE_CURSOR_INVALID", status: 400 }),
    );
    const unknownVersion = Buffer.from(
      JSON.stringify({ v: 2, sort: "UPDATED_DESC", value: "x", id: uuid }),
    ).toString("base64url");
    expect(() =>
      decodeTemplateCursor(unknownVersion, "UPDATED_DESC"),
    ).toThrow();
    const cursor = encodeTemplateCursor({
      sort: "NAME_ASC",
      value: "a",
      id: uuid,
    });
    expect(() => decodeTemplateCursor(cursor, "UPDATED_DESC")).toThrow();
  });

  it("keeps structured errors controlled and revision conflict details stable", () => {
    const notFound = new GenericTemplateError(
      "TEMPLATE_NOT_FOUND",
      "模板不存在",
      {
        templateId: uuid,
      },
    );
    expect(notFound.toResponse()).toEqual({
      code: "TEMPLATE_NOT_FOUND",
      message: "模板不存在",
      details: { templateId: uuid },
    });
    expect(notFound.status).toBe(404);
    expect(notFound.toResponse()).not.toHaveProperty("cause");

    const conflict = new GameTemplateRevisionConflictError(
      3,
      4,
      "editor-1",
      "2026-09-15T04:28:00.000Z",
    );
    expect(conflict).toMatchObject({
      code: "TEMPLATE_REVISION_CONFLICT",
      status: 409,
      details: {
        expectedRevision: 3,
        currentRevision: 4,
        currentEditor: "editor-1",
        currentUpdatedAt: "2026-09-15T04:28:00.000Z",
      },
    });
    expect(conflict.toResponse()).not.toHaveProperty("draftConfig");

    expect(
      new GenericTemplateError("TEMPLATE_COMPONENT_INVALID", "配置无效", {
        issues: [],
      }).status,
    ).toBe(422);
  });

  it("strictly validates public mutation bodies and server-owned fields", () => {
    const create = schemaFor(
      "POST /api/v1/tenant/game-dispatch-templates",
      "body",
    );
    expect(create.safeParse({ gameId: uuid, name: "英雄联盟" }).success).toBe(
      true,
    );
    expect(
      create.safeParse({ gameId: uuid, name: "英雄联盟", tenantId: uuid })
        .success,
    ).toBe(false);
    expect(create.safeParse({ gameId: "bad", name: "英雄联盟" }).success).toBe(
      false,
    );

    const save = schemaFor(
      "PATCH /api/v1/tenant/game-dispatch-templates/:id/draft",
      "body",
    );
    expect(
      save.safeParse({ expectedRevision: 0, config: validConfig }).success,
    ).toBe(true);
    expect(
      save.safeParse({ expectedRevision: -1, config: validConfig }).success,
    ).toBe(false);
    expect(
      save.safeParse({ expectedRevision: 1.5, config: validConfig }).success,
    ).toBe(false);
    expect(
      save.safeParse({
        expectedRevision: 0,
        config: validConfig,
        status: "PUBLISHED",
      }).success,
    ).toBe(false);
    expect(
      save.safeParse({
        expectedRevision: 0,
        config: { ...validConfig, rendererVersion: 1 },
      }).success,
    ).toBe(false);

    const numericMoney = {
      ...validConfig,
      components: [
        {
          ...validConfig.components[0],
          options: [
            { ...validConfig.components[0].options[0], priceDeltaFen: 1000 },
          ],
        },
      ],
    };
    expect(
      save.safeParse({ expectedRevision: 0, config: numericMoney }).success,
    ).toBe(false);

    const unknownKind = {
      ...validConfig,
      components: [{ ...validConfig.components[0], kind: "POSITION_BLOCK" }],
    };
    expect(
      save.safeParse({ expectedRevision: 0, config: unknownKind }).success,
    ).toBe(false);
    expect(
      save.safeParse({
        expectedRevision: 0,
        config: { ...validConfig, schemaVersion: 3 },
      }).success,
    ).toBe(false);
  });

  it("enforces list/version queries, UUIDs and config collection limits", () => {
    const list = schemaFor(
      "GET /api/v1/tenant/game-dispatch-templates",
      "query",
    );
    expect(
      list.safeParse({ gameId: uuid, limit: "100", sort: "NAME_ASC" }).success,
    ).toBe(true);
    expect(list.safeParse({ limit: "101" }).success).toBe(false);
    expect(list.safeParse({ tenantId: uuid }).success).toBe(false);

    const restore = schemaFor(
      "POST /api/v1/tenant/game-dispatch-templates/:id/restore",
      "body",
    );
    expect(
      restore.safeParse({ versionId: uuid, expectedRevision: 2 }).success,
    ).toBe(true);
    expect(
      restore.safeParse({ versionId: "latest", expectedRevision: 2 }).success,
    ).toBe(false);

    const save = schemaFor(
      "PATCH /api/v1/tenant/game-dispatch-templates/:id/draft",
      "body",
    );
    const tooManySections = {
      ...validConfig,
      sections: Array.from({ length: 21 }, (_, index) => ({
        stableKey: `section_${index}`,
        label: `分区 ${index}`,
        enabled: true,
        sortOrder: index,
        layout: { columns: 1 },
      })),
    };
    expect(
      save.safeParse({ expectedRevision: 0, config: tooManySections }).success,
    ).toBe(false);

    const tooManyOptions = {
      ...validConfig,
      components: [
        {
          ...validConfig.components[0],
          options: Array.from({ length: 101 }, (_, index) => ({
            value: `option_${index}`,
            label: `选项 ${index}`,
          })),
        },
      ],
    };
    expect(
      save.safeParse({ expectedRevision: 0, config: tooManyOptions }).success,
    ).toBe(false);

    const oversizedConfig = {
      ...validConfig,
      components: [
        {
          kind: "REPEATABLE_TABLE",
          stableKey: "rows",
          sectionKey: "basic",
          label: "明细",
          enabled: true,
          sortOrder: 0,
          layout: { colSpan: 2, rowBreakBefore: false },
          columns: [
            {
              stableKey: "content",
              label: "内容",
              columnType: "TEXT",
              semanticRole: "CUSTOM",
              required: false,
            },
          ],
          defaultRows: [{ content: "x".repeat(256 * 1024) }],
        },
      ],
    };
    expect(
      save.safeParse({ expectedRevision: 0, config: oversizedConfig }).success,
    ).toBe(false);
  });
});
