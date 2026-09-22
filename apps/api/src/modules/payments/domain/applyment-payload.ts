/**
 * S4-5b-3a：**个体户**进件资料 → 微信提交申请单报文（官方 partner/4012719997）。
 *
 * 为什么先只做个体户：官方按主体类型分了四大类（企业/个体户/事业单位/其他组织），
 * 每类必填项不同。陪玩门店第一家试运营就是个体现状居多，先把最可能用的那条做扎实，
 * **其它类型明确拒绝**（fail-closed，绝不拼一个"差不多"的报文去撞运气）。
 *
 * 字段名全部取自官方文档原文；金额无关，但注意两个"必须加密"的字段在客户端加密
 * （`contact_info.contact_name` / `mobile_phone` / `contact_email` / 身份证号 / 银行账号等 15 条）。
 */

export class IntakeValidationError extends Error {
  constructor(
    readonly field: string,
    detail: string,
  ) {
    super(`${field}：${detail}`);
    this.name = "IntakeValidationError";
  }
}

export interface IndividualIntakeInput {
  /** 门店编码（租户 code），用于拼业务申请编号 */
  tenantCode: string;
  /** 服务商商户号（官方建议业务申请编号以它开头） */
  spMchid: string;
  /** 超级管理员（= 个体户经营者）：官方 contact_type 取 LEGAL */
  contactName: string;
  mobilePhone: string;
  contactEmail: string;
  /** 营业执照 */
  licenseNumber: string;
  merchantName: string;
  legalPerson: string;
  licenseCopyMediaId: string;
  /** 经营者身份证 */
  idCardName: string;
  idCardNumber: string;
  /** 证件有效期（官方要求必填，yyyy-MM-dd；长期有效按官方口径填远期日期由门店确认） */
  cardPeriodBegin: string;
  cardPeriodEnd: string;
  idCardCopyMediaId: string;
  idCardNationalMediaId: string;
  /** 结算账户：个体户结算到经营者个人银行卡 → BANK_ACCOUNT_TYPE_PERSONAL */
  accountName: string;
  accountBank: string;
  accountNumber: string;
  bankAddressCode?: string;
}

/**
 * 业务申请编号：官方规则是"数字 / 字母 / 下划线，≤124 字符，建议前缀服务商商户号，同服务商下唯一"，
 * 并且**申请单被驳回后用同一编号重提即覆盖原申请单**——所以这里必须是**确定性**的
 * （同一门店每次算出来一样），否则驳回重提会变成两张申请单。
 */
export function generateBusinessCode(
  spMchid: string,
  tenantCode: string,
): string {
  const safe = tenantCode.replace(/[^0-9A-Za-z_]/g, "_");
  return `${spMchid}_${safe}`.slice(0, 124);
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const ID_CARD = /^\d{17}[\dXx]$/;
const PHONE = /^(?:\d{11}|[\d-+]{5,20})$/;

function requireText(field: string, value: string | undefined): string {
  const trimmed = (value ?? "").trim();
  if (!trimmed) throw new IntakeValidationError(field, "必填，不能为空");
  return trimmed;
}

function requireDate(field: string, value: string | undefined): string {
  const trimmed = requireText(field, value);
  if (!DATE.test(trimmed)) {
    throw new IntakeValidationError(field, "日期格式应为 yyyy-MM-dd");
  }
  return trimmed;
}

/** 上送前的本地校验：错就点名到字段，避免拿一次真实请求去换一个 PARAM_ERROR。 */
export function assertIndividualIntake(input: IndividualIntakeInput): void {
  requireText("门店编码", input.tenantCode);
  requireText("服务商商户号", input.spMchid);
  requireText("超级管理员姓名", input.contactName);
  const phone = requireText("联系手机", input.mobilePhone);
  if (!PHONE.test(phone)) {
    throw new IntakeValidationError(
      "联系手机",
      "应为 11 位手机号，或 5-20 位数字/连字符/加号",
    );
  }
  const email = requireText("联系邮箱", input.contactEmail);
  if (!email.includes("@")) {
    throw new IntakeValidationError("联系邮箱", "需要是邮箱格式（含 @）");
  }
  requireText("营业执照号", input.licenseNumber);
  requireText("商户名称", input.merchantName);
  requireText("经营者姓名", input.legalPerson);
  requireText("营业执照照片", input.licenseCopyMediaId);
  requireText("身份证姓名", input.idCardName);
  const idCard = requireText("身份证号码", input.idCardNumber);
  if (!ID_CARD.test(idCard)) {
    throw new IntakeValidationError(
      "身份证号码",
      "应为 17 位数字 + 1 位数字或 X",
    );
  }
  requireDate("证件有效期开始", input.cardPeriodBegin);
  requireDate("证件有效期结束", input.cardPeriodEnd);
  requireText("身份证人像面照片", input.idCardCopyMediaId);
  requireText("身份证国徽面照片", input.idCardNationalMediaId);
  requireText("结算账户名", input.accountName);
  requireText("开户银行", input.accountBank);
  requireText("结算账号", input.accountNumber);
  if (input.bankAddressCode !== undefined) {
    requireText("开户银行地址编码", input.bankAddressCode);
  }
}

/**
 * 组装提交进件报文（明文；敏感字段由 WechatPayPartnerClient 加密后上送）。
 * 三个"固定取值"是官方按主体类型定的，不是可选项：
 * `subject_type=SUBJECT_TYPE_INDIVIDUAL`、`contact_info.contact_type=LEGAL`、
 * `bank_account_info.bank_account_type=BANK_ACCOUNT_TYPE_PERSONAL`。
 */
export function buildIndividualApplymentPayload(
  input: IndividualIntakeInput,
): Record<string, unknown> {
  assertIndividualIntake(input);
  return {
    business_code: generateBusinessCode(input.spMchid, input.tenantCode),
    contact_info: {
      contact_type: "LEGAL",
      contact_name: input.contactName.trim(),
      mobile_phone: input.mobilePhone.trim(),
      contact_email: input.contactEmail.trim(),
    },
    subject_info: {
      subject_type: "SUBJECT_TYPE_INDIVIDUAL",
      business_license_info: {
        license_copy: input.licenseCopyMediaId.trim(),
        license_number: input.licenseNumber.trim(),
        merchant_name: input.merchantName.trim(),
        legal_person: input.legalPerson.trim(),
      },
      identity_info: {
        id_card_info: {
          id_card_copy: input.idCardCopyMediaId.trim(),
          id_card_national: input.idCardNationalMediaId.trim(),
          id_card_name: input.idCardName.trim(),
          id_card_number: input.idCardNumber.trim().toUpperCase(),
          card_period_begin: input.cardPeriodBegin.trim(),
          card_period_end: input.cardPeriodEnd.trim(),
        },
      },
    },
    bank_account_info: {
      bank_account_type: "BANK_ACCOUNT_TYPE_PERSONAL",
      account_name: input.accountName.trim(),
      account_bank: input.accountBank.trim(),
      account_number: input.accountNumber.trim(),
      ...(input.bankAddressCode
        ? { bank_address_code: input.bankAddressCode.trim() }
        : {}),
    },
  };
}
