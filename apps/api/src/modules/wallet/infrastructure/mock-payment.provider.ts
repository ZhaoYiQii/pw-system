import type {
  PaymentProvider,
  RechargeResult,
} from "../domain/payment-provider.js";

/** 本地模拟支付：立即成功并生成稳定 providerRef。生产环境必须替换真实通道。 */
export class MockPaymentProvider implements PaymentProvider {
  async charge(outNo: string): Promise<RechargeResult> {
    return { providerRef: `MOCK-${outNo}`, success: true };
  }
}
