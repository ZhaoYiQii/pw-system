export class BossWalletNotFoundError extends Error {
  constructor(message = "老板档案未绑定") {
    super(message);
    this.name = "BossWalletNotFoundError";
  }
}

export class RechargeInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RechargeInputError";
  }
}

export class PaymentStateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PaymentStateError";
  }
}
