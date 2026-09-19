import { parseFenString, type MoneyFen } from "../../../common/money.js";

/** 规则库里的单条加价：命中键为「模板字段 stableKey + 选项值」，例如 `mode=ranked`。 */
export interface PricingRuleItem {
  dimensionKey: string;
  amountFen: MoneyFen;
}

export interface ResolveUnitPriceInput {
  /** 陪玩×游戏底价（分/小时）；为空表示该陪玩在这个游戏没有专属底价。 */
  gameBaseFen: MoneyFen | null;
  /** 陪玩级兜底底价（分/小时）；为空表示也没有兜底。 */
  fallbackBaseFen: MoneyFen | null;
  /** 本次订单命中的维度键（来自模板取值，如 `mode=ranked`、`rank=钻石`）。 */
  dimensionKeys: readonly string[];
  /** 该游戏的加价规则项。 */
  ruleItems: readonly PricingRuleItem[];
}

/**
 * 单价 = 底价(陪玩×游戏，缺省用陪玩级兜底) + Σ 命中维度键的加价。
 *
 * - 底价与兜底都缺失时返回 `null`：调用方据此给出明确业务错误，禁止静默按 0 计（规格 §6）。
 * - 金额一律整数分（bigint 运算），非法金额直接抛错，不做取整或截断。
 * - 本版只有加价（`SURCHARGE`）：固定价（`FIXED`）是后续独立立项，不在此函数内分支。
 */
export function resolveUnitPriceFen(
  input: ResolveUnitPriceInput,
): MoneyFen | null {
  const base = pickBaseFen(input.gameBaseFen, input.fallbackBaseFen);
  if (base === null) return null;

  const hitKeys = new Set(input.dimensionKeys);
  let total = base;
  for (const item of input.ruleItems) {
    if (!hitKeys.has(item.dimensionKey)) continue;
    total += fenOf(item.amountFen, `ruleItems.${item.dimensionKey}`);
  }
  return total.toString();
}

function pickBaseFen(
  gameBaseFen: MoneyFen | null,
  fallbackBaseFen: MoneyFen | null,
): bigint | null {
  if (gameBaseFen !== null) {
    return fenOf(gameBaseFen, "gameBaseFen");
  }
  if (fallbackBaseFen !== null) {
    return fenOf(fallbackBaseFen, "fallbackBaseFen");
  }
  return null;
}

/** 非负整数十进制字符串（分）→ bigint；非法值直接抛错。 */
function fenOf(value: MoneyFen, field: string): bigint {
  const parsed = parseFenString(value, true);
  if (parsed === null) {
    throw new Error(`${field} 必须为非负整数分字符串`);
  }
  return BigInt(parsed);
}
