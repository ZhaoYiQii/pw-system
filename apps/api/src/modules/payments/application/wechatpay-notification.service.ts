import type { WechatPayPartnerClient } from "../infrastructure/wechatpay-partner.client.js";
import {
  WechatPayDisabledError,
  WechatPayPayloadError,
  WechatPaySignatureError,
} from "../domain/payments.errors.js";
import type { InboxEventRecord, PaymentsRepository } from "./payments-ports.js";

/**
 * S4-2：微信支付回调管线（服务商模式）。
 *
 * 两段式，是刻意的：
 *  1. `ingest()`：**只做验签 + 落库**。官方要求 5 秒内验签并应答，且最多重试 15 次——
 *     所以入口绝不在这里做业务（解密/入账），否则一次慢查询就可能丢单。
 *  2. `processPending()`：由 worker 逐行解密、校验、入账；失败的行**不标记已处理**，
 *     下一轮重试并留在收件箱里，成为可见的运维信号。
 *
 * 幂等有三层：收件箱 `(provider, event_id)` 唯一、支付单状态守卫、钱包行锁。
 */

const PROVIDER = "wechatpay_partner";
const SUCCESS_EVENT = "TRANSACTION.SUCCESS";

interface DecryptedTransaction {
  out_trade_no?: string;
  transaction_id?: string;
  trade_state?: string;
  success_time?: string;
  amount?: { total?: number; payer_total?: number; currency?: string };
}

export class WechatPayNotificationService {
  constructor(
    private readonly repository: PaymentsRepository,
    private readonly client: WechatPayPartnerClient | null,
  ) {}

  /** 回调入口：验签 → 落收件箱 → 立刻返回（业务处理交给 worker）。 */
  async ingest(input: {
    headers: Record<string, string | undefined>;
    rawBody: string;
  }): Promise<{ accepted: true; duplicate: boolean; eventId: string }> {
    const client = this.requireClient();
    if (
      !client.verifyNotification({
        headers: input.headers,
        rawBody: input.rawBody,
      })
    ) {
      throw new WechatPaySignatureError();
    }
    const event = parseEvent(input.rawBody);
    const saved = await this.repository.saveInboxEvent({
      provider: PROVIDER,
      eventId: event.id,
      eventType: event.eventType,
      headers: toHeaderMap(input.headers),
      rawBody: input.rawBody,
      signatureVerified: true,
    });
    // 同一事件重复投递（微信重试）：按幂等成功应答，绝不让它继续重试。
    return { accepted: true, duplicate: saved === null, eventId: event.id };
  }

  /** worker 每轮处理一批未处理的回调。 */
  async processPending(
    limit = 20,
    now: Date = new Date(),
  ): Promise<{ processed: number; skipped: number; failed: number }> {
    const client = this.requireClient();
    const rows = await this.repository.listUnprocessedInbox(limit);
    let processed = 0;
    let skipped = 0;
    let failed = 0;
    for (const row of rows) {
      try {
        const outcome = await this.applyRow(client, row, now);
        if (outcome === "processed") processed += 1;
        else skipped += 1;
        await this.repository.markInboxProcessed(row.id, now);
      } catch (error) {
        failed += 1;
        console.error(
          JSON.stringify({
            scope: "wechatpay-notification",
            eventId: row.eventId,
            eventType: row.eventType,
            outcome: "failed",
            message: error instanceof Error ? error.message : String(error),
          }),
        );
      }
    }
    return { processed, skipped, failed };
  }

  /** 单行处理；返回 processed 表示"确实入账了"，skipped 表示"无需入账/已处理过"。 */
  private async applyRow(
    client: WechatPayPartnerClient,
    row: InboxEventRecord,
    now: Date,
  ): Promise<"processed" | "skipped"> {
    const event = parseEvent(row.rawBody);
    if (
      event.eventType !== SUCCESS_EVENT ||
      event.eventType !== row.eventType
    ) {
      return "skipped";
    }
    const resource = event.resource;
    if (!resource?.ciphertext || !resource.nonce) {
      throw new WechatPayPayloadError("回调缺少 resource.ciphertext/nonce");
    }
    const transaction = client.decryptNotificationResource({
      ciphertext: resource.ciphertext,
      nonce: resource.nonce,
      ...(resource.associated_data !== undefined
        ? { associated_data: resource.associated_data }
        : {}),
    }) as DecryptedTransaction;

    const outTradeNo = transaction.out_trade_no ?? "";
    if (!outTradeNo) throw new WechatPayPayloadError("回调缺少 out_trade_no");

    const order = await this.repository.findPaymentOrderByOutNo(outTradeNo);
    if (!order) {
      // 没有对应支付单：**不标记已处理**，留在收件箱里等人工/对账介入
      throw new WechatPayPayloadError(`支付单不存在：${outTradeNo}`);
    }
    // 只有真正支付成功的通知才入账；其它状态（如退款相关事件走另一条回调）忽略
    if (transaction.trade_state !== "SUCCESS") return "skipped";

    const paidFen = BigInt(transaction.amount?.total ?? 0);
    if (paidFen !== order.amountFen) {
      await this.repository.recordDifference({
        tenantId: order.tenantId,
        kind: "AMOUNT_MISMATCH",
        paymentOrderId: order.id,
        amountFen: paidFen,
        detail: `回调金额 ${paidFen} 与支付单 ${order.amountFen} 不一致（out_trade_no=${outTradeNo}）`,
      });
      return "skipped";
    }

    const transactionId = transaction.transaction_id ?? "";
    if (!transactionId)
      throw new WechatPayPayloadError("回调缺少 transaction_id");
    if (order.status === "SUCCESS" && order.transactionId === transactionId) {
      return "skipped"; // 幂等：这笔已经入过账
    }

    const paidAt = transaction.success_time
      ? new Date(transaction.success_time)
      : now;
    const result = await this.repository.settlePaymentOrder({
      tenantId: order.tenantId,
      orderId: order.id,
      transactionId,
      paidAt,
      reason: "微信支付充值",
    });
    return result.credited ? "processed" : "skipped";
  }

  private requireClient(): WechatPayPartnerClient {
    if (!this.client) throw new WechatPayDisabledError();
    return this.client;
  }
}

interface ParsedEvent {
  id: string;
  eventType: string | null;
  resource?: { ciphertext?: string; nonce?: string; associated_data?: string };
}

function parseEvent(rawBody: string): ParsedEvent {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBody);
  } catch {
    throw new WechatPayPayloadError("回调报文不是合法 JSON");
  }
  const body = parsed as {
    id?: unknown;
    event_type?: unknown;
    resource?: {
      ciphertext?: unknown;
      nonce?: unknown;
      associated_data?: unknown;
    };
  };
  if (typeof body.id !== "string" || body.id === "") {
    throw new WechatPayPayloadError("回调缺少 id");
  }
  return {
    id: body.id,
    eventType: typeof body.event_type === "string" ? body.event_type : null,
    ...(body.resource
      ? {
          resource: {
            ...(typeof body.resource.ciphertext === "string"
              ? { ciphertext: body.resource.ciphertext }
              : {}),
            ...(typeof body.resource.nonce === "string"
              ? { nonce: body.resource.nonce }
              : {}),
            ...(typeof body.resource.associated_data === "string"
              ? { associated_data: body.resource.associated_data }
              : {}),
          },
        }
      : {}),
  };
}

function toHeaderMap(
  headers: Record<string, string | undefined>,
): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    if (
      typeof value === "string" &&
      key.toLowerCase().startsWith("wechatpay-")
    ) {
      result[key.toLowerCase()] = value;
    }
  }
  return result;
}
