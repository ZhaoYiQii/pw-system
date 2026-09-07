export interface RechargeResult {
  providerRef: string;
  success: boolean;
}

export interface PaymentProvider {
  charge(outNo: string, amountFen: string): Promise<RechargeResult>;
}
