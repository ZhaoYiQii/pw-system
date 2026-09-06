export type ActiveStatus = "ACTIVE" | "INACTIVE";

export interface PlayerView {
  id: string;
  tenantId: string;
  name: string;
  mobile: string | null;
  intro: string | null;
  status: ActiveStatus;
  acceptingOrders: boolean;
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
