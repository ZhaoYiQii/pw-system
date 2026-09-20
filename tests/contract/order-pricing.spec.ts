/**
 * 算价模型 Task 1 契约：规则库与陪玩×游戏底价的 OpenAPI 形状与生成客户端。
 * 金额一律十进制字符串分；命中键是「模板字段 stableKey=选项值」。
 */
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
  required?: string[];
  properties?: Record<string, Schema>;
  items?: Schema;
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

const RULE_PATH = "/api/v1/tenant/game-pricing/games/{gameId}";
const BASE_PATH =
  "/api/v1/tenant/game-pricing/players/{playerId}/games/{gameId}/base";

function jsonSchema(
  operation: Operation | undefined,
  section: "requestBody" | "200",
): Schema {
  const schema =
    section === "requestBody"
      ? operation?.requestBody?.content?.["application/json"]?.schema
      : operation?.responses?.[section]?.content?.["application/json"]?.schema;
  if (!schema) throw new Error(`missing ${section} schema`);
  return schema;
}

describe("算价模型契约：规则库 + 陪玩×游戏底价", () => {
  it("规则库读写 operation 存在，路径与 operationId 稳定", () => {
    expect(document.paths[RULE_PATH]?.get?.operationId).toBe(
      "pricingRules_getGameRule",
    );
    expect(document.paths[RULE_PATH]?.put?.operationId).toBe(
      "pricingRules_putGameRule",
    );
    expect(document.paths[BASE_PATH]?.get?.operationId).toBe(
      "pricingRules_getPlayerGamePrice",
    );
    expect(document.paths[BASE_PATH]?.put?.operationId).toBe(
      "pricingRules_putPlayerGamePrice",
    );
  });

  it("规则库写入体只收命中键与金额，金额为字符串分、类型位有枚举", () => {
    const body = jsonSchema(document.paths[RULE_PATH]?.put, "requestBody");
    expect(body.required).toEqual(["items"]);
    const item = body.properties?.items?.items;
    expect(item?.required).toEqual(["dimensionKey", "amountFen"]);
    expect(item?.properties?.dimensionKey?.type).toBe("string");
    expect(item?.properties?.amountFen?.type).toBe("string");
    // 非负整数分：^(?:0|[1-9][0-9]*)$ —— 不含小数点，杜绝浮点金额。
    expect(item?.properties?.amountFen?.pattern).toBe("^(?:0|[1-9][0-9]*)$");
    expect(item?.properties?.kind?.enum).toEqual(["SURCHARGE", "FIXED"]);
  });

  it("规则库读回：data.items 为数组，金额与更新时间形状固定", () => {
    const read = jsonSchema(document.paths[RULE_PATH]?.get, "200");
    const data = read.properties?.data;
    expect(data?.required).toEqual(["gameId", "enabled", "items", "updatedAt"]);
    expect(data?.properties?.items?.type).toBe("array");
    expect(data?.properties?.items?.items?.required).toEqual([
      "id",
      "kind",
      "dimensionKey",
      "amountFen",
      "sortOrder",
    ]);
    expect(data?.properties?.items?.items?.properties?.amountFen?.type).toBe(
      "string",
    );
    expect(data?.properties?.updatedAt?.nullable).toBe(true);
  });

  it("陪玩×游戏底价：写入要求字符串分，读回带兜底与状态", () => {
    const body = jsonSchema(document.paths[BASE_PATH]?.put, "requestBody");
    expect(body.required).toEqual(["basePricePerHourFen"]);
    expect(body.properties?.basePricePerHourFen?.type).toBe("string");
    expect(body.properties?.basePricePerHourFen?.pattern).toBe(
      "^(?:0|[1-9][0-9]*)$",
    );
    expect(body.properties?.status?.enum).toEqual(["ACTIVE", "INACTIVE"]);

    const read = jsonSchema(document.paths[BASE_PATH]?.get, "200");
    const data = read.properties?.data;
    expect(data?.required).toEqual([
      "playerId",
      "gameId",
      "basePricePerHourFen",
      "fallbackBasePricePerHourFen",
      "status",
    ]);
    expect(data?.properties?.basePricePerHourFen?.nullable).toBe(true);
    expect(data?.properties?.fallbackBasePricePerHourFen?.type).toBe("string");
  });

  it("生成客户端包含四个算价 operation", () => {
    for (const fn of [
      "pricingRulesGetGameRule",
      "pricingRulesPutGameRule",
      "pricingRulesGetPlayerGamePrice",
      "pricingRulesPutPlayerGamePrice",
    ]) {
      expect(sdkSource).toContain(`export const ${fn} =`);
    }
  });
});
