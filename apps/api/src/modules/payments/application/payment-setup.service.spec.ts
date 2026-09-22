import { generateKeyPairSync } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  canAcceptPayment,
  mapApplymentState,
  NEXT_ACTION_TEXT,
  setupSource,
} from "../domain/payment-setup.js";
import type {
  PaymentAccountRecord,
  PaymentSetupRepository,
} from "./payment-setup-ports.js";
import { TenantPaymentSetupService, toView } from "./payment-setup.service.js";
import {
  WechatPayPartnerClient,
  type WechatPayPartnerConfig,
} from "../infrastructure/wechatpay-partner.client.js";
import {
  PaymentSetupInputError,
  WechatPayDisabledError,
} from "../domain/payments.errors.js";

/**
 * S4-5：门店支付状态的**纯口径**单测（真库行为见 tests/integration/wechatpay-applyment.spec.ts）。
 * 核心不可退让的一条：**除了「进件完成 + 开户意愿确认已授权 + 有子商户号」，
 * 任何组合都不许映射成 ACTIVE**——状态映射一旦放宽，门店会在收不到钱的情况下显示"可收款"。
 */

const ACCOUNT: PaymentAccountRecord = {
  status: "APPLYING",
  subMchid: null,
  subAppid: null,
  applyNo: "2000002124775691",
  businessCode: "1900013511_s5cwalk",
  providerState: "APPLYMENT_STATE_AUDITING",
  providerStateMsg: "审核中",
  authorizeState: null,
  rejectDetail: null,
  signUrl: null,
  submittedAt: null,
  lastSyncedAt: null,
};

function repositoryStub(options: {
  account?: PaymentAccountRecord | null;
  applied?: PaymentAccountRecord;
}) {
  const calls: Array<Record<string, unknown>> = [];
  const repository: PaymentSetupRepository = {
    findAccount: async () => options.account ?? null,
    bindSubMchid: async (input) => {
      calls.push({ kind: "bind", ...input });
      return options.applied ?? { ...ACCOUNT, subMchid: input.subMchid };
    },
    recordSubmittedApplyment: async (input) => {
      calls.push({ kind: "submit", ...input });
      return (
        options.applied ?? {
          ...ACCOUNT,
          applyNo: input.applyNo,
          status: "APPLYING",
        }
      );
    },
    applyProviderStatus: async (input) => {
      calls.push({ kind: "apply", ...input });
      return { account: options.applied ?? ACCOUNT, changed: true };
    },
  };
  return { repository, calls };
}

describe("S4-5：门店支付状态映射", () => {
  it("微信 8 种申请单状态逐一映射：只有 FINISHED+已授权 才是 ACTIVE", () => {
    const withSub = { hasSubMchid: true } as const;
    expect(
      mapApplymentState({
        applymentState: "APPLYMENT_STATE_EDITTING",
        ...withSub,
      }),
    ).toMatchObject({ status: "APPLYING", nextAction: "FIX_AND_RESUBMIT" });
    expect(
      mapApplymentState({
        applymentState: "APPLYMENT_STATE_AUDITING",
        ...withSub,
      }),
    ).toMatchObject({ status: "APPLYING", nextAction: "WAIT_AUDIT" });
    expect(
      mapApplymentState({
        applymentState: "APPLYMENT_STATE_REJECTED",
        ...withSub,
      }),
    ).toMatchObject({ status: "APPLYING", nextAction: "FIX_AND_RESUBMIT" });
    expect(
      mapApplymentState({
        applymentState: "APPLYMENT_STATE_TO_BE_CONFIRMED",
        ...withSub,
      }),
    ).toMatchObject({ status: "PENDING_CONFIRM", nextAction: "SCAN_TO_SIGN" });
    expect(
      mapApplymentState({
        applymentState: "APPLYMENT_STATE_TO_BE_SIGNED",
        ...withSub,
      }),
    ).toMatchObject({ status: "PENDING_CONFIRM", nextAction: "SCAN_TO_SIGN" });
    expect(
      mapApplymentState({
        applymentState: "APPLYMENT_STATE_SIGNING",
        ...withSub,
      }),
    ).toMatchObject({
      status: "PENDING_CONFIRM",
      nextAction: "WAIT_ACTIVATION",
    });
    expect(
      mapApplymentState({
        applymentState: "APPLYMENT_STATE_FINISHED",
        authorizeState: "AUTHORIZE_STATE_AUTHORIZED",
        ...withSub,
      }),
    ).toMatchObject({ status: "ACTIVE", nextAction: "READY" });
    expect(
      mapApplymentState({
        applymentState: "APPLYMENT_STATE_CANCELED",
        ...withSub,
      }),
    ).toMatchObject({ status: "SUSPENDED", nextAction: "CONTACT_SUPPORT" });
  });

  it("绝不早熟地给 ACTIVE：进件完成但未授权 / 无子商户号 / 未知状态都不许", () => {
    // 进件完成 + 未授权
    expect(
      mapApplymentState({
        applymentState: "APPLYMENT_STATE_FINISHED",
        authorizeState: "AUTHORIZE_STATE_UNAUTHORIZED",
        hasSubMchid: true,
      }),
    ).toMatchObject({ status: "PENDING_CONFIRM", nextAction: "SCAN_TO_SIGN" });
    // 进件完成 + 授权状态未知（还没查）
    expect(
      mapApplymentState({
        applymentState: "APPLYMENT_STATE_FINISHED",
        hasSubMchid: true,
      }),
    ).toMatchObject({ status: "PENDING_CONFIRM" });
    // 进件完成但没有子商户号（官方只有三种状态会返回 sub_mchid）
    expect(
      mapApplymentState({
        applymentState: "APPLYMENT_STATE_FINISHED",
        authorizeState: "AUTHORIZE_STATE_AUTHORIZED",
        hasSubMchid: false,
      }),
    ).toMatchObject({
      status: "PENDING_CONFIRM",
      nextAction: "CONTACT_SUPPORT",
    });
    // 认不出的状态 → fail-closed
    expect(
      mapApplymentState({
        applymentState: "SOMETHING_NEW_FROM_WECHAT",
        hasSubMchid: true,
      }),
    ).toMatchObject({ status: "SUSPENDED", nextAction: "CONTACT_SUPPORT" });
  });

  it("没有申请单：没子商户号→待提交；有子商户号→待扫码（人工进件路径）", () => {
    expect(
      mapApplymentState({ applymentState: null, hasSubMchid: false }),
    ).toMatchObject({ status: "APPLYING", nextAction: "SUBMIT_INTAKE" });
    expect(
      mapApplymentState({ applymentState: null, hasSubMchid: true }),
    ).toMatchObject({ status: "PENDING_CONFIRM", nextAction: "SCAN_TO_SIGN" });
  });

  it("可收款判据：子商户号 + ACTIVE，缺一不可（与下单门禁同一函数）", () => {
    expect(canAcceptPayment("1900007292", "ACTIVE")).toBe(true);
    expect(canAcceptPayment(null, "ACTIVE")).toBe(false);
    expect(canAcceptPayment("1900007292", "PENDING_CONFIRM")).toBe(false);
    expect(canAcceptPayment("1900007292", "APPLYING")).toBe(false);
    expect(canAcceptPayment("1900007292", null)).toBe(false);
  });

  it("进件来源判定：有申请单号=微信进件，只有子商户号=人工绑定", () => {
    expect(
      setupSource({ applyNo: "2000001", businessCode: null, subMchid: null }),
    ).toBe("WECHAT_APPLYMENT");
    expect(
      setupSource({ applyNo: null, businessCode: null, subMchid: "190" }),
    ).toBe("MANUAL_BIND");
    expect(
      setupSource({ applyNo: null, businessCode: null, subMchid: null }),
    ).toBe(null);
  });

  it("每个 nextAction 都有中文指引（前端不拼文案）", () => {
    for (const text of Object.values(NEXT_ACTION_TEXT)) {
      expect(text.length).toBeGreaterThan(4);
    }
  });
});

describe("S4-5：门店支付设置服务", () => {
  it("没绑过 → 不配置 + 待提交进件（未启用支付也能看状态）", async () => {
    const { repository } = repositoryStub({ account: null });
    const service = new TenantPaymentSetupService(repository, null);
    const view = await service.getStatus("t1");
    expect(view.configured).toBe(false);
    expect(view.nextAction).toBe("SUBMIT_INTAKE");
    expect(view.canAcceptPayment).toBe(false);
  });

  it("人工绑定：子商户号必须是 6-32 位数字，前后空格会被裁掉", async () => {
    const { repository, calls } = repositoryStub({});
    const service = new TenantPaymentSetupService(repository, null);
    // 注意：前后空格是"允许并裁掉"的（见下面那条），不在拒绝列表里
    for (const bad of ["", "12", "abcdef", "1900007292-x", "1900007292 1"]) {
      await expect(
        service.bindSubMchid({
          tenantId: "t1",
          subMchid: bad,
          operatorAccountId: "a1",
        }),
      ).rejects.toBeInstanceOf(PaymentSetupInputError);
    }
    await service.bindSubMchid({
      tenantId: "t1",
      subMchid: " 1900007292 ",
      operatorAccountId: "a1",
    });
    expect(calls[0]).toMatchObject({
      kind: "bind",
      tenantId: "t1",
      subMchid: "1900007292",
    });
  });

  it("刷新：无凭证 → 503（不假装成功）", async () => {
    const { repository } = repositoryStub({ account: ACCOUNT });
    const service = new TenantPaymentSetupService(repository, null);
    await expect(
      service.refresh({ tenantId: "t1", operatorAccountId: "a1" }),
    ).rejects.toBeInstanceOf(WechatPayDisabledError);
  });

  it("刷新：连申请单号/子商户号都没有 → 400（明确告诉用户缺什么）", async () => {
    const { repository } = repositoryStub({
      account: { ...ACCOUNT, applyNo: null, subMchid: null },
    });
    const service = new TenantPaymentSetupService(repository, fakeClient());
    await expect(
      service.refresh({ tenantId: "t1", operatorAccountId: "a1" }),
    ).rejects.toThrow(/还没有申请单号或子商户号/);
  });

  it("刷新：待签约 → PENDING_CONFIRM + 落库 sign_url；再刷新到已授权 → ACTIVE", async () => {
    const { repository, calls } = repositoryStub({ account: ACCOUNT });
    const service = new TenantPaymentSetupService(repository, fakeClient());
    const signing = await service.refresh({
      tenantId: "t1",
      operatorAccountId: "a1",
    });
    expect(calls[0]).toMatchObject({
      kind: "apply",
      status: "PENDING_CONFIRM",
      subMchid: "1900007292",
      providerState: "APPLYMENT_STATE_TO_BE_SIGNED",
      signUrl: "https://pay.weixin.qq.com/public/apply4ec_sign/s?sign=abc",
    });
    expect(signing.canAcceptPayment).toBe(false);

    const active = repositoryStub({
      account: ACCOUNT,
      applied: {
        ...ACCOUNT,
        status: "ACTIVE",
        subMchid: "1900007292",
        providerState: "APPLYMENT_STATE_FINISHED",
        authorizeState: "AUTHORIZE_STATE_AUTHORIZED",
      },
    });
    const service2 = new TenantPaymentSetupService(
      active.repository,
      fakeClient({ finished: true }),
    );
    const view = await service2.refresh({
      tenantId: "t1",
      operatorAccountId: "a1",
    });
    expect(view.status).toBe("ACTIVE");
    expect(view.canAcceptPayment).toBe(true);
    expect(view.nextAction).toBe("READY");
  });

  it("刷新：被驳回 → 驳回原因原样带出（前端要按字段展示）", async () => {
    const account = { ...ACCOUNT, providerState: "APPLYMENT_STATE_REJECTED" };
    const { repository, calls } = repositoryStub({ account });
    const service = new TenantPaymentSetupService(
      repository,
      fakeClient({ rejected: true }),
    );
    await service.refresh({ tenantId: "t1", operatorAccountId: "a1" });
    expect(calls[0]).toMatchObject({
      kind: "apply",
      providerState: "APPLYMENT_STATE_REJECTED",
      status: "APPLYING",
      rejectDetail: [
        {
          field: "subject_info.identity_info.id_card_info.id_card_number",
          fieldName: "身份证号码",
          rejectReason: "证件号码与姓名不匹配",
        },
      ],
    });
  });

  it("视图：库里存的驳回详情能健壮解析（缺字段/脏数据不炸）", () => {
    const view = toView({
      ...ACCOUNT,
      rejectDetail: [
        { field: "a", fieldName: "姓名", rejectReason: "模糊" },
        { field: 123 },
        null,
      ],
    });
    expect(view.rejectDetail).toEqual([
      { field: "a", fieldName: "姓名", rejectReason: "模糊" },
      { field: null, fieldName: null, rejectReason: null },
      { field: null, fieldName: null, rejectReason: null },
    ]);
    expect(view.source).toBe("WECHAT_APPLYMENT");
  });
});

/**
 * 假客户端：**真实的 WechatPayPartnerClient** + 假 fetch（与对账 spec 同一手法）。
 * 好处是顺带验证我方请求路径拼得对不对——fake fetch 收到的 URL 就是客户端真正发出的 URL。
 */
function fakeClient(
  options: { finished?: boolean; rejected?: boolean } = {},
): WechatPayPartnerClient {
  const keyPair = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const config: WechatPayPartnerConfig = {
    spMchid: "1900013511",
    spAppid: "wxappid",
    apiV3Key: "0123456789abcdef0123456789abcdef",
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
            authorize_state: options.finished
              ? "AUTHORIZE_STATE_AUTHORIZED"
              : "AUTHORIZE_STATE_UNAUTHORIZED",
          }),
      };
    }
    if (url.includes("/applyment4sub/applyment/applyment_id/")) {
      return {
        status: 200,
        text: async () =>
          JSON.stringify({
            business_code: "1900013511_s5cwalk",
            applyment_id: 2000002124775691,
            sub_mchid: "1900007292",
            sign_url:
              "https://pay.weixin.qq.com/public/apply4ec_sign/s?sign=abc",
            applyment_state: options.finished
              ? "APPLYMENT_STATE_FINISHED"
              : options.rejected
                ? "APPLYMENT_STATE_REJECTED"
                : "APPLYMENT_STATE_TO_BE_SIGNED",
            applyment_state_msg: options.rejected ? "已驳回" : "待签约",
            audit_detail: options.rejected
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
    return { status: 404, text: async () => '{"code":"RESOURCE_NOT_EXISTS"}' };
  });
}
