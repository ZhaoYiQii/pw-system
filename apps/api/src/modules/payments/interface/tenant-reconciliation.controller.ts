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
import { TenantReconciliationService } from "../application/tenant-reconciliation.service.js";
import { PaymentLedgerInputError } from "../domain/payments.errors.js";

/**
 * S4-7b：门店**可见对账**端点（最近账单文件 + 差异列表，只读）。
 *
 * 权限 `finance.manage`（老板 / 财务）：对账是财务口径，店长客服看不到。
 * 这一片不提供"标记差异已解决"之类的写操作——差异的判定与修复属于对账链路（S4-3）与人工核对，
 * 门店端只负责"看得见"。
 */
@Controller("api/v1/tenant/payments/reconciliation")
export class TenantReconciliationController {
  constructor(
    @Inject(TenantReconciliationService)
    private readonly reconciliation: TenantReconciliationService,
  ) {}

  /** `?limit=1-200` 只作用于差异列表；账单固定取最近 5 份。 */
  @TenantScope()
  @Permissions("finance.manage")
  @Get()
  async overview(
    @Req() req: AuthenticatedRequest,
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
        data: await this.reconciliation.overview({
          tenantId,
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
