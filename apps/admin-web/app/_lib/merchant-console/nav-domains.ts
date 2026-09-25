/**
 * 导航域、三级菜单与未来模块目录（纯数据，不含逻辑）。
 * 域与 `MERCHANT_MODULES[].group` 是两套并行分组，同名不同义，不要互相推导。
 */
import { CONSOLE_BASE } from "./console-path";
import type { MerchantModuleId } from "./nav-registry";

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
      "payments-wallets",
      "payments-ledger",
      "payments-reconciliation",
      "fund-ledger",
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
    activeModuleIds: [
      "settings",
      "catalog",
      "pricing",
      "audit",
      "payments-settings",
    ],
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

/**
 * 三级菜单注册表（二级模块 → 三级页面）。
 * 2026-09-12：订单中心下新增"派单工作台 / 模板管理"。
 * 三级项仍受二级模块的角色可见性约束，前端只控制呈现，不是安全边界。
 *
 * href 由 `CONSOLE_BASE` 派生：`findActiveNavChild` 按同样的前缀拼出候选 href
 * 再做字符串相等比较，两边一旦分叉会静默失配（面包屑降级成模块名、不报错）。
 */
export const MERCHANT_NAV_CHILDREN: Partial<
  Record<MerchantModuleId, readonly MerchantNavChild[]>
> = {
  dispatch: [
    {
      id: "dispatch-board",
      label: "派单工作台",
      href: `${CONSOLE_BASE}/dispatch`,
    },
    {
      id: "dispatch-templates",
      label: "模板管理",
      href: `${CONSOLE_BASE}/dispatch/templates`,
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
    domain: "settings",
    label: "价格方案",
    description: "管理服务售价和时长规则。",
    status: "preview",
  },
  {
    id: "catalog-sharing",
    domain: "settings",
    label: "分成方案",
    description: "配置门店与陪玩分成规则。",
    status: "preview",
  },
  {
    id: "catalog-addons",
    domain: "settings",
    label: "附加服务",
    description: "配置可选增值服务。",
    status: "planned",
  },
  {
    id: "catalog-limits",
    domain: "settings",
    label: "限购方案",
    description: "按商品、客户和时段配置限制。",
    status: "planned",
  },
  {
    id: "catalog-certificates",
    domain: "settings",
    label: "技能证书",
    description: "管理技能证明和审核要求。",
    status: "planned",
  },
  {
    id: "catalog-decoration",
    domain: "settings",
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
