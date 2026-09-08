import type { DemoStatusTone } from "./demo-data";

export const RECORD_MODULE_IDS = [
  "customers",
  "players",
  "catalog",
  "sessions",
  "finance",
  "settlements",
  "disputes",
  "audit",
] as const;

export type RecordModuleId = (typeof RECORD_MODULE_IDS)[number];

export interface RecordTimelineEvent {
  time: string;
  title: string;
  desc: string;
  state?: "done" | "now" | "future";
}

export interface RecordEvidenceItem {
  name: string;
  uploader: string;
  time: string;
}

export interface RecordListRow {
  id: string;
  no: string;
  title: string;
  info: string;
  amount: string;
  tone: DemoStatusTone;
  statusLabel: string;
  timeline?: RecordTimelineEvent[];
  evidence?: RecordEvidenceItem[];
}

export interface RecordModuleConfig {
  id: RecordModuleId;
  title: string;
  kicker: string;
  description: string;
  rows: RecordListRow[];
  timelinePlaceholder: string[];
  primaryAction?: {
    label: string;
    dialogTitle: string;
    dialogBody: string;
    confirmLabel: string;
    nextLabel?: string;
    nextTone?: DemoStatusTone;
  };
}

export const RECORD_MODULES: Record<RecordModuleId, RecordModuleConfig> = {
  customers: {
    id: "customers",
    title: "客户档案",
    kicker: "RECORDS / CUSTOMERS",
    description: "客户档案、联系方式、历史订单与账户余额入口。",
    rows: [
      {
        id: "c-0001",
        no: "C-0001",
        title: "林同学",
        info: "王者荣耀玩家 · 历史 6 单",
        amount: "余额 ¥320.00",
        tone: "running",
        statusLabel: "活跃",
      },
      {
        id: "c-0002",
        no: "C-0002",
        title: "周同学",
        info: "和平精英玩家 · 历史 3 单",
        amount: "余额 ¥180.00",
        tone: "assigned",
        statusLabel: "近 7 天下单",
      },
      {
        id: "c-0003",
        no: "C-0003",
        title: "孙同学",
        info: "英雄联盟玩家 · 历史 1 单",
        amount: "余额 ¥60.00",
        tone: "muted",
        statusLabel: "沉睡客户",
      },
    ],
    timelinePlaceholder: [
      "账户充值 / 订单创建",
      "派单、场次与结算联动",
      "账变流水与余额入口",
    ],
    primaryAction: {
      label: "编辑资料",
      dialogTitle: "编辑客户资料（模板）",
      dialogBody:
        "客户详情与资料表单将按统一档案模板补齐；当前原型只演示列表与详情框架。",
      confirmLabel: "了解",
    },
  },
  players: {
    id: "players",
    title: "陪玩档案",
    kicker: "RECORDS / PLAYERS",
    description: "陪玩资料、接单状态、技能标签与收入结算记录。",
    rows: [
      {
        id: "p-1001",
        no: "P-1001",
        title: "星野",
        info: "王者荣耀 · 打野 · 王者段位",
        amount: "近 7 日收入 ¥680",
        tone: "running",
        statusLabel: "可接单",
      },
      {
        id: "p-1002",
        no: "P-1002",
        title: "小满",
        info: "王者荣耀 · 辅助 · 钻石段位",
        amount: "近 7 日收入 ¥520",
        tone: "assigned",
        statusLabel: "今晚有档",
      },
      {
        id: "p-1003",
        no: "P-1003",
        title: "和声",
        info: "和平精英 · 全能 · 星钻段位",
        amount: "近 7 日收入 ¥860",
        tone: "muted",
        statusLabel: "休息中",
      },
    ],
    timelinePlaceholder: [
      "接单状态与排班档期",
      "场次开始 / 结束证据",
      "收入与结算批次关联",
    ],
    primaryAction: {
      label: "编辑资料",
      dialogTitle: "编辑陪玩资料（模板）",
      dialogBody:
        "技能标签、档期、审核状态与结算信息将在档案详情切片补齐；当前为统一详情模板。",
      confirmLabel: "了解",
    },
  },
  catalog: {
    id: "catalog",
    title: "服务目录",
    kicker: "RECORDS / CATALOG",
    description: "游戏、服务模式、岗位模板与计价规则的统一配置入口。",
    rows: [
      {
        id: "ct-01",
        no: "CT-01",
        title: "王者荣耀 · 娱乐双排",
        info: "岗位：打野 / 辅助 / 全能",
        amount: "¥120 · 120 分钟",
        tone: "running",
        statusLabel: "启用",
      },
      {
        id: "ct-02",
        no: "CT-02",
        title: "和平精英 · 娱乐四排",
        info: "岗位：全能 ×3",
        amount: "¥90 · 90 分钟",
        tone: "running",
        statusLabel: "启用",
      },
      {
        id: "ct-03",
        no: "CT-03",
        title: "永劫无间 · 巅峰赛双排",
        info: "岗位：全能",
        amount: "¥150 · 60 分钟",
        tone: "pending",
        statusLabel: "草稿",
      },
    ],
    timelinePlaceholder: [
      "游戏 / 区服与产品维护",
      "价格与时长规则版本",
      "岗位模板与报名规则",
    ],
    primaryAction: {
      label: "编辑服务产品",
      dialogTitle: "编辑服务产品（模板）",
      dialogBody:
        "服务目录编辑表单将在后续切片按统一表单模板补齐；当前为列表与详情占位。",
      confirmLabel: "了解",
    },
  },
  sessions: {
    id: "sessions",
    title: "场次与证据",
    kicker: "RECORDS / SESSIONS",
    description: "场次台账、事件时间线、服务端计时与证据核对。",
    rows: [
      {
        id: "088",
        no: "SS-20260908-088",
        title: "阿凯 × 小北",
        info: "王者荣耀 · 巅峰赛双排",
        amount: "42:16",
        tone: "running",
        statusLabel: "服务中",
        evidence: [{ name: "开始截图", uploader: "小北", time: "19:01:22" }],
        timeline: [
          {
            time: "14:05",
            title: "需求确认",
            desc: "客服小满 · 订单价格快照已生成",
            state: "done",
          },
          {
            time: "19:39",
            title: "人选已确认",
            desc: "客服小满 · 打野 / 辅助已就位",
            state: "done",
          },
          {
            time: "19:00",
            title: "场次开始",
            desc: "小北（陪玩端）· 服务器时间",
            state: "now",
          },
          {
            time: "—",
            title: "等待结束与结束截图",
            desc: "结束前需上传结束截图",
            state: "future",
          },
        ],
      },
      {
        id: "090",
        no: "SS-20260908-090",
        title: "Momo × 十一",
        info: "永劫无间 · 双排上分",
        amount: "52:30",
        tone: "running",
        statusLabel: "接近结束",
        evidence: [{ name: "开始截图", uploader: "十一", time: "18:31:05" }],
        timeline: [
          {
            time: "18:30",
            title: "场次开始",
            desc: "十一（陪玩端）· 服务器时间",
            state: "now",
          },
          {
            time: "—",
            title: "等待结束与结束截图",
            desc: "距计划结束 07:30",
            state: "future",
          },
        ],
      },
      {
        id: "071",
        no: "SS-20260908-071",
        title: "阿峰 × 和声",
        info: "和平精英 · 娱乐双排",
        amount: "120 分钟",
        tone: "done",
        statusLabel: "证据齐 · 已确认",
        evidence: [
          { name: "开始截图", uploader: "和声", time: "16:50:12" },
          { name: "结束截图", uploader: "和声", time: "18:48:40" },
        ],
        timeline: [
          {
            time: "16:50",
            title: "场次开始",
            desc: "和声（陪玩端）",
            state: "done",
          },
          {
            time: "18:48",
            title: "场次结束",
            desc: "和声（陪玩端）· 结束截图已上传",
            state: "done",
          },
          {
            time: "18:52",
            title: "时长确认",
            desc: "客户已确认 · 等待费用核对",
            state: "done",
          },
        ],
      },
    ],
    timelinePlaceholder: [
      "需求确认 → 发布",
      "场次开始 / 结束证据",
      "时长与金额调整复核",
    ],
    primaryAction: {
      label: "核对证据",
      dialogTitle: "证据核对",
      dialogBody:
        "演示动作：核对通过后进入场次确认。正式实现由服务端校验上传时间、租户归属与文件哈希。",
      confirmLabel: "标记已核对",
      nextLabel: "已核对",
      nextTone: "done",
    },
  },
  finance: {
    id: "finance",
    title: "收入账本",
    kicker: "RECORDS / FINANCE",
    description: "陪玩应收、门店流水与账户账变记录。",
    rows: [
      {
        id: "e-1001",
        no: "E-1001",
        title: "小北 · 9/7 场次",
        info: "王者双排 120 分钟",
        amount: "¥240",
        tone: "assigned",
        statusLabel: "已生成",
      },
      {
        id: "e-1002",
        no: "E-1002",
        title: "十一 · 9/7 场次",
        info: "永劫双排 90 分钟",
        amount: "¥165",
        tone: "pending",
        statusLabel: "待结算",
      },
      {
        id: "e-1003",
        no: "E-1003",
        title: "清禾 · 9/8 场次",
        info: "王者双排 120 分钟",
        amount: "¥180",
        tone: "running",
        statusLabel: "待复核",
      },
    ],
    timelinePlaceholder: [
      "场次结束生成应收",
      "分账规则 / 费率快照",
      "结算批次汇总",
    ],
  },
  settlements: {
    id: "settlements",
    title: "结算批次",
    kicker: "RECORDS / SETTLEMENTS",
    description: "按批次复核、批准、登记线下支付与冲正。",
    rows: [
      {
        id: "s-0908-01",
        no: "S-20260908-01",
        title: "周结 · 9/1–9/7",
        info: "含 3 位陪玩 8 笔应收",
        amount: "¥860.00",
        tone: "pending",
        statusLabel: "待复核",
      },
      {
        id: "s-0907-01",
        no: "S-20260907-01",
        title: "周结 · 8/25–8/31",
        info: "已登记线下支付",
        amount: "¥1,240.00",
        tone: "done",
        statusLabel: "已支付",
      },
      {
        id: "s-0905-01",
        no: "S-20260905-01",
        title: "周结 · 8/18–8/24",
        info: "存在冲正记录",
        amount: "¥980.00",
        tone: "cancelled",
        statusLabel: "已冲正",
      },
    ],
    timelinePlaceholder: [
      "应收生成与冻结",
      "复核 / 批准 / 支付登记",
      "冲正与审计追踪",
    ],
    primaryAction: {
      label: "复核并批准",
      dialogTitle: "复核结算批次",
      dialogBody:
        "批准后进入支付登记。正式实现中，发起人不能批准自己发起的批次，金额以服务端账本为准。",
      confirmLabel: "批准批次",
      nextLabel: "已批准",
      nextTone: "done",
    },
  },
  disputes: {
    id: "disputes",
    title: "客诉记录",
    kicker: "RECORDS / DISPUTES",
    description: "客诉、证据、处理时间线与结算冻结状态。",
    rows: [
      {
        id: "d-31",
        no: "D-31",
        title: "订单 028 · 时长争议",
        info: "陪玩报 42 分钟，客户认为 35 分钟",
        amount: "¥120",
        tone: "pending",
        statusLabel: "待处理",
      },
      {
        id: "d-30",
        no: "D-30",
        title: "订单 021 · 取消扣费",
        info: "客户未到场要求退款",
        amount: "¥60",
        tone: "pending",
        statusLabel: "待复核",
      },
      {
        id: "d-28",
        no: "D-28",
        title: "订单 015 · 证据异议",
        info: "结束截图时间与服务器不一致",
        amount: "¥150",
        tone: "running",
        statusLabel: "冻结中",
      },
    ],
    timelinePlaceholder: [
      "争议发起与证据收集",
      "客服 / 财务处理动作",
      "结算冻结与解冻",
    ],
    primaryAction: {
      label: "开始处理",
      dialogTitle: "开始处理客诉",
      dialogBody:
        "处理前请核对证据时间线与结算冻结状态；演示动作只更新页面状态。",
      confirmLabel: "开始处理",
      nextLabel: "处理中",
      nextTone: "running",
    },
  },
  audit: {
    id: "audit",
    title: "审计日志",
    kicker: "RECORDS / AUDIT",
    description: "敏感操作、状态变更与操作者追踪。",
    rows: [
      {
        id: "a-9201",
        no: "A-9201",
        title: "order.confirm",
        info: "订单 028 · 客服小满",
        amount: "19:41",
        tone: "assigned",
        statusLabel: "已记录",
      },
      {
        id: "a-9200",
        no: "A-9200",
        title: "settlement.review",
        info: "批次 S-01 · 财务",
        amount: "19:20",
        tone: "pending",
        statusLabel: "待复核",
      },
      {
        id: "a-9199",
        no: "A-9199",
        title: "evidence.upload",
        info: "场次 088 · 陪玩端",
        amount: "19:02",
        tone: "assigned",
        statusLabel: "已记录",
      },
    ],
    timelinePlaceholder: [
      "操作者与租户上下文",
      "状态变更前后值",
      "筛选、导出与审计留痕",
    ],
  },
};

export function getRecordModule(
  moduleId: string,
): RecordModuleConfig | undefined {
  return RECORD_MODULE_IDS.includes(moduleId as RecordModuleId)
    ? RECORD_MODULES[moduleId as RecordModuleId]
    : undefined;
}
