import { describe, expect, it } from "vitest";
import {
  TEMPLATE_EVENTS,
  emitTemplateEvent,
  toTemplateEventRecord,
  withTemplateTiming,
  type TemplateEventRecord,
} from "./game-template-observability.js";

function collector(): {
  records: TemplateEventRecord[];
  sink: { info: (r: TemplateEventRecord) => void };
} {
  const records: TemplateEventRecord[] = [];
  return { records, sink: { info: (record) => records.push(record) } };
}

describe("game-template-observability：事件白名单与计时", () => {
  it("只保留白名单字段：config、订单值与 PII 一律丢弃", () => {
    const record = toTemplateEventRecord(TEMPLATE_EVENTS.DRAFT_SAVE_FAILED, {
      tenantId: "t-1",
      templateId: "tpl-1",
      code: "TEMPLATE_REVISION_CONFLICT",
      config: { sections: [{ label: "机密配置" }] },
      values: { server: "艾欧尼亚" },
      customerName: "张三",
      mobile: "13800000000",
      message: "含用户输入的长文本".repeat(50),
    });

    expect(record).toEqual({
      event: "template.draft_save_failed",
      tenantId: "t-1",
      templateId: "tpl-1",
      code: "TEMPLATE_REVISION_CONFLICT",
    });
    expect(JSON.stringify(record)).not.toContain("机密配置");
    expect(JSON.stringify(record)).not.toContain("艾欧尼亚");
    expect(JSON.stringify(record)).not.toContain("13800000000");
  });

  it("数字字段只接受有限数字并取整", () => {
    const record = toTemplateEventRecord(TEMPLATE_EVENTS.LIST, {
      durationMs: 12.7,
      count: Number.NaN,
    });
    expect(record.durationMs).toBe(12);
    expect(record.count).toBeUndefined();
  });

  it("计时辅助在成功与失败时都发事件，并保留受控 code", async () => {
    const { records, sink } = collector();

    await withTemplateTiming(
      TEMPLATE_EVENTS.LIST,
      { tenantId: "t-1" },
      async () => "ok",
      sink,
    );
    expect(records[0]).toMatchObject({ event: "template.list", outcome: "ok" });
    expect(typeof records[0]?.durationMs).toBe("number");

    await expect(
      withTemplateTiming(
        TEMPLATE_EVENTS.ORDER_CREATE_FAILED,
        { tenantId: "t-1" },
        async () => {
          throw Object.assign(new Error("boom"), {
            code: "TEMPLATE_ARCHIVED",
          });
        },
        sink,
      ),
    ).rejects.toThrow("boom");
    expect(records[1]).toMatchObject({
      event: "template.order_create_failed",
      outcome: "failed",
      code: "TEMPLATE_ARCHIVED",
    });
  });

  it("sink 抛错不影响业务结果（观测是旁路）", async () => {
    const broken = {
      info: () => {
        throw new Error("sink down");
      },
    };
    expect(() =>
      emitTemplateEvent(TEMPLATE_EVENTS.LIST, { tenantId: "t-1" }, broken),
    ).not.toThrow();
    await expect(
      withTemplateTiming(TEMPLATE_EVENTS.LIST, {}, async () => 42, broken),
    ).resolves.toBe(42);
  });
});
