import { Logger } from "@nestjs/common";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PublishedConfigV2 } from "../domain/game-template-config-v2.js";
import type {
  CreateTemplateOrderCommand,
  GameDispatchTemplateOrderRepository,
} from "./game-dispatch-template-order.service.js";
import { GameDispatchTemplateOrderService } from "./game-dispatch-template-order.service.js";

/** 一个分组未标记、含 CS 专属字段与 CUSTOMER 专属必填字段的发布配置。 */
function audienceConfig(): PublishedConfigV2 {
  return {
    schemaVersion: 2,
    documentRendererVersion: 1,
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
        stableKey: "region",
        sectionKey: "basic",
        label: "区服",
        enabled: true,
        sortOrder: 0,
        layout: { colSpan: 1, rowBreakBefore: false },
        fieldType: "TEXT",
        semanticRole: "SERVER_REGION",
        required: true,
      },
      {
        kind: "FIELD",
        stableKey: "internal_note",
        sectionKey: "basic",
        label: "内部备注",
        enabled: true,
        sortOrder: 1,
        layout: { colSpan: 1, rowBreakBefore: false },
        fieldType: "TEXT",
        semanticRole: "CUSTOM",
        required: false,
        audiences: ["CS"],
      },
      {
        kind: "FIELD",
        stableKey: "customer_note",
        sectionKey: "basic",
        label: "客户备注",
        enabled: true,
        sortOrder: 2,
        layout: { colSpan: 1, rowBreakBefore: false },
        fieldType: "TEXTAREA",
        semanticRole: "ORDER_NOTE",
        required: true,
        audiences: ["CUSTOMER"],
      },
    ],
    staffingSource: { kind: "FIXED", count: 1 },
  };
}

/** 假仓储：只把领域回调跑一遍，把草稿原样交回应用层，便于观察旁路事件。 */
function fakeRepository(
  config: PublishedConfigV2,
): GameDispatchTemplateOrderRepository {
  return {
    createFromPublishedVersion: async (
      command: CreateTemplateOrderCommand,
      buildDraft,
    ) => {
      const outcome = buildDraft(config, command.input.values);
      return {
        duplicate: false,
        result: {
          orderId: "order-1",
          dispatchOrderId: "dispatch-1",
          templateVersionId: command.input.templateVersionId,
          staffingSummary: outcome.draft.staffing,
          priceAdjustmentFen: outcome.draft.priceAdjustmentFen,
          document: outcome.draft.document,
        },
      };
    },
  };
}

const INPUT_VALUES = {
  region: "艾欧尼亚",
  internal_note: "客服备注",
  customer_note: "客户备注",
};

function input(values: Record<string, unknown>) {
  return {
    gameId: "00000000-0000-4000-8000-000000000001",
    templateId: "00000000-0000-4000-8000-000000000002",
    templateVersionId: "00000000-0000-4000-8000-000000000003",
    customerProfileId: "00000000-0000-4000-8000-000000000004",
    values,
  };
}

/** 采集受控事件：默认 sink 走 Nest Logger，这里拦住它的输出。 */
function captureEvents(): { lines: string[] } {
  const lines: string[] = [];
  vi.spyOn(Logger.prototype, "log").mockImplementation((line: unknown) => {
    lines.push(typeof line === "string" ? line : JSON.stringify(line));
  });
  return { lines };
}

describe("GameDispatchTemplateOrderService：写入侧端口过滤的受控事件", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("丢弃了不可见字段的值时，发一条只含条数的受控事件", async () => {
    const { lines } = captureEvents();
    const service = new GameDispatchTemplateOrderService(
      fakeRepository(audienceConfig()),
    );

    const output = await service.create(
      "tenant-1",
      "actor-1",
      "idem-key-1",
      input(INPUT_VALUES),
      "CS",
    );

    expect(output.duplicate).toBe(false);
    const event = lines.find((line) =>
      line.includes("template.field_values_dropped"),
    );
    expect(event).toBeTruthy();
    expect(JSON.parse(event as string)).toMatchObject({
      event: "template.field_values_dropped",
      tenantId: "tenant-1",
      count: 1,
      outcome: "ok",
    });
    // 事件里不能出现被丢弃的键或值。
    expect(event).not.toContain("customer_note");
    expect(event).not.toContain("客户备注");
  });

  it("没有字段被丢弃时不发这条事件", async () => {
    const { lines } = captureEvents();
    const service = new GameDispatchTemplateOrderService(
      fakeRepository(audienceConfig()),
    );

    await service.create(
      "tenant-1",
      "actor-1",
      "idem-key-2",
      input({ region: "艾欧尼亚", internal_note: "客服备注" }),
      "CS",
    );

    expect(
      lines.some((line) => line.includes("template.field_values_dropped")),
    ).toBe(false);
  });
});
