import {
  Body,
  Controller,
  Get,
  HttpException,
  HttpStatus,
  Inject,
  Post,
  Req,
} from "@nestjs/common";
import { Permissions, TenantScope } from "../../../common/auth/decorators.js";
import type { AuthenticatedRequest } from "../../../common/auth/auth.guard.js";
import { WalletService } from "../application/wallet.service.js";
import {
  BossWalletNotFoundError,
  PaymentStateError,
  RechargeInputError,
} from "../domain/wallet-errors.js";

function tenantIdOf(req: AuthenticatedRequest): string {
  const id = req.principal?.tenantId;
  if (!id)
    throw new HttpException("tenant context missing", HttpStatus.UNAUTHORIZED);
  return id;
}

@Controller("api/v1/boss")
export class WalletController {
  constructor(@Inject(WalletService) private readonly wallet: WalletService) {}

  private mapError(error: unknown): never {
    if (error instanceof BossWalletNotFoundError)
      throw new HttpException(error.message, HttpStatus.NOT_FOUND);
    if (
      error instanceof RechargeInputError ||
      error instanceof PaymentStateError
    )
      throw new HttpException(error.message, HttpStatus.BAD_REQUEST);
    throw error;
  }

  @TenantScope()
  @Permissions("order.manage")
  @Get("wallet")
  async get(@Req() req: AuthenticatedRequest) {
    if (req.principal?.role !== "CUSTOMER") {
      throw new HttpException("需要老板身份", HttpStatus.FORBIDDEN);
    }
    try {
      return {
        data: await this.wallet.get(tenantIdOf(req), req.principal.sub),
      };
    } catch (error) {
      this.mapError(error);
    }
  }

  @TenantScope()
  @Permissions("order.manage")
  @Post("wallet/recharge")
  async recharge(
    @Req() req: AuthenticatedRequest,
    @Body() body: { amountFen?: unknown },
  ) {
    if (req.principal?.role !== "CUSTOMER") {
      throw new HttpException("需要老板身份", HttpStatus.FORBIDDEN);
    }
    try {
      return {
        data: await this.wallet.recharge(
          tenantIdOf(req),
          req.principal.sub,
          body.amountFen as string,
        ),
      };
    } catch (error) {
      this.mapError(error);
    }
  }
}
