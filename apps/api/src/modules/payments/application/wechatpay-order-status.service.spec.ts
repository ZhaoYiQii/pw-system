import { describe, expect, it } from "vitest";
import { WechatPayCheckoutService } from "./wechatpay-checkout.service.js";
import type { CheckoutRepository } from "./checkout-ports.js";
import { PrepayInputError } from "../domain/payments.errors.js";

/**
 * S4-6a：客户查自己的支付单状态（结果页轮询用，零凭证）。
 * 关键判据：① 不需要微信凭证也能答；② 跨客户/跨租户查不到（仓储按租户+客户过滤）；
 * ③ `credited` 只在回调已把状态变成 SUCCESS 时为 true。
 */

function harness(input: {
  payer?: { customerProfileId: string; spOpenid: string | null } | null;
  order?: {
    outNo: string;
    status: string;
    amountFen: bigint;
    paidAt: Date | null;
  } | null;
}) {
  const calls: Array<Record<string, unknown>> = [];
  const repository: CheckoutRepository = {
    findTenantPaymentAccount: async () => null,
    findCustomerPayerIdentity: async () =>
      input.payer === undefined
        ? { customerProfileId: "profile-1", spOpenid: "oOpenid" }
        : input.payer,
    createPrepayOrder: async () => ({ id: "order-1", outNo: "WX1" }),
    attachPrepayId: async () => undefined,
    findCustomerPaymentOrder: async (query) => {
      calls.push(query);
      return input.order === undefined
        ? {
            outNo: "WX1",
            status: "PENDING",
            amountFen: 12800n,
            paidAt: null,
          }
        : input.order;
    },
  };
  // 注意：client 传 null —— 证明这条链路不依赖微信凭证
  return {
    service: new WechatPayCheckoutService(repository, null),
    calls,
  };
}

describe("S4-6a：客户查支付单状态", () => {
  it("未支付：返回 PENDING 且 credited=false（客户问「付成功了吗」要能答「还没有」）", async () => {
    const { service, calls } = harness({});
    const result = await service.getOrderStatus({
      tenantId: "t1",
      customerAccountId: "a1",
      outTradeNo: "WX1",
    });
    expect(result).toMatchObject({
      outTradeNo: "WX1",
      status: "PENDING",
      amountFen: "12800",
      paidAt: null,
      credited: false,
    });
    // 查询必须带租户与客户档案，不能只按单号
    expect(calls[0]).toMatchObject({
      tenantId: "t1",
      customerProfileId: "profile-1",
      outNo: "WX1",
    });
  });

  it("回调已入账：SUCCESS + credited=true + 带支付时间", async () => {
    const { service } = harness({
      order: {
        outNo: "WX1",
        status: "SUCCESS",
        amountFen: 12800n,
        paidAt: new Date("2026-09-23T02:00:00.000Z"),
      },
    });
    const result = await service.getOrderStatus({
      tenantId: "t1",
      customerAccountId: "a1",
      outTradeNo: "WX1",
    });
    expect(result.credited).toBe(true);
    expect(result.paidAt).toBe("2026-09-23T02:00:00.000Z");
  });

  it("别人的单号 / 不存在的单号 → 一律「支付单不存在」（不泄漏存在性）", async () => {
    const { service } = harness({ order: null });
    await expect(
      service.getOrderStatus({
        tenantId: "t1",
        customerAccountId: "a1",
        outTradeNo: "SOMEONE-ELSE",
      }),
    ).rejects.toBeInstanceOf(PrepayInputError);
  });

  it("没有客户档案 → 明确报错，不返回空壳数据", async () => {
    const { service } = harness({ payer: null });
    await expect(
      service.getOrderStatus({
        tenantId: "t1",
        customerAccountId: "a1",
        outTradeNo: "WX1",
      }),
    ).rejects.toThrow(/客户档案不存在/);
  });
});
