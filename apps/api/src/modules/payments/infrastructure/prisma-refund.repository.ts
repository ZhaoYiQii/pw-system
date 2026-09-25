import { withTenantContext } from "@pw/database";
import type { DbTransaction, PrismaClient } from "@pw/database";
import { buildLedgerTransactionNo } from "../../ledger/domain/ledger-transaction-no.js";
import type {
  ManualRefundConfirmationResult,
  ManualRefundRepository,
  ManualRefundRequestResult,
  RefundOrderRecord,
} from "../application/refund-ports.js";
import {
  DuplicateRefundError,
  InsufficientWalletBalanceError,
} from "../application/manual-refund.service.js";
import {
  RefundInputError,
  RefundNotAllowedError,
} from "../domain/payments.errors.js";
import {
  CUSTOMER_PREPAID_LIABILITY_ACCOUNT,
  PAYMENT_CONFIRMED_EVENT_TYPE,
  PAYMENT_CONFIRMED_SOURCE_TYPE,
  WECHAT_SETTLEMENT_ASSET_ACCOUNT,
} from "../domain/payment-confirmed-ledger-posting.js";
import {
  REFUND_STATUSES,
  RefundStatusTransitionError,
} from "../domain/refund-confirmation-state.js";
import type { RefundStatus } from "../domain/refund-confirmation-state.js";
import {
  OriginalPaymentPostingMissingError,
  REFUND_CONFIRMABLE_STATUS,
  REFUND_OCCUPYING_STATUSES,
  REFUND_SUCCEEDED_STATUS,
  assertRefundConfirmable,
  buildRefundConfirmedLedgerPosting,
} from "../domain/refund-confirmed-ledger-posting.js";

/**
 * 把库里的自由文本状态收窄为领域状态；认不出的状态直接暴露，不猜、不默认。
 *
 * 刻意不回显原始值：`payment_refunds.status` 是自由文本列，把陌生字符串拼进错误消息
 * 会被 5xx 日志原样记下（沿用 DS-004 的日志注入口径）。
 */
function asRefundStatus(value: string): RefundStatus {
  const known = REFUND_STATUSES.find((status) => status === value);
  if (!known) {
    throw new Error("退款单状态无法识别，不在允许的状态集合内");
  }
  return known;
}

/**
 * DS-005：人工退款两步事实流的真库实现。
 *
 * 全部走**运行时连接 + 租户上下文**（RLS 生效）：退款是租户级资源，租户 id 来自登录态，
 * 不像回调链路那样需要跨租户找单，因此不用平台连接。
 *
 * 两步的资金语义**不同**：
 * - `createPendingManualRefund()` 只写退款单与审计，**不碰钱包与总账**；
 * - `confirmManualRefund()` 才在同一事务内扣钱包 + 写钱包流水 + 总账冲销 + 审计。
 */
export class PrismaRefundRepository implements ManualRefundRepository {
  constructor(private readonly runtime: PrismaClient) {}

  async findOrderForRefund(
    tenantId: string,
    input: { outNo?: string; orderId?: string },
  ): Promise<RefundOrderRecord | null> {
    return withTenantContext(
      this.runtime,
      tenantId,
      async (tx: DbTransaction) => {
        const order = await tx.paymentOrder.findFirst({
          where: {
            tenantId,
            ...(input.orderId ? { id: input.orderId } : {}),
            ...(input.outNo ? { outNo: input.outNo } : {}),
          },
          select: {
            id: true,
            outNo: true,
            amountFen: true,
            status: true,
            customerProfileId: true,
          },
        });
        if (!order) return null;
        // 可退额度按「待确认 + 已确认」的占用量计算：待确认申请也算占住了额度，
        // 否则同一张支付单能开出多张待确认申请、合计超过原支付金额。
        const occupied = await tx.paymentRefund.aggregate({
          where: {
            tenantId,
            paymentOrderId: order.id,
            status: { in: [...REFUND_OCCUPYING_STATUSES] },
          },
          _sum: { amountFen: true },
        });
        return {
          id: order.id,
          outNo: order.outNo,
          amountFen: order.amountFen,
          status: order.status,
          customerProfileId: order.customerProfileId,
          occupiedFen: occupied._sum.amountFen ?? 0n,
        };
      },
    );
  }

  async createPendingManualRefund(input: {
    tenantId: string;
    orderId: string;
    customerProfileId: string;
    amountFen: bigint;
    reason: string;
    operatorAccountId: string;
    outRefundNo: string;
  }): Promise<ManualRefundRequestResult> {
    return withTenantContext(
      this.runtime,
      input.tenantId,
      async (tx: DbTransaction) => {
        // 0) 先锁住支付单行：同一订单的登记由此串行化，后面的「识别重试 → 核准额度 → 插入」
        //    在同一个事务里对同一订单是原子的。支付金额取锁住的这一行（权威值），
        //    不信任调用方传来的数字。
        const orderLocks = await tx.$queryRaw<Array<{ amount_fen: bigint }>>`
        SELECT amount_fen FROM payment_orders
        WHERE id = ${input.orderId}::uuid
          AND tenant_id = ${input.tenantId}::uuid
        FOR UPDATE`;
        const lockedOrder = orderLocks[0];
        if (!lockedOrder) throw new RefundInputError("支付单不存在");
        const orderAmountFen = lockedOrder.amount_fen;

        // 1) **先识别幂等重试，再做额度校验**——顺序不能反。
        //    同一个 (tenant_id, out_refund_no) 已登记过就说明这是重复提交：那张申请本身正占着
        //    额度，拿「支付金额 − 已占用」去比它必然把合法重试判成超退。例如支付 12800、
        //    首次登记 8000（此时已占用 8000、可退只剩 4800），同键重试金额仍是 8000，
        //    先复核就会误报 409；正确结果是原样返回已存在的那张（duplicate=true）。
        //    按 tenant_id 过滤，避免跨租户同号互相可见。
        const existing = await tx.paymentRefund.findFirst({
          where: {
            tenantId: input.tenantId,
            outRefundNo: input.outRefundNo,
          },
          select: { id: true },
        });
        if (existing) {
          throw new DuplicateRefundError(
            await this.loadExistingRequest(
              tx,
              input.tenantId,
              input.outRefundNo,
              orderAmountFen,
            ),
          );
        }

        // 2) 额度复核：只对**真正的新申请**执行。待确认 + 已确认都占额度。
        //    服务层的同类校验在另一个事务里，只挡顺序提交（并发登记会各自读到「占用 0」而都通过），
        //    所以这里才是权威的一道。
        const occupied = await tx.paymentRefund.aggregate({
          where: {
            tenantId: input.tenantId,
            paymentOrderId: input.orderId,
            status: { in: [...REFUND_OCCUPYING_STATUSES] },
          },
          _sum: { amountFen: true },
        });
        const remainingFen = orderAmountFen - (occupied._sum.amountFen ?? 0n);
        if (input.amountFen > remainingFen) {
          throw new RefundNotAllowedError(
            `退款金额超过可退余额（可退 ${remainingFen} 分，本次 ${input.amountFen} 分）`,
          );
        }

        // 3) 原子插入申请。唯一约束是第二道防线：上面的识别与插入之间有并发窗口
        //    （同一订单已被支付单行锁串行化，正常撞不上；但也不能指望「将来总有人先加锁」），
        //    所以这里仍然靠 (tenant_id, out_refund_no) 唯一约束兜底，冲突即按重复处理。
        //    为什么用 ON CONFLICT DO NOTHING 而不是「catch 唯一冲突再查询」：
        //    Postgres 事务里任何语句报错后整个事务作废（25P02），后续查询会被拒——
        //    S4-3b 的真库测试抓到过这个坑，这里沿用同一写法。
        //    注意 updated_at 无默认值（Prisma 的 @updatedAt 只在 client 写入时生效），原生 SQL 必须自己给。
        //    succeeded_at 与 refund_id 显式 NULL：登记只是申请，尚无实际退款凭据。
        const inserted = await tx.$queryRaw<Array<{ id: string }>>`
        INSERT INTO payment_refunds
          (tenant_id, payment_order_id, out_refund_no, amount_fen, status, refund_id, reason, succeeded_at, updated_at)
        VALUES (
          ${input.tenantId}::uuid,
          ${input.orderId}::uuid,
          ${input.outRefundNo},
          ${input.amountFen},
          ${REFUND_CONFIRMABLE_STATUS},
          NULL,
          ${input.reason},
          NULL,
          now()
        )
        ON CONFLICT (tenant_id, out_refund_no) DO NOTHING
        RETURNING id::text AS id`;
        if (inserted.length === 0) {
          // 抢跑路径：另一笔相同提交先落地了。如实报重复，并把**已存在**的那张原样读回来。
          throw new DuplicateRefundError(
            await this.loadExistingRequest(
              tx,
              input.tenantId,
              input.outRefundNo,
              orderAmountFen,
            ),
          );
        }
        const refundId = inserted[0]!.id;

        // 4) 审计：只记录「申请已登记」。这里**没有**钱包扣减、钱包流水、总账交易或分录——
        //    登记不是退款事实，写了就等于凭空认定钱已经退出去。
        await tx.auditLog.create({
          data: {
            tenantId: input.tenantId,
            actorType: "tenant_account",
            actorId: input.operatorAccountId,
            action: "payment.refund.manual.requested",
            resourceType: "payment_refund",
            resourceId: refundId,
            summary: `人工退款申请登记 ${input.amountFen} 分（out_refund_no=${input.outRefundNo}）：${input.reason}`,
          },
        });

        // 5) 响应里的金额必须是**真实**值：登记不动钱包，所以余额就是未扣减的真实余额；
        //    累计已确认只算 SUCCEEDED，本张待确认申请不计入——不得伪造成「已扣后余额」。
        const refundedFen = await this.sumConfirmedFen(
          tx,
          input.tenantId,
          input.orderId,
        );
        const wallet = await tx.bossWallet.findFirst({
          where: {
            tenantId: input.tenantId,
            customerProfileId: input.customerProfileId,
          },
          select: { balanceFen: true },
        });
        return {
          refundId,
          outRefundNo: input.outRefundNo,
          status: REFUND_CONFIRMABLE_STATUS,
          amountFen: input.amountFen,
          refundedFen,
          walletBalanceFen: wallet?.balanceFen ?? 0n,
          fullyRefunded: refundedFen >= orderAmountFen,
        };
      },
    );
  }

  async confirmManualRefund(input: {
    tenantId: string;
    refundId: string;
    evidenceRef: string;
    operatorAccountId: string;
    confirmedAt: Date;
  }): Promise<ManualRefundConfirmationResult> {
    return withTenantContext(
      this.runtime,
      input.tenantId,
      async (tx: DbTransaction) => {
        // 1) 读退款单：拿金额、订单与单号。状态判断**不依赖**这次读取，见下面的条件更新。
        const refund = await tx.paymentRefund.findFirst({
          where: { id: input.refundId, tenantId: input.tenantId },
          select: {
            id: true,
            outRefundNo: true,
            amountFen: true,
            paymentOrderId: true,
            status: true,
          },
        });
        if (!refund) throw new RefundInputError("退款单不存在");

        const order = await tx.paymentOrder.findFirst({
          where: { id: refund.paymentOrderId, tenantId: input.tenantId },
          select: { customerProfileId: true, amountFen: true },
        });
        if (!order) {
          // 退款单必然挂在支付单上，取不到说明数据被破坏；不静默兜底，整笔回滚
          throw new Error("refund order not found");
        }

        // 2) 状态守卫：用条件更新把 PENDING_CONFIRMATION 原子转成 SUCCEEDED。
        //    不是「先查再改」——并发下第二个请求会拿到 0 行，由下面的断言给出结论。
        const guard = await tx.paymentRefund.updateMany({
          where: {
            id: refund.id,
            tenantId: input.tenantId,
            status: REFUND_CONFIRMABLE_STATUS,
          },
          data: {
            status: REFUND_SUCCEEDED_STATUS,
            // 门店实际退款凭据号：只作可审计引用，不存卡号或客户敏感信息
            refundId: input.evidenceRef,
            succeededAt: input.confirmedAt,
            version: { increment: 1 },
          },
        });
        if (guard.count !== 1) {
          // 0 行：这张退款单已不在可确认状态（重复确认、已被拒/撤销，或并发抢先）。
          // **不拿上面那次读到的旧状态下结论**：并发时输的一方在这里看到的是更新前的
          // PENDING_CONFIRMATION，据此放行会掉进「不可达」分支变成 500。
          // 事务内重新读一次（READ COMMITTED 每条语句取新快照）：抢先的一方此时已提交，
          // 读到 SUCCEEDED → 状态机抛 RefundStatusTransitionError → 控制器映射 409。
          const current = await tx.paymentRefund.findFirst({
            where: { id: refund.id, tenantId: input.tenantId },
            select: { status: true },
          });
          if (!current) throw new RefundInputError("退款单不存在");
          assertRefundConfirmable(current.status);
          // 兜底：重读仍是可确认状态却拿到 0 行，说明状态在这两句之间又被改了；
          // 仍然抛状态冲突（409），绝不静默重试、绝不二次扣款。
          throw new RefundStatusTransitionError(
            current.status,
            REFUND_SUCCEEDED_STATUS,
          );
        }

        // 3) 锁客户钱包并扣减：与充值/入账路径同一把行锁，余额不够则整笔回滚
        const locks = await tx.$queryRaw<
          Array<{ id: string; balance_fen: bigint }>
        >`
        SELECT id, balance_fen FROM boss_wallets
        WHERE tenant_id = ${input.tenantId}::uuid
          AND customer_profile_id = ${order.customerProfileId}::uuid
        FOR UPDATE`;
        const wallet = locks[0];
        if (!wallet) {
          throw new InsufficientWalletBalanceError(0n, refund.amountFen);
        }
        const balance = wallet.balance_fen;
        if (balance < refund.amountFen) {
          throw new InsufficientWalletBalanceError(balance, refund.amountFen);
        }
        const after = balance - refund.amountFen;
        await tx.bossWallet.update({
          where: { id: wallet.id },
          data: { balanceFen: after },
        });
        await tx.walletEntry.create({
          data: {
            tenantId: input.tenantId,
            customerProfileId: order.customerProfileId,
            walletId: wallet.id,
            txNo: refund.outRefundNo,
            type: "REFUND",
            amountFen: refund.amountFen,
            balanceAfterFen: after,
            referenceType: "payment_refund",
            referenceId: refund.id,
            reason: `人工退款确认（退款单 ${refund.outRefundNo}）`,
          },
        });

        // 4) 找原支付成功总账交易，取它的资金账户：冲销必须落在钱实际流出的那个账户上。
        //    找不到（或没挂资金账户）说明这笔支付没有入账记录，不得凭空造账户，整笔回滚。
        const paymentPosting = await tx.ledgerTransaction.findFirst({
          where: {
            tenantId: input.tenantId,
            sourceType: PAYMENT_CONFIRMED_SOURCE_TYPE,
            sourceId: refund.paymentOrderId,
            eventType: PAYMENT_CONFIRMED_EVENT_TYPE,
          },
          select: { fundAccountId: true },
        });
        const fundAccountId = paymentPosting?.fundAccountId ?? null;
        if (!fundAccountId) {
          throw new OriginalPaymentPostingMissingError(refund.outRefundNo);
        }

        // 5) 科目只建不改：`update` 为空对象，避免覆盖既有科目的名称。
        //    不依赖 upsert 的返回值——空 update 的 upsert 在行已存在时不保证回读该行；
        //    按仓内既有约定（prisma-ledger.repository.ensureAccount）改成 upsert 后重新查回 id。
        for (const account of [
          WECHAT_SETTLEMENT_ASSET_ACCOUNT,
          CUSTOMER_PREPAID_LIABILITY_ACCOUNT,
        ]) {
          await tx.ledgerAccount.upsert({
            where: {
              tenantId_code: {
                tenantId: input.tenantId,
                code: account.code,
              },
            },
            create: {
              tenantId: input.tenantId,
              code: account.code,
              name: account.name,
            },
            update: {},
          });
        }
        const accountRows = await tx.ledgerAccount.findMany({
          where: {
            tenantId: input.tenantId,
            code: {
              in: [
                WECHAT_SETTLEMENT_ASSET_ACCOUNT.code,
                CUSTOMER_PREPAID_LIABILITY_ACCOUNT.code,
              ],
            },
          },
          select: { id: true, code: true },
        });
        const accountIds = new Map<string, string>();
        for (const row of accountRows) {
          accountIds.set(row.code, row.id);
        }

        const posting = buildRefundConfirmedLedgerPosting({
          amountFen: refund.amountFen,
          fundAccountId,
          refundId: refund.id,
          outRefundNo: refund.outRefundNo,
          customerProfileId: order.customerProfileId,
          confirmedAt: input.confirmedAt,
        });

        const ledgerTransaction = await tx.ledgerTransaction.create({
          data: {
            tenantId: input.tenantId,
            txNo: buildLedgerTransactionNo(),
            description: posting.transaction.description,
            sourceType: posting.transaction.sourceType,
            sourceId: posting.transaction.sourceId,
            eventType: posting.transaction.eventType,
            status: posting.transaction.status,
            fundAccountId: posting.transaction.fundAccountId,
            occurredAt: posting.transaction.occurredAt,
            confirmedAt: posting.transaction.confirmedAt,
          },
          select: { id: true },
        });

        for (const entry of posting.entries) {
          const accountId = accountIds.get(entry.accountCode);
          if (!accountId) {
            throw new Error(`总账科目未就绪：${entry.accountCode}`);
          }
          await tx.ledgerEntry.create({
            data: {
              tenantId: input.tenantId,
              transactionId: ledgerTransaction.id,
              accountId,
              direction: entry.direction,
              amountFen: entry.amountFen,
              fundAccountId: entry.fundAccountId,
              auxiliaryType: entry.auxiliaryType,
              auxiliaryId: entry.auxiliaryId,
            },
          });
        }

        // 6) 审计：摘要含退款单号与金额；凭据号已写入 payment_refunds.refund_id，
        //    不在这里全文重复登记（避免凭据号扩散到审计查询面）。
        await tx.auditLog.create({
          data: {
            tenantId: input.tenantId,
            actorType: "tenant_account",
            actorId: input.operatorAccountId,
            action: "payment.refund.manual.confirmed",
            resourceType: "payment_refund",
            resourceId: refund.id,
            summary: `人工退款确认 ${refund.amountFen} 分（退款单 ${refund.outRefundNo}）`,
          },
        });

        // 7) 确认后的累计已确认退款（含本笔）与扣减后余额
        const refundedFen = await this.sumConfirmedFen(
          tx,
          input.tenantId,
          refund.paymentOrderId,
        );
        // fail-closed 兜底：累计**已确认**退款不得超过原支付金额。
        // 登记侧已用「占用额度」把超退挡住，这里再断言一次——钱是在这一步真正出去的，
        // 任何历史遗留或外部写入的越界都必须在此整笔回滚，而不是照样退出去。
        if (refundedFen > order.amountFen) {
          throw new RefundNotAllowedError(
            `累计已确认退款 ${refundedFen} 分超过原支付金额 ${order.amountFen} 分（退款单 ${refund.outRefundNo}），请人工核对账目`,
          );
        }
        return {
          refundId: refund.id,
          outRefundNo: refund.outRefundNo,
          status: REFUND_SUCCEEDED_STATUS,
          amountFen: refund.amountFen,
          refundedFen,
          walletBalanceFen: after,
          fullyRefunded: refundedFen >= order.amountFen,
        };
      },
    );
  }

  /** 该支付单累计**已确认**（SUCCEEDED）的退款金额；待确认申请不计入。 */
  private async sumConfirmedFen(
    tx: DbTransaction,
    tenantId: string,
    paymentOrderId: string,
  ): Promise<bigint> {
    const confirmed = await tx.paymentRefund.aggregate({
      where: { tenantId, paymentOrderId, status: REFUND_SUCCEEDED_STATUS },
      _sum: { amountFen: true },
    });
    return confirmed._sum.amountFen ?? 0n;
  }

  /** 幂等命中：把已登记好的那张申请原样读回来（含真实余额与累计已确认退款）。 */
  private async loadExistingRequest(
    tx: DbTransaction,
    tenantId: string,
    outRefundNo: string,
    orderAmountFen: bigint,
  ): Promise<ManualRefundRequestResult> {
    const existing = await tx.paymentRefund.findFirst({
      where: { tenantId, outRefundNo },
      select: {
        id: true,
        outRefundNo: true,
        amountFen: true,
        status: true,
        paymentOrderId: true,
      },
    });
    if (!existing) {
      // 不可达：两个调用点（按 out_refund_no 预查、插入冲突兜底）都已在同一事务内确认这行存在。
      // 真出现说明唯一索引与查询条件不一致，必须暴露出来。
      throw new Error(`refund row disappeared: ${outRefundNo}`);
    }
    const refundedFen = await this.sumConfirmedFen(
      tx,
      tenantId,
      existing.paymentOrderId,
    );
    const order = await tx.paymentOrder.findFirst({
      where: { tenantId, id: existing.paymentOrderId },
      select: { customerProfileId: true },
    });
    const wallet = order
      ? await tx.bossWallet.findFirst({
          where: { tenantId, customerProfileId: order.customerProfileId },
          select: { balanceFen: true },
        })
      : null;
    return {
      refundId: existing.id,
      outRefundNo: existing.outRefundNo,
      // 幂等重放返回该单**当前真实状态**：可能已被确认或撤销，不能假装还是待确认
      status: asRefundStatus(existing.status),
      amountFen: existing.amountFen,
      refundedFen,
      walletBalanceFen: wallet?.balanceFen ?? 0n,
      fullyRefunded: refundedFen >= orderAmountFen,
    };
  }
}
