import { describe, expect, it } from "vitest";
import {
  hasStructuredRows,
  orderDocumentCopyPayload,
  orderDocumentSourceLabel,
  type OrderDocumentView,
} from "./order-document";

function document(): OrderDocumentView {
  return {
    schemaVersion: 1,
    rendererVersion: 1,
    rows: [
      { sectionLabel: "需求信息", fieldLabel: "区服", value: "艾欧尼亚" },
      { sectionLabel: "需求信息", fieldLabel: "特殊要求", value: "上分" },
    ],
    plainText: "【需求信息】\n区服：艾欧尼亚",
    generatedFromSnapshotAt: "2026-09-17T00:00:00.000Z",
  };
}

describe("order-document：订单文案面板的取值规则", () => {
  it("有 v2 文案时复制 v2 纯文本", () => {
    expect(orderDocumentCopyPayload(document(), "旧文案")).toBe(
      "【需求信息】\n区服：艾欧尼亚",
    );
  });

  it("旧订单（document 为 null）回退到历史文案", () => {
    expect(orderDocumentCopyPayload(null, "旧文案")).toBe("旧文案");
    expect(orderDocumentCopyPayload(null, "")).toBe("");
  });

  it("v2 文案为空串时也回退，不复制空内容", () => {
    const empty = { ...document(), plainText: "   " };
    expect(orderDocumentCopyPayload(empty, "旧文案")).toBe("旧文案");
  });

  it("结构化行的存在性与来源说明", () => {
    expect(hasStructuredRows(document())).toBe(true);
    expect(hasStructuredRows(null)).toBe(false);
    expect(hasStructuredRows({ ...document(), rows: [] })).toBe(false);
    expect(orderDocumentSourceLabel(document())).toContain("渲染器 v1");
    expect(orderDocumentSourceLabel(null)).toContain("历史订单");
  });
});
