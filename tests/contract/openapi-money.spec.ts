import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const document = JSON.parse(
  readFileSync(path.resolve(here, "../../openapi.json"), "utf8"),
) as {
  paths: Record<string, Record<string, unknown>>;
};

function responseSchema(
  methodPath: string,
  method: string,
  status: string,
): Record<string, unknown> {
  const operation = document.paths[methodPath]?.[method] as
    | {
        responses?: Record<
          string,
          { content?: Record<string, { schema?: Record<string, unknown> }> }
        >;
      }
    | undefined;
  const schema =
    operation?.responses?.[status]?.content?.["application/json"]?.schema;
  if (!schema)
    throw new Error(
      `missing ${method.toUpperCase()} ${methodPath} ${status} schema`,
    );
  return schema;
}

function schemaAt(
  schema: Record<string, unknown>,
  ...segments: Array<string | number>
): Record<string, unknown> {
  let current: unknown = schema;
  for (const segment of segments) {
    if (current === null || typeof current !== "object")
      throw new Error(`cannot descend ${String(segment)}`);
    current = (current as Record<string, unknown>)[String(segment)];
  }
  if (current === null || typeof current !== "object")
    throw new Error(`missing ${segments.join(".")}`);
  return current as Record<string, unknown>;
}

describe("OpenAPI 金额契约（MoneyFen 必须为十进制字符串）", () => {
  it("catalog 价格规则：输入输出 priceFen/playerCostFen 均为 string", () => {
    const createBody = document.paths[
      "/api/v1/tenant/catalog/products/{productId}/pricing"
    ]?.post as {
      requestBody?: {
        content?: Record<string, { schema?: Record<string, unknown> }>;
      };
    };
    const bodyProps = schemaAt(
      createBody?.requestBody?.content?.["application/json"]?.schema as Record<
        string,
        unknown
      >,
      "properties",
    );
    expect(schemaAt(bodyProps, "priceFen")["type"]).toBe("string");
    expect(schemaAt(bodyProps, "playerCostFen")["type"]).toBe("string");

    const list = responseSchema(
      "/api/v1/tenant/catalog/products/{productId}/pricing",
      "get",
      "200",
    );
    const dataItems = schemaAt(list, "properties", "data", "items");
    const ruleProps = schemaAt(dataItems, "properties");
    expect(schemaAt(ruleProps, "priceFen")["type"]).toBe("string");
    expect(schemaAt(ruleProps, "playerCostFen")["type"]).toBe("string");
  });

  it("orders 快照与预算金额为 string；接单大厅 unitPriceFen 为 string", () => {
    const order = responseSchema("/api/v1/tenant/orders/{id}", "get", "200");
    const orderProps = schemaAt(order, "properties", "data", "properties");
    const requirementProps = schemaAt(orderProps, "requirement", "properties");
    expect(schemaAt(requirementProps, "minBudgetFen")["type"]).toBe("string");
    expect(schemaAt(requirementProps, "maxBudgetFen")["type"]).toBe("string");
    const snapshotItems = schemaAt(orderProps, "snapshot", "items");
    const lineProps = schemaAt(snapshotItems, "properties");
    expect(schemaAt(lineProps, "unitPriceFen")["type"]).toBe("string");
    expect(schemaAt(lineProps, "playerCostFen")["type"]).toBe("string");
    expect(schemaAt(lineProps, "lineTotalFen")["type"]).toBe("string");

    const hall = responseSchema(
      "/api/v1/tenant/player/order-hall",
      "get",
      "200",
    );
    const hallItemProps = schemaAt(
      hall,
      "properties",
      "data",
      "items",
      "properties",
    );
    expect(schemaAt(hallItemProps, "unitPriceFen")["type"]).toBe("string");
  });

  it("finance split-preview 入参与输出、陪玩财务余额均为 string", () => {
    const preview = responseSchema(
      "/api/v1/tenant/finance-rules/split-preview",
      "post",
      "200",
    );
    const previewProps = schemaAt(preview, "properties", "data", "properties");
    expect(schemaAt(previewProps, "platformFeeFen")["type"]).toBe("string");
    expect(schemaAt(previewProps, "storeCutFen")["type"]).toBe("string");
    expect(schemaAt(previewProps, "playerShareFen")["type"]).toBe("string");

    const previewBody = document.paths[
      "/api/v1/tenant/finance-rules/split-preview"
    ]?.post as {
      requestBody?: {
        content?: Record<string, { schema?: Record<string, unknown> }>;
      };
    };
    const amount = schemaAt(
      previewBody?.requestBody?.content?.["application/json"]?.schema as Record<
        string,
        unknown
      >,
      "properties",
      "amountFen",
    );
    expect(amount["type"]).toBe("string");

    const finance = responseSchema(
      "/api/v1/tenant/player/finance",
      "get",
      "200",
    );
    const financeProps = schemaAt(finance, "properties", "data", "properties");
    expect(schemaAt(financeProps, "pendingFen")["type"]).toBe("string");
    expect(schemaAt(financeProps, "batchedFen")["type"]).toBe("string");
    expect(schemaAt(financeProps, "paidFen")["type"]).toBe("string");
  });
});
