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

/** 陪玩端报名大厅：按位置行给出需要人数、已报名人数与「我的报名」（Task 4 / 设计规格 §3.5）。 */
export interface PlayerHallLineView {
  lineId: string;
  positionLabel: string;
  requiredCount: number;
  appliedCount: number;
  myApplicationId: string | null;
  myApplicationStatus: string | null;
}

export interface PlayerHallOrderView {
  orderId: string;
  dispatchNo: string;
  orderNo: string;
  durationMinutes: number;
  desiredStartAt: string | null;
  roundClosesAt: string | null;
  lines: PlayerHallLineView[];
}

/** 陪玩端「我的接单」：报名状态 + 选中后落下的档位（报单与开始/结束服务都挂在档位上）。 */
export interface PlayerApplicationView {
  applicationId: string;
  orderId: string;
  dispatchNo: string;
  orderNo: string;
  orderStatus: string;
  lineId: string;
  positionLabel: string;
  status: string;
  createdAt: string;
  slotId: string | null;
  /** 未选中（无生效档位）且报名仍为 APPLIED 时才可自助取消；选中后只能由商家释放名额。 */
  canWithdraw: boolean;
}

/** 商家「释放名额」结果：档位标记 RELEASED，订单回到报名阶段并重开一轮。 */
export interface SlotReleaseView {
  slotId: string;
  orderId: string;
  playerId: string;
  orderStatus: string;
  roundNo: number;
  releasedAt: string;
}

/** 违约记录（设计规格 §3.5 / §5）：人工认定，触发通知老板。 */
export interface PlayerBreachView {
  id: string;
  playerId: string;
  playerName: string;
  orderId: string;
  orderSlotId: string | null;
  reason: string;
  createdAt: string;
}
