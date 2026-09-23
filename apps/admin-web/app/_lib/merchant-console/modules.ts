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
    label: "对账差异",
    kicker: "RECORDS / RECONCILIATION",
    description: "微信账单与门店账本的比对结果，差异未解决优先（只读）。",
    features: ["最近账单文件", "差异列表（未解决优先）", "差异类型中文说明"],
  },
  {
    id: "payments-settings",
    group: "settings",
    label: "支付设置",
    kicker: "SETTINGS / PAYMENTS",
    description: "门店收款状态、子商户号登记与状态刷新。",
    features: ["能不能收款 + 下一步", "登记子商户号", "刷新微信侧状态"],
  },
] as const;

export type MerchantModuleId = (typeof MERCHANT_MODULES)[number]["id"];
export type MerchantModule = (typeof MERCHANT_MODULES)[number];

export const MERCHANT_NAV_DOMAINS = [
  {
    id: "business",
    label: "经营台",
    description: "今天要处理的经营事项",
    activeModuleIds: ["work", "overview", "live", "health", "ai"],
  },
  {
    id: "orders",
    label: "订单履约",
    description: "从下单、派单到服务完成",
    activeModuleIds: ["dispatch", "review", "sessions", "disputes"],
  },
  {
    id: "people",
    label: "客户陪玩",
    description: "客户、陪玩与门店人员",
    activeModuleIds: [
      "customers",
      "players",
      "player-applications",
      "breaches",
    ],
  },
  {
    id: "catalog",
    label: "商品店铺",
    description: "商品、价格与店铺展示",
    activeModuleIds: ["catalog"],
  },
  {
    id: "marketing",
    label: "营销会员",
    description: "优惠、活动与会员成长",
    activeModuleIds: [],
  },
  {
    id: "finance",
    label: "财务结算",
    description: "入账、结算与对账",
    activeModuleIds: [
      "finance",
      "settlements",
      "payments-ledger",
      "payments-reconciliation",
    ],
  },
  {
    id: "insights",
    label: "数据风控",
    description: "经营分析与异常监测",
    activeModuleIds: ["risk", "finrisk"],
  },
  {
    id: "settings",
    label: "运营设置",
    description: "门店、权限与审计配置",
    activeModuleIds: ["settings", "pricing", "audit", "payments-settings"],
  },
] as const satisfies readonly {
  id: string;
  label: string;
  description: string;
  activeModuleIds: readonly MerchantModuleId[];
}[];

export type MerchantNavDomainId = (typeof MERCHANT_NAV_DOMAINS)[number]["id"];
export type MerchantModuleStatus = "active" | "preview" | "planned";

export interface MerchantNavChild {
  id: string;
  label: string;
  href: string;
}

export interface MerchantNavItem {
  id: string;
  domain: MerchantNavDomainId;
  label: string;
  description: string;
  status: MerchantModuleStatus;
  moduleId?: MerchantModuleId;
  /** 二级模块下的三级菜单；存在时侧栏渲染为可展开分组。 */
  children?: readonly MerchantNavChild[];
}

const ACTIVE_NAV_LABELS: Partial<Record<MerchantModuleId, string>> = {
  work: "经营工作台",
  overview: "经营总览",
  live: "进行中服务",
  health: "消息与任务",
  ai: "智能助手",
  dispatch: "订单中心",
  review: "审核台",
  disputes: "售后纠纷",
  finance: "经营入账",
  settings: "门店与套餐",
};

/**
 * 三级菜单注册表（二级模块 → 三级页面）。
 * 2026-09-12：订单中心下新增"派单工作台 / 模板管理"。
 * 三级项仍受二级模块的角色可见性约束，前端只控制呈现，不是安全边界。
 */
export const MERCHANT_NAV_CHILDREN: Partial<
  Record<MerchantModuleId, readonly MerchantNavChild[]>
> = {
  dispatch: [
    {
      id: "dispatch-board",
      label: "派单工作台",
      href: "/merchant-console/dispatch",
    },
    {
      id: "dispatch-templates",
      label: "模板管理",
      href: "/merchant-console/dispatch/templates",
    },
  ],
};

export const MERCHANT_FUTURE_MODULES: readonly MerchantNavItem[] = [
  {
    id: "order-rush-hall",
    domain: "orders",
    label: "抢单大厅",
    description: "集中查看可抢订单和响应进度。",
    status: "preview",
  },
  {
    id: "order-reviews",
    domain: "orders",
    label: "评价管理",
    description: "查看服务评价并跟进低分反馈。",
    status: "preview",
  },
  {
    id: "people-schedule",
    domain: "people",
    label: "排班管理",
    description: "配置陪玩可接单时段和班次。",
    status: "preview",
  },
  {
    id: "people-tags",
    domain: "people",
    label: "标签分组",
    description: "用标签与分组管理客户和陪玩。",
    status: "preview",
  },
  {
    id: "people-relations",
    domain: "people",
    label: "关系管理",
    description: "查看屏蔽、关系流水和配对异常。",
    status: "planned",
  },
  {
    id: "people-staff",
    domain: "people",
    label: "员工管理",
    description: "管理客服、财务和店长账号。",
    status: "planned",
  },
  {
    id: "catalog-pricing",
    domain: "catalog",
    label: "价格方案",
    description: "管理服务售价和时长规则。",
    status: "preview",
  },
  {
    id: "catalog-sharing",
    domain: "catalog",
    label: "分成方案",
    description: "配置门店与陪玩分成规则。",
    status: "preview",
  },
  {
    id: "catalog-addons",
    domain: "catalog",
    label: "附加服务",
    description: "配置可选增值服务。",
    status: "planned",
  },
  {
    id: "catalog-limits",
    domain: "catalog",
    label: "限购方案",
    description: "按商品、客户和时段配置限制。",
    status: "planned",
  },
  {
    id: "catalog-certificates",
    domain: "catalog",
    label: "技能证书",
    description: "管理技能证明和审核要求。",
    status: "planned",
  },
  {
    id: "catalog-decoration",
    domain: "catalog",
    label: "店铺装修",
    description: "配置对客页面的品牌内容。",
    status: "planned",
  },
  {
    id: "marketing-discounts",
    domain: "marketing",
    label: "优惠活动",
    description: "统一管理优惠券、折扣和领取记录。",
    status: "preview",
  },
  {
    id: "marketing-invitations",
    domain: "marketing",
    label: "邀请奖励",
    description: "配置邀请方案、奖励和渠道统计。",
    status: "preview",
  },
  {
    id: "marketing-growth",
    domain: "marketing",
    label: "会员成长",
    description: "配置等级、成长值与升级规则。",
    status: "planned",
  },
  {
    id: "marketing-benefits",
    domain: "marketing",
    label: "权益礼包",
    description: "管理等级权益和礼包记录。",
    status: "planned",
  },
  {
    id: "marketing-backpack",
    domain: "marketing",
    label: "用户背包",
    description: "集中展示用户持有的权益与道具。",
    status: "planned",
  },
  {
    id: "marketing-games",
    domain: "marketing",
    label: "互动玩法",
    description: "管理店内互动模板和玩法。",
    status: "planned",
  },
  {
    id: "finance-ledger",
    domain: "finance",
    label: "资金账单",
    description: "查询账户流水和资金去向。",
    status: "preview",
  },
  {
    id: "finance-payments",
    domain: "finance",
    label: "支付退款",
    description: "汇总支付记录、退款与处理状态。",
    status: "preview",
  },
  {
    id: "finance-withdrawals",
    domain: "finance",
    label: "提现管理",
    description: "管理陪玩提现申请与渠道。",
    status: "planned",
  },
  {
    id: "finance-reconcile",
    domain: "finance",
    label: "财务对账",
    description: "核对平台、门店与外部渠道流水。",
    status: "planned",
  },
  {
    id: "finance-arrears",
    domain: "finance",
    label: "欠款追踪",
    description: "跟进待补款与异常账款。",
    status: "planned",
  },
  {
    id: "insights-summary",
    domain: "insights",
    label: "综合分析",
    description: "汇总订单、收入和履约指标。",
    status: "preview",
  },
  {
    id: "insights-trends",
    domain: "insights",
    label: "经营趋势",
    description: "按时间观察订单与收入变化。",
    status: "preview",
  },
  {
    id: "insights-ranking",
    domain: "insights",
    label: "业绩排行",
    description: "查看陪玩和员工的服务表现。",
    status: "preview",
  },
  {
    id: "insights-care",
    domain: "insights",
    label: "客户关怀",
    description: "识别需要回访的客户。",
    status: "planned",
  },
  {
    id: "insights-churn",
    domain: "insights",
    label: "流失预警",
    description: "识别活跃度下降的客户与陪玩。",
    status: "planned",
  },
  {
    id: "insights-private-order",
    domain: "insights",
    label: "私单风险",
    description: "提供需人工核查的异常线索。",
    status: "planned",
  },
  {
    id: "settings-permissions",
    domain: "settings",
    label: "员工权限",
    description: "查看角色与模块访问范围。",
    status: "preview",
  },
  {
    id: "settings-notifications",
    domain: "settings",
    label: "通知规则",
    description: "配置站内提醒和触达策略。",
    status: "preview",
  },
  {
    id: "settings-miniprogram",
    domain: "settings",
    label: "小程序管理",
    description: "管理独立小程序绑定与状态。",
    status: "planned",
  },
  {
    id: "settings-channels",
    domain: "settings",
    label: "渠道管理",
    description: "管理邀请和合作渠道。",
    status: "planned",
  },
  {
    id: "settings-help",
    domain: "settings",
    label: "帮助中心",
    description: "查看操作说明与常见问题。",
    status: "planned",
  },
] as const;

export interface VisibleMerchantNavDomain {
  id: MerchantNavDomainId;
  label: string;
  description: string;
  activeItems: MerchantNavItem[];
  previewItems: MerchantNavItem[];
  plannedItems: MerchantNavItem[];
}

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
    "review",
    "sessions",
    "customers",
    "players",
    "player-applications",
    "breaches",
    "catalog",
    "pricing",
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
    "payments-ledger",
    "payments-reconciliation",
    "payments-settings",
  ],
  ADMIN: [
    "work",
    "ai",
    "dispatch",
    "review",
    "sessions",
    "customers",
    "players",
    "player-applications",
    "breaches",
    "catalog",
    "pricing",
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
    "review",
    "sessions",
    "customers",
    "players",
    "breaches",
    "disputes",
    "live",
    "risk",
  ],
  FINANCE: [
    "work",
    "dispatch",
    "review",
    "sessions",
    "finance",
    "settlements",
    "disputes",
    "audit",
    "overview",
    "risk",
    "finrisk",
    "health",
    "payments-ledger",
    "payments-reconciliation",
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

export function getModuleDomain(
  moduleId: MerchantModuleId,
): (typeof MERCHANT_NAV_DOMAINS)[number] | undefined {
  return MERCHANT_NAV_DOMAINS.find((domain) =>
    domain.activeModuleIds.some((id) => id === moduleId),
  );
}

export function getVisibleNavDomains(role: MerchantRole): Array<{
  id: MerchantNavDomainId;
  label: string;
  description: string;
  activeItems: MerchantNavItem[];
  previewItems: MerchantNavItem[];
  plannedItems: MerchantNavItem[];
}> {
  const allowedModuleIds = new Set(ROLE_MODULE_IDS[role]);
  const moduleById = new Map(
    MERCHANT_MODULES.map((module) => [module.id, module] as const),
  );
  const ownerFutureItems =
    role === "OWNER" ? MERCHANT_FUTURE_MODULES : ([] as const);

  return MERCHANT_NAV_DOMAINS.map((domain) => {
    const activeItems = domain.activeModuleIds.flatMap((moduleId) => {
      if (!allowedModuleIds.has(moduleId)) return [];
      const module = moduleById.get(moduleId);
      if (!module) return [];
      return [
        {
          id: module.id,
          domain: domain.id,
          label: ACTIVE_NAV_LABELS[module.id] ?? module.label,
          description: module.description,
          status: "active" as const,
          moduleId: module.id,
          ...(MERCHANT_NAV_CHILDREN[module.id]
            ? { children: MERCHANT_NAV_CHILDREN[module.id] }
            : {}),
        },
      ];
    });
    const domainFutureItems = ownerFutureItems.filter(
      (item) => item.domain === domain.id,
    );

    return {
      id: domain.id,
      label: domain.label,
      description: domain.description,
      activeItems,
      previewItems: domainFutureItems.filter(
        (item) => item.status === "preview",
      ),
      plannedItems: domainFutureItems.filter(
        (item) => item.status === "planned",
      ),
    };
  }).filter(
    (domain) =>
      domain.activeItems.length > 0 ||
      domain.previewItems.length > 0 ||
      domain.plannedItems.length > 0,
  );
}

export function getFirstAllowedModule(
  role: MerchantRole,
): MerchantModule | undefined {
  return getVisibleNavGroups(role)[0]?.items[0];
}
