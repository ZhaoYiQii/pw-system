import type { PrismaClient } from "@pw/database";
import type {
  GameView,
  PricingRuleView,
  ProductView,
  RegionView,
} from "../domain/catalog.js";
import {
  CatalogInUseError,
  DuplicateCatalogEntryError,
} from "../domain/errors.js";
import type { CatalogRepository } from "../application/catalog.service.js";
import type { MoneyFen } from "../../../common/money.js";

function isP2002(error: unknown): boolean {
  return (
    error !== null &&
    typeof error === "object" &&
    "code" in error &&
    (error as { code?: string }).code === "P2002"
  );
}

function isP2003(error: unknown): boolean {
  return (
    error !== null &&
    typeof error === "object" &&
    "code" in error &&
    (error as { code?: string }).code === "P2003"
  );
}

interface PlainGame {
  id: string;
  tenantId: string;
  name: string;
  enabled: boolean;
  createdAt: Date;
  updatedAt: Date;
}

interface PlainRegion {
  id: string;
  tenantId: string;
  gameId: string;
  name: string;
  enabled: boolean;
  createdAt: Date;
  updatedAt: Date;
}

interface PlainProduct {
  id: string;
  tenantId: string;
  gameId: string;
  gameRegionId: string | null;
  name: string;
  description: string | null;
  enabled: boolean;
  createdAt: Date;
  updatedAt: Date;
}

function mapGame(row: PlainGame): GameView {
  return {
    id: row.id,
    tenantId: row.tenantId,
    name: row.name,
    enabled: row.enabled,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function mapRegion(row: PlainRegion): RegionView {
  return {
    id: row.id,
    tenantId: row.tenantId,
    gameId: row.gameId,
    name: row.name,
    enabled: row.enabled,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function mapRule(row: {
  id: string;
  tenantId: string;
  serviceProductId: string;
  durationSeconds: number;
  priceFen: bigint;
  playerCostFen: bigint;
  enabled: boolean;
  createdAt: Date;
  updatedAt: Date;
}): PricingRuleView {
  return {
    id: row.id,
    tenantId: row.tenantId,
    serviceProductId: row.serviceProductId,
    durationSeconds: row.durationSeconds,
    priceFen: row.priceFen.toString(),
    playerCostFen: row.playerCostFen.toString(),
    enabled: row.enabled,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

async function enrichProducts(
  client: PrismaClient,
  rows: PlainProduct[],
): Promise<ProductView[]> {
  if (rows.length === 0) return [];
  const gameIds = Array.from(new Set(rows.map((r) => r.gameId)));
  const regionIds = Array.from(
    new Set(
      rows
        .filter((r) => r.gameRegionId !== null)
        .map((r) => r.gameRegionId as string),
    ),
  );
  const games = await client.game.findMany({
    where: { id: { in: gameIds } },
    select: { id: true, name: true },
  });
  const regions =
    regionIds.length > 0
      ? await client.gameRegion.findMany({
          where: { id: { in: regionIds } },
          select: { id: true, name: true },
        })
      : [];
  const gameName = new Map(games.map((g) => [g.id, g.name]));
  const regionName = new Map(regions.map((r) => [r.id, r.name]));
  return rows.map((r) => ({
    id: r.id,
    tenantId: r.tenantId,
    gameId: r.gameId,
    gameRegionId: r.gameRegionId,
    name: r.name,
    description: r.description,
    enabled: r.enabled,
    gameName: gameName.get(r.gameId) ?? "",
    regionName: r.gameRegionId
      ? (regionName.get(r.gameRegionId) ?? null)
      : null,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  }));
}

export class PrismaCatalogRepository implements CatalogRepository {
  constructor(private readonly client: PrismaClient) {}

  // ===== games =====
  async listGames(tenantId: string, enabled?: boolean): Promise<GameView[]> {
    const rows = await this.client.game.findMany({
      where: { tenantId, ...(enabled !== undefined ? { enabled } : {}) },
      orderBy: { createdAt: "asc" },
    });
    return rows.map(mapGame);
  }

  async findGame(tenantId: string, id: string): Promise<GameView | null> {
    const row = await this.client.game.findFirst({ where: { tenantId, id } });
    return row ? mapGame(row) : null;
  }

  async createGame(tenantId: string, name: string): Promise<GameView> {
    try {
      return mapGame(
        await this.client.game.create({ data: { tenantId, name } }),
      );
    } catch (error) {
      if (isP2002(error))
        throw new DuplicateCatalogEntryError(`game 已存在：${name}`);
      throw error;
    }
  }

  async updateGame(
    tenantId: string,
    id: string,
    input: { name?: string; enabled?: boolean },
  ): Promise<GameView | null> {
    try {
      const res = await this.client.game.updateMany({
        where: { tenantId, id },
        data: {
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
        },
      });
      if (res.count === 0) return null;
      return this.findGame(tenantId, id);
    } catch (error) {
      if (isP2002(error)) throw new DuplicateCatalogEntryError("game 重名");
      throw error;
    }
  }

  async removeGame(tenantId: string, id: string): Promise<boolean> {
    try {
      const res = await this.client.game.deleteMany({
        where: { tenantId, id },
      });
      return res.count > 0;
    } catch (error) {
      if (isP2003(error)) throw new CatalogInUseError("game", id);
      throw error;
    }
  }

  // ===== regions =====
  async listRegions(
    tenantId: string,
    gameId?: string,
    enabled?: boolean,
  ): Promise<RegionView[]> {
    const rows = await this.client.gameRegion.findMany({
      where: {
        tenantId,
        ...(gameId ? { gameId } : {}),
        ...(enabled !== undefined ? { enabled } : {}),
      },
      orderBy: [{ gameId: "asc" }, { name: "asc" }],
    });
    return rows.map(mapRegion);
  }

  async createRegion(
    tenantId: string,
    gameId: string,
    name: string,
  ): Promise<RegionView> {
    try {
      return mapRegion(
        await this.client.gameRegion.create({
          data: { tenantId, gameId, name },
        }),
      );
    } catch (error) {
      if (isP2002(error))
        throw new DuplicateCatalogEntryError(`区服已存在：${name}`);
      if (isP2003(error)) throw new CatalogInUseError("game", gameId);
      throw error;
    }
  }

  async updateRegion(
    tenantId: string,
    id: string,
    input: { name?: string; enabled?: boolean },
  ): Promise<RegionView | null> {
    try {
      const res = await this.client.gameRegion.updateMany({
        where: { tenantId, id },
        data: {
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
        },
      });
      if (res.count === 0) return null;
      const row = await this.client.gameRegion.findFirst({
        where: { tenantId, id },
      });
      return row ? mapRegion(row) : null;
    } catch (error) {
      if (isP2002(error)) throw new DuplicateCatalogEntryError("区服重名");
      throw error;
    }
  }

  async removeRegion(tenantId: string, id: string): Promise<boolean> {
    try {
      const res = await this.client.gameRegion.deleteMany({
        where: { tenantId, id },
      });
      return res.count > 0;
    } catch (error) {
      if (isP2003(error)) throw new CatalogInUseError("region", id);
      throw error;
    }
  }

  // ===== products =====
  async listProducts(
    tenantId: string,
    opts: { gameId?: string; enabled?: boolean },
  ): Promise<ProductView[]> {
    const where: Record<string, unknown> = { tenantId };
    if (opts.gameId) where.gameId = opts.gameId;
    if (opts.enabled !== undefined) where.enabled = opts.enabled;
    const rows = await this.client.serviceProduct.findMany({
      where,
      orderBy: { createdAt: "asc" },
    });
    return enrichProducts(this.client, rows);
  }

  async findProduct(tenantId: string, id: string): Promise<ProductView | null> {
    const row = await this.client.serviceProduct.findFirst({
      where: { tenantId, id },
    });
    if (!row) return null;
    const views = await enrichProducts(this.client, [row]);
    return views[0] as ProductView;
  }

  async createProduct(
    tenantId: string,
    input: {
      gameId: string;
      gameRegionId?: string | null;
      name: string;
      description?: string | null;
    },
  ): Promise<ProductView> {
    try {
      const row = await this.client.serviceProduct.create({
        data: {
          tenantId,
          gameId: input.gameId,
          ...(input.gameRegionId ? { gameRegionId: input.gameRegionId } : {}),
          name: input.name,
          ...(input.description ? { description: input.description } : {}),
        },
      });
      const views = await enrichProducts(this.client, [row]);
      return views[0] as ProductView;
    } catch (error) {
      if (isP2002(error))
        throw new DuplicateCatalogEntryError("同名产品已存在");
      if (isP2003(error))
        throw new CatalogInUseError("game/region", input.gameId);
      throw error;
    }
  }

  async updateProduct(
    tenantId: string,
    id: string,
    input: {
      name?: string;
      description?: string | null;
      enabled?: boolean;
      gameRegionId?: string | null;
    },
  ): Promise<ProductView | null> {
    try {
      const res = await this.client.serviceProduct.updateMany({
        where: { tenantId, id },
        data: {
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.description !== undefined
            ? { description: input.description }
            : {}),
          ...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
          ...(input.gameRegionId !== undefined
            ? { gameRegionId: input.gameRegionId }
            : {}),
        },
      });
      if (res.count === 0) return null;
      return this.findProduct(tenantId, id);
    } catch (error) {
      if (isP2002(error))
        throw new DuplicateCatalogEntryError("同名产品已存在");
      if (isP2003(error)) throw new CatalogInUseError("region", id);
      throw error;
    }
  }

  async removeProduct(tenantId: string, id: string): Promise<boolean> {
    try {
      const res = await this.client.serviceProduct.deleteMany({
        where: { tenantId, id },
      });
      return res.count > 0;
    } catch (error) {
      if (isP2003(error)) throw new CatalogInUseError("product", id);
      throw error;
    }
  }

  // ===== pricing rules =====
  async listRules(
    tenantId: string,
    productId?: string,
  ): Promise<PricingRuleView[]> {
    const rows = await this.client.pricingRule.findMany({
      where: {
        tenantId,
        ...(productId ? { serviceProductId: productId } : {}),
      },
      orderBy: { durationSeconds: "asc" },
    });
    return rows.map(mapRule);
  }

  async createRule(
    tenantId: string,
    productId: string,
    input: {
      durationSeconds: number;
      priceFen: MoneyFen;
      playerCostFen: MoneyFen;
      enabled: boolean;
    },
  ): Promise<PricingRuleView> {
    try {
      const row = await this.client.pricingRule.create({
        data: {
          tenantId,
          serviceProductId: productId,
          durationSeconds: input.durationSeconds,
          priceFen: BigInt(input.priceFen),
          playerCostFen: BigInt(input.playerCostFen),
          enabled: input.enabled,
        },
      });
      return mapRule(row);
    } catch (error) {
      if (isP2002(error))
        throw new DuplicateCatalogEntryError("该时长价格已存在");
      if (isP2003(error)) throw new CatalogInUseError("product", productId);
      throw error;
    }
  }

  async updateRule(
    tenantId: string,
    id: string,
    input: {
      durationSeconds?: number;
      priceFen?: MoneyFen;
      playerCostFen?: MoneyFen;
      enabled?: boolean;
    },
  ): Promise<PricingRuleView | null> {
    try {
      const res = await this.client.pricingRule.updateMany({
        where: { tenantId, id },
        data: {
          ...(input.durationSeconds !== undefined
            ? { durationSeconds: input.durationSeconds }
            : {}),
          ...(input.priceFen !== undefined
            ? { priceFen: BigInt(input.priceFen) }
            : {}),
          ...(input.playerCostFen !== undefined
            ? { playerCostFen: BigInt(input.playerCostFen) }
            : {}),
          ...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
        },
      });
      if (res.count === 0) return null;
      const row = await this.client.pricingRule.findFirst({
        where: { tenantId, id },
      });
      return row ? mapRule(row) : null;
    } catch (error) {
      if (isP2002(error))
        throw new DuplicateCatalogEntryError("该时长价格已存在");
      throw error;
    }
  }

  async removeRule(tenantId: string, id: string): Promise<boolean> {
    const res = await this.client.pricingRule.deleteMany({
      where: { tenantId, id },
    });
    return res.count > 0;
  }
}
