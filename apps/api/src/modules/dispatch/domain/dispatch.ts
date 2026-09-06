import type { MoneyFen } from "../../../common/money.js";

export interface HallOrderView {
  id: string;
  orderNo: string;
  productName: string;
  durationSeconds: number;
  unitPriceFen: MoneyFen;
  desiredStartAt: Date | null;
  createdAt: Date;
}

export interface ApplicationView {
  id: string;
  orderId: string;
  playerId: string;
  playerName: string;
  status: string;
  playerNote: string | null;
  createdAt: Date;
}

export interface AssignView {
  id: string;
  orderId: string;
  playerId: string;
  applicationId: string | null;
  createdAt: Date;
}
