import { createPublicKey, generateKeyPairSync } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDatabaseClient } from "@pw/database";
import type { PrismaClient } from "@pw/database";
import {
  WechatPayPartnerClient,
  sha1Hex,
  type WechatPayPartnerConfig,
} from "../../apps/api/src/modules/payments/infrastructure/wechatpay-partner.client.js";
import { PrismaReconciliationRepository } from "../../apps/api/src/modules/payments/infrastructure/prisma-reconciliation.repository.js";
import { WechatPayReconciliationService } from "../../apps/api/src/modules/payments/application/wechatpay-reconciliation.service.js";

/**
 * S4-3b：对账的**真库**验证——账单与本地支付单比对、差异落库、同一份账单幂等。
 * 真假账单用官方表头 + 官方金额单位（元/两位小数）构造，SHA1 与接口摘要一致。
 */

const suffix = Date.now().toString(36);
const BILL_DATE = "2026-09-22";
const DAY_START_UTC = new Date("2026-09-21T16:00:00.000Z"); // 北京 09-22 00:00
const API_V3_KEY = "0123456789abcdef0123456789abcdef";
const keyPair = generateKeyPairSync("rsa", { modulusLength: 2048 });
const privateKeyPem = keyPair.privateKey
  .export({ type: "pkcs8", format: "pem" })
  .toString();

const BILL_HEADER =
  "`交易时间,`公众账号ID,`商户号,`特约商户号,`设备号,`微信订单号,`商户订单号,`用户标识,`交易类型,`交易状态," +
  "`付款银行,`货币种类,`应结订单金额,`代金券金额,`微信退款单号,`商户退款单号,`退款金额,`充值券退款金额,`退款类型," +
  "`退款状态,`商品名称,`商户数据包,`手续费,`费率,`订单金额,`申请退款金额,`费率备注";
const BILL_SUMMARY_HEADER =
  "`总交易单数,`应结订单总金额,`退款总金额,`充值券退款总金额,`手续费总金额,`订单总金额,`申请退款总金额";

function billLine(outTradeNo: string, totalYuan: string) {
  return [
    "`2026-09-22 10:00:00",
    "`wxappid",
    "`1900007291",
    "`1900007292",
    "`",
    `\`420000${outTradeNo}`,
    `\`${outTradeNo}`,
    "`oUpF8u",
    "`JSAPI",
    "`SUCCESS",
    "`OTHERS",
    "`CNY",
    `\`${totalYuan}`,
    "`0.00",
    "`",
    "`",
    "`0.00",
    "`0.00",
    "`",
    "`",
    "`陪玩充值",
    "`",
    "`0.05",
    "`0.60%",
    `\`${totalYuan}`,
    "`0.00",
    "`726",
  ].join(",");
}

function envOrThrow(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`missing env ${name}`);
  return value;
}

describe("wechatpay 每日对账（真库）", () => {
  let owner: PrismaClient;
  let runtime: PrismaClient;
  let service: WechatPayReconciliationService;
  let tenantId: string;
  const outNos = [
    `WXOK${suffix}`,
    `WXMIS${suffix}`,
    `WXLOCAL${suffix}`,
    `WXUNKNOWN${suffix}`,
  ];

  beforeAll(async () => {
    owner = createDatabaseClient(envOrThrow("PW_TEST_MIGRATION_URL"));
    runtime = createDatabaseClient(envOrThrow("PW_TEST_RUNTIME_URL"));

    const tenant = await owner.tenant.create({
      data: { code: `wxrecon_${suffix}`, name: "对账集成测试店" },
    });
    tenantId = tenant.id;
    await owner.tenantPaymentAccount.create({
      data: {
        tenantId,
        subMchid: "1900007292",
        applyNo: `APPLY-RECON-${suffix}`,
        status: "ACTIVE",
      },
    });
    const account = await owner.tenantAccount.create({
      data: {
        tenantId,
        username: `wxrecon_${suffix}`,
        passwordHash: "scrypt:test:test",
      },
    });
    const profile = await owner.customerProfile.create({
      data: { tenantId, tenantAccountId: account.id, name: "对账客户" },
    });

    // 本地三笔：与账单一致的、金额不符的、账单里没有的
    for (const [outNo, amountFen] of [
      [outNos[0]!, 888n],
      [outNos[1]!, 500n],
      [outNos[2]!, 300n],
    ] as const) {
      await owner.paymentOrder.create({
        data: {
          tenantId,
          customerProfileId: profile.id,
          outNo,
          amountFen,
          provider: "wechatpay_partner",
          status: "SUCCESS",
          transactionId: `420000${outNo}`,
          paidAt: new Date(DAY_START_UTC.getTime() + 10 * 60 * 60 * 1000),
          subMchid: "1900007292",
          spMchid: "1900007291",
        },
      });
    }

    // 账单：WXOK 金额一致、WXMIS 金额 1.00（本地 5.00）、WXUNKNOWN 微信有本地无
    const billText = [
      BILL_HEADER,
      billLine(outNos[0]!, "8.88"),
      billLine(outNos[1]!, "1.00"),
      billLine(outNos[3]!, "2.00"),
      "",
      BILL_SUMMARY_HEADER,
      "`3,`11.88,`0.00,`0.00,`0.15,`11.88,`0.00",
    ].join("\n");

    const config: WechatPayPartnerConfig = {
      spMchid: "1900007291",
      spAppid: "wxappid",
      apiV3Key: API_V3_KEY,
      privateKeyPem,
      merchantSerialNo: "SERIAL",
      notifyUrl: "https://h5.17ai.club/api/v1/payments/wechatpay/notify",
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
    const client = new WechatPayPartnerClient(config, async (url) => {
      if (url.includes("/v3/bill/tradebill")) {
        return {
          status: 200,
          text: async () =>
            JSON.stringify({
              hash_type: "SHA1",
              hash_value: sha1Hex(billText),
              download_url:
                "https://api.mch.weixin.qq.com/v3/billdownload/file?token=x",
            }),
        };
      }
      return { status: 200, text: async () => billText };
    });
    service = new WechatPayReconciliationService(
      new PrismaReconciliationRepository(owner, runtime),
      client,
    );
  });

  afterAll(async () => {
    if (!tenantId) return;
    await owner.reconciliationCase.deleteMany({ where: { tenantId } });
    await owner.reconciliationDifference.deleteMany({ where: { tenantId } });
    await owner.reconciliationStatement.deleteMany({ where: { tenantId } });
    await owner.paymentOrder.deleteMany({ where: { tenantId } });
    await owner.tenantPaymentAccount.deleteMany({ where: { tenantId } });
    await owner.customerProfile.deleteMany({ where: { tenantId } });
    await owner.tenantAccountRole.deleteMany({ where: { tenantId } });
    await owner.tenantAccount.deleteMany({ where: { tenantId } });
    await owner.tenant.delete({ where: { id: tenantId } });
    await owner.$disconnect();
    await runtime.$disconnect();
  });

  it("对账：落账单记录 + 三类差异（金额不符 / 微信有本地无 / 本地有微信无），且重复对账幂等", async () => {
    const first = await service.reconcile({
      tenantId,
      subMchid: "1900007292",
      billDate: BILL_DATE,
    });
    expect(first.outcome).toBe("reconciled");
    expect(first.rows).toBe(3);
    expect(first.differences).toBe(3);

    const statement = await owner.reconciliationStatement.findFirst({
      where: { tenantId },
    });
    expect(statement).not.toBeNull();
    expect(statement!.totalCount).toBe(3);
    expect(statement!.subMchid).toBe("1900007292");

    const differences = await owner.reconciliationDifference.findMany({
      where: { tenantId },
    });
    const kinds = differences.map((row) => row.kind).sort();
    expect(kinds).toEqual([
      "AMOUNT_MISMATCH",
      "MISSING_LOCAL",
      "MISSING_WECHAT",
    ]);
    const mismatch = differences.find((row) => row.kind === "AMOUNT_MISMATCH");
    expect(mismatch!.amountFen).toBe(100n);

    const cases = await owner.reconciliationCase.findMany({
      where: { tenantId },
      orderBy: { differenceId: "asc" },
    });
    expect(cases).toHaveLength(3);
    expect(cases.every((row) => row.status === "OPEN")).toBe(true);
    expect(cases.map((row) => row.differenceId).sort()).toEqual(
      differences.map((row) => row.id).sort(),
    );

    // 同一份账单再对一次：幂等，不重复记差异
    const second = await service.reconcile({
      tenantId,
      subMchid: "1900007292",
      billDate: BILL_DATE,
    });
    expect(second.outcome).toBe("already");
    expect(second.differences).toBe(0);
    expect(
      await owner.reconciliationStatement.count({ where: { tenantId } }),
    ).toBe(1);
    expect(
      await owner.reconciliationDifference.count({ where: { tenantId } }),
    ).toBe(3);
    expect(await owner.reconciliationCase.count({ where: { tenantId } })).toBe(
      3,
    );
  });
});
