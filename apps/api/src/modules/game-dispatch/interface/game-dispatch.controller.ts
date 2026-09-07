import {
  Body,
  Controller,
  Delete,
  Get,
  HttpException,
  HttpStatus,
  Inject,
  Param,
  Post,
  Req,
} from "@nestjs/common";
import { Permissions, TenantScope } from "../../../common/auth/decorators.js";
import type { AuthenticatedRequest } from "../../../common/auth/auth.guard.js";
import { GameDispatchService } from "../application/game-dispatch.service.js";
import {
  DispatchConflictError,
  DispatchInputError,
  DispatchNotFoundError,
  DispatchStateError,
} from "../domain/dispatch-errors.js";

function tenantIdOf(req: AuthenticatedRequest): string {
  const id = req.principal?.tenantId;
  if (!id)
    throw new HttpException("tenant context missing", HttpStatus.UNAUTHORIZED);
  return id;
}

@Controller("api/v1/tenant/game-dispatch")
export class GameDispatchController {
  constructor(
    @Inject(GameDispatchService)
    private readonly dispatch: GameDispatchService,
  ) {}

  private mapError(error: unknown): never {
    if (error instanceof DispatchNotFoundError)
      throw new HttpException(error.message, HttpStatus.NOT_FOUND);
    if (error instanceof DispatchStateError)
      throw new HttpException(error.message, HttpStatus.CONFLICT);
    if (error instanceof DispatchConflictError)
      throw new HttpException(error.message, HttpStatus.CONFLICT);
    if (error instanceof DispatchInputError)
      throw new HttpException(error.message, HttpStatus.BAD_REQUEST);
    throw error;
  }

  @TenantScope()
  @Permissions("gameDispatch.manage")
  @Get()
  async list(@Req() req: AuthenticatedRequest) {
    return { data: await this.dispatch.list(tenantIdOf(req)) };
  }

  @TenantScope()
  @Permissions("gameDispatch.manage")
  @Post("orders")
  async createDraft(
    @Req() req: AuthenticatedRequest,
    @Body() body: Record<string, unknown>,
  ) {
    try {
      const input: {
        templateId: string;
        customerProfileId: string;
        formValues: Record<string, string>;
        desiredStartAt?: string | null;
        durationMinutes: number;
        lines: { positionLabel: string; requiredCount: number }[];
      } = {
        templateId: body.templateId as string,
        customerProfileId: body.customerProfileId as string,
        formValues: (body.formValues ?? {}) as Record<string, string>,
        durationMinutes: body.durationMinutes as number,
        lines: body.lines as {
          positionLabel: string;
          requiredCount: number;
        }[],
      };
      if (body.desiredStartAt !== undefined)
        input.desiredStartAt = body.desiredStartAt as string | null;
      return {
        data: await this.dispatch.createDraft(
          tenantIdOf(req),
          req.principal?.sub ?? "system",
          input,
        ),
      };
    } catch (error) {
      this.mapError(error);
    }
  }

  @TenantScope()
  @Permissions("order.manage")
  @Post("customer/orders")
  async customerCreateDraft(
    @Req() req: AuthenticatedRequest,
    @Body() body: Record<string, unknown>,
  ) {
    if (req.principal?.role !== "CUSTOMER") {
      throw new HttpException("需要老板身份", HttpStatus.FORBIDDEN);
    }
    try {
      const input: {
        templateId: string;
        formValues: Record<string, string>;
        desiredStartAt?: string | null;
        durationMinutes: number;
        lines: { positionLabel: string; requiredCount: number }[];
      } = {
        templateId: body.templateId as string,
        formValues: (body.formValues ?? {}) as Record<string, string>,
        durationMinutes: body.durationMinutes as number,
        lines: body.lines as {
          positionLabel: string;
          requiredCount: number;
        }[],
      };
      if (body.desiredStartAt !== undefined)
        input.desiredStartAt = body.desiredStartAt as string | null;
      return {
        data: await this.dispatch.customerCreateDraft(
          tenantIdOf(req),
          req.principal.sub,
          input,
        ),
      };
    } catch (error) {
      this.mapError(error);
    }
  }

  @TenantScope()
  @Permissions("order.manage")
  @Get("customer/templates")
  async customerTemplates(@Req() req: AuthenticatedRequest) {
    if (req.principal?.role !== "CUSTOMER") {
      throw new HttpException("需要老板身份", HttpStatus.FORBIDDEN);
    }
    return {
      data: await this.dispatch.customerTemplates(tenantIdOf(req)),
    };
  }

  @TenantScope()
  @Permissions("order.manage")
  @Get("customer/templates/:id")
  async customerTemplate(
    @Req() req: AuthenticatedRequest,
    @Param("id") id: string,
  ) {
    if (req.principal?.role !== "CUSTOMER") {
      throw new HttpException("需要老板身份", HttpStatus.FORBIDDEN);
    }
    try {
      return {
        data: await this.dispatch.customerTemplate(tenantIdOf(req), id),
      };
    } catch (error) {
      this.mapError(error);
    }
  }

  @TenantScope()
  @Permissions("gameDispatch.manage")
  @Get("orders/:orderId")
  async view(
    @Req() req: AuthenticatedRequest,
    @Param("orderId") orderId: string,
  ) {
    try {
      return { data: await this.dispatch.view(tenantIdOf(req), orderId) };
    } catch (error) {
      this.mapError(error);
    }
  }

  @TenantScope()
  @Permissions("gameDispatch.manage")
  @Get("orders/:orderId/applications")
  async applications(
    @Req() req: AuthenticatedRequest,
    @Param("orderId") orderId: string,
  ) {
    try {
      return {
        data: await this.dispatch.applications(tenantIdOf(req), orderId),
      };
    } catch (error) {
      this.mapError(error);
    }
  }

  @TenantScope()
  @Permissions("dispatch.manage")
  @Get("player/orders/:orderId/signup")
  async playerSignup(
    @Req() req: AuthenticatedRequest,
    @Param("orderId") orderId: string,
  ) {
    if (req.principal?.role !== "PLAYER") {
      throw new HttpException("需要陪玩身份", HttpStatus.FORBIDDEN);
    }
    try {
      return {
        data: await this.dispatch.playerSignup(
          tenantIdOf(req),
          req.principal.sub,
          orderId,
        ),
      };
    } catch (error) {
      this.mapError(error);
    }
  }

  @TenantScope()
  @Permissions("order.manage")
  @Get("customer/orders/:orderId/select")
  async customerSelect(
    @Req() req: AuthenticatedRequest,
    @Param("orderId") orderId: string,
  ) {
    if (req.principal?.role !== "CUSTOMER") {
      throw new HttpException("需要老板身份", HttpStatus.FORBIDDEN);
    }
    try {
      return {
        data: await this.dispatch.customerView(
          tenantIdOf(req),
          req.principal.sub,
          orderId,
        ),
      };
    } catch (error) {
      this.mapError(error);
    }
  }

  @TenantScope()
  @Permissions("order.manage")
  @Post("customer/orders/:orderId/assignment")
  async customerAssign(
    @Req() req: AuthenticatedRequest,
    @Param("orderId") orderId: string,
    @Body() body: { applicationIds?: unknown },
  ) {
    if (req.principal?.role !== "CUSTOMER") {
      throw new HttpException("需要老板身份", HttpStatus.FORBIDDEN);
    }
    try {
      const ids = Array.isArray(body.applicationIds)
        ? body.applicationIds.filter((v): v is string => typeof v === "string")
        : [];
      return {
        data: await this.dispatch.customerAssign(
          tenantIdOf(req),
          req.principal.sub,
          orderId,
          ids,
        ),
      };
    } catch (error) {
      this.mapError(error);
    }
  }

  @TenantScope()
  @Permissions("gameDispatch.manage")
  @Get("orders/:orderId/copy-text")
  async copy(
    @Req() req: AuthenticatedRequest,
    @Param("orderId") orderId: string,
  ) {
    try {
      return { data: await this.dispatch.copy(tenantIdOf(req), orderId) };
    } catch (error) {
      this.mapError(error);
    }
  }

  @TenantScope()
  @Permissions("gameDispatch.manage")
  @Post("orders/:orderId/publish")
  async publish(
    @Req() req: AuthenticatedRequest,
    @Param("orderId") orderId: string,
  ) {
    try {
      return {
        data: await this.dispatch.publish(
          tenantIdOf(req),
          req.principal?.sub ?? "system",
          orderId,
        ),
      };
    } catch (error) {
      this.mapError(error);
    }
  }

  @TenantScope()
  @Permissions("dispatch.manage")
  @Post("orders/:orderId/lines/:lineId/applications")
  async apply(
    @Req() req: AuthenticatedRequest,
    @Param("orderId") orderId: string,
    @Param("lineId") lineId: string,
  ) {
    try {
      const app = await this.dispatch.apply(
        tenantIdOf(req),
        req.principal?.sub ?? "",
        orderId,
        lineId,
      );
      return { data: app };
    } catch (error) {
      this.mapError(error);
    }
  }

  @TenantScope()
  @Permissions("dispatch.manage")
  @Post("applications/:id/withdraw")
  async withdraw(@Req() req: AuthenticatedRequest, @Param("id") id: string) {
    try {
      await this.dispatch.withdraw(
        tenantIdOf(req),
        req.principal?.sub ?? "",
        id,
      );
      return { data: { ok: true } };
    } catch (error) {
      this.mapError(error);
    }
  }

  @TenantScope()
  @Permissions("gameDispatch.manage")
  @Delete("applications/:id")
  async staffRemove(@Req() req: AuthenticatedRequest, @Param("id") id: string) {
    try {
      await this.dispatch.staffRemove(
        tenantIdOf(req),
        req.principal?.sub ?? "system",
        id,
      );
      return { data: { ok: true } };
    } catch (error) {
      this.mapError(error);
    }
  }

  @TenantScope()
  @Permissions("gameDispatch.manage")
  @Post("orders/:orderId/assignment")
  async assign(
    @Req() req: AuthenticatedRequest,
    @Param("orderId") orderId: string,
    @Body() body: { applicationIds?: unknown },
  ) {
    try {
      const ids = Array.isArray(body.applicationIds)
        ? body.applicationIds.filter((v): v is string => typeof v === "string")
        : [];
      return {
        data: await this.dispatch.assign(
          tenantIdOf(req),
          req.principal?.sub ?? "system",
          orderId,
          ids,
        ),
      };
    } catch (error) {
      this.mapError(error);
    }
  }
}
