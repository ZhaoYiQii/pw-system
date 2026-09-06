import { describe, expect, it } from "vitest";
import { inspectRuntime } from "./index.js";

describe("worker runtime (Slice 0 skeleton)", () => {
  it("reports queue as typed unsupported until a later slice", () => {
    expect(inspectRuntime()).toEqual({
      queue: { ready: false, reason: "QUEUE_NOT_CONFIGURED_IN_SLICE_0" },
    });
  });
});
