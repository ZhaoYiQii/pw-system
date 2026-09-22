import { createPublicKey, generateKeyPairSync } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  WechatPayPartnerClient,
  sha1Hex,
  type WechatPayPartnerConfig,
} from "../infrastructure/wechatpay-partner.client.js";
import {
  WechatPayReconciliationService,
  beijingDayRange,
  beijingHour,
  beijingYesterday,
  classifyDifferences,
  isBillNotReady,
} from "./wechatpay-reconciliation.service.js";
import type {
  LocalPaymentOrder,
  ReconciliationRepository,
} from "./reconciliation-ports.js";
import { WechatPayError } from "../infrastructure/wechatpay-partner.client.js";
import type { BillRow } from "./bill-parser.js";

const API_V3_KEY = "0123456789abcdef0123456789abcdef";

const BILL_HEADER =
  "`交易时间,`公众账号ID,`商户号,`特约商户号,`设备号,`微信订单号,`商户订单号,`用户标识,`交易类型,`交易状态," +
  "`付款银行,`货币种类,`应结订单金额,`代金券金额,`微信退款单号,`商户退款单号,`退款金额,`充值券退款金额,`退款类型," +
  "`退款状态,`商品名称,`商户数据包,`手续费,`费率,`订单金额,`申请退款金额,`费率备注";
const BILL_SUMMARY_HEADER =
  "`总交易单数,`应结订单总金额,`退款总金额,`充值券退款总金额,`手续费总金额,`订单总金额,`申请退款总金额";

function billLine(outTradeNo: string, total: string, state = "SUCCESS") {
  return [
    "`2026-09-22 10:00:00",
    "`wxappid",
    "`1900007291",
    "`1900007292",
    "`",
    `\`420000${outTradeNo.replace(/\W/g, "")}`,
    `\`${outTradeNo}`,
    "`oUpF8u",
    "`JSAPI",
    `\`${state}`,
    "`OTHERS",
    "`CNY",
    `\`${total}`,
    "`0.00",
    "`",
    "`",
    `\`${total === "0.00" ? "0.00" : "0.00"}`,
    "`0.00",
    "`",
    "`",
    "`充值",
    "`",
    "`0.05",
    "`0.60%",
    `\`${total}`,
    "`0.00",
    "`726",
  ].join(",");
}

function billText(lines: string[], totalCount: number): string {
  const summaryValues = [
    `\`${totalCount}`,
    "`0.00",
    "`0.00",
    "`0.00",
    "`0.00",
    "`0.00",
    "`0.00",
  ].join(",");
  return [BILL_HEADER, ...lines, "", BILL_SUMMARY_HEADER, summaryValues].join(
    "\n",
  );
}

function clientServingBill(
  text: string | null,
  options: { notReady?: boolean } = {},
) {
  const keyPair = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const config: WechatPayPartnerConfig = {
    spMchid: "1900007291",
    spAppid: "wxappid",
    apiV3Key: API_V3_KEY,
    privateKeyPem: keyPair.privateKey
      .export({ type: "pkcs8", format: "pem" })
      .toString(),
    merchantSerialNo: "SERIAL",
    notifyUrl: "https://h5.17ai.club/notify",
    apiBase: "https://api.mch.weixin.qq.com",
    verifiers: [
      {
        serialNo: "P",
        publicKeyPem: createPublicKey(keyPair.privateKey)
          .export({ type: "spki", format: "pem" })
          .toString(),
      },
    ],
  };
  return new WechatPayPartnerClient(config, async (url) => {
    if (options.notReady) {
      return {
        status: 404,
        text: async () => '{"code":"RESOURCE_NOT_EXISTS"}',
      };
    }
    if (url.includes("/v3/bill/tradebill")) {
      return {
        status: 200,
        text: async () =>
          JSON.stringify({
            hash_type: "SHA1",
            hash_value: sha1Hex(text ?? ""),
            download_url:
              "https://api.mch.weixin.qq.com/v3/billdownload/file?token=x",
          }),
      };
    }
    return { status: 200, text: async () => text ?? "" };
  });
}

function repositoryStub(overrides: Partial<ReconciliationRepository> = {}) {
  const statements: unknown[] = [];
  const differences: unknown[] = [];
  const repository: ReconciliationRepository = {
    listReconcileTargets: async () => [
      { tenantId: "tenant-1", subMchid: "1900007292" },
    ],
    findLocalOrders: async () => [],
    saveStatement: async (input) => {
      statements.push(input);
      return { id: "statement-1", inserted: true };
    },
    recordDifferences: async (inputs) => {
      differences.push(...inputs);
    },
    ...overrides,
  };
  return { repository, statements, differences };
}

const localOrder = (
  overrides: Partial<LocalPaymentOrder> = {},
): LocalPaymentOrder => ({
  id: "order-1",
  outNo: "WX1",
  amountFen: 888n,
  status: "SUCCESS",
  transactionId: "4200001",
  ...overrides,
});

describe("S4-3b：每日对账", () => {
  it("北京时间口径：昨天与小时数（跨零点/跨时区都要对）", () => {
    // 2026-09-23T01:00Z = 北京 09:00 → 昨天 2026-09-22，小时 9（<10，不该拉账单）
    expect(beijingYesterday(new Date("2026-09-23T01:00:00Z"))).toBe(
      "2026-09-22",
    );
    expect(beijingHour(new Date("2026-09-23T01:00:00Z"))).toBe(9);
    // 2026-09-23T02:00Z = 北京 10:00 → 可以拉
    expect(beijingHour(new Date("2026-09-23T02:00:00Z"))).toBe(10);
    // 北京 2026-09-23 00:30 = UTC 2026-09-22T16:30Z → 昨天仍是 09-22
    expect(beijingYesterday(new Date("2026-09-22T16:30:00Z"))).toBe(
      "2026-09-22",
    );
    const range = beijingDayRange("2026-09-22");
    expect(range.start.toISOString()).toBe("2026-09-21T16:00:00.000Z");
    expect(range.end.toISOString()).toBe("2026-09-22T16:00:00.000Z");
  });

  it("账单未生成（404/RESOURCE_NOT_EXISTS）识别为 not_ready，不当成失败", () => {
    expect(
      isBillNotReady(new WechatPayError("RESOURCE_NOT_EXISTS", 404, "无账单")),
    ).toBe(true);
    expect(
      isBillNotReady(new WechatPayError("SYSTEM_ERROR", 500, "系统异常")),
    ).toBe(false);
  });

  it("差异分类：漏单 / 金额不符 / 本地未标记支付 / 本地有微信无；退款行不参与", () => {
    const rows: BillRow[] = [
      { ...billRow("WX1", 888n), tradeState: "SUCCESS" },
      { ...billRow("WX2", 100n), tradeState: "SUCCESS" },
      { ...billRow("WX3", 200n), tradeState: "SUCCESS" },
      { ...billRow("WX1", 0n), tradeState: "REFUND" },
    ];
    const drafts = classifyDifferences({
      tenantId: "tenant-1",
      rows,
      localOrders: [
        localOrder({
          id: "o1",
          outNo: "WX1",
          amountFen: 888n,
          status: "SUCCESS",
        }),
        localOrder({
          id: "o2",
          outNo: "WX2",
          amountFen: 500n,
          status: "SUCCESS",
        }),
        localOrder({
          id: "o4",
          outNo: "WX4",
          amountFen: 300n,
          status: "SUCCESS",
        }),
        localOrder({
          id: "o5",
          outNo: "WX5",
          amountFen: 400n,
          status: "PENDING",
        }),
      ],
    });
    const kinds = drafts.map(
      (draft) => `${draft.kind}:${draft.paymentOrderId ?? "-"}`,
    );
    expect(kinds).toContain("AMOUNT_MISMATCH:o2");
    expect(kinds).toContain("MISSING_LOCAL:-");
    expect(kinds).toContain("MISSING_WECHAT:o4");
    // 本地 PENDING 且账单里没有 → 不算差异（还没付而已）
    expect(kinds).not.toContain("MISSING_WECHAT:o5");
    expect(drafts).toHaveLength(3);
  });

  it("本地标记成功但微信已支付 → STATUS_MISMATCH（回调可能没处理成功）", () => {
    const drafts = classifyDifferences({
      tenantId: "tenant-1",
      rows: [{ ...billRow("WX9", 500n), tradeState: "SUCCESS" }],
      localOrders: [
        localOrder({
          id: "o9",
          outNo: "WX9",
          amountFen: 500n,
          status: "PENDING",
        }),
      ],
    });
    expect(drafts).toHaveLength(1);
    expect(drafts[0]).toMatchObject({
      kind: "STATUS_MISMATCH",
      paymentOrderId: "o9",
    });
  });

  it("服务：账单未生成 → not_ready 且**不落账单记录**", async () => {
    const { repository, statements } = repositoryStub();
    const service = new WechatPayReconciliationService(
      repository,
      clientServingBill(null, { notReady: true }),
    );
    const result = await service.reconcile({
      tenantId: "tenant-1",
      subMchid: "1900007292",
      billDate: "2026-09-22",
    });
    expect(result).toEqual({ outcome: "not_ready", rows: 0, differences: 0 });
    expect(statements).toHaveLength(0);
  });

  it("服务：正常对账 → 落账单记录 + 记录差异；同一份账单第二次只报 already", async () => {
    const text = billText(
      [billLine("WX1", "8.88"), billLine("WX2", "1.00")],
      2,
    );
    let inserted = true;
    const { repository, statements, differences } = repositoryStub({
      findLocalOrders: async () => [
        localOrder({ id: "o1", outNo: "WX1", amountFen: 888n }),
        localOrder({ id: "o4", outNo: "WX4", amountFen: 300n }),
      ],
      saveStatement: async (input) => {
        statements.push(input);
        const result = { id: "statement-1", inserted };
        inserted = false;
        return result;
      },
    });
    const service = new WechatPayReconciliationService(
      repository,
      clientServingBill(text),
    );
    const first = await service.reconcile({
      tenantId: "tenant-1",
      subMchid: "1900007292",
      billDate: "2026-09-22",
    });
    expect(first.outcome).toBe("reconciled");
    expect(first.rows).toBe(2);
    // WX2 微信有本地无 + WX4 本地有微信无
    expect(first.differences).toBe(2);
    const second = await service.reconcile({
      tenantId: "tenant-1",
      subMchid: "1900007292",
      billDate: "2026-09-22",
    });
    expect(second.outcome).toBe("already");
    expect(second.differences).toBe(0);
    expect(differences).toHaveLength(2);
  });

  it("worker 触发：北京时间 10 点前不动作；10 点后对「昨天」的账单", async () => {
    const text = billText([billLine("WX1", "8.88")], 1);
    const before = new WechatPayReconciliationService(
      repositoryStub({
        findLocalOrders: async () => [localOrder({ outNo: "WX1" })],
      }).repository,
      clientServingBill(text),
      () => new Date("2026-09-23T01:00:00Z"), // 北京 09:00
    );
    expect(await before.reconcileDue()).toEqual({
      checked: 0,
      reconciled: 0,
      skipped: 0,
      failed: 0,
    });

    const after = new WechatPayReconciliationService(
      repositoryStub({
        findLocalOrders: async () => [localOrder({ outNo: "WX1" })],
      }).repository,
      clientServingBill(text),
      () => new Date("2026-09-23T02:00:00Z"), // 北京 10:00
    );
    expect(await after.reconcileDue()).toEqual({
      checked: 1,
      reconciled: 1,
      skipped: 0,
      failed: 0,
    });
  });

  it("账单文件 SHA1 与接口摘要不一致 → 报错（不拿着可疑账单对账）", async () => {
    const keyPair = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const config: WechatPayPartnerConfig = {
      spMchid: "1900007291",
      spAppid: "wxappid",
      apiV3Key: API_V3_KEY,
      privateKeyPem: keyPair.privateKey
        .export({ type: "pkcs8", format: "pem" })
        .toString(),
      merchantSerialNo: "SERIAL",
      notifyUrl: "https://h5.17ai.club/notify",
      apiBase: "https://api.mch.weixin.qq.com",
      verifiers: [],
    };
    const client = new WechatPayPartnerClient(config, async (url) => {
      if (url.includes("/v3/bill/tradebill")) {
        return {
          status: 200,
          text: async () =>
            JSON.stringify({
              hash_type: "SHA1",
              hash_value: "deadbeef",
              download_url:
                "https://api.mch.weixin.qq.com/v3/billdownload/file?token=x",
            }),
        };
      }
      return { status: 200, text: async () => billText([], 0) };
    });
    const service = new WechatPayReconciliationService(
      repositoryStub().repository,
      client,
    );
    await expect(
      service.reconcile({
        tenantId: "tenant-1",
        subMchid: "1900007292",
        billDate: "2026-09-22",
      }),
    ).rejects.toThrowError(/SHA1/);
  });
});

function billRow(outTradeNo: string, totalFen: bigint): BillRow {
  return {
    tradeTime: "2026-09-22 10:00:00",
    appId: "wxappid",
    mchid: "1900007291",
    subMchid: "1900007292",
    transactionId: `420000${outTradeNo}`,
    outTradeNo,
    tradeType: "JSAPI",
    tradeState: "SUCCESS",
    totalAmountFen: totalFen,
    settleAmountFen: totalFen,
    refundAmountFen: 0n,
    feeFen: 5n,
    refundId: "",
  };
}
