export interface DispatchLineInput {
  positionLabel: string;
  requiredCount: number;
}

export interface DispatchDraftInput {
  templateId: string;
  customerProfileId: string;
  formValues: Record<string, string>;
  desiredStartAt?: string | null;
  durationMinutes: number;
  lines: DispatchLineInput[];
}

export interface DispatchLineView {
  id: string;
  positionLabel: string;
  requiredCount: number;
  applications: DispatchApplicationView[];
}

export interface DispatchApplicationView {
  id: string;
  playerId: string;
  playerName: string;
  positionLabel: string;
  status: string;
  createdAt: string;
}

export interface DispatchView {
  orderId: string;
  dispatchOrderId: string;
  dispatchNo: string;
  status: string;
  customerProfileId: string;
  templateName: string;
  formValues: Record<string, string>;
  durationMinutes: number;
  desiredStartAt: string | null;
  lines: DispatchLineView[];
  round: {
    roundNo: number;
    opensAt: string;
    closesAt: string;
    status: string;
  } | null;
  copyText: string;
  applyUrl: string;
  bossUrl: string;
}

export interface DispatchCopyResult {
  copyText: string;
  applyUrl: string;
  bossUrl: string;
}
