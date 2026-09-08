import type { DemoStatusTone } from "./demo-data";

export const SETTING_TABS = [
  { id: "brand", label: "门店与品牌" },
  { id: "versions", label: "配置版本" },
  { id: "employees", label: "员工与角色" },
  { id: "matrix", label: "权限矩阵" },
  { id: "plan", label: "套餐与功能" },
] as const;

export type SettingTabId = (typeof SETTING_TABS)[number]["id"];

export interface SettingEmployee {
  id: string;
  name: string;
  roleLabel: string;
  roleDesc: string;
  lastActive: string;
  statusLabel: string;
  statusTone: DemoStatusTone;
}

export interface SettingVersion {
  id: string;
  version: string;
  label: string;
  actor: string;
  time: string;
  isCurrent: boolean;
}

export const SETTING_EMPLOYEES: SettingEmployee[] = [
  {
    id: "ningning",
    name: "宁宁",
    roleLabel: "店老板",
    roleDesc: "全模块",
    lastActive: "刚刚",
    statusLabel: "正常",
    statusTone: "done",
  },
  {
    id: "shiyi",
    name: "十一",
    roleLabel: "店长",
    roleDesc: "经营与配置",
    lastActive: "10 分钟前",
    statusLabel: "正常",
    statusTone: "done",
  },
  {
    id: "xiaoman",
    name: "小满",
    roleLabel: "客服",
    roleDesc: "订单与派单",
    lastActive: "2 分钟前",
    statusLabel: "正常",
    statusTone: "done",
  },
  {
    id: "ache",
    name: "阿澈",
    roleLabel: "财务",
    roleDesc: "结算与风控",
    lastActive: "昨天",
    statusLabel: "正常",
    statusTone: "done",
  },
];

export const SETTING_VERSIONS: SettingVersion[] = [
  {
    id: "v2",
    version: "v2",
    label: "品牌色与门店资料调整",
    actor: "宁宁 · 店老板",
    time: "2026-09-07 19:40",
    isCurrent: true,
  },
  {
    id: "v1",
    version: "v1",
    label: "门店初始化配置",
    actor: "系统",
    time: "2026-09-01 10:00",
    isCurrent: false,
  },
];

/** P4 演示套餐：core 默认随套餐启用；增值模块按需开关。 */
export const SETTING_FEATURE_KEYS = [
  "core.customers",
  "core.players",
  "core.catalog",
  "core.orders",
  "core.dispatch",
  "core.sessions",
  "core.settlements",
  "addon.customer_self_service",
  "addon.player_order_hall",
  "addon.ai_requirement_parser",
  "addon.ai_match_recommendation",
  "addon.ai_anomaly_detection",
  "addon.advanced_reports",
  "addon.online_payment",
] as const;

export const SETTING_FEATURE_ENABLED = new Set<string>([
  "core.customers",
  "core.players",
  "core.catalog",
  "core.orders",
  "core.dispatch",
  "core.sessions",
  "core.settlements",
  "addon.customer_self_service",
  "addon.player_order_hall",
  "addon.ai_requirement_parser",
]);
