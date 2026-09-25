/**
 * 商家端模块注册表：角色、分组与 25 个模块的字面量。
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
    label: "经营工作台",
    kicker: "WORKBENCH / TODAY",
    description: "处理阻塞营业的订单、结算与风险，先看影响再给动作。",
    features: [
      "今日待办 / 场次 / 结算 / 风险",
      "角色裁剪的财务与风险卡",
      "按状态深链记录台账",
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
    id: "player-applications",
    group: "records",
    label: "陪玩申请",
    kicker: "RECORDS / PLAYER APPLICATIONS",
    description:
      "老板端申请成为陪玩的待审列表，审核通过后自动建档并开通陪玩端。",
    features: ["待审申请", "批准 / 拒绝", "审核后自动追加 PLAYER"],
  },
  // P3 / D3：陪玩违约只读台账（时间范围 + 陪玩筛选、offset 分页）。
  {
    id: "breaches",
    group: "records",
    label: "陪玩违约",
    kicker: "RECORDS / BREACHES",
    description: "人工认定的放鸽子 / 未到场台账，只读；记录入口在订单详情。",
    features: ["时间范围与陪玩筛选", "分页台账", "点进订单详情"],
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
    id: "pricing",
    group: "settings",
    label: "算价模型",
    kicker: "SETTINGS / PRICING",
    description:
      "维护按游戏的加价规则与每陪玩每游戏底价（单价 = 底价 + 命中加价）。",
    features: ["按游戏的加价规则", "陪玩×游戏底价", "命中键与整数分校验"],
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
  // 订单中心列表 Slice 2：审核台（报单审批从场次详情收敛到独立队列）。
  {
    id: "review",
    group: "records",
    label: "审核台",
    kicker: "RECORDS / REVIEW",
    description:
      "报单队列 + 开始/结束截图并排对照 + 通过/驳回动作，审批留痕沿用审计日志。",
    features: [
      "报单队列（待审批/已通过/已驳回）",
      "截图并排对照与时长差异",
      "通过可修正时长",
    ],
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
  // S4-8：支付线的三页挂进商家端侧栏（与门店后台渲染同一份 panel，不重复实现）。
  {
    id: "payments-ledger",
    group: "records",
    label: "支付台账",
    kicker: "RECORDS / PAYMENTS",
    description:
      "客户充值支付单：金额、已退多少、还能退多少，并在行内登记退款。",
    features: [
      "支付单列表与状态筛选",
      "已退 / 可退金额",
      "人工退款登记（扣钱包 + 流水 + 审计）",
    ],
  },
  {
    id: "payments-reconciliation",
    group: "records",
    label: "对账处理工作台",
    kicker: "RECORDS / RECONCILIATION",
    description:
      "微信账单与门店账本的比对结果，以及每条差异的处理单：认领、处理、提交复核、复核关闭或带理由忽略。",
    features: [
      "差异列表（未解决优先）与处理单状态",
      "认领 / 开始处理 / 提交复核 / 复核关闭",
      "带理由忽略（不改账目，差异标记为已解决）",
      "最近账单文件与差异类型中文说明",
    ],
  },
  {
    id: "payments-settings",
    group: "settings",
    label: "支付设置",
    kicker: "SETTINGS / PAYMENTS",
    description: "门店收款状态、子商户号登记与状态刷新。",
    features: ["能不能收款 + 下一步", "登记子商户号", "刷新微信侧状态"],
  },
  {
    id: "payments-wallets",
    group: "records",
    label: "客户钱包",
    kicker: "RECORDS / WALLETS",
    description: "客户余额与充值 / 退款流水（只读），支持按客户名搜索。",
    features: [
      "客户余额列表与最近变动",
      "单客户充值 / 退款 / 扣费流水",
      "金额方向由后端判定（不猜正负）",
    ],
  },
  {
    id: "fund-ledger",
    group: "records",
    label: "统一资金台账",
    kicker: "RECORDS / FUND LEDGER",
    description: "已确认业务资金事件的只读追溯入口：筛选、导出与逐笔证据链。",
    features: [
      "服务端筛选、排序与分页",
      "当前筛选与排序下的完整 CSV 导出",
      "四段证据链：来源 → 资金账户 → 借贷结果 → 确认信息",
    ],
  },
] as const;

export type MerchantModuleId = (typeof MERCHANT_MODULES)[number]["id"];
export type MerchantModule = (typeof MERCHANT_MODULES)[number];

export function getMerchantModule(id: string): MerchantModule | undefined {
  return MERCHANT_MODULES.find((item) => item.id === id);
}
