import {
  constants,
  createPublicKey,
  generateKeyPairSync,
  privateDecrypt,
} from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDatabaseClient } from "@pw/database";
import type { PrismaClient } from "@pw/database";
import {
  WechatPayPartnerClient,
  type WechatPayPartnerConfig,
} from "../../apps/api/src/modules/payments/infrastructure/wechatpay-partner.client.js";
import { PrismaPaymentSetupRepository } from "../../apps/api/src/modules/payments/infrastructure/prisma-payment-setup.repository.js";
import { TenantPaymentSetupService } from "../../apps/api/src/modules/payments/application/payment-setup.service.js";
import type { IndividualIntakeInput } from "../../apps/api/src/modules/payments/domain/applyment-payload.js";
import {
  PaymentSetupInputError,
  WechatPayDisabledError,
} from "../../apps/api/src/modules/payments/domain/payments.errors.js";

/**
 * S4-5b-4：**提交进件**的真库验证（零凭证：微信侧用假 fetch）。
 *
 * 要证明的四件事：
 * 1. 提交成功后库里才出现申请单号（失败不留痕）；
 * 2. 上送报文里敏感字段是密文（用测试私钥能解回），非敏感字段是明文；
 * 3. 进行中的申请单不许重复提交；被驳回后可以用**同一个 business_code** 重提；
 * 4. 没配微信支付公钥时明确 503 语义（WechatPayError.MISSING_PUBLIC_KEY），不发明文。
 */

const suffix = Date.now().toString(36);
const APPLYMENT_ID = 2000002124775691;

function envOrThrow(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`missing env ${name}`);
  return value;
}

describe("提交进件申请单（真库）", () => {
  let owner: PrismaClient;
  let runtime: PrismaClient;
  let setup: TenantPaymentSetupService;
  let tenantId: string;
  let operatorAccountId: string;
  let merchantPrivateKeyPem: string;
  let publicKeyPem: string;
  let publicKeyId: string | null;
  const sentBodies: string[] = [];

  const intake: IndividualIntakeInput = {
    tenantCode: `wxsubmit_${suffix}`,
    spMchid: "1900013511",
    contactName: "张三",
    mobilePhone: "13800000000",
    contactEmail: "boss@example.com",
    licenseNumber: "91110000MA0000000X",
    merchantName: "示例陪玩工作室",
    legalPerson: "张三",
    licenseCopyMediaId: "MEDIA-LICENSE",
    idCardName: "张三",
    idCardNumber: "11010119900307551X",
    cardPeriodBegin: "2020-01-01",
    cardPeriodEnd: "2030-01-01",
    idCardCopyMediaId: "MEDIA-ID-FRONT",
    idCardNationalMediaId: "MEDIA-ID-BACK",
    accountName: "张三",
    accountBank: "工商银行",
    accountNumber: "6217000010000000000",
  };

  function buildService(input: { withPublicKey: boolean }) {
    const config: WechatPayPartnerConfig = {
      spMchid: "1900013511",
      spAppid: "wxappid",
      apiV3Key: "0123456789abcdef0123456789abcdef",
      privateKeyPem: merchantPrivateKeyPem,
      merchantSerialNo: "MCH-SERIAL",
      notifyUrl: "https://h5.17ai.club/api/v1/payments/wechatpay/notify",
      apiBase: "https://api.mch.weixin.qq.com",
      verifiers: [],
      ...(input.withPublicKey && publicKeyId
        ? { publicKey: { publicKeyId, publicKeyPem } }
        : {}),
    };
    const client = new WechatPayPartnerClient(config, async (_url, init) => {
      sentBodies.push(
        typeof init.body === "string" ? init.body : init.body.toString("utf8"),
      );
      return {
        status: 200,
        text: async () => JSON.stringify({ applyment_id: APPLYMENT_ID }),
      };
    });
    return new TenantPaymentSetupService(
      new PrismaPaymentSetupRepository(runtime),
      client,
    );
  }

  beforeAll(async () => {
    owner = createDatabaseClient(envOrThrow("PW_TEST_MIGRATION_URL"));
    runtime = createDatabaseClient(envOrThrow("PW_TEST_RUNTIME_URL"));
    const pair = generateKeyPairSync("rsa", { modulusLength: 2048 });
    merchantPrivateKeyPem = pair.privateKey
      .export({ type: "pkcs8", format: "pem" })
      .toString();
    publicKeyPem = createPublicKey(pair.privateKey)
      .export({ type: "spki", format: "pem" })
      .toString();
    publicKeyId = "PUB_KEY_ID_0116571234562024052000123400000000";

    const tenant = await owner.tenant.create({
      data: { code: intake.tenantCode, name: "进件提交测试店" },
    });
    tenantId = tenant.id;
    const account = await owner.tenantAccount.create({
      data: {
        tenantId,
        username: `wxsubmit_${suffix}`,
        passwordHash: "scrypt:test:test",
      },
    });
    operatorAccountId = account.id;
    setup = buildService({ withPublicKey: true });
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

  it("没配微信支付公钥 → 明确拒绝，且库里不留痕（绝不发明文）", async () => {
    const disabledKey = buildService({ withPublicKey: false });
    await expect(
      disabledKey.submitIntake({
        tenantId,
        operatorAccountId,
        intake,
      }),
    ).rejects.toThrow(/未配置微信支付公钥/);
    expect(
      await owner.tenantPaymentAccount.count({ where: { tenantId } }),
    ).toBe(0);
    expect(sentBodies).toHaveLength(0);
  });

  it("提交成功：库里出现申请单号与业务编号、状态 APPLYING、写审计；报文里敏感字段是密文", async () => {
    const view = await setup.submitIntake({
      tenantId,
      operatorAccountId,
      intake,
    });
    expect(view.status).toBe("APPLYING");
    expect(view.applyNo).toBe(String(APPLYMENT_ID));
    expect(view.businessCode).toBe(`1900013511_${intake.tenantCode}`);
    expect(view.canAcceptPayment).toBe(false);
    expect(view.source).toBe("WECHAT_APPLYMENT");

    const row = await owner.tenantPaymentAccount.findFirst({
      where: { tenantId },
    });
    expect(row!.applyNo).toBe(String(APPLYMENT_ID));
    expect(row!.submittedAt).not.toBeNull();
    expect(
      await owner.auditLog.count({
        where: { tenantId, action: "payment.setup.submit" },
      }),
    ).toBe(1);

    expect(sentBodies).toHaveLength(1);
    const sent = JSON.parse(sentBodies[0]!) as Record<string, unknown>;
    const contact = sent.contact_info as Record<string, unknown>;
    const decrypt = (value: string) =>
      privateDecrypt(
        {
          key: merchantPrivateKeyPem,
          padding: constants.RSA_PKCS1_OAEP_PADDING,
        },
        Buffer.from(value, "base64"),
      ).toString("utf8");
    expect(decrypt(contact.contact_name as string)).toBe("张三");
    expect(decrypt(contact.mobile_phone as string)).toBe("13800000000");
    const subject = sent.subject_info as Record<string, unknown>;
    const license = subject.business_license_info as Record<string, unknown>;
    expect(license.license_number).toBe("91110000MA0000000X");
    const bank = sent.bank_account_info as Record<string, unknown>;
    expect(decrypt(bank.account_number as string)).toBe("6217000010000000000");
  });

  it("进行中的申请单不许重复提交（同一门户重复点提交不该造出第二张申请单）", async () => {
    await expect(
      setup.submitIntake({ tenantId, operatorAccountId, intake }),
    ).rejects.toBeInstanceOf(PaymentSetupInputError);
    expect(sentBodies).toHaveLength(1);
    expect(
      await owner.auditLog.count({
        where: { tenantId, action: "payment.setup.submit" },
      }),
    ).toBe(1);
  });

  it("被驳回后可用同一个 business_code 重提（官方口径：同号覆盖原申请单）", async () => {
    await owner.tenantPaymentAccount.updateMany({
      where: { tenantId },
      data: { providerState: "APPLYMENT_STATE_REJECTED", status: "APPLYING" },
    });
    const view = await setup.submitIntake({
      tenantId,
      operatorAccountId,
      intake,
    });
    expect(view.businessCode).toBe(`1900013511_${intake.tenantCode}`);
    expect(sentBodies).toHaveLength(2);
    const first = JSON.parse(sentBodies[0]!) as Record<string, unknown>;
    const second = JSON.parse(sentBodies[1]!) as Record<string, unknown>;
    expect(second.business_code).toBe(first.business_code);
    // 重提后上一次的查询结果被清空，等刷新再填（避免展示过期状态）
    const row = await owner.tenantPaymentAccount.findFirst({
      where: { tenantId },
    });
    expect(row!.providerState).toBeNull();
    expect(
      await owner.auditLog.count({
        where: { tenantId, action: "payment.setup.submit" },
      }),
    ).toBe(2);
  });

  it("未启用微信支付（无凭证）时提交 → 503 语义", async () => {
    const offline = new TenantPaymentSetupService(
      new PrismaPaymentSetupRepository(runtime),
      null,
    );
    await expect(
      offline.submitIntake({ tenantId, operatorAccountId, intake }),
    ).rejects.toBeInstanceOf(WechatPayDisabledError);
  });
});
