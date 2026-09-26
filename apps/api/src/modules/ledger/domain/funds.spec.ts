import { describe, expect, it } from "vitest";
import { assertBalancedFundEntries, type FundEntryDraft } from "./funds.js";

describe("business funds ledger", () => {
  const balanced: FundEntryDraft[] = [
    { direction: "DEBIT", amountFen: 12_800n },
    { direction: "CREDIT", amountFen: 12_800n },
  ];

  it("accepts a positive, balanced transaction", () => {
    expect(() => assertBalancedFundEntries(balanced)).not.toThrow();
  });

  it("rejects an unbalanced transaction before it can be written", () => {
    expect(() =>
      assertBalancedFundEntries([
        { direction: "DEBIT", amountFen: 12_800n },
        { direction: "CREDIT", amountFen: 12_799n },
      ]),
    ).toThrow("ledger entries are not balanced");
  });

  it("rejects a zero-value entry", () => {
    expect(() =>
      assertBalancedFundEntries([
        { direction: "DEBIT", amountFen: 12_800n },
        { direction: "CREDIT", amountFen: 0n },
      ]),
    ).toThrow("ledger entry amount must be positive");
  });
});
