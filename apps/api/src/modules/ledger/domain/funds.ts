export type FundEntryDirection = "DEBIT" | "CREDIT";

export interface FundEntryDraft {
  direction: FundEntryDirection;
  amountFen: bigint;
}

/** Guards the invariant that every confirmed business-fund transaction balances. */
export function assertBalancedFundEntries(
  entries: readonly FundEntryDraft[],
): void {
  let debitFen = 0n;
  let creditFen = 0n;

  for (const entry of entries) {
    if (entry.amountFen <= 0n) {
      throw new Error("ledger entry amount must be positive");
    }
    if (entry.direction === "DEBIT") debitFen += entry.amountFen;
    else creditFen += entry.amountFen;
  }

  if (debitFen !== creditFen) {
    throw new Error("ledger entries are not balanced");
  }
}
