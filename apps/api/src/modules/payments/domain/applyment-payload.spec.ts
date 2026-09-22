import { describe, expect, it } from "vitest";
import {
  IntakeValidationError,
  assertIndividualIntake,
  buildIndividualApplymentPayload,
  generateBusinessCode,
  type IndividualIntakeInput,
} from "./applyment-payload.js";

/**
 * S4-5b-3a：个体户进件资料的**字段名与校验**单测（零凭证）。
 * 判据：字段路径必须与官方 4012719997 原文一致（错一个字母微信就 PARAM_ERROR）；
 * 校验失败要**点名到字段**；业务申请编号必须**确定性**（驳回重提才不会变成两张申请单）。
 */

const VALID: IndividualIntakeInput = {
  tenantCode: "s5cwalk",
  spMchid: "1900013511",
  contactName: "张三",
  mobilePhone: "13800000000",
  contactEmail: "boss@example.com",
  licenseNumber: "91110000MA0000000X",
  merchantName: "示例陪玩工作室",
  legalPerson: "张三",
  licenseCopyMediaId: "MEDIA-LICENSE",
  idCardName: "张三",
  idCardNumber: "11010119900307551x",
  cardPeriodBegin: "2020-01-01",
  cardPeriodEnd: "2030-01-01",
  idCardCopyMediaId: "MEDIA-ID-FRONT",
  idCardNationalMediaId: "MEDIA-ID-BACK",
  accountName: "张三",
  accountBank: "工商银行",
  accountNumber: "6217000010000000000",
};

describe("S4-5b-3a：个体户进件资料", () => {
  it("报文结构与官方字段名逐条对齐（个体户固定取值也写死）", () => {
    const payload = buildIndividualApplymentPayload(VALID);
    expect(payload).toEqual({
      business_code: "1900013511_s5cwalk",
      contact_info: {
        contact_type: "LEGAL",
        contact_name: "张三",
        mobile_phone: "13800000000",
        contact_email: "boss@example.com",
      },
      subject_info: {
        subject_type: "SUBJECT_TYPE_INDIVIDUAL",
        business_license_info: {
          license_copy: "MEDIA-LICENSE",
          license_number: "91110000MA0000000X",
          merchant_name: "示例陪玩工作室",
          legal_person: "张三",
        },
        identity_info: {
          id_card_info: {
            id_card_copy: "MEDIA-ID-FRONT",
            id_card_national: "MEDIA-ID-BACK",
            id_card_name: "张三",
            // 身份证号统一大写（官方样例是 X 大写）
            id_card_number: "11010119900307551X",
            card_period_begin: "2020-01-01",
            card_period_end: "2030-01-01",
          },
        },
      },
      bank_account_info: {
        bank_account_type: "BANK_ACCOUNT_TYPE_PERSONAL",
        account_name: "张三",
        account_bank: "工商银行",
        account_number: "6217000010000000000",
      },
    });
    // 选填的开户银行地址编码：没填就不该出现在报文里
    expect(
      (payload.bank_account_info as Record<string, unknown>).bank_address_code,
    ).toBeUndefined();
  });

  it("业务申请编号：确定性 + 只含官方允许字符 + 不超长（驳回重提必须同号）", () => {
    expect(generateBusinessCode("1900013511", "s5cwalk")).toBe(
      "1900013511_s5cwalk",
    );
    expect(generateBusinessCode("1900013511", "s5cwalk")).toBe(
      generateBusinessCode("1900013511", "s5cwalk"),
    );
    const weird = generateBusinessCode("1900013511", "门店 A-1/2***");
    expect(weird).toMatch(/^[0-9A-Za-z_]+$/);
    expect(weird.startsWith("1900013511_")).toBe(true);
    expect(generateBusinessCode("1900013511", "x".repeat(300)).length).toBe(
      124,
    );
  });

  it("校验失败要点名到字段（空值、手机、邮箱、身份证、日期格式）", () => {
    const cases: Array<[Partial<IndividualIntakeInput>, RegExp]> = [
      [{ contactName: "  " }, /超级管理员姓名：必填/],
      [{ mobilePhone: "138" }, /联系手机：应为 11 位手机号/],
      [{ contactEmail: "boss.example.com" }, /联系邮箱：需要是邮箱格式/],
      [{ idCardNumber: "1101011990030755" }, /身份证号码：应为 17 位数字/],
      [{ cardPeriodEnd: "2030/01/01" }, /证件有效期结束：日期格式/],
      [{ licenseCopyMediaId: "" }, /营业执照照片：必填/],
      [{ accountNumber: "" }, /结算账号：必填/],
    ];
    for (const [patch, expected] of cases) {
      expect(() => assertIndividualIntake({ ...VALID, ...patch })).toThrow(
        expected,
      );
    }
    try {
      assertIndividualIntake({ ...VALID, mobilePhone: "138" });
      throw new Error("should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(IntakeValidationError);
      expect((error as IntakeValidationError).field).toBe("联系手机");
    }
  });

  it("前后空格会被裁掉（老板复制粘贴带空格不该导致进件被拒）", () => {
    const payload = buildIndividualApplymentPayload({
      ...VALID,
      contactName: "  张三  ",
      mobilePhone: " 13800000000 ",
      contactEmail: " boss@example.com ",
    });
    const contact = payload.contact_info as Record<string, unknown>;
    expect(contact.contact_name).toBe("张三");
    expect(contact.mobile_phone).toBe("13800000000");
    expect(contact.contact_email).toBe("boss@example.com");
  });
});
