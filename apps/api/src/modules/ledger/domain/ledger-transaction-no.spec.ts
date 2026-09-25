import { describe, expect, it } from "vitest";
import { buildLedgerTransactionNo } from "./ledger-transaction-no.js";

describe("ledger transaction number", () => {
  it("does not reuse a number for transactions created in the same millisecond", () => {
    const values = new Set(
      Array.from({ length: 128 }, () => buildLedgerTransactionNo()),
    );

    expect(values).toHaveLength(128);
    expect([...values].every((value) => /^LT[A-F0-9]{32}$/.test(value))).toBe(
      true,
    );
  });
});
