import type { DemoStatusTone } from "./demo-data";

export const MONITOR_MODULE_IDS = [
  "overview",
  "live",
  "risk",
  "finrisk",
  "health",
] as const;

export type MonitorModuleId = (typeof MONITOR_MODULE_IDS)[number];

export interface MonitorRow {
  id: string;
  no: string;
  title: string;
  info: string;
  amount: string;
  tone: DemoStatusTone;
  statusLabel: string;
  href?: string;
  actionLabel: string;
}

export interface MonitorModuleConfig {
  id: MonitorModuleId;
  kicker: string;
  title: string;
  description: string;
  rows: MonitorRow[];
}

export const MONITOR_MODULES: Record<MonitorModuleId, MonitorModuleConfig> = {
  overview: {
    id: "overview",
    kicker: "MONITOR / OVERVIEW",
    title: "门店概览",
    description: "营业脉搏与需要人工处理的风险，先看影响再给动作。",
    rows: [],
  },
  live: {
    id: "live",
    kicker: "MONITOR / LIVE",
    title: "进行中场次",
    description: "服务端计时的实时场次与结束提醒。",
    rows: [
      {
        id: "088",
        no: "SS-20260908-088",
        title: "阿凯 × 小北",
        info: "王者荣耀 · 巅峰赛双排",
        amount: "42:16",
        tone: "running",
        statusLabel: "服务中",
        href: "/merchant-console/sessions/088",
        actionLabel: "实时盯场",
      },
      {
        id: "090",
        no: "SS-20260908-090",
        title: "Momo × 十一",
        info: "永劫无间 · 双排上分 · 距计划结束 07:30",
        amount: "52:30",
        tone: "pending",
        statusLabel: "接近结束",
        href: "/merchant-console/sessions/090",
        actionLabel: "收结束证据",
      },
    ],
  },
  risk: {
    id: "risk",
    kicker: "MONITOR / RISK",
    title: "异常与争议",
    description: "调整待复核、争议冻结与重复截图等异常集中处理。",
    rows: [
      {
        id: "d-31",
        no: "D-31",
        title: "订单 028 · 时长争议",
        info: "双方时间记录不一致，需客服复核",
        amount: "¥120",
        tone: "pending",
        statusLabel: "待处理",
        href: "/merchant-console/disputes/d-31",
        actionLabel: "去处理",
      },
      {
        id: "d-28",
        no: "D-28",
        title: "订单 015 · 证据异议",
        info: "结束截图时间与服务器不一致 · 已冻结结算",
        amount: "¥150",
        tone: "running",
        statusLabel: "冻结中",
        href: "/merchant-console/disputes/d-28",
        actionLabel: "去处理",
      },
      {
        id: "a-07",
        no: "A-07",
        title: "重复截图提示",
        info: "同一 SHA-256 已上传过，等待人工确认",
        amount: "—",
        tone: "pending",
        statusLabel: "待确认",
        actionLabel: "人工确认",
      },
    ],
  },
  finrisk: {
    id: "finrisk",
    kicker: "MONITOR / FINANCE RISK",
    title: "财务风险",
    description: "待复核、冻结与超时确认的财务事项。",
    rows: [
      {
        id: "f-01",
        no: "F-01",
        title: "结算批次待批准",
        info: "发起人不可自批 · S-20260908-01",
        amount: "¥860.00",
        tone: "pending",
        statusLabel: "待复核",
        href: "/merchant-console/settlements/s-0908-01",
        actionLabel: "去复核",
      },
      {
        id: "f-02",
        no: "F-02",
        title: "争议冻结应收",
        info: "D-28 关联应收已冻结",
        amount: "¥150.00",
        tone: "running",
        statusLabel: "冻结中",
        href: "/merchant-console/disputes/d-28",
        actionLabel: "查看",
      },
      {
        id: "f-03",
        no: "F-03",
        title: "超时未确认",
        info: "服务结束超 24h 未确认，等待跟进",
        amount: "¥120.00",
        tone: "pending",
        statusLabel: "待跟进",
        actionLabel: "跟进",
      },
    ],
  },
  health: {
    id: "health",
    kicker: "MONITOR / HEALTH",
    title: "通知与任务健康",
    description: "通知触达、失败重试、Outbox 死信与人工重放。",
    rows: [
      {
        id: "n-081",
        no: "N-081",
        title: "派单已发布",
        info: "客服小满 · 19:40 发送",
        amount: "已送达",
        tone: "done",
        statusLabel: "已读",
        actionLabel: "查看",
      },
      {
        id: "n-080",
        no: "N-080",
        title: "待收结束证据",
        info: "场次 SS-090 提醒",
        amount: "重试中",
        tone: "pending",
        statusLabel: "重试",
        actionLabel: "手动重试",
      },
      {
        id: "n-077",
        no: "N-077",
        title: "结算待复核",
        info: "财务提醒 · 批次 S-20260908-01",
        amount: "已送达",
        tone: "done",
        statusLabel: "已读",
        actionLabel: "查看",
      },
    ],
  },
};

export function getMonitorModule(
  moduleId: string,
): MonitorModuleConfig | undefined {
  return MONITOR_MODULE_IDS.includes(moduleId as MonitorModuleId)
    ? MONITOR_MODULES[moduleId as MonitorModuleId]
    : undefined;
}
