/**
 * 商家端 P0：三台导航注册表 + UI 权限 mock。
 * 数据源：design-demos/ui-templates/merchant/merchant-console-full.html
 * 契约：后续后端 /me/permissions（或等价接口）就绪后，仅替换权限来源，不重做 UI。
 */

export const MERCHANT_ROLES = ["OWNER", "ADMIN", "CS", "FINANCE"] as const;
export type MerchantRole = (typeof MERCHANT_ROLES)[number];

export const MERCHANT_GROUPS = [
  { id: "workbench", label: "工作台" },
  { id: "records", label: "记录台" },
  { id: "monitor", label: "监控台" },
  { id: "settings", label: "门店设置" },
] as const;

export type MerchantGroupId = (typeof MERCHANT_GROUPS)[number]["id"];

export const MERCHANT_MODULES = [
  {
    id: "work",
    group: "workbench",
    label: "今日工作",
    kicker: "WORKBENCH / TODAY",
    description: "先处理阻塞营业的订单，再安排今晚服务。",
    features: [
      "今日运营脉搏与待办分组",
      "今晚服务与快捷动作",
      "按状态直达订单台账",
    ],
  },
  {
    id: "ai",
    group: "workbench",
    label: "AI 需求助手",
    kicker: "ASSISTANT / AI",
    description: "把一段客户需求解析为结构化订单建议，再做人工确认。",
    features: [
      "需求粘贴与解析预览",
      "客户 / 游戏 / 时长 / 岗位建议",
      "一键带入订单流程",
    ],
  },
  {
    id: "dispatch",
    group: "records",
    label: "订单台账",
    kicker: "RECORDS / ORDERS",
    description: "订单与派单台账，按需求、人员进度和当前动作判断每一单。",
    features: [
      "订单列表与多条件筛选",
      "派单岗位与报名进度",
      "订单详情 / 状态步骤 / 操作",
    ],
  },
  {
    id: "sessions",
    group: "records",
    label: "场次与证据",
    kicker: "RECORDS / SESSIONS",
    description: "场次台账、服务端计时与开始 / 结束证据核对。",
    features: [
      "场次列表与状态筛选",
      "事件时间线与调整复核",
      "证据查看 / 核对 / 下载",
    ],
  },
  {
    id: "customers",
    group: "records",
    label: "客户档案",
    kicker: "RECORDS / CUSTOMERS",
    description: "客户档案、联系方式、历史订单与账户余额入口。",
    features: ["客户列表与检索", "客户详情与历史订单", "余额及账变入口"],
  },
  {
    id: "players",
    group: "records",
    label: "陪玩档案",
    kicker: "RECORDS / PLAYERS",
    description: "陪玩资料、接单状态、技能标签与结算信息。",
    features: ["陪玩列表与审核", "服务能力与状态", "收入及结算记录"],
  },
  {
    id: "catalog",
    group: "records",
    label: "服务目录",
    kicker: "RECORDS / CATALOG",
    description: "配置游戏、服务模式、岗位模板与计价规则。",
    features: ["游戏与服务项目", "岗位需求模板", "价格与时长规则"],
  },
  {
    id: "finance",
    group: "records",
    label: "收入账本",
    kicker: "RECORDS / FINANCE",
    description: "收入账本、客户账变与陪玩收入的统一入口。",
    features: ["客户余额与流水", "陪玩收入记录", "应收明细与分账规则"],
  },
  {
    id: "settlements",
    group: "records",
    label: "结算批次",
    kicker: "RECORDS / SETTLEMENTS",
    description: "结算批次状态机：生成、复核、批准、登记支付与冲正。",
    features: [
      "批次列表与状态筛选",
      "批次详情 / 复核 / 批准",
      "登记支付与冲正",
    ],
  },
  {
    id: "disputes",
    group: "records",
    label: "客诉记录",
    kicker: "RECORDS / DISPUTES",
    description: "集中处理退款、证据、申诉与处理记录。",
    features: ["争议证据", "处理时间线", "结算冻结状态"],
  },
  {
    id: "audit",
    group: "records",
    label: "审计日志",
    kicker: "RECORDS / AUDIT",
    description: "追踪敏感操作、状态变更和操作者。",
    features: ["操作日志", "状态变更记录", "筛选与导出"],
  },
  {
    id: "overview",
    group: "monitor",
    label: "门店概览",
    kicker: "MONITOR / OVERVIEW",
    description: "营业脉搏与需要人工处理的风险，先看影响再给动作。",
    features: ["今日营业摘要", "进行中 / 待办 / 风险入口", "去处理深链"],
  },
  {
    id: "live",
    group: "monitor",
    label: "进行中场次",
    kicker: "MONITOR / LIVE",
    description: "集中查看正在进行的场次、服务端计时与证据进度。",
    features: ["在线场次列表", "时长与结束提醒", "开始 / 结束证据核对"],
  },
  {
    id: "risk",
    group: "monitor",
    label: "异常与争议",
    kicker: "MONITOR / RISK",
    description: "调整待复核、争议冻结与重复截图等异常集中处理。",
    features: ["调整待复核", "争议冻结与证据", "处理动作与记录"],
  },
  {
    id: "finrisk",
    group: "monitor",
    label: "财务风险",
    kicker: "MONITOR / FINANCE RISK",
    description: "待复核结算、open hold 与超时确认等财务风险。",
    features: ["待复核结算批次", "冻结 / 冲正风险", "超时确认提醒"],
  },
  {
    id: "health",
    group: "monitor",
    label: "通知与任务健康",
    kicker: "MONITOR / HEALTH",
    description: "通知触达、失败重试、Outbox 死信与人工重放。",
    features: ["通知列表与已读", "失败与重试队列", "消息模板 / 通道状态"],
  },
  {
    id: "settings",
    group: "settings",
    label: "门店与套餐",
    kicker: "SETTINGS",
    description: "门店资料、员工角色、套餐与功能开关。",
    features: ["门店资料与品牌", "员工与角色 / 权限矩阵", "套餐与增值功能"],
  },
] as const;

export type MerchantModuleId = (typeof MERCHANT_MODULES)[number]["id"];
export type MerchantModule = (typeof MERCHANT_MODULES)[number];

export const MERCHANT_ROLE_META: Record<
  MerchantRole,
  { label: string; desc: string }
> = {
  OWNER: { label: "店老板", desc: "全模块" },
  ADMIN: { label: "店长", desc: "经营与配置" },
  CS: { label: "客服", desc: "订单与派单" },
  FINANCE: { label: "财务", desc: "结算与风控" },
};

const ROLE_MODULE_IDS: Record<MerchantRole, readonly MerchantModuleId[]> = {
  OWNER: [
    "work",
    "ai",
    "dispatch",
    "sessions",
    "customers",
    "players",
    "catalog",
    "finance",
    "settlements",
    "disputes",
    "audit",
    "overview",
    "live",
    "risk",
    "finrisk",
    "health",
    "settings",
  ],
  ADMIN: [
    "work",
    "ai",
    "dispatch",
    "sessions",
    "customers",
    "players",
    "catalog",
    "finance",
    "settlements",
    "disputes",
    "overview",
    "live",
    "risk",
    "finrisk",
    "health",
  ],
  CS: [
    "work",
    "ai",
    "dispatch",
    "sessions",
    "customers",
    "players",
    "disputes",
    "live",
    "risk",
  ],
  FINANCE: [
    "dispatch",
    "sessions",
    "finance",
    "settlements",
    "disputes",
    "audit",
    "overview",
    "risk",
    "finrisk",
    "health",
  ],
};

export function getMerchantModule(id: string): MerchantModule | undefined {
  return MERCHANT_MODULES.find((item) => item.id === id);
}

export function getGroupLabel(groupId: MerchantGroupId): string {
  return MERCHANT_GROUPS.find((group) => group.id === groupId)?.label ?? "";
}

export function canAccessModule(
  role: MerchantRole,
  moduleId: MerchantModuleId,
): boolean {
  return ROLE_MODULE_IDS[role].includes(moduleId);
}

export function getVisibleNavGroups(role: MerchantRole): Array<{
  id: MerchantGroupId;
  label: string;
  items: MerchantModule[];
}> {
  return MERCHANT_GROUPS.map((group) => ({
    id: group.id,
    label: group.label,
    items: MERCHANT_MODULES.filter(
      (item) => item.group === group.id && canAccessModule(role, item.id),
    ),
  })).filter((group) => group.items.length > 0);
}

export function getFirstAllowedModule(
  role: MerchantRole,
): MerchantModule | undefined {
  return getVisibleNavGroups(role)[0]?.items[0];
}
