import { createHash } from "node:crypto";
import type {
  LocalPaymentOrder,
  ReconciliationRepository,
} from "./reconciliation-ports.js";
import { parseTradeBill, type BillRow } from "./bill-parser.js";
import type { WechatPayPartnerClient } from "../infrastructure/wechatpay-partner.client.js";
import { sha1Hex } from "../infrastructure/wechatpay-partner.client.js";
import {
  WechatPayDisabledError,
  WechatPayPayloadError,
} from "../domain/payments.errors.js";

/**
 * S4-3b：每日对账（服务商模式）。
 *
 * 定位：回调是"实时入账"，对账是"事后兜底"——两者缺一不可。
 * 官方口径（partner/4013080599.md / 4012085421.md）：
 * - 账单用**北京时间**的自然日（yyyy-MM-DD），次日 9 点开始生成，建议 **10 点后**获取；
 * - 下载地址 5 分钟有效；下载响应无签名头（跳过验签），完整性靠 **SHA1** 摘要比对；
 * - 金额单位是元、两位小数（解析器已按要求转成整数分）。
 *
 * 差异分类（都会落 `reconciliation_differences`，供人工/后续自动补记）：
 * - `MISSING_LOCAL`：微信账单里有、本地没有（典型是回调丢了）
 * - `AMOUNT_MISMATCH`：金额不一致（**绝不自动入账**）
 * - `STATUS_MISMATCH`：微信已支付、本地状态还不是 SUCCESS（回调没处理成功）
 * - `MISSING_WECHAT`：本地标记成功、账单里没有（要么账单延迟，要么本地被改过）
 *
 * 退款行本片**不参与**分类，避免把同一笔订单的退款行当成支付行。
 * S4-4 的人工退款登记只写 `payment_refunds`、**不改 `payment_orders.status`**，
 * 所以本分类逻辑对退款无感知：支付行照旧按 SUCCESS 比对。
 */

export type ReconcileOutcome = "reconciled" | "already" | "not_ready";

export interface DifferenceDraft {
  tenantId: string;
  kind: string;
  paymentOrderId?: string;
  amountFen?: bigint;
  detail: string;
}

/** 北京时间某一天 → UTC 的 [start, end) 区间。 */
export function beijingDayRange(billDate: string): { start: Date; end: Date } {
  const start = new Date(`${billDate}T00:00:00+08:00`);
  if (Number.isNaN(start.getTime())) {
    throw new WechatPayPayloadError(`账单日期格式非法：${billDate}`);
  }
  return { start, end: new Date(start.getTime() + 24 * 60 * 60 * 1000) };
}

/** 北京时间口径下的"昨天"（yyyy-MM-DD）。 */
export function beijingYesterday(now: Date): string {
  const shifted = new Date(now.getTime() + 8 * 60 * 60 * 1000);
  shifted.setUTCDate(shifted.getUTCDate() - 1);
  return shifted.toISOString().slice(0, 10);
}

/** 北京时间的小时（0-23），用于"10 点前不拉账单"。 */
export function beijingHour(now: Date): number {
  return new Date(now.getTime() + 8 * 60 * 60 * 1000).getUTCHours();
}

/** 账单尚未生成（微信还没出账）——安静跳过，下一轮再试。 */
export function isBillNotReady(error: unknown): boolean {
  const status = (error as { httpStatus?: number }).httpStatus;
  const code = String((error as { code?: string }).code ?? "");
  return status === 404 || /NOT_?EXIST/i.test(code);
}

export function classifyDifferences(input: {
  tenantId: string;
  rows: BillRow[];
  localOrders: LocalPaymentOrder[];
}): DifferenceDraft[] {
  const localByOutNo = new Map(
    input.localOrders.map((order) => [order.outNo, order]),
  );
  const seenInBill = new Set<string>();
  const drafts: DifferenceDraft[] = [];
  for (const row of input.rows) {
    // 只管支付成功行；退款行（订单金额 0.00、带退款单号）留给退款对账
    if (row.tradeState !== "SUCCESS" || row.totalAmountFen <= 0n) continue;
    seenInBill.add(row.outTradeNo);
    const local = localByOutNo.get(row.outTradeNo);
    if (!local) {
      drafts.push({
        tenantId: input.tenantId,
        kind: "MISSING_LOCAL",
        amountFen: row.totalAmountFen,
        detail: `微信账单有、本地无该支付单：${row.outTradeNo}（微信订单号 ${row.transactionId}）`,
      });
      continue;
    }
    if (local.amountFen !== row.totalAmountFen) {
      drafts.push({
        tenantId: input.tenantId,
        kind: "AMOUNT_MISMATCH",
        paymentOrderId: local.id,
        amountFen: row.totalAmountFen,
        detail: `金额不符：本地 ${local.amountFen} 分 / 微信 ${row.totalAmountFen} 分（${row.outTradeNo}）`,
      });
      continue;
    }
    if (local.status !== "SUCCESS") {
      drafts.push({
        tenantId: input.tenantId,
        kind: "STATUS_MISMATCH",
        paymentOrderId: local.id,
        detail: `微信已支付但本地状态为 ${local.status}：${row.outTradeNo}（回调可能未处理成功）`,
      });
    }
  }
  for (const order of input.localOrders) {
    if (order.status !== "SUCCESS") continue;
    if (seenInBill.has(order.outNo)) continue;
    drafts.push({
      tenantId: input.tenantId,
      kind: "MISSING_WECHAT",
      paymentOrderId: order.id,
      detail: `本地标记成功、微信账单里没有：${order.outNo}`,
    });
  }
  return drafts;
}

export class WechatPayReconciliationService {
  constructor(
    private readonly repository: ReconciliationRepository,
    private readonly client: WechatPayPartnerClient | null,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async reconcile(input: {
    tenantId: string;
    subMchid: string;
    billDate: string;
  }): Promise<{
    outcome: ReconcileOutcome;
    rows: number;
    differences: number;
  }> {
    if (!this.client) throw new WechatPayDisabledError();
    const client = this.client;
    const { start, end } = beijingDayRange(input.billDate);

    let handle: { hashType: string; hashValue: string; downloadUrl: string };
    try {
      handle = await client.requestTradeBill({
        billDate: input.billDate,
        subMchid: input.subMchid,
      });
    } catch (error) {
      if (isBillNotReady(error)) {
        return { outcome: "not_ready", rows: 0, differences: 0 };
      }
      throw error;
    }

    const text = await client.downloadBillText(handle.downloadUrl);
    const officialHash = sha1Hex(text);
    if (officialHash.toLowerCase() !== handle.hashValue.toLowerCase()) {
      throw new WechatPayPayloadError(
        `账单文件 SHA1 与接口摘要不一致（我方 ${officialHash} / 微信 ${handle.hashValue}）`,
      );
    }
    const parsed = parseTradeBill(text);

    const statement = await this.repository.saveStatement({
      tenantId: input.tenantId,
      subMchid: input.subMchid,
      billType: "ALL",
      billDate: input.billDate,
      // 列名是 file_sha256：存**我们自己的** SHA-256 作为文件标识；
      // 微信侧完整性用上面的 SHA1 校验，两者用途不同，别混。
      fileSha256: createHash("sha256").update(text, "utf8").digest("hex"),
      totalCount: parsed.summary.totalCount,
      totalFen: parsed.summary.orderTotalFen,
    });
    if (!statement.inserted) {
      return { outcome: "already", rows: parsed.rows.length, differences: 0 };
    }

    const localOrders = await this.repository.findLocalOrders(
      input.tenantId,
      start,
      end,
    );
    const drafts = classifyDifferences({
      tenantId: input.tenantId,
      rows: parsed.rows,
      localOrders,
    });
    if (drafts.length > 0) await this.repository.recordDifferences(drafts);
    return {
      outcome: "reconciled",
      rows: parsed.rows.length,
      differences: drafts.length,
    };
  }

  /**
   * worker 每轮调用：**北京时间 10 点前不动**（官方：次日 9 点开始生成、建议 10 点后获取），
   * 之后对每个 ACTIVE 子商户对「昨天」的账单；已对过或账单未生成的都安静跳过。
   */
  async reconcileDue(limit = 5): Promise<{
    checked: number;
    reconciled: number;
    skipped: number;
    failed: number;
  }> {
    if (!this.client)
      return { checked: 0, reconciled: 0, skipped: 0, failed: 0 };
    const now = this.now();
    if (beijingHour(now) < 10) {
      return { checked: 0, reconciled: 0, skipped: 0, failed: 0 };
    }
    const billDate = beijingYesterday(now);
    const targets = (await this.repository.listReconcileTargets()).slice(
      0,
      limit,
    );
    let reconciled = 0;
    let skipped = 0;
    let failed = 0;
    for (const target of targets) {
      try {
        const result = await this.reconcile({
          tenantId: target.tenantId,
          subMchid: target.subMchid,
          billDate,
        });
        if (result.outcome === "reconciled") reconciled += 1;
        else skipped += 1;
      } catch (error) {
        failed += 1;
        console.error(
          JSON.stringify({
            scope: "wechatpay-reconciliation",
            tenantId: target.tenantId,
            subMchid: target.subMchid,
            billDate,
            outcome: "failed",
            message: error instanceof Error ? error.message : String(error),
          }),
        );
      }
    }
    return { checked: targets.length, reconciled, skipped, failed };
  }
}
