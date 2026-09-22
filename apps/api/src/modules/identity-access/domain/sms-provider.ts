export type SmsProviderKind = "mock" | "sms" | "tencent";

export interface SendSmsCodeInput {
  tenantId: string;
  /**
   * 收信号码（E.164/国内 11 位规范化后的形式）。
   *
   * 真实通道必须拿到完整号码才能投递，所以端口必须携带它；此前只有 phoneTail，
   * 是无法接真实短信服务的硬性缺口。日志与审计仍然只记录尾号（见调用方与 mock 实现）。
   */
  mobile: string;
  phoneTail: string;
  scene: string;
  code: string;
}

export interface SmsProvider {
  readonly kind: SmsProviderKind;
  sendCode(input: SendSmsCodeInput): Promise<void>;
}
