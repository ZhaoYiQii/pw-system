/** DS-012：对账处理单列表的 OpenAPI / 生成客户端契约。 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../..");

interface Schema {
  type?: string;
  const?: string;
  enum?: string[];
  format?: string;
  pattern?: string;
  nullable?: boolean;
  minimum?: number;
  maximum?: number;
  required?: string[];
  properties?: Record<string, Schema>;
  items?: Schema;
  oneOf?: Schema[];
  discriminator?: { propertyName?: string };
  additionalProperties?: boolean;
}

interface Parameter {
  name?: string;
  required?: boolean;
  schema?: Schema;
}

interface Operation {
  operationId?: string;
  parameters?: Parameter[];
  requestBody?: unknown;
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
const typesSource = readFileSync(
  path.join(root, "packages/api-client/src/types.gen.ts"),
  "utf8",
);

const LIST_PATH = "/api/v1/tenant/reconciliation/cases";
const CLAIM_PATH = "/api/v1/tenant/reconciliation/cases/{caseId}/claim";
const START_PATH =
  "/api/v1/tenant/reconciliation/cases/{caseId}/start-processing";
const SUBMIT_REVIEW_PATH =
  "/api/v1/tenant/reconciliation/cases/{caseId}/submit-review";
const CLOSE_PATH = "/api/v1/tenant/reconciliation/cases/{caseId}/close";
const IGNORE_PATH = "/api/v1/tenant/reconciliation/cases/{caseId}/ignore";
const STATUSES = [
  "OPEN",
  "CLAIMED",
  "PROCESSING",
  "PENDING_REVIEW",
  "CLOSED",
  "IGNORED",
];

function operation(): Operation {
  const found = document.paths[LIST_PATH]?.get;
  if (!found) throw new Error(`missing GET ${LIST_PATH}`);
  return found;
}

function responseSchema(status: string): Schema {
  const schema =
    operation().responses?.[status]?.content?.["application/json"]?.schema;
  if (!schema) throw new Error(`missing ${status} application/json schema`);
  return schema;
}

function commandOperation(pathname: string): Operation {
  const found = document.paths[pathname]?.post;
  if (!found) throw new Error(`missing POST ${pathname}`);
  return found;
}

describe("DS-012 reconciliation case list contract", () => {
  it("exposes one stable read-only GET operation", () => {
    expect(operation().operationId).toBe("tenantReconciliationCase_list");
    expect(operation().requestBody).toBeUndefined();
    expect(document.paths[LIST_PATH]?.post).toBeUndefined();
  });

  it("accepts only optional status/page/pageSize query parameters", () => {
    const parameters = operation().parameters ?? [];
    expect(parameters.map((parameter) => parameter.name).sort()).toEqual([
      "page",
      "pageSize",
      "status",
    ]);
    expect(parameters.every((parameter) => parameter.required === false)).toBe(
      true,
    );
    expect(
      parameters.find((parameter) => parameter.name === "status")?.schema?.enum,
    ).toEqual(STATUSES);
    const pageSize = parameters.find(
      (parameter) => parameter.name === "pageSize",
    )?.schema;
    expect(pageSize?.minimum).toBe(1);
    expect(pageSize?.maximum).toBe(100);
  });

  it("keeps the paginated response complete, nullable and string-money safe", () => {
    const envelope = responseSchema("200");
    const view = envelope.properties?.data;
    const row = view?.properties?.rows?.items;
    const difference = row?.properties?.difference;

    expect(view?.required).toEqual(["rows", "total", "page", "pageSize"]);
    expect(row?.required).toEqual([
      "id",
      "differenceId",
      "status",
      "ownerId",
      "resolutionType",
      "resolutionNote",
      "linkedTransactionId",
      "reviewedBy",
      "reviewedAt",
      "closedAt",
      "createdAt",
      "updatedAt",
      "version",
      "difference",
    ]);
    expect(row?.properties?.status?.enum).toEqual(STATUSES);
    for (const field of [
      "ownerId",
      "resolutionType",
      "resolutionNote",
      "linkedTransactionId",
      "reviewedBy",
      "reviewedAt",
      "closedAt",
    ]) {
      expect(row?.properties?.[field]?.nullable, field).toBe(true);
    }
    expect(difference?.properties?.amountFen).toMatchObject({
      type: "string",
      pattern: "^(?:0|[1-9][0-9]*)$",
      nullable: true,
    });
    for (const field of ["detail", "paymentOrderId", "resolvedAt"]) {
      expect(difference?.properties?.[field]?.nullable, field).toBe(true);
    }
  });

  it("declares the shared 400 error and generates typed SDK surfaces", () => {
    expect(responseSchema("400").required).toEqual([
      "type",
      "title",
      "status",
      "code",
      "message",
      "requestId",
    ]);
    expect(sdkSource).toContain("export const tenantReconciliationCaseList =");
    expect(typesSource).toContain(
      "export type TenantReconciliationCaseListData =",
    );
    expect(typesSource).toContain(
      "status?: 'OPEN' | 'CLAIMED' | 'PROCESSING' | 'PENDING_REVIEW' | 'CLOSED' | 'IGNORED';",
    );
    expect(typesSource).toContain("amountFen: string | null;");
  });
});

describe("DS-013 reconciliation case command contract", () => {
  it("exposes only the two explicit command operations", () => {
    expect(commandOperation(CLAIM_PATH).operationId).toBe(
      "tenantReconciliationCase_claim",
    );
    expect(commandOperation(START_PATH).operationId).toBe(
      "tenantReconciliationCase_startProcessing",
    );
    expect(document.paths[LIST_PATH]?.patch).toBeUndefined();
    expect(document.paths[LIST_PATH]?.put).toBeUndefined();
  });

  it("requires UUID caseId and a strict positive expectedVersion body", () => {
    for (const pathname of [CLAIM_PATH, START_PATH]) {
      const operation = commandOperation(pathname);
      const caseId = operation.parameters?.find(
        (parameter) => parameter.name === "caseId",
      );
      expect(caseId).toMatchObject({
        name: "caseId",
        required: true,
        schema: { type: "string", format: "uuid" },
      });

      const requestBody = operation.requestBody as {
        required?: boolean;
        content?: Record<string, { schema?: Schema }>;
      };
      const schema = requestBody.content?.["application/json"]?.schema;
      expect(requestBody.required).toBe(true);
      expect(schema).toMatchObject({
        type: "object",
        required: ["expectedVersion"],
        additionalProperties: false,
      });
      expect(schema?.properties?.expectedVersion).toMatchObject({
        type: "integer",
        minimum: 1,
      });
    }
  });

  it("documents 200 success, all known failures and no accidental 201 contract", () => {
    for (const pathname of [CLAIM_PATH, START_PATH]) {
      const responses = commandOperation(pathname).responses ?? {};
      expect(Object.keys(responses).sort()).toEqual([
        "200",
        "400",
        "401",
        "403",
        "404",
        "409",
      ]);
      expect(responses["201"]).toBeUndefined();
      expect(
        responses["200"]?.content?.["application/json"]?.schema?.properties
          ?.data?.properties?.version,
      ).toMatchObject({ type: "integer", minimum: 1 });
    }
  });

  it("generates typed SDK commands with expectedVersion inputs", () => {
    expect(sdkSource).toContain("export const tenantReconciliationCaseClaim =");
    expect(sdkSource).toContain(
      "export const tenantReconciliationCaseStartProcessing =",
    );
    expect(typesSource).toContain(
      "export type TenantReconciliationCaseClaimData =",
    );
    expect(typesSource).toContain(
      "export type TenantReconciliationCaseStartProcessingData =",
    );
    expect(typesSource).toContain("expectedVersion: number;");
  });
});

describe("DS-014 reconciliation case closure contract", () => {
  it("exposes submit-review, close and ignore with stable operation ids", () => {
    expect(commandOperation(SUBMIT_REVIEW_PATH).operationId).toBe(
      "tenantReconciliationCase_submitReview",
    );
    expect(commandOperation(CLOSE_PATH).operationId).toBe(
      "tenantReconciliationCase_close",
    );
    expect(commandOperation(IGNORE_PATH).operationId).toBe(
      "tenantReconciliationCase_ignore",
    );
  });

  it("documents exact command response statuses without accidental 201", () => {
    for (const pathname of [SUBMIT_REVIEW_PATH, CLOSE_PATH, IGNORE_PATH]) {
      const responses = commandOperation(pathname).responses ?? {};
      expect(Object.keys(responses).sort()).toEqual([
        "200",
        "400",
        "401",
        "403",
        "404",
        "409",
      ]);
      expect(responses["201"]).toBeUndefined();
    }
  });

  it("models submit-review as two strict mutually exclusive result branches", () => {
    const requestBody = commandOperation(SUBMIT_REVIEW_PATH).requestBody as {
      required?: boolean;
      content?: Record<string, { schema?: Schema }>;
    };
    const schema = requestBody.content?.["application/json"]?.schema;
    expect(requestBody.required).toBe(true);
    expect(schema?.discriminator?.propertyName).toBe("resolutionType");
    expect(schema?.oneOf).toHaveLength(2);

    const noLedgerChange = schema?.oneOf?.find(
      (branch) =>
        branch.properties?.resolutionType?.const === "NO_LEDGER_CHANGE",
    );
    expect(noLedgerChange).toMatchObject({
      type: "object",
      required: ["expectedVersion", "resolutionType", "resolutionNote"],
      additionalProperties: false,
    });
    expect(noLedgerChange?.properties?.linkedTransactionId).toBeUndefined();

    const ledgerTransaction = schema?.oneOf?.find(
      (branch) =>
        branch.properties?.resolutionType?.const === "LEDGER_TRANSACTION",
    );
    expect(ledgerTransaction).toMatchObject({
      type: "object",
      required: [
        "expectedVersion",
        "resolutionType",
        "resolutionNote",
        "linkedTransactionId",
      ],
      additionalProperties: false,
    });
    expect(ledgerTransaction?.properties?.linkedTransactionId).toMatchObject({
      type: "string",
      format: "uuid",
    });
  });

  it("keeps close and ignore request bodies strict", () => {
    const bodySchema = (pathname: string) => {
      const requestBody = commandOperation(pathname).requestBody as {
        required?: boolean;
        content?: Record<string, { schema?: Schema }>;
      };
      expect(requestBody.required).toBe(true);
      return requestBody.content?.["application/json"]?.schema;
    };

    expect(bodySchema(CLOSE_PATH)).toMatchObject({
      type: "object",
      required: ["expectedVersion"],
      additionalProperties: false,
    });
    expect(bodySchema(IGNORE_PATH)).toMatchObject({
      type: "object",
      required: ["expectedVersion", "reason"],
      additionalProperties: false,
    });
  });

  it("generates typed SDK commands for the three closure operations", () => {
    expect(sdkSource).toContain(
      "export const tenantReconciliationCaseSubmitReview =",
    );
    expect(sdkSource).toContain("export const tenantReconciliationCaseClose =");
    expect(sdkSource).toContain(
      "export const tenantReconciliationCaseIgnore =",
    );
    expect(typesSource).toContain(
      "export type TenantReconciliationCaseSubmitReviewData =",
    );
    expect(typesSource).toContain(
      "export type TenantReconciliationCaseCloseData =",
    );
    expect(typesSource).toContain(
      "export type TenantReconciliationCaseIgnoreData =",
    );
  });
});
