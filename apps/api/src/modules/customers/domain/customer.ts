export type ActiveStatus = "ACTIVE" | "INACTIVE";

export interface CustomerView {
  id: string;
  tenantId: string;
  name: string;
  mobile: string | null;
  remark: string | null;
  status: ActiveStatus;
  createdAt: Date;
  updatedAt: Date;
}

export interface CustomerWalletEntryView {
  id: string;
  txNo: string;
  type: string;
  amountFen: string;
  balanceAfterFen: string;
  reason: string | null;
  createdAt: Date;
}

export interface CustomerWalletView {
  bossNo: string;
  balanceFen: string;
  entries: CustomerWalletEntryView[];
}

export interface CustomerAccountView {
  customerId: string;
  wallet: CustomerWalletView | null;
}

export interface CustomerOrderHistoryRow {
  orderId: string;
  orderNo: string;
  dispatchNo: string | null;
  processType: "CLASSIC" | "GAME_DISPATCH";
  status: string;
  remark: string | null;
  createdAt: Date;
  updatedAt: Date;
}
