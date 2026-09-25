/** DS-008：统一资金台账列表与 CSV 导出的 OpenAPI / 生成客户端契约。 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../..");

interface Schema {
  type?: string;
  format?: string;
  enum?: string[];
  pattern?: string;
  nullable?: boolean;
  minLength?: number;
  maxLength?: number;
  minimum?: number;
  maximum?: number;
  required?: string[];
  properties?: Record<string, Schema>;
  items?: Schema;
}

interface Parameter {
  name?: string;
  required?: boolean;
  schema?: Schema;
}

interface Operation {
  operationId?: string;
  parameters?: Parameter[];
  responses?: Record<string, { content?: Record<string, { schema?: Schema }> }>;
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

const LIST_PATH = "/api/v1/tenant/funds/ledger";
const EXPORT_PATH = `${LIST_PATH}/export.csv`;
const FILTERS = [
  "eventType",
  "status",
  "fundAccountId",
  "sourceType",
  "q",
  "occurredFrom",
  "occurredTo",
  "minAmountFen",
  "maxAmountFen",
  "sortBy",
  "sortDir",
] as const;

function operation(pathname: string): Operation {
  const found = document.paths[pathname]?.get;
  if (!found) throw new Error(`missing GET ${pathname}`);
  return found;
}

function responseSchema(
  target: Operation,
  status: string,
  mediaType: string,
): Schema {
  const schema = target.responses?.[status]?.content?.[mediaType]?.schema;
  if (!schema) throw new Error(`missing ${status} ${mediaType} schema`);
  return schema;
}

describe("DS-008 fund ledger OpenAPI contract", () => {
  it("keeps list and export operationIds stable", () => {
    expect(operation(LIST_PATH).operationId).toBe("tenantFundLedger_list");
    expect(operation(EXPORT_PATH).operationId).toBe(
      "tenantFundLedger_exportCsv",
    );
  });

  it("declares all query parameters optional and excludes pagination from export", () => {
    const listParams = operation(LIST_PATH).parameters ?? [];
    const exportParams = operation(EXPORT_PATH).parameters ?? [];
    expect(listParams.map((parameter) => parameter.name)).toEqual(
      expect.arrayContaining([...FILTERS, "page", "pageSize"]),
    );
    expect(exportParams.map((parameter) => parameter.name).sort()).toEqual(
      [...FILTERS].sort(),
    );
    expect(
      [...listParams, ...exportParams].every(
        (parameter) => parameter.required === false,
      ),
    ).toBe(true);

    const pageSize = listParams.find(
      (parameter) => parameter.name === "pageSize",
    )?.schema;
    expect(pageSize?.minimum).toBe(1);
    expect(pageSize?.maximum).toBe(200);
    expect(
      exportParams.find((parameter) => parameter.name === "minAmountFen")
        ?.schema?.pattern,
    ).toBe("^(?:0|[1-9][0-9]*)$");
  });

  it("describes the complete list JSON response with string money and nullable fields", () => {
    const envelope = responseSchema(
      operation(LIST_PATH),
      "200",
      "application/json",
    );
    const view = envelope.properties?.data;
    const row = view?.properties?.rows?.items;
    expect(view?.required).toEqual([
      "rows",
      "total",
      "page",
      "pageSize",
      "sortBy",
      "sortDir",
    ]);
    expect(row?.required).toEqual(
      expect.arrayContaining([
        "transactionId",
        "txNo",
        "amountFen",
        "debitFen",
        "creditFen",
        "balanced",
        "fundAccount",
        "auxiliaries",
      ]),
    );
    for (const field of ["amountFen", "debitFen", "creditFen"]) {
      expect(row?.properties?.[field]?.type).toBe("string");
      expect(row?.properties?.[field]?.pattern).toBe("^(?:0|[1-9][0-9]*)$");
    }
    for (const field of [
      "eventType",
      "sourceType",
      "sourceId",
      "description",
      "fundFlowDirection",
      "fundAccount",
      "createdBy",
      "confirmedBy",
      "confirmedAt",
    ]) {
      expect(row?.properties?.[field]?.nullable, field).toBe(true);
    }
  });

  it("declares CSV text response and 400/422 errors", () => {
    const exported = operation(EXPORT_PATH);
    expect(responseSchema(exported, "200", "text/csv").type).toBe("string");
    for (const status of ["400", "422"]) {
      const error = responseSchema(exported, status, "application/json");
      expect(error.type).toBe("object");
      expect(error.required).toEqual([
        "type",
        "title",
        "status",
        "code",
        "message",
        "requestId",
      ]);
      expect(error.properties?.status?.type).toBe("integer");
      expect(error.properties?.code?.type).toBe("string");
    }
    expect(operation(LIST_PATH).responses?.["400"]).toBeDefined();
  });

  it("generates list and export SDK methods", () => {
    expect(sdkSource).toContain("export const tenantFundLedgerList =");
    expect(sdkSource).toContain("export const tenantFundLedgerExportCsv =");
  });
});
