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

/** 参与维度命中的模板字段：只有落在选项里的取值才形成命中键（设计规格 §3.1）。 */
export interface PricingDimensionField {
  /** 模板字段稳定键（v1 用 fieldKey，v2 用 stableKey）。 */
  key: string;
  /** 该字段的可选项值。 */
  optionValues: readonly string[];
}

export interface PricingDimensionInput {
  fields: readonly PricingDimensionField[];
  /** 订单提交值（v1 是 formValuesJson，v2 是 values）。 */
  values: Readonly<Record<string, unknown>>;
  /**
   * 旧版派单的段位标签：v1 段位规则迁移后以 `rank=<label>` 作为命中键（设计规格 §5）。
   * v2 通用模板没有独立的段位标签，留空即可。
   */
  rankLabel?: string | null;
}

/**
 * 收集本次订单命中的维度键：
 * - 只有落在模板选项里的取值才形成键，选项之外的取值不参与命中（不猜测、不放宽）；
 * - 多选字段按提交顺序逐个形成键，键去重后按字段顺序输出，同一份取值必然得到同一组键；
 * - `rank=<label>` 兼容键对应 v1 段位规则迁移后的命中键（见设计规格 §5）。
 */
export function pricingDimensionKeys(input: PricingDimensionInput): string[] {
  const keys: string[] = [];
  const seen = new Set<string>();
  const push = (key: string): void => {
    if (seen.has(key)) return;
    seen.add(key);
    keys.push(key);
  };

  for (const field of input.fields) {
    const raw = input.values[field.key];
    const selected =
      typeof raw === "string"
        ? [raw]
        : Array.isArray(raw)
          ? raw.filter((value): value is string => typeof value === "string")
          : [];
    for (const value of selected) {
      if (!field.optionValues.includes(value)) continue;
      push(`${field.key}=${value}`);
    }
  }

  const rankLabel =
    typeof input.rankLabel === "string" ? input.rankLabel.trim() : "";
  if (rankLabel.length > 0) push(`rank=${rankLabel}`);
  return keys;
}

/** Σ 命中维度键的加价（本版只有 SURCHARGE；固定价不在本函数内分支）。 */
export function resolveSurchargeFen(
  dimensionKeys: readonly string[],
  ruleItems: readonly PricingRuleItem[],
): MoneyFen {
  const hitKeys = new Set(dimensionKeys);
  let total = 0n;
  for (const item of ruleItems) {
    if (!hitKeys.has(item.dimensionKey)) continue;
    total += fenOf(item.amountFen, `ruleItems.${item.dimensionKey}`);
  }
  return total.toString();
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

  const surcharge = BigInt(
    resolveSurchargeFen(input.dimensionKeys, input.ruleItems),
  );
  return (base + surcharge).toString();
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
