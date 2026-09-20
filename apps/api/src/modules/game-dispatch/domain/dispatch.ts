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
  /** 选中后落下的档位 id（Task 5a：商家端据此提供「释放名额」）；未选中或被释放为 null。 */
  slotId: string | null;
  /**
   * 该陪玩在本单的单价（分/小时）= 陪玩×游戏底价 + 命中加价，**不乘时长**（设计规格 §3.4）。
   * 未设置底价时为 null（此时该陪玩无法被选中）。
   */
  unitPriceFen: string | null;
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
  /** 费用口径（Task 5b-2/A，设计规格 §3.2 / §3.4）：只报链路里真实存在的数字。 */
  settlement: DispatchSettlementView;
}

/**
 * 订单费用口径。
 *
 * 本版（A 方案）只披露真实数字：老板支出 = 已核定档位金额合计（= 确认结算实际扣款额），
 * 陪玩实收在当前链路为**整额发放**（与支出相同）。门店抽成与平台费尚未在本链路分账，
 * 因此 `storeCutFen` / `platformFeeFen` 恒为 null，`splitApplied` 恒为 false——
 * 不按规格公式编造毛利（规格 §3.2 的分账待落地，见后续 ADR）。
 */
export interface DispatchSettlementView {
  /** 老板支出（分，字符串）：已核定档位金额合计。 */
  orderAmountFen: string;
  /** 陪玩实收（分，字符串）：当前链路整额发放，等于 orderAmountFen。 */
  playerShareFen: string;
  /** 门店毛利（分，字符串）：= 支出 − 实收，分账未落地时为 0。 */
  storeProfitFen: string;
  /** 门店抽成（分）：尚未分账，恒为 null。 */
  storeCutFen: string | null;
  /** 平台费（分）：尚未分账，恒为 null。 */
  platformFeeFen: string | null;
  /** 是否已按费率分账；本版恒为 false。 */
  splitApplied: boolean;
  /** 已核定（有报单审批金额）的生效档位数。 */
  approvedSlotCount: number;
  /** 生效档位数（不含已释放）。 */
  activeSlotCount: number;
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
  /** 我报名该单的单价（分/小时，不乘时长）；未设置底价时为 null。 */
  unitPriceFen: string | null;
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
  /** 单价（分/小时，不乘时长）：选中后取档位快照价，未选中时按当前规则库计算。 */
  unitPriceFen: string | null;
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
