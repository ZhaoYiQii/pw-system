import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../..");

interface Schema {
  type?: string;
  enum?: string[];
  required?: string[];
  properties?: Record<string, Schema>;
}
interface Operation {
  operationId?: string;
  parameters?: Array<{ name?: string; in?: string; required?: boolean }>;
  requestBody?: { content?: Record<string, { schema?: Schema }> };
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

const ORDER_PATH = "/api/v1/tenant/game-dispatch/template-orders";
const TEMPLATE_BASE = "/api/v1/tenant/game-dispatch-templates";

function jsonSchema(
  operation: Operation,
  section: "requestBody" | "200" | "201",
): Schema {
  if (section === "requestBody") {
    const schema = operation.requestBody?.content?.["application/json"]?.schema;
    if (!schema) throw new Error("missing request body schema");
    return schema;
  }
  const schema =
    operation.responses?.[section]?.content?.["application/json"]?.schema;
  if (!schema) throw new Error(`missing ${section} response schema`);
  return schema;
}

describe("S4 contract：创建派单与模板读取", () => {
  const operation = document.paths[ORDER_PATH]?.post;

  it("创建派单 operation 存在且幂等键是必填请求头", () => {
    expect(operation?.operationId).toBe("gameDispatchTemplateOrder_create");
    const header = operation?.parameters?.find(
      (parameter) => parameter.in === "header",
    );
    expect(header?.name).toBe("idempotency-key");
    expect(header?.required).toBe(true);
  });

  it("请求体只接受归属与组件值，不接受最终人数或价格", () => {
    const body = jsonSchema(operation as Operation, "requestBody");
    expect(body.required).toEqual([
      "gameId",
      "templateId",
      "templateVersionId",
      "customerProfileId",
      "values",
    ]);
    const properties = body.properties ?? {};
    expect(Object.keys(properties)).not.toContain("staffingSummary");
    expect(Object.keys(properties)).not.toContain("priceAdjustmentFen");
    expect(properties.values?.type).toBe("object");
  });

  it("响应包含服务端计算与自动文案，金额为十进制字符串", () => {
    const response = jsonSchema(operation as Operation, "201");
    const data = response.properties?.data;
    expect(data?.required).toContain("staffingSummary");
    expect(data?.required).toContain("priceAdjustmentFen");
    expect(data?.required).toContain("document");
    expect(data?.properties?.priceAdjustmentFen?.type).toBe("string");
    expect(data?.properties?.document?.required).toContain("plainText");
  });

  it("错误码枚举包含三个幂等码，且既有模板码未被移除", () => {
    const errorSchema =
      document.paths[TEMPLATE_BASE]?.get?.responses?.["200"]?.content?.[
        "application/json"
      ]?.schema;
    expect(errorSchema).toBeDefined();

    const errorCodes = document.paths[ORDER_PATH]?.post?.responses?.["422"]
      ?.content?.["application/json"]?.schema as unknown as {
      properties?: { code?: { enum?: string[] } };
    };
    const codes = errorCodes?.properties?.code?.enum ?? [];
    expect(codes).toContain("TEMPLATE_IDEMPOTENCY_MISMATCH");
    expect(codes).toContain("TEMPLATE_IDEMPOTENCY_IN_FLIGHT");
    expect(codes).toContain("TEMPLATE_ARCHIVED");
    expect(codes).toContain("TEMPLATE_VERSION_UNAVAILABLE");
  });

  it("订单详情响应已具名化：新增 v2 document 且旧字段全部保留", () => {
    const view =
      document.paths["/api/v1/tenant/game-dispatch/orders/{orderId}"]?.get;
    expect(view?.operationId).toBe("gameDispatch_view");
    const data = jsonSchema(view as Operation, "200").properties?.data;
    expect(data?.required).toContain("document");
    expect(data?.properties?.document?.type).toBe("object");
    expect(data?.properties?.document?.nullable).toBe(true);
    expect(data?.properties?.document?.required).toEqual([
      "schemaVersion",
      "rendererVersion",
      "rows",
      "plainText",
      "generatedFromSnapshotAt",
    ]);
    const legacyFields = [
      "copyText",
      "applyUrl",
      "bossUrl",
      "lines",
      "round",
      "templateName",
      "formValues",
    ];
    const properties = Object.keys(data?.properties ?? {});
    for (const legacy of legacyFields) {
      expect(properties).toContain(legacy);
    }
  });

  it("模板读取 operation 与生成客户端函数存在", () => {
    const published = document.paths[`${TEMPLATE_BASE}/published`]?.get;
    expect(published?.operationId).toBe("genericGameTemplate_listPublished");
    expect(
      published?.parameters?.find((parameter) => parameter.name === "gameId")
        ?.required,
    ).toBe(true);
    const form =
      document.paths[`${TEMPLATE_BASE}/versions/{versionId}/form`]?.get;
    expect(form?.operationId).toBe("genericGameTemplate_getVersionForm");

    expect(sdkSource).toContain("export const gameDispatchTemplateOrderCreate");
    expect(sdkSource).toContain(
      "export const genericGameTemplateListPublished",
    );
    expect(sdkSource).toContain(
      "export const genericGameTemplateGetVersionForm",
    );
  });
});
