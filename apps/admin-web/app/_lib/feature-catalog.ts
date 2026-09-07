export interface FeatureMeta {
  name: string;
  description: string;
}

/** 平台功能的中文业务文案：页面只展示 name/description，不暴露 featureKey 代码。 */
export const FEATURE_META: Record<string, FeatureMeta> = {
  "core.tenancy": {
    name: "门店与访问域名",
    description: "管理门店身份、H5 访问域名与门店短码。",
  },
  "core.identity": {
    name: "账号与权限",
    description: "管理店主、客服、陪玩和客户账号及各自权限。",
  },
  "core.audit": {
    name: "审计日志",
    description: "记录门店内关键操作，便于事后核查与纠纷处理。",
  },
  "core.customers": {
    name: "客户管理",
    description: "维护老板/客户档案（姓名、手机号等）。",
  },
  "core.players": {
    name: "陪玩管理",
    description: "维护陪玩档案、技能与不可接单时间。",
  },
  "core.catalog": {
    name: "服务目录与价格",
    description: "配置游戏、区服、服务产品和按时长计费的价格。",
  },
  "core.orders": {
    name: "订单",
    description: "创建并跟进客户订单，覆盖确认、派单、服务到完成。",
  },
  "core.dispatch": {
    name: "派单与选人",
    description: "把订单发布给陪玩报名，再由客户或门店选定接单陪玩。",
  },
  "core.sessions": {
    name: "服务场次",
    description: "记录每一单的开始/结束时间与场次证据。",
  },
  "core.settlements": {
    name: "结算与收入",
    description: "按平台、门店、陪玩分成核算每单收入。",
  },
  "addon.customer_self_service": {
    name: "客户自助下单",
    description: "客户在手机 H5 上自己下单、选陪玩、确认完成并提交投诉。",
  },
  "addon.player_order_hall": {
    name: "陪玩接单大厅",
    description: "陪玩在手机 H5 上查看可接订单并报名抢单。",
  },
  "addon.ai_requirement_parser": {
    name: "AI 智能识别需求",
    description: "把客户的文字需求自动整理成下单信息，减少人工录入。",
  },
  "addon.ai_match_recommendation": {
    name: "AI 智能匹配陪玩",
    description: "根据客户需求自动推荐更合适的接单陪玩。",
  },
  "addon.ai_anomaly_detection": {
    name: "AI 风险提醒",
    description: "识别超时、异常开始/结束等可疑场次，帮门店提前发现风险。",
  },
  "addon.advanced_reports": {
    name: "经营报表",
    description: "提供更完整的经营、客户与陪玩收入统计报表。",
  },
  "addon.custom_domain": {
    name: "自有域名",
    description: "允许门店使用自己的域名作为 H5 入口，客户访问更可信。",
  },
  "addon.independent_miniprogram": {
    name: "独立小程序",
    description: "为门店生成独立微信小程序，客户从小程序直接下单。",
  },
  "addon.online_payment": {
    name: "在线支付",
    description: "客户下单后可在线付款，减少线下收费与漏单。",
  },
  "addon.enterprise_wechat_notifications": {
    name: "企业微信通知",
    description: "下单、派单、场次开始/结束等消息自动推送到门店企业微信。",
  },
  "addon.chain_stores": {
    name: "连锁门店",
    description: "同一品牌下管理多家分店，共享经营规则与账号体系。",
  },
  "addon.open_api": {
    name: "第三方系统对接",
    description: "开放对接能力，让 ERP、客服等外部系统与门店订单数据互通。",
  },
};

export function featureMeta(featureKey: string): FeatureMeta | undefined {
  return FEATURE_META[featureKey];
}

export function featureLabel(featureKey: string): string {
  return featureMeta(featureKey)?.name ?? "待补充功能";
}

export function featureDescription(featureKey: string): string {
  return featureMeta(featureKey)?.description ?? "";
}
