import {
  Controller,
  Get,
  HttpException,
  HttpStatus,
  Inject,
  Param,
  Query,
  Req,
} from "@nestjs/common";
import { Permissions, TenantScope } from "../../../common/auth/decorators.js";
import type { AuthenticatedRequest } from "../../../common/auth/auth.guard.js";
import { TenantWalletService } from "../application/tenant-wallet.service.js";
import {
  PaymentLedgerInputError,
  PaymentWalletNotFoundError,
} from "../domain/payments.errors.js";

/**
 * S4-9a：门店**客户钱包台账**端点（余额列表 + 单客户充值/退款流水）。
 *
 * 权限 `finance.manage`（老板 / 财务）：客户余额与流水是门店的钱，
 * 客服/店长看不到（与支付台账、人工退款登记同一口径）。
 *
 * 为什么不是一个端点带 `?customerProfileId=`：列表与明细的权限、缓存与错误语义完全不同
 * （列表永远有结果；明细对没有钱包的客户是 404），分开更不容易被前端混用。
 */
@Controller("api/v1/tenant/payments/wallets")
export class TenantWalletController {
  constructor(
    @Inject(TenantWalletService)
    private readonly wallets: TenantWalletService,
  ) {}

  /** `?query=` 按客户名包含匹配；`?limit=` 1-200（默认 50）。 */
  @TenantScope()
  @Permissions("finance.manage")
  @Get()
  async list(
    @Req() req: AuthenticatedRequest,
    @Query("query") query?: string,
    @Query("limit") limit?: string,
  ) {
    const tenantId = req.principal?.tenantId;
    if (!tenantId) {
      throw new HttpException(
        "tenant context missing",
        HttpStatus.UNAUTHORIZED,
      );
    }
    try {
      return {
        data: await this.wallets.listWallets({
          tenantId,
          ...(query === undefined ? {} : { query }),
          ...(limit === undefined ? {} : { limit }),
        }),
      };
    } catch (error) {
      if (error instanceof PaymentLedgerInputError) {
        throw new HttpException(error.message, HttpStatus.BAD_REQUEST);
      }
      throw error;
    }
  }

  /** 单客户钱包明细：余额 + 最近流水（`?limit=` 1-200，默认 50）。 */
  @TenantScope()
  @Permissions("finance.manage")
  @Get(":customerProfileId/entries")
  async detail(
    @Req() req: AuthenticatedRequest,
    @Param("customerProfileId") customerProfileId: string,
    @Query("limit") limit?: string,
  ) {
    const tenantId = req.principal?.tenantId;
    if (!tenantId) {
      throw new HttpException(
        "tenant context missing",
        HttpStatus.UNAUTHORIZED,
      );
    }
    try {
      return {
        data: await this.wallets.getWalletDetail({
          tenantId,
          customerProfileId,
          ...(limit === undefined ? {} : { limit }),
        }),
      };
    } catch (error) {
      if (error instanceof PaymentLedgerInputError) {
        throw new HttpException(error.message, HttpStatus.BAD_REQUEST);
      }
      if (error instanceof PaymentWalletNotFoundError) {
        throw new HttpException(error.message, HttpStatus.NOT_FOUND);
      }
      throw error;
    }
  }
}
