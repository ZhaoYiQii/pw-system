import { describe, expect, it } from "vitest";
import type {
  ManualRefundRepository,
  ManualRefundResult,
  RefundOrderRecord,
} from "./refund-ports.js";
import {
  DuplicateRefundError,
  InsufficientWalletBalanceError,
  ManualRefundService,
  buildOutRefundNo,
} from "./manual-refund.service.js";
import {
  RefundInputError,
  RefundInsufficientBalanceError,
  RefundNotAllowedError,
} from "../domain/payments.errors.js";

/**
 * S4-4：人工退款登记的三条硬规则（纯单测；真库行为由
 * tests/integration/wechatpay-refund.spec.ts 负责）。
 *
 * 规则：只有已支付单可退 / 累计不超支付金额 / 余额扣不成负数 / 幂等键只扣一次。
 */

type ApplyInput = Parameters<ManualRefundRepository["applyManualRefund"]>[0];
type ApplyFn = ManualRefundRepository["applyManualRefund"];

const ORDER: RefundOrderRecord = {
  id: "order-1",
  outNo: "WX1",
  amountFen: 12800n,
  status: "SUCCESS",
  customerProfileId: "profile-1",
  refundedFen: 0n,
};

interface Harness {
  refunds: ManualRefundService;
  calls: ApplyInput[];
}

/** 假仓储：默认找得到订单、登记成功；用 options 注入异常路径。 */
function harness(
  options: { order?: RefundOrderRecord | null; apply?: ApplyFn } = {},
): Harness {
  const order = options.order === undefined ? { ...ORDER } : options.order;
  const calls: ApplyInput[] = [];
  const apply: ApplyFn = async (input) => {
    calls.push(input);
    const result: ManualRefundResult = {
      refundId: "refund-1",
      outRefundNo: input.outRefundNo,
      amountFen: input.amountFen,
      refundedFen: input.amountFen,
      walletBalanceFen: input.orderAmountFen - input.amountFen,
      fullyRefunded: input.amountFen >= input.orderAmountFen,
    };
    return result;
  };
  const repository: ManualRefundRepository = {
    findOrderForRefund: async () => (order ? { ...order } : null),
    applyManualRefund: options.apply ?? apply,
  };
  return { refunds: new ManualRefundService(repository), calls };
}

const BASE = {
  tenantId: "t1",
  operatorAccountId: "a1",
  amountFen: 100n,
  reason: "客户要求退",
} as const;

describe("S4-4：人工退款登记", () => {
  it("入参校验：金额必须 > 0、必须给单号、原因不能为空；都不写库", async () => {
    const { refunds, calls } = harness();
    await expect(
      refunds.register({ ...BASE, outNo: "WX1", amountFen: 0n }),
    ).rejects.toBeInstanceOf(RefundInputError);
    await expect(refunds.register({ ...BASE })).rejects.toThrow(
      /需要提供 outNo 或 orderId/,
    );
    await expect(
      refunds.register({ ...BASE, outNo: "WX1", reason: "   " }),
    ).rejects.toThrow(/必须填写退款原因/);
    expect(calls).toHaveLength(0);
  });

  it("支付单不存在 → RefundInputError（HTTP 400）", async () => {
    const { refunds } = harness({ order: null });
    await expect(
      refunds.register({ ...BASE, outNo: "WX1" }),
    ).rejects.toBeInstanceOf(RefundInputError);
  });

  it("未支付（PENDING / FAILED）的支付单不许登记退款", async () => {
    for (const status of ["PENDING", "FAILED"]) {
      const { refunds } = harness({ order: { ...ORDER, status } });
      await expect(
        refunds.register({ ...BASE, outNo: "WX1" }),
      ).rejects.toBeInstanceOf(RefundNotAllowedError);
    }
  });

  it("累计退款不得超过支付金额：超一分拒绝，正好等于可退余额放行", async () => {
    const { refunds } = harness({
      order: { ...ORDER, refundedFen: 12000n },
    });
    await expect(
      refunds.register({ ...BASE, outNo: "WX1", amountFen: 801n }),
    ).rejects.toThrow(/退款金额超过可退余额（可退 800 分，本次 801 分）/);
    const ok = await refunds.register({
      ...BASE,
      outNo: "WX1",
      amountFen: 800n,
    });
    expect(ok.duplicate).toBe(false);
    expect(ok.refund.amountFen).toBe(800n);
  });

  it("正常登记：透传订单/金额/原因/操作人，并生成 out_refund_no", async () => {
    const { refunds, calls } = harness();
    const result = await refunds.register({
      tenantId: "t1",
      operatorAccountId: "account-9",
      outNo: "WX1",
      amountFen: 5000n,
      reason: "  客户临时取消  ",
    });
    expect(result.duplicate).toBe(false);
    expect(result.refund.amountFen).toBe(5000n);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      tenantId: "t1",
      orderId: "order-1",
      customerProfileId: "profile-1",
      orderAmountFen: 12800n,
      amountFen: 5000n,
      // 原因两端空白被裁掉，避免审计里出现只有空格的"原因"
      reason: "客户临时取消",
      operatorAccountId: "account-9",
    });
    expect(calls[0]!.outRefundNo).toMatch(/^MR[0-9A-Z]{10,32}$/);
  });

  it("幂等键重复：仓储报冲突 → 返回已登记的那笔（duplicate=true），不再扣钱", async () => {
    const existing: ManualRefundResult = {
      refundId: "refund-existing",
      outRefundNo: "MRDUPLICATE",
      amountFen: 5000n,
      refundedFen: 5000n,
      walletBalanceFen: 7800n,
      fullyRefunded: false,
    };
    const { refunds } = harness({
      apply: async () => {
        throw new DuplicateRefundError(existing);
      },
    });
    const result = await refunds.register({
      ...BASE,
      outNo: "WX1",
      amountFen: 5000n,
      idempotencyKey: "req-1",
    });
    expect(result.duplicate).toBe(true);
    expect(result.refund).toEqual(existing);
  });

  it("钱包余额不足 → RefundInsufficientBalanceError（HTTP 409），消息带两个数字", async () => {
    const { refunds } = harness({
      apply: async () => {
        throw new InsufficientWalletBalanceError(300n, 5000n);
      },
    });
    await expect(
      refunds.register({ ...BASE, outNo: "WX1", amountFen: 5000n }),
    ).rejects.toBeInstanceOf(RefundInsufficientBalanceError);
    await expect(
      refunds.register({ ...BASE, outNo: "WX1", amountFen: 5000n }),
    ).rejects.toThrow(
      /客户钱包余额不足（余额 300 分，本次退款 5000 分），请先人工核对账目/,
    );
  });

  it("out_refund_no：同（支付单, 幂等键）确定性一致；换订单或换键不撞号；只含字母数字且不超长", () => {
    const a = buildOutRefundNo("req-1", "order-1");
    const b = buildOutRefundNo("req-1", "order-1");
    const sameKeyOtherOrder = buildOutRefundNo("req-1", "order-2");
    const sameOrderOtherKey = buildOutRefundNo("req-2", "order-1");
    expect(a).toBe(b);
    expect(new Set([a, sameKeyOtherOrder, sameOrderOtherKey]).size).toBe(3);
    for (const value of [a, sameKeyOtherOrder, sameOrderOtherKey]) {
      expect(value).toMatch(/^[A-Za-z0-9]+$/);
      expect(value.length).toBeLessThanOrEqual(64);
    }
    // 无幂等键：每次都是一笔新退款（时间戳+随机），格式仍然合法
    expect(buildOutRefundNo(undefined, "order-1")).toMatch(/^MR[0-9A-Z]+$/);
  });
});
