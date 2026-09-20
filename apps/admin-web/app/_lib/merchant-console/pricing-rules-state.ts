/**
 * 算价模型规则库（商家端）纯逻辑：视图行 ↔ 规则库请求体、校验与展示口径。
 *
 * 口径（ADR-0003）：
 * - 命中键是通用维度键 `<模板字段 stableKey>=<选项值>`（如 mode=ranked、rank=钻石）；
 * - 金额一律非负整数分字符串，禁止浮点；界面按「分」输入，另给「元」的等值提示；
 * - 底价优先级：陪玩×游戏专属底价 → 陪玩级兜底 → 未设置（未设置时该陪玩不能接这单）。
 */
import type {
  GamePricingRuleView,
  PlayerGameBaseView,
} from "./pricing-rules-api";

export interface RuleRow {
  kind: "SURCHARGE";
  dimensionKey: string;
  amountFen: string;
}

export interface RuleRowError {
  index: number;
  field: "dimensionKey" | "amountFen";
  message: string;
}

/** 与后端 Zod / 数据库 CHECK 同一形状：字段标识=选项值。 */
export const DIMENSION_KEY_PATTERN = /^[a-z][a-z0-9_]{0,63}=[^=\s].*$/;

export function ruleRowsFromView(view: GamePricingRuleView): RuleRow[] {
  return [...view.items]
    .sort((left, right) => left.sortOrder - right.sortOrder)
    .map((item) => ({
      kind: "SURCHARGE" as const,
      dimensionKey: item.dimensionKey,
      amountFen: item.amountFen,
    }));
}

/** 空串表示还没填（新增行），此时不报错，由保存前的完整性校验兜住。 */
export function parseAmountInput(input: string): string | null {
  const value = input.trim();
  if (!/^(?:0|[1-9][0-9]*)$/.test(value)) return null;
  return value;
}

export function validateRuleRows(rows: readonly RuleRow[]): RuleRowError[] {
  const errors: RuleRowError[] = [];
  const seen = new Set<string>();
  rows.forEach((row, index) => {
    const dimensionKey = row.dimensionKey.trim();
    if (!DIMENSION_KEY_PATTERN.test(dimensionKey)) {
      errors.push({
        index,
        field: "dimensionKey",
        message: "命中键需为「字段标识=选项值」，如 mode=ranked",
      });
    } else if (seen.has(dimensionKey)) {
      errors.push({
        index,
        field: "dimensionKey",
        message: `命中键重复：${dimensionKey}`,
      });
    } else {
      seen.add(dimensionKey);
    }
    if (parseAmountInput(row.amountFen) === null) {
      errors.push({
        index,
        field: "amountFen",
        message: "加价必须为非负整数分（如 1500）",
      });
    }
  });
  return errors;
}

export function toSaveBody(rows: readonly RuleRow[]): {
  items: {
    kind: "SURCHARGE";
    dimensionKey: string;
    amountFen: string;
    sortOrder: number;
  }[];
} {
  return {
    items: rows.map((row, index) => ({
      kind: "SURCHARGE" as const,
      dimensionKey: row.dimensionKey.trim(),
      amountFen: row.amountFen.trim(),
      sortOrder: index,
    })),
  };
}

/** 分 → 元（展示用，整数运算，避免浮点）。1500 → "15.00"。 */
export function fenToYuan(fen: string): string {
  const value = parseAmountInput(fen);
  if (value === null) return "—";
  const cents = BigInt(value);
  const yuan = cents / 100n;
  const rest = (cents % 100n).toString().padStart(2, "0");
  return `${yuan}.${rest}`;
}

export interface PlayerBaseRow {
  playerId: string;
  playerName: string;
  /** 专属底价（分）；null 表示未设置。 */
  basePricePerHourFen: string | null;
  /** 陪玩级兜底（分）；null 表示也没有兜底。 */
  fallbackBasePricePerHourFen: string | null;
  /** 实际生效的单价来源。 */
  source: "GAME" | "FALLBACK" | "NONE";
  status: "ACTIVE" | "INACTIVE" | null;
}

export function playerBaseRow(input: {
  playerId: string;
  playerName: string;
  view: PlayerGameBaseView | null;
}): PlayerBaseRow {
  const view = input.view;
  const gamePrice =
    view && view.status === "ACTIVE" ? view.basePricePerHourFen : null;
  const fallback = view?.fallbackBasePricePerHourFen ?? null;
  const source: PlayerBaseRow["source"] =
    gamePrice !== null ? "GAME" : fallback !== null ? "FALLBACK" : "NONE";
  return {
    playerId: input.playerId,
    playerName: input.playerName,
    basePricePerHourFen: gamePrice,
    fallbackBasePricePerHourFen: fallback,
    source,
    status: view?.status ?? null,
  };
}

export function playerBaseSourceLabel(row: PlayerBaseRow): string {
  if (row.source === "GAME") return "专属底价";
  if (row.source === "FALLBACK") return "陪玩级兜底";
  return "未设置";
}
