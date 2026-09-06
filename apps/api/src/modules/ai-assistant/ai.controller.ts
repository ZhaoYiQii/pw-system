import { Body, Controller, Get, HttpException, HttpStatus, Inject, Param, Post, Req } from "@nestjs/common";
import { AiAssistantService } from "./ai.service.js";
import { Permissions, TenantScope } from "../../common/auth/decorators.js";
import type { AuthenticatedRequest } from "../../common/auth/auth.guard.js";

function tenantIdOf(req: AuthenticatedRequest): string { const id = req.principal?.tenantId; if (!id) throw new HttpException("tenant missing", HttpStatus.UNAUTHORIZED); return id; }

@Controller("api/v1/tenant/ai")
export class AiController {
  constructor(@Inject(AiAssistantService) private readonly ai: AiAssistantService) {}

  @TenantScope()
  @Get("capabilities")
  async capabilities() {
    return { data: this.ai.capabilities() };
  }

  @TenantScope()
  @Permissions("tenant.manage")
  @Post("parse-requirement")
  async parse(@Req() req: AuthenticatedRequest, @Body() body: Record<string, unknown>) {
    try {
      const fields: {
        description?: string;
        serviceProductId?: string | null;
        durationSeconds?: number | null;
        desiredStartAt?: string | null;
        gameId?: string | null;
        minBudgetFen?: number | null;
        maxBudgetFen?: number | null;
      } = {};
      if (body.description !== undefined) fields.description = body.description as string;
      if (body.serviceProductId !== undefined) fields.serviceProductId = body.serviceProductId as string | null;
      if (body.durationSeconds !== undefined) fields.durationSeconds = body.durationSeconds as number | null;
      if (body.desiredStartAt !== undefined) fields.desiredStartAt = body.desiredStartAt as string | null;
      if (body.gameId !== undefined) fields.gameId = body.gameId as string | null;
      if (body.minBudgetFen !== undefined) fields.minBudgetFen = body.minBudgetFen as number | null;
      if (body.maxBudgetFen !== undefined) fields.maxBudgetFen = body.maxBudgetFen as number | null;
      return { data: await this.ai.parseRequirement(tenantIdOf(req), req.principal?.sub ?? "system", fields) };
    } catch (error) {
      throw new HttpException(error instanceof Error ? error.message : String(error), HttpStatus.BAD_REQUEST);
    }
  }

  @TenantScope()
  @Permissions("tenant.manage")
  @Get("orders/:orderId/recommendations")
  async recommend(@Req() req: AuthenticatedRequest, @Param("orderId") orderId: string) {
    try {
      return { data: await this.ai.recommendPlayers(tenantIdOf(req), req.principal?.sub ?? "system", orderId) };
    } catch (error) {
      throw new HttpException(error instanceof Error ? error.message : String(error), HttpStatus.BAD_REQUEST);
    }
  }
}