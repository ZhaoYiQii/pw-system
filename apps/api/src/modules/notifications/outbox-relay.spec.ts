import { describe, expect, it } from "vitest";
import { outboxRetryDelayMs } from "./outbox.relay.js";

describe("outbox retry backoff", () => {
  it("按 attempt 指数退避并封顶 5 分钟", () => {
    expect(outboxRetryDelayMs(1)).toBe(5_000);
    expect(outboxRetryDelayMs(2)).toBe(10_000);
    expect(outboxRetryDelayMs(3)).toBe(20_000);
    expect(outboxRetryDelayMs(10)).toBe(300_000);
  });
});
