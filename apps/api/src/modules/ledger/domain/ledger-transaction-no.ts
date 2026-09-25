import { randomUUID } from "node:crypto";

/**
 * Ledger transaction numbers are tenant-unique business references, not a
 * timestamp. A timestamp alone can collide when multiple orders are accounted
 * in the same millisecond.
 */
export function buildLedgerTransactionNo(): string {
  return `LT${randomUUID().replaceAll("-", "").toUpperCase()}`;
}
