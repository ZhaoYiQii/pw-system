/**
 * 算价模型 Task 4 契约：报名大厅 / 我的报名 / 释放名额 / 违约记录的 OpenAPI 形状与生成客户端。
 * 这些 operation 只暴露报名与状态，不暴露金额（金额仍由报单与结算链路负责）。
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
  minimum?: number;
  maximum?: number;
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

const HALL_PATH = "/api/v1/tenant/game-dispatch/player/hall";
const MINE_PATH = "/api/v1/tenant/game-dispatch/player/applications";
const RELEASE_PATH = "/api/v1/tenant/game-dispatch/slots/{slotId}/release";
const BREACH_PATH =
  "/api/v1/tenant/game-dispatch/orders/{orderId}/player-breaches";
const BREACH_LIST_PATH = "/api/v1/tenant/game-dispatch/player-breaches";
const DISPATCH_DETAIL_PATH = "/api/v1/tenant/game-dispatch/orders/{orderId}";

function schemaOf(
  operation: Operation | undefined,
  section: "requestBody" | "200" | "201",
): Schema {
  const schema =
    section === "requestBody"
      ? operation?.requestBody?.content?.["application/json"]?.schema
      : operation?.responses?.[section]?.content?.["application/json"]?.schema;
  if (!schema) throw new Error(`missing ${section} schema`);
  return schema;
}

describe("算价模型 Task 4 契约：报名大厅、我的报名、释放名额与违约记录", () => {
  it("四个 operation 存在，路径与 operationId 稳定", () => {
    expect(document.paths[HALL_PATH]?.get?.operationId).toBe(
      "gameDispatch_playerHall",
    );
    expect(document.paths[MINE_PATH]?.get?.operationId).toBe(
      "gameDispatch_playerApplications",
    );
    expect(document.paths[RELEASE_PATH]?.post?.operationId).toBe(
      "gameDispatch_releaseSlot",
    );
    expect(document.paths[BREACH_PATH]?.post?.operationId).toBe(
      "gameDispatch_recordBreach",
    );
  });

  it("报名大厅与我的报名读回形状固定", () => {
    const hall = schemaOf(document.paths[HALL_PATH]?.get, "200");
    const hallItem = hall.properties?.data?.items;
    expect(hallItem?.required).toEqual([
      "orderId",
      "dispatchNo",
      "orderNo",
      "durationMinutes",
      "desiredStartAt",
      "roundClosesAt",
      "lines",
    ]);
    const line = hallItem?.properties?.lines?.items;
    expect(line?.required).toEqual([
      "lineId",
      "positionLabel",
      "requiredCount",
      "appliedCount",
      "myApplicationId",
      "myApplicationStatus",
    ]);
    expect(line?.properties?.appliedCount?.type).toBe("integer");

    const mine = schemaOf(document.paths[MINE_PATH]?.get, "200");
    const mineItem = mine.properties?.data?.items;
    expect(mineItem?.required).toEqual([
      "applicationId",
      "orderId",
      "dispatchNo",
      "orderNo",
      "orderStatus",
      "lineId",
      "positionLabel",
      "status",
      "createdAt",
      "slotId",
      "canWithdraw",
    ]);
    expect(mineItem?.properties?.canWithdraw?.type).toBe("boolean");
    expect(mineItem?.properties?.slotId?.nullable).toBe(true);
  });

  it("释放名额：原因可选；返回带订单状态与重开轮次", () => {
    const body = schemaOf(document.paths[RELEASE_PATH]?.post, "requestBody");
    expect(body.required ?? []).toEqual([]);
    expect(body.properties?.reason?.type).toBe("string");
    expect(body.properties?.reason?.nullable).toBe(true);

    const view = schemaOf(document.paths[RELEASE_PATH]?.post, "201");
    expect(view.properties?.data?.required).toEqual([
      "slotId",
      "orderId",
      "playerId",
      "orderStatus",
      "roundNo",
      "releasedAt",
    ]);
  });

  it("违约记录：playerId 与 reason 必填，档位可选；返回含陪玩与理由", () => {
    const body = schemaOf(document.paths[BREACH_PATH]?.post, "requestBody");
    expect(body.required).toEqual(["playerId", "reason"]);
    expect(body.properties?.playerId?.format).toBe("uuid");
    expect(body.properties?.orderSlotId?.nullable).toBe(true);

    const view = schemaOf(document.paths[BREACH_PATH]?.post, "201");
    expect(view.properties?.data?.required).toEqual([
      "id",
      "playerId",
      "playerName",
      "orderId",
      "orderSlotId",
      "reason",
      "createdAt",
    ]);
  });

  it("生成客户端包含四个 operation", () => {
    for (const fn of [
      "gameDispatchPlayerHall",
      "gameDispatchPlayerApplications",
      "gameDispatchReleaseSlot",
      "gameDispatchRecordBreach",
    ]) {
      expect(sdkSource).toContain(`export const ${fn} =`);
    }
  });

  it("Task 5a：违约台账 operation 与派单详情里的档位 id", () => {
    expect(document.paths[BREACH_LIST_PATH]?.get?.operationId).toBe(
      "gameDispatch_listBreaches",
    );
    const list = schemaOf(document.paths[BREACH_LIST_PATH]?.get, "200");
    const item = list.properties?.data?.items;
    expect(item?.required).toEqual([
      "id",
      "playerId",
      "playerName",
      "orderId",
      "orderSlotId",
      "reason",
      "createdAt",
    ]);
    expect(
      document.paths[BREACH_LIST_PATH]?.get?.parameters?.map((p) => p.name),
    ).toEqual(["orderId", "playerId", "limit"]);
    expect(sdkSource).toContain("export const gameDispatchListBreaches =");

    // 派单详情的报名记录必须带 slotId，商家端才能渲染「释放名额」。
    const detail = schemaOf(document.paths[DISPATCH_DETAIL_PATH]?.get, "200");
    const application =
      detail.properties?.data?.properties?.lines?.items?.properties
        ?.applications?.items;
    expect(application?.properties?.slotId?.nullable).toBe(true);
  });

  it("Task 5b：报名详情与我的报名都带单价（分/小时，不乘时长）", () => {
    // 派单详情的报名记录（老板端 / 商家端共用）：每个人的单价可空、整数分字符串。
    const detail = schemaOf(document.paths[DISPATCH_DETAIL_PATH]?.get, "200");
    const application =
      detail.properties?.data?.properties?.lines?.items?.properties
        ?.applications?.items;
    expect(application?.properties?.unitPriceFen?.type).toBe("string");
    expect(application?.properties?.unitPriceFen?.pattern).toBe(
      "^(?:0|[1-9][0-9]*)$",
    );
    expect(application?.properties?.unitPriceFen?.nullable).toBe(true);

    // 陪玩端：大厅（我的单价）与我的报名（同一数字）。
    const hall = schemaOf(document.paths[HALL_PATH]?.get, "200");
    expect(
      hall.properties?.data?.items?.properties?.unitPriceFen?.nullable,
    ).toBe(true);
    const mine = schemaOf(document.paths[MINE_PATH]?.get, "200");
    expect(
      mine.properties?.data?.items?.properties?.unitPriceFen?.nullable,
    ).toBe(true);
  });

  it("Task 5b-2(A)：派单详情带费用口径，抽成未落地时为 null 且 splitApplied=false", () => {
    const detail = schemaOf(document.paths[DISPATCH_DETAIL_PATH]?.get, "200");
    const settlement = detail.properties?.data?.properties?.settlement;
    expect(settlement?.required).toEqual([
      "orderAmountFen",
      "playerShareFen",
      "storeProfitFen",
      "storeCutFen",
      "platformFeeFen",
      "splitApplied",
      "approvedSlotCount",
      "activeSlotCount",
    ]);
    // 金额一律字符串分；抽成/平台费可空（未分账），用 flag 明示而不是编数。
    expect(settlement?.properties?.orderAmountFen?.type).toBe("string");
    expect(settlement?.properties?.playerShareFen?.pattern).toBe(
      "^(?:0|[1-9][0-9]*)$",
    );
    expect(settlement?.properties?.storeCutFen?.nullable).toBe(true);
    expect(settlement?.properties?.platformFeeFen?.nullable).toBe(true);
    expect(settlement?.properties?.splitApplied?.type).toBe("boolean");
    expect(settlement?.properties?.approvedSlotCount?.type).toBe("integer");
  });
});
