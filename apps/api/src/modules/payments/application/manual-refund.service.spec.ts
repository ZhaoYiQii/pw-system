import { describe, expect, it } from "vitest";
import type {
  ManualRefundConfirmationResult,
  ManualRefundRepository,
  ManualRefundRequestResult,
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
import { RefundStatusTransitionError } from "../domain/refund-confirmation-state.js";

/**
 * DS-005：人工退款**两步事实流**的纯单测（真库行为由集成测试负责，本任务不跑真库）。
 *
 * 核心事实：登记退款申请 ≠ 已退款。
 * - 登记只写申请与审计，**不扣钱包、不写总账**；额度要预占到「待确认 + 已确认」；
 * - 只有确认（门店已实际退款、财务登记凭据）才扣钱包并冲销总账；
 * - 重复确认必须报冲突，绝不当作幂等成功、绝不二次扣款。
 */

type CreateInput = Parameters<
  ManualRefundRepository["createPendingManualRefund"]
>[0];
type ConfirmInput = Parameters<ManualRefundRepository["confirmManualRefund"]>[0];
type CreateFn = ManualRefundRepository["createPendingManualRefund"];
type ConfirmFn = ManualRefundRepository["confirmManualRefund"];

const ORDER: RefundOrderRecord = {
  id: "order-1",
  outNo: "WX1",
  amountFen: 12800n,
  status: "SUCCESS",
  customerProfileId: "profile-1",
  occupiedFen: 0n,
};

const BASE = {
  tenantId: "t1",
  operatorAccountId: "a1",
  amountFen: 100n,
  reason: "客户要求退",
} as const;

/** 可退 800 分时多退一分的那笔（集中定义，避免断言里散落魔法数字）。 */
const OVER_BY_ONE = { ...BASE, outNo: "WX1", amountFen: 801n } as const;

interface Harness {
  refunds: ManualRefundService;
  created: CreateInput[];
  confirmed: ConfirmInput[];
  /** `findOrderForRefund` 收到的查询条件（用于断言非法入参**不会**查到库里）。 */
  lookups: Array<{ outNo?: string; orderId?: string }>;
}

/** 假仓储：默认找得到订单、登记/确认成功；用 options 注入异常路径。 */
function harness(
  options: {
    order?: RefundOrderRecord | null;
    create?: CreateFn;
    confirm?: ConfirmFn;
  } = {},
): Harness {
  const order = options.order === undefined ? { ...ORDER } : options.order;
  const created: CreateInput[] = [];
  const confirmed: ConfirmInput[] = [];
  const lookups: Array<{ outNo?: string; orderId?: string }> = [];

  const create: CreateFn = async (input) => {
    created.push(input);
    const result: ManualRefundRequestResult = {
      refundId: "refund-1",
      outRefundNo: input.outRefundNo,
      status: "PENDING_CONFIRMATION",
      amountFen: input.amountFen,
      // 登记不动钱：已确认累计仍是 0，余额是**未扣减**的真实余额
      refundedFen: 0n,
      walletBalanceFen: ORDER.amountFen,
      fullyRefunded: false,
    };
    return result;
  };
  const confirm: ConfirmFn = async (input) => {
    confirmed.push(input);
    const result: ManualRefundConfirmationResult = {
      refundId: input.refundId,
      outRefundNo: "MRABC123",
      status: "SUCCEEDED",
      amountFen: 5000n,
      refundedFen: 5000n,
      walletBalanceFen: 7800n,
      fullyRefunded: false,
    };
    return result;
  };

  const repository: ManualRefundRepository = {
    findOrderForRefund: async (_tenantId, input) => {
      lookups.push(input);
      return order ? { ...order } : null;
    },
    createPendingManualRefund: options.create ?? create,
    confirmManualRefund: options.confirm ?? confirm,
  };
  return {
    refunds: new ManualRefundService(repository),
    created,
    confirmed,
    lookups,
  };
}

describe("DS-005：人工退款登记（只登记，不动资金）", () => {
  it("入参校验：金额必须 > 0、必须给单号、原因不能为空；都不写库", async () => {
    const { refunds, created, confirmed } = harness();
    await expect(
      refunds.register({ ...BASE, outNo: "WX1", amountFen: 0n }),
    ).rejects.toBeInstanceOf(RefundInputError);
    await expect(refunds.register({ ...BASE })).rejects.toThrow(
      /需要提供 outNo 或 orderId/,
    );
    await expect(
      refunds.register({ ...BASE, outNo: "WX1", reason: "   " }),
    ).rejects.toThrow(/必须填写退款原因/);
    expect(created).toHaveLength(0);
    expect(confirmed).toHaveLength(0);
  });

  it("支付单不存在 → RefundInputError（HTTP 400）", async () => {
    const { refunds } = harness({ order: null });
    await expect(
      refunds.register({ ...BASE, outNo: "WX1" }),
    ).rejects.toBeInstanceOf(RefundInputError);
  });

  it("支付单号不是 uuid → RefundInputError（400）且不查库；合法 uuid 裁剪后放行", async () => {
    // orderId 直接进 uuid 列：放行到 Prisma 会抛解析错误 → 500，
    // 且原始字符串（可含换行，能伪造日志行）会落进服务端日志。
    const UUID = "44444444-4444-4444-4444-444444444444";
    const { refunds, created, lookups } = harness();
    const invalid = [
      "order-1",
      "44444444-4444-4444-4444-44444444444", // 少一位
      "MRABCDEF",
      `${UUID}\nFAKE`,
    ];
    for (const orderId of invalid) {
      await expect(
        refunds.register({ ...BASE, orderId }),
        JSON.stringify(orderId),
      ).rejects.toBeInstanceOf(RefundInputError);
    }
    await expect(
      refunds.register({ ...BASE, orderId: invalid[0]! }),
    ).rejects.toThrow(/支付单号格式不正确/);
    expect(lookups).toHaveLength(0);
    expect(created).toHaveLength(0);

    // 两端空白先裁掉再校验，查询用的是裁剪后的值
    const ok = await refunds.register({ ...BASE, orderId: `  ${UUID}  ` });
    expect(ok.duplicate).toBe(false);
    expect(lookups).toEqual([{ orderId: UUID }]);
    expect(created).toHaveLength(1);
  });

  it("未支付（PENDING / FAILED）的支付单不许登记退款", async () => {
    for (const status of ["PENDING", "FAILED"]) {
      const { refunds } = harness({ order: { ...ORDER, status } });
      await expect(
        refunds.register({ ...BASE, outNo: "WX1" }),
      ).rejects.toBeInstanceOf(RefundNotAllowedError);
    }
  });

  it("额度预占：可退余额按「待确认 + 已确认」的占用量扣减，超一分拒绝、正好放行", async () => {
    // occupiedFen 里已含一张**尚未确认**的 12000 分申请 → 可退只剩 800 分
    const { refunds, created } = harness({
      order: { ...ORDER, occupiedFen: 12000n },
    });
    await expect(refunds.register(OVER_BY_ONE)).rejects.toThrow(
      /退款金额超过可退余额（可退 800 分，本次 801 分）/,
    );
    expect(created).toHaveLength(0);

    const ok = await refunds.register({
      ...BASE,
      outNo: "WX1",
      amountFen: 800n,
    });
    expect(ok.duplicate).toBe(false);
    expect(created).toHaveLength(1);
  });

  it("事务内复核不通过时如实上抛 409：仓储第二次核算额度（并发登记占满）→ RefundNotAllowedError", async () => {
    // 服务层的额度校验与写库不在同一事务，挡不住并发；权威复核在仓储事务内。
    // 这里断言仓储抛出的拒绝**原样上抛**，不被吞掉、不被改写成成功。
    const { refunds, confirmed } = harness({
      create: async () => {
        throw new RefundNotAllowedError(
          "退款金额超过可退余额（可退 0 分，本次 5000 分）",
        );
      },
    });
    await expect(
      refunds.register({ ...BASE, outNo: "WX1", amountFen: 5000n }),
    ).rejects.toBeInstanceOf(RefundNotAllowedError);
    await expect(
      refunds.register({ ...BASE, outNo: "WX1", amountFen: 5000n }),
    ).rejects.toThrow(/退款金额超过可退余额（可退 0 分，本次 5000 分）/);
    // 带幂等键时服务层不预判额度（避免误伤重试），但**新**申请超额同样会被仓储拒绝：
    // 「不预判」不等于「没人管」，权威复核始终在事务内。
    await expect(
      refunds.register({
        ...BASE,
        outNo: "WX1",
        amountFen: 5000n,
        idempotencyKey: "req-new",
      }),
    ).rejects.toThrow(/退款金额超过可退余额（可退 0 分，本次 5000 分）/);
    expect(confirmed).toHaveLength(0);
  });

  it("正常登记：透传订单/金额/原因/操作人，生成 out_refund_no，且**不触发确认**", async () => {
    const { refunds, created, confirmed } = harness();
    const result = await refunds.register({
      tenantId: "t1",
      operatorAccountId: "account-9",
      outNo: "WX1",
      amountFen: 5000n,
      reason: "  客户临时取消  ",
    });
    expect(result.duplicate).toBe(false);
    expect(result.refund.status).toBe("PENDING_CONFIRMATION");
    expect(result.refund.amountFen).toBe(5000n);
    // 登记不动钱：响应里是**真实未扣减**余额，不是「已扣后余额」（12800 − 5000 = 7800）；
    // 累计已确认退款仍是 0（本笔待确认不计入）
    expect(result.refund.walletBalanceFen).toBe(12800n);
    expect(result.refund.walletBalanceFen).not.toBe(7800n);
    expect(result.refund.refundedFen).toBe(0n);
    expect(created).toHaveLength(1);
    expect(created[0]).toMatchObject({
      tenantId: "t1",
      orderId: "order-1",
      customerProfileId: "profile-1",
      amountFen: 5000n,
      // 原因两端空白被裁掉，避免审计里出现只有空格的「原因」
      reason: "客户临时取消",
      operatorAccountId: "account-9",
    });
    expect(created[0]!.outRefundNo).toMatch(/^MR[0-9A-Z]{10,32}$/);
    // 登记路径绝不触碰确认：这是「申请 ≠ 已退款」的守门断言
    expect(confirmed).toHaveLength(0);
  });

  it("幂等键重复：仓储报冲突 → 返回已申请的那笔（duplicate=true），不再产生第二张申请", async () => {
    const existing: ManualRefundRequestResult = {
      refundId: "refund-existing",
      outRefundNo: "MRDUPLICATE",
      status: "PENDING_CONFIRMATION",
      amountFen: 5000n,
      refundedFen: 0n,
      walletBalanceFen: 12800n,
      fullyRefunded: false,
    };
    const { refunds, confirmed } = harness({
      create: async () => {
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
    expect(confirmed).toHaveLength(0);
  });

  it("回归：支付 12800 首次登记 8000 后，同幂等键重试必须 duplicate=true，不被「可退 4800」误拒", async () => {
    // 首次登记后那张申请自己占着 8000，可退只剩 4800；重试金额仍是 8000。
    // 若在识别重试**之前**先做额度校验，就会拿 8000 去比 4800 而误报 409 —— 本用例守的就是这个顺序：
    // 识别幂等重试必须先于额度校验，额度校验只对真正的新申请执行。
    const existing: ManualRefundRequestResult = {
      refundId: "refund-8000",
      outRefundNo: buildOutRefundNo("key-8000", ORDER.id),
      status: "PENDING_CONFIRMATION",
      amountFen: 8000n,
      refundedFen: 0n,
      walletBalanceFen: 12800n,
      fullyRefunded: false,
    };
    let registered = false;
    const created: CreateInput[] = [];
    const repository: ManualRefundRepository = {
      // 首笔登记成功后，这一张就把 8000 占住了
      findOrderForRefund: async () => ({
        ...ORDER,
        occupiedFen: registered ? 8000n : 0n,
      }),
      createPendingManualRefund: async (input) => {
        created.push(input);
        // 仓储在事务里**先**按 (tenant_id, out_refund_no) 识别出这是重试
        if (registered) throw new DuplicateRefundError(existing);
        registered = true;
        return { ...existing, outRefundNo: input.outRefundNo };
      },
      confirmManualRefund: async () => {
        throw new Error("登记路径不得调用确认");
      },
    };
    const refunds = new ManualRefundService(repository);
    const request = {
      tenantId: "t1",
      operatorAccountId: "a1",
      outNo: "WX1",
      amountFen: 8000n,
      reason: "客户要求退",
      idempotencyKey: "key-8000",
    } as const;

    const first = await refunds.register(request);
    expect(first.duplicate).toBe(false);
    expect(first.refund.amountFen).toBe(8000n);

    // 同幂等键、同金额重试：必须原样返回已登记的那张，而不是被「可退 4800」拒掉
    const retry = await refunds.register(request);
    expect(retry.duplicate).toBe(true);
    expect(retry.refund).toEqual(existing);
    // 第二次也走到了仓储（且用的是同一个确定性的 out_refund_no）：证明确实没被服务层提前拦下
    expect(created).toHaveLength(2);
    expect(created[1]!.outRefundNo).toBe(existing.outRefundNo);
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
    expect(buildOutRefundNo(undefined, "order-1")).toMatch(/^MR[0-9A-Z]+$/);
  });
});

describe("DS-005：退款确认（门店已实际退款后登记资金事实）", () => {
  /** `payment_refunds.id` 是 uuid，确认入参必须用真实形状的 id。 */
  const REFUND_ID = "44444444-4444-4444-4444-444444444444";
  const CONFIRM = {
    tenantId: "t1",
    operatorAccountId: "account-9",
    refundId: REFUND_ID,
    evidenceRef: "WX-REFUND_2026-09-24",
  } as const;

  it("确认成功：透传退款单号、凭据号、操作人，并带上本次确认时间", async () => {
    const { refunds, confirmed, created } = harness();
    const result = await refunds.confirm(CONFIRM);

    expect(created).toHaveLength(0);
    expect(confirmed).toHaveLength(1);
    expect(confirmed[0]).toMatchObject({
      tenantId: "t1",
      refundId: REFUND_ID,
      evidenceRef: "WX-REFUND_2026-09-24",
      operatorAccountId: "account-9",
    });
    expect(confirmed[0]!.confirmedAt).toBeInstanceOf(Date);

    expect(result.duplicate).toBe(false);
    expect(result.refund.status).toBe("SUCCEEDED");
    expect(result.refund.amountFen).toBe(5000n);
    expect(result.refund.walletBalanceFen).toBe(7800n);
    expect(result.refund.fullyRefunded).toBe(false);
  });

  it("凭据号两端空白先裁掉再校验：加空格的 WX-1 与 WX-1 等价", async () => {
    const { refunds, confirmed } = harness();
    await refunds.confirm({ ...CONFIRM, evidenceRef: "   WX-1   " });
    expect(confirmed[0]!.evidenceRef).toBe("WX-1");
  });

  it("非法凭据号一律拒绝且**不调用仓储**：空、超长、空格、斜杠、中文、控制字符", async () => {
    const invalid = [
      "",
      "   ",
      "a".repeat(65),
      "WX 1",
      "WX/1",
      "../etc/passwd",
      "凭证-1",
      `WX${String.fromCharCode(9)}1`,
      "WX#1",
      "WX.1",
    ];
    for (const evidenceRef of invalid) {
      const { refunds, confirmed } = harness();
      await expect(
        refunds.confirm({ ...CONFIRM, evidenceRef }),
        JSON.stringify(evidenceRef),
      ).rejects.toBeInstanceOf(RefundInputError);
      expect(confirmed, JSON.stringify(evidenceRef)).toHaveLength(0);
    }
    // 边界：恰好 64 位合法字符必须放行，避免把上限设成 63
    const atLimit = harness();
    await atLimit.refunds.confirm({
      ...CONFIRM,
      evidenceRef: "a".repeat(64),
    });
    expect(atLimit.confirmed).toHaveLength(1);
  });

  it("退款单不存在 → RefundInputError（HTTP 400）", async () => {
    const { refunds } = harness({
      confirm: async () => {
        throw new RefundInputError("退款单不存在");
      },
    });
    await expect(refunds.confirm(CONFIRM)).rejects.toBeInstanceOf(
      RefundInputError,
    );
  });

  it("已确认再次确认 → 上抛状态冲突（409），绝不当幂等成功、绝不二次扣款", async () => {
    const { refunds } = harness({
      confirm: async () => {
        // 复用 DS-004 状态机：SUCCEEDED 是终态，不能再次确认
        throw new RefundStatusTransitionError("SUCCEEDED", "SUCCEEDED");
      },
    });
    await expect(refunds.confirm(CONFIRM)).rejects.toBeInstanceOf(
      RefundStatusTransitionError,
    );
    // 冲突被如实上抛（含 DS-004 文案），没有被翻译成 duplicate=true
    await expect(refunds.confirm(CONFIRM)).rejects.toThrow(
      /退款状态不允许从 SUCCEEDED 变更为 SUCCEEDED/,
    );
  });

  it("钱包余额不足 → RefundInsufficientBalanceError（HTTP 409），消息带两个数字", async () => {
    const { refunds } = harness({
      confirm: async () => {
        throw new InsufficientWalletBalanceError(300n, 5000n);
      },
    });
    await expect(refunds.confirm(CONFIRM)).rejects.toBeInstanceOf(
      RefundInsufficientBalanceError,
    );
    await expect(refunds.confirm(CONFIRM)).rejects.toThrow(
      /客户钱包余额不足（余额 300 分，本次退款 5000 分），请先人工核对账目/,
    );
  });

  it("缺少退款单号或格式不是 uuid → RefundInputError（400），不调用仓储", async () => {
    const { refunds, confirmed } = harness();
    await expect(
      refunds.confirm({ ...CONFIRM, refundId: "   " }),
    ).rejects.toBeInstanceOf(RefundInputError);
    // 格式不对必须在服务层拦下：放行到 Prisma 会抛 uuid 解析错误 → 客户端输入错误被伪装成 500
    await expect(
      refunds.confirm({ ...CONFIRM, refundId: "MRABC123" }),
    ).rejects.toThrow(/退款单号格式不正确/);
    await expect(
      refunds.confirm({
        ...CONFIRM,
        refundId: "44444444-4444-4444-4444-44444444444", // 少一位
      }),
    ).rejects.toBeInstanceOf(RefundInputError);
    expect(confirmed).toHaveLength(0);
  });
});
