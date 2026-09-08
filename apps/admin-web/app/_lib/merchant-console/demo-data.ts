/**
 * P1 演示数据（与 design-demos/ui-templates/merchant/merchant-console-full.html 同源）。
 * 仅用于前端交互原型；金额与状态一律以接入后端后的服务端结果为准。
 */

export const DEMO_ORDER_STATUSES = [
  "DRAFT",
  "CONFIRMED",
  "DISPATCHING",
  "ASSIGNED",
  "IN_PROGRESS",
  "PENDING_CONFIRMATION",
  "COMPLETED",
  "CANCELLED",
] as const;

export type DemoOrderStatus = (typeof DEMO_ORDER_STATUSES)[number];

export type DemoApplicantStatus = "APPLIED" | "SELECTED";

export interface DemoSeatRole {
  name: string;
  need: number;
}

export interface DemoApplicant {
  id: string;
  name: string;
  role: string;
  status: DemoApplicantStatus;
  at: string;
}

export interface DemoOrder {
  id: string;
  game: string;
  mode: string;
  customer: string;
  status: DemoOrderStatus;
  duration: number;
  time: string;
  roles: DemoSeatRole[];
  players: DemoApplicant[];
}

export interface AiDraftSpec {
  customer: string;
  game: string;
  mode: string;
  durationMinutes: number;
  roles: DemoSeatRole[];
}

export type DemoStatusTone =
  | "muted"
  | "dispatch"
  | "assigned"
  | "running"
  | "pending"
  | "done"
  | "cancelled";

export const DEMO_STATUS_META: Record<
  DemoOrderStatus,
  { label: string; tone: DemoStatusTone }
> = {
  DRAFT: { label: "待发布", tone: "pending" },
  CONFIRMED: { label: "待发布", tone: "pending" },
  DISPATCHING: { label: "报名选人", tone: "dispatch" },
  ASSIGNED: { label: "已选定", tone: "assigned" },
  IN_PROGRESS: { label: "服务中", tone: "running" },
  PENDING_CONFIRMATION: { label: "待核算", tone: "pending" },
  COMPLETED: { label: "已完成", tone: "done" },
  CANCELLED: { label: "已取消", tone: "cancelled" },
};

export const INITIAL_DEMO_ORDERS: DemoOrder[] = [
  {
    id: "28",
    game: "王者荣耀",
    mode: "娱乐双排",
    customer: "林同学",
    status: "DISPATCHING",
    duration: 120,
    time: "20:00",
    roles: [
      { name: "打野", need: 1 },
      { name: "辅助", need: 1 },
    ],
    players: [
      {
        id: "xingye",
        name: "星野",
        role: "打野",
        status: "SELECTED",
        at: "19:39",
      },
      {
        id: "xiaoman",
        name: "小满",
        role: "辅助",
        status: "APPLIED",
        at: "19:42",
      },
      {
        id: "ache",
        name: "阿澈",
        role: "辅助",
        status: "APPLIED",
        at: "19:43",
      },
    ],
  },
  {
    id: "27",
    game: "和平精英",
    mode: "娱乐四排",
    customer: "周同学",
    status: "DRAFT",
    duration: 90,
    time: "20:30",
    roles: [{ name: "全能", need: 3 }],
    players: [],
  },
  {
    id: "26",
    game: "永劫无间",
    mode: "娱乐三排",
    customer: "陈同学",
    status: "DISPATCHING",
    duration: 60,
    time: "21:00",
    roles: [{ name: "全能", need: 2 }],
    players: [
      {
        id: "qinghe",
        name: "清禾",
        role: "全能",
        status: "APPLIED",
        at: "19:41",
      },
      {
        id: "jiusheng",
        name: "九生",
        role: "全能",
        status: "APPLIED",
        at: "19:43",
      },
    ],
  },
  {
    id: "25",
    game: "英雄联盟",
    mode: "娱乐双排",
    customer: "许同学",
    status: "ASSIGNED",
    duration: 120,
    time: "20:15",
    roles: [{ name: "全能", need: 1 }],
    players: [
      {
        id: "beichuan",
        name: "北川",
        role: "全能",
        status: "SELECTED",
        at: "19:30",
      },
    ],
  },
  {
    id: "24",
    game: "王者荣耀",
    mode: "娱乐开黑",
    customer: "林同学",
    status: "IN_PROGRESS",
    duration: 60,
    time: "已开始",
    roles: [{ name: "全能", need: 1 }],
    players: [
      {
        id: "muzi",
        name: "木子",
        role: "全能",
        status: "SELECTED",
        at: "18:55",
      },
    ],
  },
  {
    id: "23",
    game: "和平精英",
    mode: "娱乐双排",
    customer: "罗同学",
    status: "PENDING_CONFIRMATION",
    duration: 120,
    time: "服务已结束",
    roles: [{ name: "全能", need: 1 }],
    players: [
      {
        id: "hesheng",
        name: "和声",
        role: "全能",
        status: "SELECTED",
        at: "16:50",
      },
    ],
  },
  {
    id: "22",
    game: "永劫无间",
    mode: "娱乐三排",
    customer: "徐同学",
    status: "COMPLETED",
    duration: 60,
    time: "服务已结束",
    roles: [{ name: "全能", need: 2 }],
    players: [
      {
        id: "shanyu",
        name: "山屿",
        role: "全能",
        status: "SELECTED",
        at: "15:00",
      },
      {
        id: "xiaobai",
        name: "小白",
        role: "全能",
        status: "SELECTED",
        at: "15:01",
      },
    ],
  },
  {
    id: "21",
    game: "英雄联盟",
    mode: "娱乐双排",
    customer: "孙同学",
    status: "CANCELLED",
    duration: 120,
    time: "—",
    roles: [{ name: "全能", need: 1 }],
    players: [],
  },
];

export const TODO_STATUSES: readonly DemoOrderStatus[] = [
  "DRAFT",
  "CONFIRMED",
  "DISPATCHING",
  "PENDING_CONFIRMATION",
];

export const ORDER_STAGE: Record<DemoOrderStatus, number> = {
  DRAFT: 0,
  CONFIRMED: 0,
  DISPATCHING: 1,
  ASSIGNED: 2,
  IN_PROGRESS: 3,
  PENDING_CONFIRMATION: 4,
  COMPLETED: 5,
  CANCELLED: -1,
};

export function orderNo(order: DemoOrder): string {
  return `GD-0908-${order.id.padStart(3, "0")}`;
}

export function isTodo(order: DemoOrder): boolean {
  return (TODO_STATUSES as readonly string[]).includes(order.status);
}

export function selectedPlayers(order: DemoOrder): DemoApplicant[] {
  return order.players.filter((player) => player.status === "SELECTED");
}

export function neededCount(order: DemoOrder): number {
  return order.roles.reduce((sum, role) => sum + role.need, 0);
}

export function filledCount(order: DemoOrder): number {
  return selectedPlayers(order).length;
}

export function shortageFor(
  order: DemoOrder,
  roleName: string,
  withPicks: string[] = [],
): number {
  const picked = order.players.filter(
    (player) =>
      player.role === roleName &&
      (player.status === "SELECTED" || withPicks.includes(player.id)),
  ).length;
  const seat = order.roles.find((role) => role.name === roleName);
  return seat ? Math.max(0, seat.need - picked) : 0;
}

export function totalShortage(
  order: DemoOrder,
  withPicks: string[] = [],
): number {
  return order.roles.reduce(
    (sum, role) => sum + shortageFor(order, role.name, withPicks),
    0,
  );
}

export function taskActionLabel(order: DemoOrder): string {
  if (order.status === "DRAFT" || order.status === "CONFIRMED") return "去发布";
  if (order.status === "DISPATCHING") return "去选人";
  if (order.status === "PENDING_CONFIRMATION") return "去核算";
  return "查看详情";
}

export function taskHint(order: DemoOrder): string {
  if (order.status === "DRAFT") return "草稿待发布，尚未开放报名";
  if (order.status === "CONFIRMED") return "需求已确认，等待发布派单";
  if (order.status === "DISPATCHING") {
    const shortage = totalShortage(order);
    return `已确认 ${filledCount(order)}/${neededCount(order)}，还缺 ${shortage} 人`;
  }
  if (order.status === "ASSIGNED") return "队伍已选定，等待服务开始";
  if (order.status === "IN_PROGRESS") return "服务进行中，以服务端计时为准";
  if (order.status === "PENDING_CONFIRMATION")
    return "服务已结束，等待核对费用";
  if (order.status === "COMPLETED") return "订单核算已确认";
  return "订单已取消，报名与后续操作已关闭";
}

export const COPY_LABEL: Record<string, string> = {
  group: "群派单文案",
  selected: "已选人选文案",
  apply: "报名链接",
  boss: "客户选人链接",
};

export function buildCopyText(
  order: DemoOrder,
  type: "group" | "selected" | "apply" | "boss",
): string {
  if (type === "group") {
    return `${orderNo(order)} ${order.game} ${order.mode}，需要${order.roles
      .map((role) => `${role.name}${role.need}人`)
      .join("、")}`;
  }
  if (type === "selected") {
    const picked = selectedPlayers(order);
    return picked.length
      ? `已确认：${picked
          .map((player) => `${player.name}（${player.role}）`)
          .join("、")}`
      : "暂无已确认人选";
  }
  if (type === "apply") return `https://example.invalid/apply/${order.id}`;
  return `https://example.invalid/boss/${order.id}`;
}
