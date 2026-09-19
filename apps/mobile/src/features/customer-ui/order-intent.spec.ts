import { describe, expect, it } from "vitest";
import { newIdempotencyKey, orderIntentFor } from "./order-intent";

describe("orderIntentFor：一次提交意图一个幂等键", () => {
  const body = {
    gameId: "g1",
    templateId: "t1",
    templateVersionId: "v1",
    values: { memo: "上分", mode: "ranked" },
  };

  it("请求体不变就复用同一个键（字段顺序变化不算变化）", () => {
    const first = orderIntentFor(null, body, () => "key-1");
    const reordered = orderIntentFor(
      first,
      {
        values: { mode: "ranked", memo: "上分" },
        templateVersionId: "v1",
        templateId: "t1",
        gameId: "g1",
      },
      () => "key-2",
    );

    expect(first.key).toBe("key-1");
    expect(reordered.key).toBe("key-1");
    expect(reordered.signature).toBe(first.signature);
  });

  it("请求体变化就换新键，提交成功后（传 null）也换新键", () => {
    const first = orderIntentFor(null, body, () => "key-1");
    const changed = orderIntentFor(
      first,
      { ...body, values: { memo: "上分", mode: "normal" } },
      () => "key-2",
    );
    const afterSuccess = orderIntentFor(null, body, () => "key-3");

    expect(changed.key).toBe("key-2");
    expect(afterSuccess.key).toBe("key-3");
  });
});

describe("newIdempotencyKey：符合契约长度且不重复", () => {
  it("长度在 8-100 之间", () => {
    const key = newIdempotencyKey();

    expect(key.length).toBeGreaterThanOrEqual(8);
    expect(key.length).toBeLessThanOrEqual(100);
  });

  it("连续生成的键不重复", () => {
    const keys = new Set(Array.from({ length: 50 }, () => newIdempotencyKey()));

    expect(keys.size).toBe(50);
  });
});
