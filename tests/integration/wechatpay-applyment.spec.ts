import { generateKeyPairSync } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDatabaseClient } from "@pw/database";
import type { PrismaClient } from "@pw/database";
import {
  WechatPayPartnerClient,
  type WechatPayPartnerConfig,
} from "../../apps/api/src/modules/payments/infrastructure/wechatpay-partner.client.js";
import { PrismaPaymentSetupRepository } from "../../apps/api/src/modules/payments/infrastructure/prisma-payment-setup.repository.js";
import { TenantPaymentSetupService } from "../../apps/api/src/modules/payments/application/payment-setup.service.js";
import { PaymentSetupInputError } from "../../apps/api/src/modules/payments/domain/payments.errors.js";

/**
 * S4-5：门店支付进件与开户意愿确认的**真库**验证。
 *
 * 为什么真库：状态要落 7 个新列（含 JSONB 驳回详情）、要在 RLS 上下文里更新、还要写审计；
 * 假 fetch 喂的是官方应答字段名（`applyment_state` / `sign_url` / `authorize_state` / `audit_detail`），
 * 字段名写错会当场红。
 *
 * 零凭证：微信侧用假 fetch，本片不调提交进件接口（那是 S4-5b）。
 */

const suffix = Date.now().toString(36);
const API_V3_KEY = "0123456789abcdef0123456789abcdef";
const APPLY_NO = "2000002124775691";
const SUB_MCHID = "1900007292";
const SIGN_URL =
  "https://pay.weixin.qq.com/public/apply4ec_sign/s?applymentId=2000002124775691&sign=b207b673049a32c858f3aabd7d27c7ec";

type Scenario = "signing" | "finished" | "rejected";

function envOrThrow(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`missing env ${name}`);
  return value;
}

describe("门店支付进件与开户意愿确认（真库）", () => {
  let owner: PrismaClient;
  let runtime: PrismaClient;
  let setup: TenantPaymentSetupService;
  let tenantId: string;
  let operatorAccountId: string;
  let accountRowId: string;
  let scenario: Scenario = "signing";

  function partnerClient(): WechatPayPartnerClient {
    const keyPair = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const config: WechatPayPartnerConfig = {
      spMchid: "1900013511",
      spAppid: "wxappid",
      apiV3Key: API_V3_KEY,
      privateKeyPem: keyPair.privateKey
        .export({ type: "pkcs8", format: "pem" })
        .toString(),
      merchantSerialNo: "SERIAL",
      notifyUrl: "https://h5.17ai.club/api/v1/payments/wechatpay/notify",
      apiBase: "https://api.mch.weixin.qq.com",
      verifiers: [],
    };
    return new WechatPayPartnerClient(config, async (url) => {
      if (url.includes("/apply4subject/applyment/merchants/")) {
        return {
          status: 200,
          text: async () =>
            JSON.stringify({
              authorize_state:
                scenario === "finished"
                  ? "AUTHORIZE_STATE_AUTHORIZED"
                  : "AUTHORIZE_STATE_UNAUTHORIZED",
            }),
        };
      }
      if (url.includes(`/applyment4sub/applyment/applyment_id/${APPLY_NO}`)) {
        return {
          status: 200,
          text: async () =>
            JSON.stringify({
              business_code: "1900013511_it",
              applyment_id: Number(APPLY_NO),
              sub_mchid: SUB_MCHID,
              sign_url: SIGN_URL,
              applyment_state:
                scenario === "finished"
                  ? "APPLYMENT_STATE_FINISHED"
                  : scenario === "rejected"
                    ? "APPLYMENT_STATE_REJECTED"
                    : "APPLYMENT_STATE_TO_BE_SIGNED",
              applyment_state_msg:
                scenario === "rejected" ? "已驳回" : "待签约",
              audit_detail:
                scenario === "rejected"
                  ? [
                      {
                        field:
                          "subject_info.identity_info.id_card_info.id_card_number",
                        field_name: "身份证号码",
                        reject_reason: "证件号码与姓名不匹配",
                      },
                    ]
                  : [],
            }),
        };
      }
      return {
        status: 404,
        text: async () => '{"code":"APPLYMENT_NOT_EXIST"}',
      };
    });
  }

  async function accountRow() {
    return owner.tenantPaymentAccount.findFirst({ where: { tenantId } });
  }

  async function refreshAuditCount(): Promise<number> {
    return owner.auditLog.count({
      where: { tenantId, action: "payment.setup.refresh" },
    });
  }

  beforeAll(async () => {
    owner = createDatabaseClient(envOrThrow("PW_TEST_MIGRATION_URL"));
    runtime = createDatabaseClient(envOrThrow("PW_TEST_RUNTIME_URL"));
    const tenant = await owner.tenant.create({
      data: { code: `wxsetup_${suffix}`, name: "进件集成测试店" },
    });
    tenantId = tenant.id;
    const account = await owner.tenantAccount.create({
      data: {
        tenantId,
        username: `wxsetup_${suffix}`,
        passwordHash: "scrypt:test:test",
      },
    });
    operatorAccountId = account.id;
    setup = new TenantPaymentSetupService(
      new PrismaPaymentSetupRepository(runtime),
      partnerClient(),
    );
  });

  afterAll(async () => {
    if (!tenantId) return;
    await owner.auditLog.deleteMany({ where: { tenantId } });
    await owner.tenantPaymentAccount.deleteMany({ where: { tenantId } });
    await owner.tenantAccountRole.deleteMany({ where: { tenantId } });
    await owner.tenantAccount.deleteMany({ where: { tenantId } });
    await owner.tenant.delete({ where: { id: tenantId } });
    await owner.$disconnect();
    await runtime.$disconnect();
  });

  it("还没配置：不谎报可收款，指引是「先提交进件」", async () => {
    const view = await setup.getStatus(tenantId);
    expect(view.configured).toBe(false);
    expect(view.nextAction).toBe("SUBMIT_INTAKE");
    expect(view.canAcceptPayment).toBe(false);
  });

  it("人工绑定子商户号 → PENDING_CONFIRM（绑定不等于能收款）+ 写审计", async () => {
    const view = await setup.bindSubMchid({
      tenantId,
      subMchid: ` ${SUB_MCHID} `,
      operatorAccountId,
    });
    expect(view.configured).toBe(true);
    expect(view.subMchid).toBe(SUB_MCHID);
    expect(view.status).toBe("PENDING_CONFIRM");
    expect(view.canAcceptPayment).toBe(false);
    expect(view.source).toBe("MANUAL_BIND");

    const row = await accountRow();
    accountRowId = row!.id;
    expect(row!.status).toBe("PENDING_CONFIRM");
    expect(row!.subMchid).toBe(SUB_MCHID);
    expect(
      await owner.auditLog.count({
        where: { tenantId, action: "payment.setup.bind" },
      }),
    ).toBe(1);
  });

  it("非法子商户号 → 400 语义（PaymentSetupInputError），不写库", async () => {
    await expect(
      setup.bindSubMchid({
        tenantId,
        subMchid: "1900007292x",
        operatorAccountId,
      }),
    ).rejects.toBeInstanceOf(PaymentSetupInputError);
    expect(await owner.auditLog.count({ where: { tenantId } })).toBe(1);
  });

  it("刷新（待签约）→ 落 sign_url 与微信原始状态；状态没变则不重复写审计", async () => {
    // 申请单号由 S4-5b 的提交接口写入；本片先手工造夹具（等价于"已提交过进件"）
    await owner.tenantPaymentAccount.update({
      where: { id: accountRowId },
      data: {
        applyNo: APPLY_NO,
        businessCode: `1900013511_${suffix}`,
        submittedAt: new Date("2026-09-23T03:00:00.000Z"),
      },
    });
    scenario = "signing";
    const view = await setup.refresh({ tenantId, operatorAccountId });
    expect(view.providerState).toBe("APPLYMENT_STATE_TO_BE_SIGNED");
    expect(view.providerStateMsg).toBe("待签约");
    expect(view.signUrl).toBe(SIGN_URL);
    expect(view.authorizeState).toBe("AUTHORIZE_STATE_UNAUTHORIZED");
    expect(view.status).toBe("PENDING_CONFIRM");
    expect(view.nextAction).toBe("SCAN_TO_SIGN");
    expect(view.canAcceptPayment).toBe(false);
    expect(view.source).toBe("WECHAT_APPLYMENT");

    const row = await accountRow();
    expect(row!.providerState).toBe("APPLYMENT_STATE_TO_BE_SIGNED");
    expect(row!.signUrl).toBe(SIGN_URL);
    expect(row!.lastSyncedAt).not.toBeNull();
    expect(await refreshAuditCount()).toBe(1);

    // 同样的状态再刷一次：库里没变化 → 不重复写审计（避免刷屏）
    await setup.refresh({ tenantId, operatorAccountId });
    expect(await refreshAuditCount()).toBe(1);
  });

  it("刷新（已完成 + 已授权）→ ACTIVE 且 canAcceptPayment=true；再查微信仍一致", async () => {
    scenario = "finished";
    const view = await setup.refresh({ tenantId, operatorAccountId });
    expect(view.providerState).toBe("APPLYMENT_STATE_FINISHED");
    expect(view.authorizeState).toBe("AUTHORIZE_STATE_AUTHORIZED");
    expect(view.status).toBe("ACTIVE");
    expect(view.canAcceptPayment).toBe(true);
    expect(view.nextAction).toBe("READY");
    const row = await accountRow();
    expect(row!.status).toBe("ACTIVE");
    expect(await refreshAuditCount()).toBe(2);
  });

  it("刷新（被驳回）→ 驳回原因落库并可原样读出，状态回到 APPLYING", async () => {
    scenario = "rejected";
    const view = await setup.refresh({ tenantId, operatorAccountId });
    expect(view.providerState).toBe("APPLYMENT_STATE_REJECTED");
    expect(view.status).toBe("APPLYING");
    expect(view.nextAction).toBe("FIX_AND_RESUBMIT");
    expect(view.rejectDetail).toEqual([
      {
        field: "subject_info.identity_info.id_card_info.id_card_number",
        fieldName: "身份证号码",
        rejectReason: "证件号码与姓名不匹配",
      },
    ]);
    expect(view.canAcceptPayment).toBe(false);

    const row = await accountRow();
    expect(row!.providerStateMsg).toBe("已驳回");
    expect(Array.isArray(row!.rejectDetail)).toBe(true);
  });

  it("租户隔离：另一个门店读不到本门店的支付账户（RLS）", async () => {
    const other = await owner.tenant.create({
      data: { code: `wxsetup_other_${suffix}`, name: "隔壁店" },
    });
    try {
      const view = await setup.getStatus(other.id);
      expect(view.configured).toBe(false);
      expect(view.subMchid).toBeNull();
    } finally {
      await owner.tenant.delete({ where: { id: other.id } });
    }
  });
});
