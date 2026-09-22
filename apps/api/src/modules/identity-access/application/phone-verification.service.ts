import { createHash, randomInt, randomBytes } from "node:crypto";
import type { PrismaClient } from "@pw/database";
import { withTenantContext } from "@pw/database";
import { phoneHash } from "../../../common/pii/phone.js";
import type { SmsProvider } from "../domain/sms-provider.js";
import {
  PhoneVerificationCodeMismatchError,
  PhoneVerificationConsumedError,
  PhoneVerificationExpiredError,
  PhoneVerificationInputError,
  PhoneVerificationThrottledError,
} from "./phone-verification.errors.js";

const PHONE_PATTERN = /^1[3-9]\d{9}$/;
const CODE_TTL_MS = 5 * 60 * 1000;
const RESEND_COOLDOWN_MS = 60 * 1000;
const MAX_ATTEMPTS = 5;

function normalizePhone(value: string): string {
  return value.replace(/[\s-]/g, "");
}

function codeHash(code: string): string {
  const salt = randomBytes(8).toString("hex");
  return `sha256:${salt}:${createHash("sha256")
    .update(`${salt}:${code}`)
    .digest("hex")}`;
}

function verifyCodeHash(hash: string, code: string): boolean {
  const [algo, salt, digest] = hash.split(":");
  if (algo !== "sha256" || !salt || !digest) return false;
  const actual = createHash("sha256").update(`${salt}:${code}`).digest("hex");
  return actual === digest;
}

export class PhoneVerificationService {
  constructor(
    private readonly client: PrismaClient,
    private readonly sms: SmsProvider,
  ) {}

  async sendCode(
    tenantId: string,
    phoneInput: string,
    scene = "register_login",
  ): Promise<{ debugCode: string | null }> {
    const phone = normalizePhone(phoneInput);
    if (!PHONE_PATTERN.test(phone)) {
      throw new PhoneVerificationInputError("手机号格式不正确");
    }
    const hash = phoneHash(tenantId, phone);
    const now = new Date();
    const code = String(randomInt(100000, 1000000));
    const tail = phone.slice(-4);

    let created: { id: string } | null = null;
    try {
      created = await withTenantContext(this.client, tenantId, async (tx) => {
        const recent = await tx.phoneVerificationCode.findFirst({
          where: {
            tenantId,
            phoneHash: hash,
            scene,
            createdAt: { gte: new Date(now.getTime() - RESEND_COOLDOWN_MS) },
          },
          orderBy: { createdAt: "desc" },
          select: { id: true },
        });
        if (recent) throw new PhoneVerificationThrottledError("发送过于频繁");
        return tx.phoneVerificationCode.create({
          data: {
            tenantId,
            phoneHash: hash,
            phoneTail: tail,
            scene,
            codeHash: codeHash(code),
            expiresAt: new Date(now.getTime() + CODE_TTL_MS),
          },
        });
      });

      await withTenantContext(this.client, tenantId, (tx) =>
        tx.auditLog.create({
          data: {
            tenantId,
            actorType: "public_anonymous",
            action: "phone-verification.send",
            resourceType: "phone_verification_code",
            summary: `发送验证码 scene=${scene} phone_tail=****${tail}`,
          },
        }),
      );

      await this.sms.sendCode({
        tenantId,
        // 完整号码只交给通道用于投递；审计与日志仍只写尾号
        mobile: phone,
        phoneTail: tail,
        scene,
        code,
      });
    } catch (error) {
      if (created) {
        await withTenantContext(this.client, tenantId, (tx) =>
          tx.phoneVerificationCode.delete({ where: { id: created!.id } }),
        );
      }
      throw error;
    }
    return { debugCode: this.sms.kind === "mock" ? code : null };
  }

  async consumeCode(
    tenantId: string,
    phoneInput: string,
    codeInput: string,
    scene = "register_login",
  ): Promise<void> {
    const phone = normalizePhone(phoneInput);
    if (!PHONE_PATTERN.test(phone)) {
      throw new PhoneVerificationInputError("手机号格式不正确");
    }
    const hash = phoneHash(tenantId, phone);
    await withTenantContext(this.client, tenantId, async (tx) => {
      const found = await tx.phoneVerificationCode.findFirst({
        where: {
          tenantId,
          phoneHash: hash,
          scene,
          consumedAt: null,
          expiresAt: { gt: new Date() },
        },
        orderBy: { createdAt: "desc" },
      });
      if (!found) {
        throw new PhoneVerificationExpiredError("验证码不存在或已过期");
      }
      if (found.attempts >= MAX_ATTEMPTS) {
        throw new PhoneVerificationCodeMismatchError(
          "尝试次数过多，请重新获取",
        );
      }
      await tx.phoneVerificationCode.update({
        where: { id: found.id },
        data: { attempts: { increment: 1 } },
      });
      if (!verifyCodeHash(found.codeHash, codeInput)) {
        throw new PhoneVerificationCodeMismatchError("验证码不正确");
      }
      const consumed = await tx.phoneVerificationCode.updateMany({
        where: { id: found.id, tenantId, consumedAt: null },
        data: { consumedAt: new Date() },
      });
      if (consumed.count !== 1) {
        throw new PhoneVerificationConsumedError("验证码已被使用");
      }
      await tx.auditLog.create({
        data: {
          tenantId,
          actorType: "public_anonymous",
          action: "phone-verification.consume",
          resourceType: "phone_verification_code",
          resourceId: found.id,
          summary: `校验成功 scene=${scene} phone_tail=****${found.phoneTail}`,
        },
      });
    });
  }
}
