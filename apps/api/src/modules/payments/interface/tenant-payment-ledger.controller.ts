import {
  Controller,
  Get,
  Header,
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
 * S5-1：门店**支付台账**端点（服务端分页 / 排序 / 筛选 / CSV 导出）。
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
   * `?status=SUCCESS|PENDING|FAILED`（不传=全部）、`?q=`（单号或客户名关键词，≤50 字）、
   * `?sortBy=createdAt|paidAt|amountFen|status|outNo`、`?sortDir=asc|desc`、
   * `?page=1`、`?pageSize=1-200`（`limit` 是旧参数名，等价于 `pageSize`）。
   *
   * 入参非法 → 400（认不出的状态**不**当"全部"处理，否则筛选会静默失效）。
   */
  @TenantScope()
  @Permissions("finance.manage")
  @Get()
  async list(
    @Req() req: AuthenticatedRequest,
    @Query("status") status?: string,
    @Query("q") q?: string,
    @Query("sortBy") sortBy?: string,
    @Query("sortDir") sortDir?: string,
    @Query("page") page?: string,
    @Query("pageSize") pageSize?: string,
    @Query("limit") limit?: string,
  ) {
    const tenantId = tenantIdOf(req);
    try {
      return {
        data: await this.ledger.list({
          tenantId,
          ...(status === undefined ? {} : { status }),
          ...(q === undefined ? {} : { q }),
          ...(sortBy === undefined ? {} : { sortBy }),
          ...(sortDir === undefined ? {} : { sortDir }),
          ...(page === undefined ? {} : { page }),
          ...(pageSize === undefined ? {} : { pageSize }),
          ...(limit === undefined ? {} : { limit }),
        }),
      };
    } catch (error) {
      this.rethrow(error);
    }
  }

  /**
   * 导出当前筛选条件下的台账 CSV（带 BOM，Excel 可直接打开；金额按元两位小数输出）。
   * 大数据量应走对账/账单链路，这里设了行数上限（见服务层常量）。
   */
  @TenantScope()
  @Permissions("finance.manage")
  @Get("export.csv")
  @Header("content-type", "text/csv; charset=utf-8")
  @Header("content-disposition", 'attachment; filename="payment-orders.csv"')
  async exportCsv(
    @Req() req: AuthenticatedRequest,
    @Query("status") status?: string,
    @Query("q") q?: string,
  ): Promise<string> {
    const tenantId = tenantIdOf(req);
    try {
      return await this.ledger.exportCsv({
        tenantId,
        ...(status === undefined ? {} : { status }),
        ...(q === undefined ? {} : { q }),
      });
    } catch (error) {
      this.rethrow(error);
    }
  }

  private rethrow(error: unknown): never {
    if (error instanceof PaymentLedgerInputError) {
      throw new HttpException(error.message, HttpStatus.BAD_REQUEST);
    }
    throw error;
  }
}

function tenantIdOf(req: AuthenticatedRequest): string {
  const id = req.principal?.tenantId;
  if (!id) {
    throw new HttpException("tenant context missing", HttpStatus.UNAUTHORIZED);
  }
  return id;
}
