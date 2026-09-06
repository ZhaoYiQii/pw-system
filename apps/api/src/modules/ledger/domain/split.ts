export interface SplitBps {
  platformFeeBp: number;
  storeCutBp: number;
}

export interface SplitResult {
  platformFeeFen: number;
  storeCutFen: number;
  playerShareFen: number;
}

const BP = 10000;

/**
 * 分成公式（bp 基点：3%=300、20%=2000，均以应付金额为基数）。
 * platform + store ≤ 10000；陪玩到手 = 剩余（尾差归陪玩），保证总和 = amount。
 */
export function splitSettlement(amountFen: number, rates: SplitBps): SplitResult {
  if (!Number.isSafeInteger(amountFen) || amountFen <= 0) throw new Error("amountFen 必须为正整数（分）");
  if (
    !Number.isInteger(rates.platformFeeBp) ||
    !Number.isInteger(rates.storeCutBp) ||
    rates.platformFeeBp < 0 ||
    rates.storeCutBp < 0 ||
    rates.platformFeeBp + rates.storeCutBp > BP
  ) {
    throw new Error("费率非法：需非负整数 bp，且 platform+store ≤ 10000");
  }
  const platformFeeFen = Math.floor((amountFen * rates.platformFeeBp) / BP);
  const storeCutFen = Math.floor((amountFen * rates.storeCutBp) / BP);
  const playerShareFen = amountFen - platformFeeFen - storeCutFen;
  return { platformFeeFen, storeCutFen, playerShareFen };
}