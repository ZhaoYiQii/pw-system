import {
  Body,
  Controller,
  Delete,
  Get,
  HttpException,
  HttpStatus,
  Inject,
  Param,
  Patch,
  Post,
  Query,
  Req,
} from "@nestjs/common";
import { CatalogService } from "../application/catalog.service.js";
import {
  CatalogInUseError,
  CatalogNotFoundError,
  DuplicateCatalogEntryError,
  InvalidCatalogInputError,
} from "../domain/errors.js";
import { Permissions, TenantScope } from "../../../common/auth/decorators.js";
import type { AuthenticatedRequest } from "../../../common/auth/auth.guard.js";
import { ApiBody, ApiCreatedResponse, ApiOkResponse } from "@nestjs/swagger";
import {
  dataArraySchema,
  dataSchema,
  pricingRuleBodySchema,
  pricingRuleSchema,
  updatePricingRuleBodySchema,
} from "../../../openapi/schemas.js";

function tenantIdOf(req: AuthenticatedRequest): string {
  const id = req.principal?.tenantId;
  if (!id)
    throw new HttpException("tenant context missing", HttpStatus.UNAUTHORIZED);
  return id;
}

function optBool(value: unknown): boolean | undefined {
  return typeof value === "string" && (value === "true" || value === "false")
    ? value === "true"
    : undefined;
}

function asOptionalString(value: unknown): string | null | undefined {
  return value === undefined ? undefined : (value as string | null);
}

@Controller("api/v1/tenant/catalog")
export class CatalogController {
  constructor(
    @Inject(CatalogService) private readonly catalog: CatalogService,
  ) {}

  private mapError(error: unknown): never {
    if (error instanceof CatalogNotFoundError)
      throw new HttpException(error.message, HttpStatus.NOT_FOUND);
    if (error instanceof InvalidCatalogInputError)
      throw new HttpException(error.message, HttpStatus.BAD_REQUEST);
    if (
      error instanceof DuplicateCatalogEntryError ||
      error instanceof CatalogInUseError
    ) {
      throw new HttpException(error.message, HttpStatus.CONFLICT);
    }
    throw error;
  }

  // ===== games =====
  @TenantScope()
  @Permissions("catalog.manage")
  @Get("games")
  async listGames(
    @Req() req: AuthenticatedRequest,
    @Query("enabled") enabled?: unknown,
  ) {
    return {
      data: await this.catalog.listGames(tenantIdOf(req), optBool(enabled)),
    };
  }

  @TenantScope()
  @Permissions("catalog.manage")
  @Post("games")
  async createGame(
    @Req() req: AuthenticatedRequest,
    @Body() body: { name?: unknown },
  ) {
    try {
      return {
        data: await this.catalog.createGame(tenantIdOf(req), body.name),
      };
    } catch (error) {
      this.mapError(error);
    }
  }

  @TenantScope()
  @Permissions("catalog.manage")
  @Patch("games/:id")
  async updateGame(
    @Req() req: AuthenticatedRequest,
    @Param("id") id: string,
    @Body() body: { name?: unknown; enabled?: unknown },
  ) {
    try {
      const input: { name?: unknown; enabled?: unknown } = {};
      if (body.name !== undefined) input.name = body.name;
      if (body.enabled !== undefined) input.enabled = body.enabled;
      return {
        data: await this.catalog.updateGame(tenantIdOf(req), id, input),
      };
    } catch (error) {
      this.mapError(error);
    }
  }

  @TenantScope()
  @Permissions("catalog.manage")
  @Delete("games/:id")
  async removeGame(@Req() req: AuthenticatedRequest, @Param("id") id: string) {
    try {
      await this.catalog.removeGame(tenantIdOf(req), id);
      return { data: { ok: true } };
    } catch (error) {
      this.mapError(error);
    }
  }

  // ===== regions =====
  @TenantScope()
  @Permissions("catalog.manage")
  @Get("regions")
  async listRegions(
    @Req() req: AuthenticatedRequest,
    @Query("gameId") gameId?: unknown,
    @Query("enabled") enabled?: unknown,
  ) {
    try {
      const game = typeof gameId === "string" && gameId ? gameId : undefined;
      return {
        data: await this.catalog.listRegions(
          tenantIdOf(req),
          game,
          optBool(enabled),
        ),
      };
    } catch (error) {
      this.mapError(error);
    }
  }

  @TenantScope()
  @Permissions("catalog.manage")
  @Post("games/:gameId/regions")
  async createRegion(
    @Req() req: AuthenticatedRequest,
    @Param("gameId") gameId: string,
    @Body() body: { name?: unknown },
  ) {
    try {
      return {
        data: await this.catalog.createRegion(
          tenantIdOf(req),
          gameId,
          body.name,
        ),
      };
    } catch (error) {
      this.mapError(error);
    }
  }

  @TenantScope()
  @Permissions("catalog.manage")
  @Patch("regions/:id")
  async updateRegion(
    @Req() req: AuthenticatedRequest,
    @Param("id") id: string,
    @Body() body: { name?: unknown; enabled?: unknown },
  ) {
    try {
      const input: { name?: unknown; enabled?: unknown } = {};
      if (body.name !== undefined) input.name = body.name;
      if (body.enabled !== undefined) input.enabled = body.enabled;
      return {
        data: await this.catalog.updateRegion(tenantIdOf(req), id, input),
      };
    } catch (error) {
      this.mapError(error);
    }
  }

  @TenantScope()
  @Permissions("catalog.manage")
  @Delete("regions/:id")
  async removeRegion(
    @Req() req: AuthenticatedRequest,
    @Param("id") id: string,
  ) {
    try {
      await this.catalog.removeRegion(tenantIdOf(req), id);
      return { data: { ok: true } };
    } catch (error) {
      this.mapError(error);
    }
  }

  // ===== products =====
  @TenantScope()
  @Permissions("catalog.manage")
  @Get("products")
  async listProducts(
    @Req() req: AuthenticatedRequest,
    @Query("gameId") gameId?: unknown,
    @Query("enabled") enabled?: unknown,
  ) {
    try {
      const opts: { gameId?: string; enabled?: boolean } = {};
      if (typeof gameId === "string" && gameId) opts.gameId = gameId;
      const e = optBool(enabled);
      if (e !== undefined) opts.enabled = e;
      return { data: await this.catalog.listProducts(tenantIdOf(req), opts) };
    } catch (error) {
      this.mapError(error);
    }
  }

  @TenantScope()
  @Permissions("catalog.manage")
  @Post("products")
  async createProduct(
    @Req() req: AuthenticatedRequest,
    @Body()
    body: {
      gameId?: unknown;
      gameRegionId?: unknown;
      name?: unknown;
      description?: unknown;
    },
  ) {
    try {
      const input: {
        gameId: string;
        gameRegionId?: string | null;
        name: unknown;
        description?: unknown;
      } = {
        gameId: body.gameId as string,
        name: body.name,
      };
      const region = asOptionalString(body.gameRegionId);
      if (region !== undefined) input.gameRegionId = region;
      const desc = asOptionalString(body.description);
      if (desc !== undefined) input.description = desc;
      return { data: await this.catalog.createProduct(tenantIdOf(req), input) };
    } catch (error) {
      this.mapError(error);
    }
  }

  @TenantScope()
  @Permissions("catalog.manage")
  @Patch("products/:id")
  async updateProduct(
    @Req() req: AuthenticatedRequest,
    @Param("id") id: string,
    @Body()
    body: {
      name?: unknown;
      description?: unknown;
      enabled?: unknown;
      gameRegionId?: unknown;
    },
  ) {
    try {
      const input: {
        name?: unknown;
        description?: unknown;
        enabled?: unknown;
        gameRegionId?: unknown;
      } = {};
      if (body.name !== undefined) input.name = body.name;
      if (body.description !== undefined) input.description = body.description;
      if (body.enabled !== undefined) input.enabled = body.enabled;
      if (body.gameRegionId !== undefined)
        input.gameRegionId = body.gameRegionId;
      return {
        data: await this.catalog.updateProduct(tenantIdOf(req), id, input),
      };
    } catch (error) {
      this.mapError(error);
    }
  }

  @TenantScope()
  @Permissions("catalog.manage")
  @Delete("products/:id")
  async removeProduct(
    @Req() req: AuthenticatedRequest,
    @Param("id") id: string,
  ) {
    try {
      await this.catalog.removeProduct(tenantIdOf(req), id);
      return { data: { ok: true } };
    } catch (error) {
      this.mapError(error);
    }
  }

  // ===== pricing =====
  @TenantScope()
  @Permissions("catalog.manage")
  @Get("products/:productId/pricing")
  @ApiOkResponse({ schema: dataArraySchema(pricingRuleSchema) as never })
  async listRules(
    @Req() req: AuthenticatedRequest,
    @Param("productId") productId: string,
  ) {
    try {
      return { data: await this.catalog.listRules(tenantIdOf(req), productId) };
    } catch (error) {
      this.mapError(error);
    }
  }

  @TenantScope()
  @Permissions("catalog.manage")
  @Post("products/:productId/pricing")
  @ApiBody({ schema: pricingRuleBodySchema as never })
  @ApiCreatedResponse({ schema: dataSchema(pricingRuleSchema) as never })
  async createRule(
    @Req() req: AuthenticatedRequest,
    @Param("productId") productId: string,
    @Body()
    body: {
      durationSeconds?: unknown;
      priceFen?: unknown;
      playerCostFen?: unknown;
      enabled?: unknown;
    },
  ) {
    try {
      const input: {
        durationSeconds: unknown;
        priceFen: unknown;
        playerCostFen?: unknown;
        enabled?: unknown;
      } = {
        durationSeconds: body.durationSeconds,
        priceFen: body.priceFen,
      };
      if (body.playerCostFen !== undefined)
        input.playerCostFen = body.playerCostFen;
      if (body.enabled !== undefined) input.enabled = body.enabled;
      return {
        data: await this.catalog.createRule(tenantIdOf(req), productId, input),
      };
    } catch (error) {
      this.mapError(error);
    }
  }

  @TenantScope()
  @Permissions("catalog.manage")
  @Patch("pricing/:id")
  @ApiBody({ schema: updatePricingRuleBodySchema as never })
  @ApiOkResponse({ schema: dataSchema(pricingRuleSchema) as never })
  async updateRule(
    @Req() req: AuthenticatedRequest,
    @Param("id") id: string,
    @Body()
    body: {
      durationSeconds?: unknown;
      priceFen?: unknown;
      playerCostFen?: unknown;
      enabled?: unknown;
    },
  ) {
    try {
      const input: {
        durationSeconds?: unknown;
        priceFen?: unknown;
        playerCostFen?: unknown;
        enabled?: unknown;
      } = {};
      if (body.durationSeconds !== undefined)
        input.durationSeconds = body.durationSeconds;
      if (body.priceFen !== undefined) input.priceFen = body.priceFen;
      if (body.playerCostFen !== undefined)
        input.playerCostFen = body.playerCostFen;
      if (body.enabled !== undefined) input.enabled = body.enabled;
      return {
        data: await this.catalog.updateRule(tenantIdOf(req), id, input),
      };
    } catch (error) {
      this.mapError(error);
    }
  }

  @TenantScope()
  @Permissions("catalog.manage")
  @Delete("pricing/:id")
  async removeRule(@Req() req: AuthenticatedRequest, @Param("id") id: string) {
    try {
      await this.catalog.removeRule(tenantIdOf(req), id);
      return { data: { ok: true } };
    } catch (error) {
      this.mapError(error);
    }
  }
}
