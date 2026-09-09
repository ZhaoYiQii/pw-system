export type SmsProviderKind = "mock" | "sms";

export interface SendSmsCodeInput {
  tenantId: string;
  phoneTail: string;
  scene: string;
  code: string;
}

export interface SmsProvider {
  readonly kind: SmsProviderKind;
  sendCode(input: SendSmsCodeInput): Promise<void>;
}
