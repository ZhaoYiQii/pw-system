import type { GameView, PricingRuleView, ProductView, RegionView } from "../domain/catalog.js";
import { CatalogNotFoundError, DuplicateCatalogEntryError, InvalidCatalogInputError } from "../domain/errors.js";
import type { MoneyFen } from "../../../common/money.js";
import { parseFenString } from "../../../common/money.js";

export interface CatalogRepository {
  listGames(tenantId: string, enabled?: boolean): Promise<GameView[]>;
  findGame(tenantId: string, id: string): Promise<GameView | null>;
  createGame(tenantId: string, name: string): Promise<GameView>;
  updateGame(tenantId: string, id: string, input: { name?: string; enabled?: boolean }): Promise<GameView | null>;
  removeGame(tenantId: string, id: string): Promise<boolean>;

  listRegions(tenantId: string, gameId?: string, enabled?: boolean): Promise<RegionView[]>;
  createRegion(tenantId: string, gameId: string, name: string): Promise<RegionView>;
  updateRegion(tenantId: string, id: string, input: { name?: string; enabled?: boolean }): Promise<RegionView | null>;
  removeRegion(tenantId: string, id: string): Promise<boolean>;

  listProducts(tenantId: string, opts: { gameId?: string; enabled?: boolean }): Promise<ProductView[]>;
  findProduct(tenantId: string, id: string): Promise<ProductView | null>;
  createProduct(tenantId: string, input: { gameId: string; gameRegionId?: string | null; name: string; description?: string | null }): Promise<ProductView>;
  updateProduct(tenantId: string, id: string, input: { name?: string; description?: string | null; enabled?: boolean; gameRegionId?: string | null }): Promise<ProductView | null>;
  removeProduct(tenantId: string, id: string): Promise<boolean>;

  listRules(tenantId: string, productId?: string): Promise<PricingRuleView[]>;
  createRule(tenantId: string, productId: string, input: { durationSeconds: number; priceFen: MoneyFen; playerCostFen: MoneyFen; enabled?: boolean }): Promise<PricingRuleView>;
  updateRule(tenantId: string, id: string, input: { durationSeconds?: number; priceFen?: MoneyFen; playerCostFen?: MoneyFen; enabled?: boolean }): Promise<PricingRuleView | null>;
  removeRule(tenantId: string, id: string): Promise<boolean>;
}

function assertName(value: unknown, label: string, max = 60): string {
  if (typeof value !== "string" || value.trim().length < 1 || value.length > max) {
    throw new InvalidCatalogInputError(`${label} 需为 1-${max} 字符`);
  }
  return value.trim();
}

/** MoneyFen：十进制字符串分；禁止 number/浮点/负数（主规格 10.5/12.1 红测试）。 */
function assertMoneyFen(value: unknown, label: string, allowZero: boolean): MoneyFen {
  const fen = parseFenString(value, allowZero);
  if (fen === null) {
    throw new InvalidCatalogInputError(`${label} 必须为${allowZero ? "非负" : "正"}整数十进制字符串（分）`);
  }
  return fen;
}

/** DurationSeconds：整数秒 > 0。 */
function assertDurationSeconds(value: unknown): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
    throw new InvalidCatalogInputError("durationSeconds 必须为正整数（秒）");
  }
  return value;
}

export class CatalogService {
  constructor(private readonly repository: CatalogRepository) {}

  async listGames(tenantId: string, enabled?: boolean): Promise<GameView[]> {
    return this.repository.listGames(tenantId, enabled);
  }

  async createGame(tenantId: string, name: unknown): Promise<GameView> {
    const clean = assertName(name, "游戏名");
    try {
      return await this.repository.createGame(tenantId, clean);
    } catch (error) {
      if (error instanceof DuplicateCatalogEntryError) throw error;
      throw error;
    }
  }

  async updateGame(tenantId: string, id: string, input: { name?: unknown; enabled?: unknown }): Promise<GameView> {
    const clean: { name?: string; enabled?: boolean } = {};
    if (input.name !== undefined) clean.name = assertName(input.name, "游戏名");
    if (input.enabled !== undefined) {
      if (typeof input.enabled !== "boolean") throw new InvalidCatalogInputError("enabled 需为布尔");
      clean.enabled = input.enabled;
    }
    const row = await this.repository.updateGame(tenantId, id, clean);
    if (!row) throw new CatalogNotFoundError("game", id);
    return row;
  }

  async removeGame(tenantId: string, id: string): Promise<void> {
    const ok = await this.repository.removeGame(tenantId, id);
    if (!ok) throw new CatalogNotFoundError("game", id);
  }

  async listRegions(tenantId: string, gameId?: string, enabled?: boolean): Promise<RegionView[]> {
    if (gameId) {
      const game = await this.repository.findGame(tenantId, gameId);
      if (!game) throw new CatalogNotFoundError("game", gameId);
    }
    return this.repository.listRegions(tenantId, gameId, enabled);
  }

  async createRegion(tenantId: string, gameId: string, name: unknown): Promise<RegionView> {
    const game = await this.repository.findGame(tenantId, gameId);
    if (!game) throw new CatalogNotFoundError("game", gameId);
    try {
      return await this.repository.createRegion(tenantId, gameId, assertName(name, "区服名"));
    } catch (error) {
      if (error instanceof DuplicateCatalogEntryError) throw error;
      throw error;
    }
  }

  async updateRegion(tenantId: string, id: string, input: { name?: unknown; enabled?: unknown }): Promise<RegionView> {
    const clean: { name?: string; enabled?: boolean } = {};
    if (input.name !== undefined) clean.name = assertName(input.name, "区服名");
    if (input.enabled !== undefined) {
      if (typeof input.enabled !== "boolean") throw new InvalidCatalogInputError("enabled 需为布尔");
      clean.enabled = input.enabled;
    }
    const row = await this.repository.updateRegion(tenantId, id, clean);
    if (!row) throw new CatalogNotFoundError("region", id);
    return row;
  }

  async removeRegion(tenantId: string, id: string): Promise<void> {
    const ok = await this.repository.removeRegion(tenantId, id);
    if (!ok) throw new CatalogNotFoundError("region", id);
  }

  async listProducts(tenantId: string, opts: { gameId?: string; enabled?: boolean }): Promise<ProductView[]> {
    if (opts.gameId) {
      const game = await this.repository.findGame(tenantId, opts.gameId);
      if (!game) throw new CatalogNotFoundError("game", opts.gameId);
    }
    const where: { gameId?: string; enabled?: boolean } = {};
    if (opts.gameId) where.gameId = opts.gameId;
    if (opts.enabled !== undefined) where.enabled = opts.enabled;
    return this.repository.listProducts(tenantId, where);
  }

  async createProduct(
    tenantId: string,
    input: { gameId: string; gameRegionId?: string | null; name: unknown; description?: unknown }
  ): Promise<ProductView> {
    const game = await this.repository.findGame(tenantId, input.gameId);
    if (!game) throw new CatalogNotFoundError("game", input.gameId);
    try {
      return await this.repository.createProduct(tenantId, {
        gameId: input.gameId,
        gameRegionId: input.gameRegionId ?? null,
        name: assertName(input.name, "产品名", 80),
        description: typeof input.description === "string" && input.description.trim() ? input.description.trim() : null
      });
    } catch (error) {
      if (error instanceof DuplicateCatalogEntryError) throw error;
      throw error;
    }
  }

  async updateProduct(
    tenantId: string,
    id: string,
    input: { name?: unknown; description?: unknown; enabled?: unknown; gameRegionId?: unknown }
  ): Promise<ProductView> {
    const clean: { name?: string; description?: string | null; enabled?: boolean; gameRegionId?: string | null } = {};
    if (input.name !== undefined) clean.name = assertName(input.name, "产品名", 80);
    if (input.description !== undefined) clean.description = typeof input.description === "string" && input.description.trim() ? input.description.trim() : null;
    if (input.enabled !== undefined) {
      if (typeof input.enabled !== "boolean") throw new InvalidCatalogInputError("enabled 需为布尔");
      clean.enabled = input.enabled;
    }
    if (input.gameRegionId !== undefined) clean.gameRegionId = (input.gameRegionId as string | null) ?? null;
    const row = await this.repository.updateProduct(tenantId, id, clean);
    if (!row) throw new CatalogNotFoundError("product", id);
    return row;
  }

  async removeProduct(tenantId: string, id: string): Promise<void> {
    const ok = await this.repository.removeProduct(tenantId, id);
    if (!ok) throw new CatalogNotFoundError("product", id);
  }

  async listRules(tenantId: string, productId?: string): Promise<PricingRuleView[]> {
    if (productId) {
      const product = await this.repository.findProduct(tenantId, productId);
      if (!product) throw new CatalogNotFoundError("product", productId);
    }
    return this.repository.listRules(tenantId, productId);
  }

  async createRule(
    tenantId: string,
    productId: string,
    input: { durationSeconds: unknown; priceFen: unknown; playerCostFen?: unknown; enabled?: unknown }
  ): Promise<PricingRuleView> {
    const product = await this.repository.findProduct(tenantId, productId);
    if (!product) throw new CatalogNotFoundError("product", productId);
    const cost = input.playerCostFen === undefined ? "0" : assertMoneyFen(input.playerCostFen, "playerCostFen", true);
    try {
      return await this.repository.createRule(tenantId, productId, {
        durationSeconds: assertDurationSeconds(input.durationSeconds),
        priceFen: assertMoneyFen(input.priceFen, "priceFen", false),
        playerCostFen: cost,
        enabled: input.enabled === undefined ? true : input.enabled === true
      });
    } catch (error) {
      if (error instanceof DuplicateCatalogEntryError) throw error;
      throw error;
    }
  }

  async updateRule(
    tenantId: string,
    id: string,
    input: { durationSeconds?: unknown; priceFen?: unknown; playerCostFen?: unknown; enabled?: unknown }
  ): Promise<PricingRuleView> {
    const clean: { durationSeconds?: number; priceFen?: MoneyFen; playerCostFen?: MoneyFen; enabled?: boolean } = {};
    if (input.durationSeconds !== undefined) clean.durationSeconds = assertDurationSeconds(input.durationSeconds);
    if (input.priceFen !== undefined) clean.priceFen = assertMoneyFen(input.priceFen, "priceFen", false);
    if (input.playerCostFen !== undefined) clean.playerCostFen = assertMoneyFen(input.playerCostFen, "playerCostFen", true);
    if (input.enabled !== undefined) {
      if (typeof input.enabled !== "boolean") throw new InvalidCatalogInputError("enabled 需为布尔");
      clean.enabled = input.enabled;
    }
    const row = await this.repository.updateRule(tenantId, id, clean);
    if (!row) throw new CatalogNotFoundError("pricing_rule", id);
    return row;
  }

  async removeRule(tenantId: string, id: string): Promise<void> {
    const ok = await this.repository.removeRule(tenantId, id);
    if (!ok) throw new CatalogNotFoundError("pricing_rule", id);
  }
}
