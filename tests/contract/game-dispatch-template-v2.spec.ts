import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../..");

interface Operation {
  operationId?: string;
  description?: string;
  parameters?: Array<{
    name?: string;
    in?: string;
    required?: boolean;
    schema?: Record<string, unknown>;
  }>;
  requestBody?: {
    content?: Record<string, { schema?: Record<string, unknown> }>;
  };
  responses?: Record<
    string,
    { content?: Record<string, { schema?: Record<string, unknown> }> }
  >;
}

interface OpenApiDocument {
  paths: Record<string, Record<string, Operation>>;
}

const document = JSON.parse(
  readFileSync(path.join(root, "openapi.json"), "utf8"),
) as OpenApiDocument;
const sdkSource = readFileSync(
  path.join(root, "packages/api-client/src/sdk.gen.ts"),
  "utf8",
);

const BASE = "/api/v1/tenant/game-dispatch-templates";

const NEW_OPERATIONS: Array<{
  path: string;
  method: string;
  operationId: string;
}> = [
  { path: BASE, method: "get", operationId: "genericGameTemplate_list" },
  { path: BASE, method: "post", operationId: "genericGameTemplate_create" },
  {
    path: `${BASE}/{id}/draft`,
    method: "get",
    operationId: "genericGameTemplate_getDraft",
  },
  {
    path: `${BASE}/{id}/draft`,
    method: "patch",
    operationId: "genericGameTemplate_saveDraft",
  },
  {
    path: `${BASE}/{id}/publish`,
    method: "post",
    operationId: "genericGameTemplate_publish",
  },
  {
    path: `${BASE}/{id}/versions`,
    method: "get",
    operationId: "genericGameTemplate_listVersions",
  },
  {
    path: `${BASE}/{id}/restore`,
    method: "post",
    operationId: "genericGameTemplate_restore",
  },
  {
    path: `${BASE}/{id}/copy`,
    method: "post",
    operationId: "genericGameTemplate_copy",
  },
  {
    path: `${BASE}/{id}/default`,
    method: "post",
    operationId: "genericGameTemplate_setDefault",
  },
  {
    path: `${BASE}/{id}/archive`,
    method: "post",
    operationId: "genericGameTemplate_archive",
  },
  {
    path: `${BASE}/{id}/unarchive`,
    method: "post",
    operationId: "genericGameTemplate_unarchive",
  },
  {
    path: `${BASE}/{id}`,
    method: "delete",
    operationId: "genericGameTemplate_remove",
  },
];

/** 生成客户端函数名：operationId 按 `_` 分段转 PascalCase，首字母小写。 */
const SDK_FUNCTIONS = [
  "genericGameTemplateList",
  "genericGameTemplateCreate",
  "genericGameTemplateGetDraft",
  "genericGameTemplateSaveDraft",
  "genericGameTemplatePublish",
  "genericGameTemplateListVersions",
  "genericGameTemplateRestore",
  "genericGameTemplateCopy",
  "genericGameTemplateSetDefault",
  "genericGameTemplateArchive",
  "genericGameTemplateUnarchive",
  "genericGameTemplateRemove",
];

function operation(pathname: string, method: string): Operation {
  const found = document.paths[pathname]?.[method];
  if (!found) {
    throw new Error(`missing ${method.toUpperCase()} ${pathname}`);
  }
  return found;
}

function schemaAt(
  schema: unknown,
  ...segments: Array<string | number>
): Record<string, unknown> {
  let current: unknown = schema;
  for (const segment of segments) {
    if (current === null || typeof current !== "object") {
      throw new Error(`cannot descend ${String(segment)}`);
    }
    current = (current as Record<string, unknown>)[String(segment)];
  }
  if (current === null || typeof current !== "object") {
    throw new Error(`missing ${segments.join(".")}`);
  }
  return current as Record<string, unknown>;
}

function requestSchema(
  pathname: string,
  method: string,
): Record<string, unknown> {
  return schemaAt(
    operation(pathname, method).requestBody?.content?.["application/json"]
      ?.schema,
    "properties",
  );
}

function responseSchema(
  pathname: string,
  method: string,
  status: string,
): Record<string, unknown> {
  return schemaAt(
    operation(pathname, method).responses?.[status]?.content?.[
      "application/json"
    ]?.schema,
  );
}

/** 递归收集 schema 中出现过的属性名，用于"可写 body 不得出现某字段"这类断言。 */
function collectPropertyNames(schema: unknown, found: Set<string>): void {
  if (schema === null || typeof schema !== "object") return;
  if (Array.isArray(schema)) {
    for (const entry of schema) collectPropertyNames(entry, found);
    return;
  }
  const record = schema as Record<string, unknown>;
  const properties = record.properties;
  if (properties !== null && typeof properties === "object") {
    for (const [key, value] of Object.entries(
      properties as Record<string, unknown>,
    )) {
      found.add(key);
      collectPropertyNames(value, found);
    }
  }
  for (const nested of [
    record.items,
    record.oneOf,
    record.additionalProperties,
    record.contains,
  ]) {
    collectPropertyNames(nested, found);
  }
}

describe("OpenAPI 契约：S2 通用派单模板管理", () => {
  it("12 条新路径存在且 operationId 稳定", () => {
    for (const expected of NEW_OPERATIONS) {
      const found = operation(expected.path, expected.method);
      expect(found.operationId, `${expected.method} ${expected.path}`).toBe(
        expected.operationId,
      );
    }
    // 旧 game-template 接口继续存在，不能被新路由取代或删除。
    for (const legacy of [
      "/api/v1/tenant/game-templates",
      "/api/v1/tenant/game-templates/{id}",
      "/api/v1/tenant/game-templates/{id}/copy",
    ]) {
      expect(document.paths[legacy], legacy).toBeTruthy();
    }
    expect(operation("/api/v1/tenant/game-templates", "get").operationId).toBe(
      "gameTemplate_list",
    );
  });

  it("配置为 schemaVersion=2 判别联合，priceDeltaFen 是十进制字符串而非 number", () => {
    const saveBody = requestSchema(`${BASE}/{id}/draft`, "patch");
    const config = schemaAt(saveBody, "config", "properties");
    expect(schemaAt(config, "schemaVersion")["enum"]).toEqual([2]);
    expect(schemaAt(config, "sections")["maxItems"]).toBe(20);
    expect(schemaAt(config, "components")["maxItems"]).toBe(100);

    const componentKinds = (
      schemaAt(config, "components", "items")["oneOf"] as Array<
        Record<string, unknown>
      >
    ).map((variant) => schemaAt(variant, "properties", "kind")["const"]);
    expect(componentKinds).toEqual(["FIELD", "REPEATABLE_TABLE", "NOTE"]);

    const staffingKinds = (
      schemaAt(config, "staffingSource")["oneOf"] as Array<
        Record<string, unknown>
      >
    ).map((variant) => schemaAt(variant, "properties", "kind")["const"]);
    expect(staffingKinds).toEqual([
      "FIXED",
      "NUMBER_FIELD",
      "REPEATABLE_TABLE_SUM",
    ]);

    // 选项加价：FIELD 选项与表格列选项都必须是 decimal string。
    const fieldVariant = (
      schemaAt(config, "components", "items")["oneOf"] as Array<
        Record<string, unknown>
      >
    )[0] as Record<string, unknown>;
    const fieldPrice = schemaAt(
      fieldVariant,
      "properties",
      "options",
      "items",
      "properties",
      "priceDeltaFen",
    );
    expect(fieldPrice["type"]).toBe("string");
    expect(String(fieldPrice["pattern"])).toContain("[0-9]");

    const tableVariant = (
      schemaAt(config, "components", "items")["oneOf"] as Array<
        Record<string, unknown>
      >
    )[1] as Record<string, unknown>;
    const columnOptions = schemaAt(
      tableVariant,
      "properties",
      "columns",
      "items",
      "properties",
      "options",
      "items",
      "properties",
    );
    expect(schemaAt(columnOptions, "priceDeltaFen")["type"]).toBe("string");
  });

  it("rendererVersion 不出现在任何可写 body；发布响应只返回草稿与版本摘要", () => {
    for (const expected of NEW_OPERATIONS) {
      const requestBody = operation(expected.path, expected.method).requestBody;
      if (!requestBody) continue;
      const names = new Set<string>();
      collectPropertyNames(
        requestBody.content?.["application/json"]?.schema,
        names,
      );
      expect(
        names.has("documentRendererVersion"),
        `${expected.method} ${expected.path} 不应接受 documentRendererVersion`,
      ).toBe(false);
      expect(
        names.has("tenantId"),
        `${expected.method} ${expected.path} 不应接受 tenantId`,
      ).toBe(false);
      expect(
        names.has("status"),
        `${expected.method} ${expected.path} 不应接受 status`,
      ).toBe(false);
      expect(
        names.has("activeVersionId"),
        `${expected.method} ${expected.path} 不应接受 activeVersionId`,
      ).toBe(false);
    }

    // 草稿响应返回的是可编辑草稿 schema（含可选 legacyCompatibility，无 renderer）。
    const draftConfig = schemaAt(
      responseSchema(`${BASE}/{id}/draft`, "get", "200"),
      "properties",
      "data",
      "properties",
      "config",
      "properties",
    );
    expect(Object.keys(draftConfig)).toContain("legacyCompatibility");
    expect(Object.keys(draftConfig)).not.toContain("documentRendererVersion");

    const publishData = schemaAt(
      responseSchema(`${BASE}/{id}/publish`, "post", "201"),
      "properties",
      "data",
      "properties",
    );
    expect(Object.keys(publishData)).toContain("activeVersion");
    expect(Object.keys(publishData)).toContain("config");
    const versionSummary = schemaAt(publishData, "activeVersion", "properties");
    expect(Object.keys(versionSummary)).not.toContain("configJson");
  });

  it("错误 details 有固定类型：409 修订冲突、422 校验问题、409 删除受限", () => {
    const conflict = schemaAt(
      responseSchema(`${BASE}/{id}/draft`, "patch", "409"),
      "properties",
      "details",
      "properties",
    );
    expect(Object.keys(conflict).sort()).toEqual([
      "currentEditor",
      "currentRevision",
      "currentUpdatedAt",
      "expectedRevision",
    ]);

    const validation = schemaAt(
      responseSchema(`${BASE}/{id}/publish`, "post", "422"),
      "properties",
      "details",
      "properties",
      "issues",
      "items",
      "properties",
    );
    expect(Object.keys(validation)).toContain("code");
    expect(Object.keys(validation)).toContain("path");
    expect(Object.keys(validation)).toContain("message");
    expect(Object.keys(validation)).toContain("componentKey");

    const restricted = schemaAt(
      responseSchema(`${BASE}/{id}`, "delete", "409"),
      "properties",
      "details",
      "properties",
    );
    expect(Object.keys(restricted).sort()).toEqual([
      "orderCount",
      "snapshotCount",
      "templateId",
      "versionCount",
    ]);
  });

  it("分页 schema 与查询参数齐全", () => {
    const page = schemaAt(
      responseSchema(BASE, "get", "200"),
      "properties",
      "page",
      "properties",
    );
    expect(schemaAt(page, "nextCursor")["nullable"]).toBe(true);

    const versionPage = schemaAt(
      responseSchema(`${BASE}/{id}/versions`, "get", "200"),
      "properties",
      "page",
      "properties",
    );
    expect(schemaAt(versionPage, "nextCursor")["nullable"]).toBe(true);

    const listParams = (operation(BASE, "get").parameters ?? []).map(
      (parameter) => parameter.name,
    );
    expect(listParams).toEqual(
      expect.arrayContaining([
        "gameId",
        "status",
        "q",
        "sort",
        "cursor",
        "limit",
      ]),
    );
    const versionParams = (
      operation(`${BASE}/{id}/versions`, "get").parameters ?? []
    ).map((parameter) => parameter.name);
    expect(versionParams).toEqual(expect.arrayContaining(["cursor", "limit"]));
    const deleteParams = operation(`${BASE}/{id}`, "delete").parameters ?? [];
    expect(deleteParams.map((parameter) => parameter.name)).toContain(
      "expectedRevision",
    );

    const listData = schemaAt(
      responseSchema(BASE, "get", "200"),
      "properties",
      "data",
      "items",
      "properties",
    );
    // 摘要不得包含 config 或旧固定模块字段。
    for (const forbidden of [
      "config",
      "fields",
      "positions",
      "rankRules",
      "copyLines",
    ]) {
      expect(Object.keys(listData)).not.toContain(forbidden);
    }
  });

  it("生成客户端暴露 12 个操作函数", () => {
    for (const fn of SDK_FUNCTIONS) {
      expect(sdkSource, `sdk.gen.ts 缺少 ${fn}`).toContain(
        `export const ${fn} =`,
      );
    }
  });
});
