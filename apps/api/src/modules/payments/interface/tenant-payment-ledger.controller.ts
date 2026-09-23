import {
  Controller,
  Get,
  HttpException,
  HttpStatus,
  Inject,
  Query,
  Req,
} from "@nestjs/common";
import { Permissions, TenantScope } from "../../../common/auth/decorators.js";
import type { AuthenticatedRequest } from "../../../common/auth/auth.guard.js";
import { TenantPaymentLedgerService } from "../application/payment-ledger.service.js";
import { PaymentLedgerInputError } from "../domain/payments.errors.js";

/**
 * S4-7：门店**支付台账**端点（客户充值/支付的支付单列表）。
 *
 * 权限口径与人工退款登记一致：`finance.manage`（老板 / 财务）。台账是财务对账与退款的依据，
 * 客服/店长看不到门店的钱；退款登记本身在 `/api/v1/payments/refunds/manual`（同一权限）。
 */
@Controller("api/v1/tenant/payments/orders")
export class TenantPaymentLedgerController {
  constructor(
    @Inject(TenantPaymentLedgerService)
    private readonly ledger: TenantPaymentLedgerService,
  ) {}

  /**
   * `?status=SUCCESS|PENDING|FAILED`（不传=全部）、`?limit=1-200`（默认 50）。
   * 入参非法 → 400（认不出的状态**不**当"全部"处理，否则筛选会静默失效）。
   */
  @TenantScope()
  @Permissions("finance.manage")
  @Get()
  async list(
    @Req() req: AuthenticatedRequest,
    @Query("status") status?: string,
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
        data: await this.ledger.list({
          tenantId,
          ...(status === undefined ? {} : { status }),
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
}
