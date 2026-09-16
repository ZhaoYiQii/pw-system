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

/**
 * v2 订单自动文案：只由订单自身快照生成（发布配置 + 提交值 + 快照时间），
 * 不读取当前模板，也不暴露内部 stableKey、semanticRole 或数据库列名。
 */
export interface DispatchDocumentView {
  schemaVersion: number;
  rendererVersion: number;
  rows: { sectionLabel: string; fieldLabel: string; value: string }[];
  plainText: string;
  generatedFromSnapshotAt: string;
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
  /** v2 订单的自动文案；旧订单或快照不可解析时为 null。 */
  document: DispatchDocumentView | null;
}

export interface DispatchListRow {
  orderId: string;
  dispatchNo: string;
  status: string;
  durationMinutes: number;
  customerProfileId: string;
  createdAt: string;
}

export interface DispatchCopyResult {
  copyText: string;
  applyUrl: string;
  bossUrl: string;
}
