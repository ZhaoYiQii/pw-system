import type { MoneyFen } from "../../../common/money.js";

export type OrderStatusType =
  | "DRAFT"
  | "CONFIRMED"
  | "DISPATCHING"
  | "ASSIGNED"
  | "READY"
  | "IN_PROGRESS"
  | "PENDING_CONFIRMATION"
  | "COMPLETED"
  | "CANCELLED";

export interface RequirementView {
  description: string;
  gameId: string | null;
  serviceProductId: string | null;
  gameName: string | null;
  productName: string | null;
  desiredStartAt: Date | null;
  durationSeconds: number | null;
  minBudgetFen: MoneyFen | null;
  maxBudgetFen: MoneyFen | null;
  note: string | null;
}

export interface SnapshotLineView {
  serviceProductId: string | null;
  productName: string;
  regionName: string | null;
  durationSeconds: number;
  unitPriceFen: MoneyFen;
  playerCostFen: MoneyFen;
  lineTotalFen: MoneyFen;
  currency: string;
}

export interface OrderView {
  id: string;
  tenantId: string;
  orderNo: string;
  customerProfileId: string;
  customerName: string;
  status: OrderStatusType;
  scheduledStartAt: Date | null;
  remark: string | null;
  version: number;
  createdAt: Date;
  updatedAt: Date;
  requirement: RequirementView | null;
  snapshot: SnapshotLineView[] | null;
  timeline: Array<{
    id: string;
    eventType: string;
    fromStatus: string | null;
    toStatus: string | null;
    occurredAt: Date;
  }>;
}
