import { Injectable } from "@nestjs/common";
import type { SmsProvider, SendSmsCodeInput } from "../domain/sms-provider.js";

/**
 * 开发 Mock：验证码会记录到结构化日志；仅非生产或显式 ALLOW_MOCK_SMS 可用。
 * 生产真实短信接入后，SMS_PROVIDER 选择真实 adapter，不再走本类。
 */
@Injectable()
export class MockSmsProvider implements SmsProvider {
  readonly kind = "mock" as const;

  constructor(private readonly logger: { log(message: string): void }) {}

  async sendCode(input: SendSmsCodeInput): Promise<void> {
    // 有意只打尾号：mock 是开发用的，不该把完整号码写进日志
    this.logger.log(
      `[mock-sms] tenant=${input.tenantId} tail=${input.phoneTail} scene=${input.scene} code=${input.code}`,
    );
  }
}
