/**
 * 算价模型 Task 3 契约：报单提交与客服审批的 OpenAPI 形状与生成客户端。
 * 申报/核定时长是整数分钟（15–1440）；金额一律十进制字符串分。
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
  minimum?: number;
  maximum?: number;
  required?: string[];
  properties?: Record<string, Schema>;
  items?: Schema;
}
interface Operation {
  operationId?: string;
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

const REPORT_PATH = "/api/v1/tenant/game-dispatch/slots/{slotId}/report";
const REVIEW_PATH = `${REPORT_PATH}/review`;

function jsonSchema(
  operation: Operation | undefined,
  section: "requestBody" | "201",
): Schema {
  const schema =
    section === "requestBody"
      ? operation?.requestBody?.content?.["application/json"]?.schema
      : operation?.responses?.[section]?.content?.["application/json"]?.schema;
  if (!schema) throw new Error(`missing ${section} schema`);
  return schema;
}

describe("算价模型 Task 3 契约：报单与客服审批", () => {
  it("报单与审批 operation 存在，路径与 operationId 稳定", () => {
    expect(document.paths[REPORT_PATH]?.post?.operationId).toBe(
      "slotReport_report",
    );
    expect(document.paths[REVIEW_PATH]?.post?.operationId).toBe(
      "slotReport_review",
    );
  });

  it("报单写入体只收申报分钟数，边界 15–1440 且为整数", () => {
    const body = jsonSchema(document.paths[REPORT_PATH]?.post, "requestBody");
    expect(body.required).toEqual(["declaredDurationMinutes"]);
    const minutes = body.properties?.declaredDurationMinutes;
    expect(minutes?.type).toBe("integer");
    expect(minutes?.minimum).toBe(15);
    expect(minutes?.maximum).toBe(1440);
  });

  it("审批写入体：approve 必填布尔，修正时长可选且同边界，reason 可空", () => {
    const body = jsonSchema(document.paths[REVIEW_PATH]?.post, "requestBody");
    expect(body.required).toEqual(["approve"]);
    expect(body.properties?.approve?.type).toBe("boolean");
    expect(body.properties?.declaredDurationMinutes?.type).toBe("integer");
    expect(body.properties?.declaredDurationMinutes?.minimum).toBe(15);
    expect(body.properties?.declaredDurationMinutes?.maximum).toBe(1440);
    expect(body.properties?.reason?.type).toBe("string");
    expect(body.properties?.reason?.nullable).toBe(true);
  });

  it("读回：报单状态枚举固定，申报时长可空，金额为可空字符串分", () => {
    const read = jsonSchema(document.paths[REPORT_PATH]?.post, "201");
    const data = read.properties?.data;
    expect(data?.required).toEqual([
      "slotId",
      "sessionId",
      "orderId",
      "playerId",
      "unitPriceFen",
      "reportStatus",
      "declaredDurationMinutes",
      "durationSeconds",
      "reportSubmittedAt",
      "reportReviewedAt",
      "reportReviewedBy",
      "reportReviewNote",
      "earningFen",
    ]);
    expect(data?.properties?.reportStatus?.enum).toEqual([
      "NOT_REPORTED",
      "PENDING_REVIEW",
      "APPROVED",
      "REJECTED",
    ]);
    expect(data?.properties?.declaredDurationMinutes?.nullable).toBe(true);
    expect(data?.properties?.declaredDurationMinutes?.minimum).toBe(15);
    // 证据计时长仅作对照：不参与计费，也不再是金额来源。
    expect(data?.properties?.durationSeconds?.type).toBe("integer");
    expect(data?.properties?.earningFen?.type).toBe("string");
    expect(data?.properties?.earningFen?.pattern).toBe("^(?:0|[1-9][0-9]*)$");
    expect(data?.properties?.earningFen?.nullable).toBe(true);
  });

  it("生成客户端包含两个报单 operation", () => {
    for (const fn of ["slotReportReport", "slotReportReview"]) {
      expect(sdkSource).toContain(`export const ${fn} =`);
    }
  });
});
