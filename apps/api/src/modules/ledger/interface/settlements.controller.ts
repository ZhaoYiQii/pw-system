import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  HttpException,
  HttpStatus,
  Inject,
  Logger,
  Param,
  Post,
  Req,
} from "@nestjs/common";
import { PrismaSettlementsRepository } from "../infrastructure/prisma-settlements.repository.js";
import type { ConfirmSettlementPaymentResult } from "../infrastructure/prisma-settlements.repository.js";
import {
  PlayerPayoutConfirmedConflictError,
  PlayerPayoutConfirmedInputError,
  normalizePlayerPayoutRequest,
} from "../domain/player-payout-confirmed-ledger-posting.js";
import type { NormalizedPlayerPayoutRequest } from "../domain/player-payout-confirmed-ledger-posting.js";
import { Permissions, TenantScope } from "../../../common/auth/decorators.js";
import type { AuthenticatedRequest } from "../../../common/auth/auth.guard.js";
import { AuditService } from "../../audit/audit.service.js";

function tenantIdOf(req: AuthenticatedRequest): string {
  const id = req.principal?.tenantId;
  if (!id)
    throw new HttpException("tenant context missing", HttpStatus.UNAUTHORIZED);
  return id;
}

/** 日志用：`unknown` 错误取可读文本，不改变错误本身。 */
function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** DS-006 成功响应：金额一律为十进制字符串（分）。 */
interface SettlementPaymentResponse {
  batchId: string;
  paymentId: string;
  transactionId: string;
  status: "PAID";
  amountFen: string;
  duplicate: false;
}

@Controller("api/v1/tenant/settlements")
export class SettlementsController {
  private readonly logger = new Logger(SettlementsController.name);

  constructor(
    @Inject(PrismaSettlementsRepository)
    private readonly repo: PrismaSettlementsRepository,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  private guard(req: AuthenticatedRequest): void {
    const role = req.principal?.role;
    if (role !== "TENANT_OWNER" && role !== "FINANCE")
      throw new ForbiddenException("仅店主/财务可操作结算");
  }

  private bad(error: unknown): never {
    throw new HttpException(
      error instanceof Error ? error.message : String(error),
      HttpStatus.CONFLICT,
    );
  }

  @TenantScope()
  @Permissions("finance.manage")
  @Get()
  async list(@Req() req: AuthenticatedRequest) {
    this.guard(req);
    return { data: await this.repo.list(tenantIdOf(req)) };
  }

  @TenantScope()
  @Permissions("finance.manage")
  @Get("earnings")
  async listEarnings(@Req() req: AuthenticatedRequest) {
    this.guard(req);
    return { data: await this.repo.listEarnings(tenantIdOf(req)) };
  }

  @TenantScope()
  @Permissions("finance.manage")
  @Get("ledger")
  async financeLedger(@Req() req: AuthenticatedRequest) {
    this.guard(req);
    return { data: await this.repo.financeLedger(tenantIdOf(req)) };
  }

  @TenantScope()
  @Permissions("finance.manage")
  @Get(":id")
  async detail(@Req() req: AuthenticatedRequest, @Param("id") id: string) {
    this.guard(req);
    const view = await this.repo.detail(tenantIdOf(req), id);
    if (!view) throw new HttpException("批次不存在", HttpStatus.NOT_FOUND);
    return { data: view };
  }

  @TenantScope()
  @Permissions("finance.manage")
  @Post()
  async create(@Req() req: AuthenticatedRequest) {
    this.guard(req);
    const id = await this.repo.create(
      tenantIdOf(req),
      req.principal?.sub ?? "system",
    );
    await this.audit.record({
      tenantId: tenantIdOf(req),
      actorType: req.principal?.role,
      actorId: req.principal?.sub ?? "system",
      action: "settlement.create",
      resourceType: "settlement_batch",
      resourceId: id,
      summary: "创建结算批次",
    });
    return { data: { id } };
  }

  @TenantScope()
  @Permissions("finance.manage")
  @Post(":id/items")
  async addItems(
    @Req() req: AuthenticatedRequest,
    @Param("id") id: string,
    @Body() body: { earningIds?: unknown; slotEarningIds?: unknown },
  ) {
    this.guard(req);
    const ids = Array.isArray(body.earningIds)
      ? (body.earningIds as unknown[]).filter(
          (x): x is string => typeof x === "string",
        )
      : [];
    const slotIds = Array.isArray(body.slotEarningIds)
      ? (body.slotEarningIds as unknown[]).filter(
          (x): x is string => typeof x === "string",
        )
      : [];
    try {
      await this.repo.addItems(tenantIdOf(req), id, ids, slotIds);
      await this.audit.record({
        tenantId: tenantIdOf(req),
        actorType: req.principal?.role,
        actorId: req.principal?.sub ?? "system",
        action: "settlement.add_items",
        resourceType: "settlement_batch",
        resourceId: id,
        summary: `添加 ${ids.length} 条旧应收与 ${slotIds.length} 条档位收入至批次`,
      });
      return { data: { ok: true } };
    } catch (error) {
      this.bad(error);
    }
  }

  @TenantScope()
  @Permissions("finance.manage")
  @Post(":id/review")
  async review(@Req() req: AuthenticatedRequest, @Param("id") id: string) {
    this.guard(req);
    try {
      await this.repo.review(
        tenantIdOf(req),
        id,
        req.principal?.sub ?? "system",
      );
      await this.audit.record({
        tenantId: tenantIdOf(req),
        actorType: req.principal?.role,
        actorId: req.principal?.sub ?? "system",
        action: "settlement.review",
        resourceType: "settlement_batch",
        resourceId: id,
        summary: "复核结算批次",
      });
      return { data: { ok: true } };
    } catch (error) {
      this.bad(error);
    }
  }

  @TenantScope()
  @Permissions("finance.manage")
  @Post(":id/approve")
  async approve(@Req() req: AuthenticatedRequest, @Param("id") id: string) {
    this.guard(req);
    try {
      await this.repo.approve(
        tenantIdOf(req),
        id,
        req.principal?.sub ?? "system",
      );
      await this.audit.record({
        tenantId: tenantIdOf(req),
        actorType: req.principal?.role,
        actorId: req.principal?.sub ?? "system",
        action: "settlement.approve",
        resourceType: "settlement_batch",
        resourceId: id,
        summary: "批准结算批次",
      });
      return { data: { ok: true } };
    } catch (error) {
      this.bad(error);
    }
  }

  /** DS-006：新标准端点——登记**已实际发生**的陪玩付款（不是代付接口）。 */
  @TenantScope()
  @Permissions("finance.manage")
  @Post(":id/payments")
  async confirmPayment(
    @Req() req: AuthenticatedRequest,
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    return this.confirmSettlementPayment(req, id, body);
  }

  /**
   * 过渡适配器：旧路由保留，但必须携带完整资金事实并走同一条付款路径，
   * 不再支持空请求体的「登记线下支付」。认证、错误与返回结果与新路由一致。
   */
  @TenantScope()
  @Permissions("finance.manage")
  @Post(":id/pay")
  async pay(
    @Req() req: AuthenticatedRequest,
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    return this.confirmSettlementPayment(req, id, body);
  }

  /**
   * 两条路由共用同一条实际付款确认路径。
   *
   * 边界校验只在这里做一次（批次 id 以 URL 为权威），仓储只接受已校验的输入；
   * 输入非法 → 400，状态/并发冲突 → 409，未识别错误 → 记录日志后 500
   * （既不吞掉，也不把内部错误伪装成「冲突」回给客户端）。
   * 租户与操作者只来自服务端登录态，缺少登录态是 401，不会退化成 400/409。
   * 审计只在仓储事务返回成功之后记录，摘要含批次号/金额/资金账户，不含完整凭证号与备注。
   */
  private async confirmSettlementPayment(
    req: AuthenticatedRequest,
    id: string,
    body: unknown,
  ): Promise<{ data: SettlementPaymentResponse }> {
    this.guard(req);
    const tenantId = tenantIdOf(req);
    const actorId = req.principal?.sub;
    if (!actorId) {
      throw new HttpException(
        "登录态缺少操作者标识，拒绝登记付款",
        HttpStatus.UNAUTHORIZED,
      );
    }

    let request: NormalizedPlayerPayoutRequest;
    try {
      request = normalizePlayerPayoutRequest(body, id);
    } catch (error) {
      if (error instanceof PlayerPayoutConfirmedInputError) {
        throw new HttpException(error.message, HttpStatus.BAD_REQUEST);
      }
      throw error;
    }

    let result: ConfirmSettlementPaymentResult;
    try {
      result = await this.repo.confirmPayment({
        tenantId,
        batchId: request.batchId,
        fundAccountId: request.fundAccountId,
        evidenceRef: request.evidenceRef,
        occurredAt: request.occurredAt,
        idempotencyKey: request.idempotencyKey,
        note: request.note,
        operatorId: actorId,
      });
    } catch (error) {
      if (error instanceof PlayerPayoutConfirmedInputError) {
        throw new HttpException(error.message, HttpStatus.BAD_REQUEST);
      }
      if (error instanceof PlayerPayoutConfirmedConflictError) {
        throw new HttpException(error.message, HttpStatus.CONFLICT);
      }
      // 未识别错误（连接池、超时、约束竞争等）不是业务冲突：记录详情后按 500 上抛，
      // 既不吞掉，也不把内部驱动原文当成「冲突」回给客户端。
      this.logger.error(
        `结算付款失败（批次 ${request.batchId}）：${describeError(error)}`,
        error instanceof Error ? error.stack : undefined,
      );
      throw new HttpException(
        "结算付款失败：服务内部错误",
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }

    // 审计只在付款事务提交成功之后写：此时资金事实已经落库，审计失败既不能伪装成
    // 「付款失败」，也不能被吞掉——记录日志后如实返回 500，并告知操作者不要重复提交。
    try {
      await this.audit.record({
        tenantId,
        actorType: req.principal?.role,
        actorId,
        action: "settlement.payment.confirmed",
        resourceType: "settlement_batch",
        resourceId: result.batchId,
        summary: `确认结算批次付款：批次 ${result.batchNo}，金额 ${result.amountFen.toString()} 分，资金账户 ${result.fundAccountCode}（${result.fundAccountName}）`,
      });
    } catch (error) {
      this.logger.error(
        `结算付款已入账，但审计写入失败（批次 ${result.batchId}，付款记录 ${result.paymentId}）：${describeError(error)}`,
      );
      throw new HttpException(
        "付款已登记成功，但审计写入失败；请勿重复提交，请联系技术支持核对批次状态",
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }

    return {
      data: {
        batchId: result.batchId,
        paymentId: result.paymentId,
        transactionId: result.transactionId,
        status: result.status,
        amountFen: result.amountFen.toString(),
        duplicate: false,
      },
    };
  }

  @TenantScope()
  @Permissions("finance.manage")
  @Post(":id/void")
  async voidBatch(@Req() req: AuthenticatedRequest, @Param("id") id: string) {
    this.guard(req);
    try {
      await this.repo.void(tenantIdOf(req), id);
      await this.audit.record({
        tenantId: tenantIdOf(req),
        actorType: req.principal?.role,
        actorId: req.principal?.sub ?? "system",
        action: "settlement.void",
        resourceType: "settlement_batch",
        resourceId: id,
        summary: "作废结算批次",
      });
      return { data: { ok: true } };
    } catch (error) {
      this.bad(error);
    }
  }
}
