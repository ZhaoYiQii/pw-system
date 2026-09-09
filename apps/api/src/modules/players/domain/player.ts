import type { MoneyFen } from "../../../common/money.js";

export type ActiveStatus = "ACTIVE" | "INACTIVE";

export interface PlayerView {
  id: string;
  tenantId: string;
  name: string;
  mobile: string | null;
  intro: string | null;
  status: ActiveStatus;
  acceptingOrders: boolean;
  basePricePerHourFen: MoneyFen;
  createdAt: Date;
  updatedAt: Date;
}

export interface PlayerSkillView {
  id: string;
  tenantId: string;
  playerId: string;
  gameId: string;
  gameRegionId: string | null;
  gameName: string;
  regionName: string | null;
  title: string | null;
  note: string | null;
}

export interface PlayerAvailabilityView {
  id: string;
  tenantId: string;
  playerId: string;
  startsAt: Date;
  endsAt: Date;
  reason: string | null;
}

export interface PlayerDetailView extends PlayerView {
  skills: PlayerSkillView[];
  availability: PlayerAvailabilityView[];
}

export type PlayerEarningSource = "LEGACY" | "SLOT";

export interface PlayerEarningRecordView {
  id: string;
  source: PlayerEarningSource;
  amountFen: string;
  status: string;
  orderId: string;
  orderNo: string;
  createdAt: Date;
}

export interface PlayerAccountFinanceView {
  paidFen: string;
  unpaidFen: string;
  records: PlayerEarningRecordView[];
}

export interface PlayerAccountView extends PlayerDetailView {
  finance: PlayerAccountFinanceView;
}
