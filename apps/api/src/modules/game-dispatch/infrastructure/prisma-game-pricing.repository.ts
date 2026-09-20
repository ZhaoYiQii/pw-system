/**
 * 算价模型（ADR-0003）持久化：陪玩×游戏底价 + 按游戏绑定的加价规则库。
 *
 * 这里有两类入口，职责不同：
 * - `loadGameRuleItems` / `loadPlayerGameBases` 接收**调用方已有的租户事务客户端**，
 *   供选人计价与模板下单在同一个事务里取价（不另开事务、不放大连接数）；
 * - `PrismaGamePricingRepository` 供规则库读写接口使用，由 `tenantGuarded` 包成租户事务，
 *   所有方法第一个参数都是 tenantId（禁止信任客户端提交的 tenantId）。
 */
import type { DbTransaction, PrismaClient } from "@pw/database";
import type { MoneyFen } from "../../../common/money.js";
import type { PricingRuleItem } from "../domain/game-pricing.js";

/** 读路径可复用的事务客户端：服务内部事务，或租户守护代理注入的 tx。 */
export type PricingClient = PrismaClient | DbTransaction;

export type GamePricingRuleItemKind = "SURCHARGE" | "FIXED";

export interface GamePricingRuleItemView {
  id: string;
  kind: GamePricingRuleItemKind;
  dimensionKey: string;
  amountFen: MoneyFen;
  sortOrder: number;
}

export interface GamePricingRuleView {
  gameId: string;
  enabled: boolean;
  items: GamePricingRuleItemView[];
  /** null 表示这个游戏还没有规则行（未配置 ≠ 已停用）。 */
  updatedAt: string | null;
}

export interface PlayerGamePriceView {
  playerId: string;
  gameId: string;
  /** 该陪玩在该游戏的专属底价；null 表示未设置，计价时回退到陪玩级兜底。 */
  basePricePerHourFen: MoneyFen | null;
  /** 陪玩级兜底底价（PlayerProfile.basePricePerHourFen）；0 按「未设置」对待。 */
  fallbackBasePricePerHourFen: MoneyFen | null;
  status: "ACTIVE" | "INACTIVE" | null;
}

export interface GamePricingRuleWriteInput {
  enabled: boolean;
  items: readonly {
    kind: GamePricingRuleItemKind;
    dimensionKey: string;
    amountFen: MoneyFen;
    sortOrder?: number;
  }[];
}

export interface PlayerGamePriceWriteInput {
  basePricePerHourFen: MoneyFen;
  status: "ACTIVE" | "INACTIVE";
}

/**
 * 计价读路径：某游戏当前生效的加价规则项（只取 `SURCHARGE`，规则行停用即整条忽略）。
 */
export async function loadGameRuleItems(
  client: PricingClient,
  tenantId: string,
  gameId: string,
): Promise<PricingRuleItem[]> {
  const rule = await client.gamePricingRule.findFirst({
    where: { tenantId, gameId, enabled: true },
  });
  if (!rule) return [];
  const items = await client.gamePricingRuleItem.findMany({
    where: { tenantId, ruleId: rule.id, kind: "SURCHARGE" },
    orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
  });
  return items.map((item) => ({
    dimensionKey: item.dimensionKey,
    amountFen: item.amountFen.toString(),
  }));
}

/**
 * 计价读路径：这批陪玩在该游戏的专属底价。
 * 只取 `ACTIVE` 行；没有行的陪玩不在 Map 里，由调用方回退到陪玩级兜底。
 */
export async function loadPlayerGameBases(
  client: PricingClient,
  tenantId: string,
  gameId: string,
  playerIds: readonly string[],
): Promise<Map<string, MoneyFen>> {
  if (playerIds.length === 0) return new Map();
  const rows = await client.playerGamePrice.findMany({
    where: {
      tenantId,
      gameId,
      playerId: { in: [...new Set(playerIds)] },
      status: "ACTIVE",
    },
  });
  return new Map(
    rows.map((row) => [row.playerId, row.basePricePerHourFen.toString()]),
  );
}

export class PrismaGamePricingRepository {
  constructor(private readonly client: PrismaClient) {}

  async gameExists(tenantId: string, gameId: string): Promise<boolean> {
    const row = await this.client.game.findFirst({
      where: { tenantId, id: gameId },
      select: { id: true },
    });
    return row !== null;
  }

  async playerExists(tenantId: string, playerId: string): Promise<boolean> {
    const row = await this.client.playerProfile.findFirst({
      where: { tenantId, id: playerId },
      select: { id: true },
    });
    return row !== null;
  }

  async getGameRule(
    tenantId: string,
    gameId: string,
  ): Promise<GamePricingRuleView> {
    const rule = await this.client.gamePricingRule.findFirst({
      where: { tenantId, gameId },
    });
    if (!rule) return { gameId, enabled: true, items: [], updatedAt: null };
    const items = await this.client.gamePricingRuleItem.findMany({
      where: { tenantId, ruleId: rule.id },
      orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
    });
    return {
      gameId,
      enabled: rule.enabled,
      items: items.map((item) => ({
        id: item.id,
        kind: item.kind,
        dimensionKey: item.dimensionKey,
        amountFen: item.amountFen.toString(),
        sortOrder: item.sortOrder,
      })),
      updatedAt: rule.updatedAt.toISOString(),
    };
  }

  /** PUT 语义：整表替换该游戏的规则项；规则行不存在时创建。 */
  async replaceGameRule(
    tenantId: string,
    actorId: string,
    gameId: string,
    input: GamePricingRuleWriteInput,
  ): Promise<GamePricingRuleView> {
    const rule = await this.client.$transaction(async (tx) => {
      const row = await tx.gamePricingRule.upsert({
        where: { tenantId_gameId: { tenantId, gameId } },
        create: {
          tenantId,
          gameId,
          enabled: input.enabled,
          createdBy: actorId,
          updatedBy: actorId,
        },
        update: {
          enabled: input.enabled,
          updatedBy: actorId,
          version: { increment: 1 },
        },
      });
      await tx.gamePricingRuleItem.deleteMany({
        where: { tenantId, ruleId: row.id },
      });
      if (input.items.length > 0) {
        await tx.gamePricingRuleItem.createMany({
          data: input.items.map((item, index) => ({
            tenantId,
            ruleId: row.id,
            kind: item.kind,
            dimensionKey: item.dimensionKey,
            amountFen: BigInt(item.amountFen),
            sortOrder: item.sortOrder ?? index,
          })),
        });
      }
      await tx.auditLog.create({
        data: {
          tenantId,
          actorType: "tenant_account",
          actorId,
          action: "game_pricing.rule.save",
          resourceType: "game_pricing_rule",
          resourceId: row.id,
          summary: `游戏加价规则：${input.items.length} 条，${input.enabled ? "启用" : "停用"}`,
        },
      });
      return row;
    });
    return {
      gameId,
      enabled: rule.enabled,
      items: await this.listRuleItems(tenantId, rule.id),
      updatedAt: rule.updatedAt.toISOString(),
    };
  }

  private async listRuleItems(
    tenantId: string,
    ruleId: string,
  ): Promise<GamePricingRuleItemView[]> {
    const items = await this.client.gamePricingRuleItem.findMany({
      where: { tenantId, ruleId },
      orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
    });
    return items.map((item) => ({
      id: item.id,
      kind: item.kind,
      dimensionKey: item.dimensionKey,
      amountFen: item.amountFen.toString(),
      sortOrder: item.sortOrder,
    }));
  }

  /** 陪玩×游戏底价现状：包含陪玩级兜底，便于前端显示"未设置时会用哪个价"。 */
  async getPlayerGamePrice(
    tenantId: string,
    playerId: string,
    gameId: string,
  ): Promise<PlayerGamePriceView> {
    const [row, player] = await Promise.all([
      this.client.playerGamePrice.findFirst({
        where: { tenantId, playerId, gameId },
      }),
      this.client.playerProfile.findFirst({
        where: { tenantId, id: playerId },
        select: { basePricePerHourFen: true },
      }),
    ]);
    const fallbackFen = player?.basePricePerHourFen ?? 0n;
    return {
      playerId,
      gameId,
      basePricePerHourFen: row ? row.basePricePerHourFen.toString() : null,
      fallbackBasePricePerHourFen:
        fallbackFen > 0n ? fallbackFen.toString() : null,
      status: row ? (row.status as "ACTIVE" | "INACTIVE") : null,
    };
  }

  async upsertPlayerGamePrice(
    tenantId: string,
    actorId: string,
    playerId: string,
    gameId: string,
    input: PlayerGamePriceWriteInput,
  ): Promise<PlayerGamePriceView> {
    await this.client.$transaction(async (tx) => {
      const row = await tx.playerGamePrice.upsert({
        where: {
          tenantId_playerId_gameId: { tenantId, playerId, gameId },
        },
        create: {
          tenantId,
          playerId,
          gameId,
          basePricePerHourFen: BigInt(input.basePricePerHourFen),
          status: input.status,
          createdBy: actorId,
          updatedBy: actorId,
        },
        update: {
          basePricePerHourFen: BigInt(input.basePricePerHourFen),
          status: input.status,
          updatedBy: actorId,
          version: { increment: 1 },
        },
      });
      await tx.auditLog.create({
        data: {
          tenantId,
          actorType: "tenant_account",
          actorId,
          action: "game_pricing.player_base.save",
          resourceType: "player_game_price",
          resourceId: row.id,
          summary: `陪玩×游戏底价：${input.basePricePerHourFen} 分/小时（${input.status}）`,
        },
      });
    });
    return this.getPlayerGamePrice(tenantId, playerId, gameId);
  }
}
