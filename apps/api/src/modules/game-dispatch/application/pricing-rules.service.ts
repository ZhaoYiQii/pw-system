/**
 * 算价模型（ADR-0003）：按游戏的加价规则库与陪玩×游戏底价的写入口。
 *
 * 边界（设计规格 §3.1–§3.2 / §6）：
 * - 命中键是**通用维度键**：`<模板字段 stableKey>=<选项值>`，如 `mode=ranked`、`rank=钻石`；
 * - 本版只接受 `SURCHARGE`（加价）；`FIXED`（固定价）保留类型位，写入时明确拒绝；
 * - 金额一律非负整数分字符串，禁止浮点；
 * - 游戏与陪玩必须属于当前租户（否则 404）；租户过滤由租户事务 + RLS 双重保证。
 */
import { parseFenString } from "../../../common/money.js";
import {
  DispatchInputError,
  DispatchNotFoundError,
} from "../domain/dispatch-errors.js";
import type {
  GamePricingRuleItemKind,
  GamePricingRuleView,
  PlayerGamePriceView,
} from "../infrastructure/prisma-game-pricing.repository.js";
import { PrismaGamePricingRepository } from "../infrastructure/prisma-game-pricing.repository.js";

export interface GamePricingRuleItemInput {
  kind?: string;
  dimensionKey: string;
  amountFen: string;
  sortOrder?: number;
}

export interface SaveGamePricingRuleInput {
  enabled?: boolean;
  items: readonly GamePricingRuleItemInput[];
}

export interface SavePlayerGamePriceInput {
  basePricePerHourFen: string;
  status?: string;
}

const MAX_RULE_ITEMS = 200;
/** 命中键 = `<字段标识>=<选项值>`；字段标识与模板 stableKey 同规则（首个字符为字母）。 */
const DIMENSION_KEY_PATTERN = /^[a-z][a-z0-9_]{0,63}=[^=\s].*$/;
/**
 * 路径参数里的 uuid 先自己校验：非法 uuid 直接按「不存在」拒绝，
 * 不让它落到 Postgres 变成 22P02（那会变成 500 而不是 404）。
 */
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class PricingRulesService {
  constructor(private readonly repository: PrismaGamePricingRepository) {}

  async getGameRule(
    tenantId: string,
    gameId: string,
  ): Promise<GamePricingRuleView> {
    await this.assertGame(tenantId, gameId);
    return this.repository.getGameRule(tenantId, gameId);
  }

  /** PUT 语义：整表替换该游戏的加价规则；未提供的 `enabled` 视为启用。 */
  async saveGameRule(
    tenantId: string,
    actorId: string,
    gameId: string,
    input: SaveGamePricingRuleInput,
  ): Promise<GamePricingRuleView> {
    await this.assertGame(tenantId, gameId);
    return this.repository.replaceGameRule(tenantId, actorId, gameId, {
      enabled: input.enabled ?? true,
      items: this.cleanRuleItems(input.items),
    });
  }

  async getPlayerGamePrice(
    tenantId: string,
    playerId: string,
    gameId: string,
  ): Promise<PlayerGamePriceView> {
    await this.assertPlayer(tenantId, playerId);
    await this.assertGame(tenantId, gameId);
    return this.repository.getPlayerGamePrice(tenantId, playerId, gameId);
  }

  async savePlayerGamePrice(
    tenantId: string,
    actorId: string,
    playerId: string,
    gameId: string,
    input: SavePlayerGamePriceInput,
  ): Promise<PlayerGamePriceView> {
    await this.assertPlayer(tenantId, playerId);
    await this.assertGame(tenantId, gameId);
    const basePricePerHourFen = parseFenString(input.basePricePerHourFen, true);
    if (basePricePerHourFen === null) {
      throw new DispatchInputError("底价必须为非负整数分字符串（分/小时）");
    }
    const status = this.cleanStatus(input.status);
    return this.repository.upsertPlayerGamePrice(
      tenantId,
      actorId,
      playerId,
      gameId,
      { basePricePerHourFen, status },
    );
  }

  private cleanStatus(value: string | undefined): "ACTIVE" | "INACTIVE" {
    if (value === undefined || value === "ACTIVE") return "ACTIVE";
    if (value === "INACTIVE") return "INACTIVE";
    throw new DispatchInputError("底价状态只能为 ACTIVE 或 INACTIVE");
  }

  private cleanRuleItems(items: readonly GamePricingRuleItemInput[]): {
    kind: GamePricingRuleItemKind;
    dimensionKey: string;
    amountFen: string;
    sortOrder: number;
  }[] {
    if (!Array.isArray(items)) {
      throw new DispatchInputError("规则项必须为数组");
    }
    if (items.length > MAX_RULE_ITEMS) {
      throw new DispatchInputError(`规则项不能超过 ${MAX_RULE_ITEMS} 条`);
    }
    const seen = new Set<string>();
    return items.map((item, index) => {
      const dimensionKey =
        typeof item?.dimensionKey === "string" ? item.dimensionKey.trim() : "";
      if (!DIMENSION_KEY_PATTERN.test(dimensionKey)) {
        throw new DispatchInputError(
          `命中键「${dimensionKey || "(空)"}」需为「字段标识=选项值」，如 mode=ranked`,
        );
      }
      if (seen.has(dimensionKey)) {
        throw new DispatchInputError(`命中键重复：${dimensionKey}`);
      }
      seen.add(dimensionKey);

      const kind = item.kind ?? "SURCHARGE";
      if (kind !== "SURCHARGE") {
        // 类型位保留（枚举里有 FIXED），但本版不实现固定价：拒绝而非静默接受。
        throw new DispatchInputError(
          `本版只支持加价（SURCHARGE）：${dimensionKey} 的类型 ${kind} 尚未开放`,
        );
      }
      const amountFen = parseFenString(item.amountFen, true);
      if (amountFen === null) {
        throw new DispatchInputError(
          `${dimensionKey} 的加价必须为非负整数分字符串`,
        );
      }
      const sortOrder = item.sortOrder ?? index;
      if (!Number.isInteger(sortOrder) || sortOrder < 0) {
        throw new DispatchInputError(`${dimensionKey} 的排序必须为非负整数`);
      }
      return { kind: "SURCHARGE" as const, dimensionKey, amountFen, sortOrder };
    });
  }

  private async assertGame(tenantId: string, gameId: string): Promise<void> {
    if (!UUID_PATTERN.test(gameId))
      throw new DispatchNotFoundError("游戏不存在");
    if (!(await this.repository.gameExists(tenantId, gameId))) {
      throw new DispatchNotFoundError("游戏不存在");
    }
  }

  private async assertPlayer(
    tenantId: string,
    playerId: string,
  ): Promise<void> {
    if (!UUID_PATTERN.test(playerId)) {
      throw new DispatchNotFoundError("陪玩不存在");
    }
    if (!(await this.repository.playerExists(tenantId, playerId))) {
      throw new DispatchNotFoundError("陪玩不存在");
    }
  }
}
