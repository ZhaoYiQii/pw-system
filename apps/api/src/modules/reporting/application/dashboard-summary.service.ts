import type { PrismaClient } from "@pw/database";
import {
  applyRoleMask,
  type AttentionItem,
  type DashboardStaffRole,
  type DashboardSummary,
  type RiskFeedItem,
} from "../domain/dashboard-summary.js";

const STORE_TZ = "Asia/Shanghai";
const DAY_MS = 24 * 60 * 60 * 1000;

const TODO_ORDER_STATUSES = [
  "DRAFT",
  "CONFIRMED",
  "DISPATCHING",
  "PENDING_CONFIRMATION",
];

const PENDING_BATCH_STATUSES = ["DRAFT", "REVIEWED", "APPROVED"];

interface DayRange {
  date: string;
  start: Date;
  end: Date;
}

interface CountRow {
  n: bigint;
}

interface SettlementSumRow {
  n: bigint;
  total: bigint;
}

interface OrderRow {
  id: string;
  order_no: string;
  status: string;
  process_type: string;
  created_at: Date;
  customer_name: string | null;
}

interface BatchRow {
  id: string;
  batch_no: string;
  status: string;
  total_amount_fen: bigint;
  created_at: Date;
}

interface DisputeRow {
  id: string;
  order_no: string;
  created_at: Date;
  customer_name: string | null;
}

interface AdjustmentRow {
  id: string;
  session_id: string;
  order_no: string;
  created_at: Date;
  customer_name: string | null;
}

function inClause(values: readonly string[], firstParamIndex: number): string {
  return values.map((_, index) => `$${firstParamIndex + index}`).join(", ");
}

function orderAction(status: string): string {
  if (status === "DISPATCHING") return "GO_SELECT";
  if (status === "PENDING_CONFIRMATION") return "GO_SETTLE";
  return "GO_PUBLISH";
}

function orderPriority(status: string): "HIGH" | "MEDIUM" {
  return status === "DRAFT" || status === "CONFIRMED" ? "MEDIUM" : "HIGH";
}

export class DashboardSummaryService {
  public client: PrismaClient;

  constructor(client: PrismaClient) {
    this.client = client;
  }

  static dayRange(now: Date = new Date()): DayRange {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: STORE_TZ,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(now);
    const get = (type: Intl.DateTimeFormatPartTypes): string =>
      parts.find((p) => p.type === type)?.value ?? "";
    const date = `${get("year")}-${get("month")}-${get("day")}`;
    const start = new Date(`${date}T00:00:00+08:00`);
    return { date, start, end: new Date(start.getTime() + DAY_MS) };
  }

  async get(
    tenantId: string,
    role: DashboardStaffRole,
  ): Promise<DashboardSummary> {
    const day = DashboardSummaryService.dayRange();
    const c = this.client;

    const todoStatus = inClause(TODO_ORDER_STATUSES, 2);
    const pendingBatchStatus = inClause(PENDING_BATCH_STATUSES, 2);

    const [
      todoCount,
      classicLive,
      slotLive,
      todayService,
      settlement,
      disputes,
      adjustmentTotal,
    ] = await Promise.all([
      c.$queryRawUnsafe<CountRow[]>(
        `SELECT COUNT(*)::bigint AS n FROM orders
           WHERE tenant_id = $1::uuid
             AND status IN (${todoStatus})`,
        tenantId,
        ...TODO_ORDER_STATUSES,
      ),
      c.$queryRaw<CountRow[]>`
          SELECT COUNT(*)::bigint AS n FROM service_sessions
          WHERE tenant_id = ${tenantId}::uuid
            AND status = 'STARTED'`,
      c.$queryRaw<CountRow[]>`
          SELECT COUNT(*)::bigint AS n FROM slot_sessions
          WHERE tenant_id = ${tenantId}::uuid
            AND status IN ('STARTED', 'IN_PROGRESS')`,
      c.$queryRaw<CountRow[]>`
          SELECT COUNT(DISTINCT order_id)::bigint AS n FROM (
            SELECT order_id FROM service_sessions
            WHERE tenant_id = ${tenantId}::uuid
              AND ended_at >= ${day.start}
              AND ended_at < ${day.end}
              AND status IN ('ENDED', 'CONFIRMED')
            UNION
            SELECT order_id FROM slot_sessions
            WHERE tenant_id = ${tenantId}::uuid
              AND ended_at >= ${day.start}
              AND ended_at < ${day.end}
              AND status = 'ENDED'
          ) s`,
      c.$queryRawUnsafe<SettlementSumRow[]>(
        `SELECT COUNT(*)::bigint AS n,
                  COALESCE(SUM(total_amount_fen), 0)::bigint AS total
           FROM settlement_batches
           WHERE tenant_id = $1::uuid
             AND status IN (${pendingBatchStatus})`,
        tenantId,
        ...PENDING_BATCH_STATUSES,
      ),
      c.$queryRaw<CountRow[]>`
          SELECT COUNT(*)::bigint AS n FROM disputes
          WHERE tenant_id = ${tenantId}::uuid AND status = 'OPEN'`,
      c.$queryRaw<CountRow[]>`
          SELECT COUNT(*)::bigint AS n FROM session_adjustments
          WHERE tenant_id = ${tenantId}::uuid AND status = 'PENDING'`,
    ]);

    const todoOrders = Number(todoCount[0]?.n ?? 0n);
    const liveSessions =
      Number(classicLive[0]?.n ?? 0n) + Number(slotLive[0]?.n ?? 0n);
    const todayServiceCount = Number(todayService[0]?.n ?? 0n);
    const financeTodos = Number(settlement[0]?.n ?? 0n);
    const pendingSettlementAmountFen = (settlement[0]?.total ?? 0n).toString();
    const openDisputes = Number(disputes[0]?.n ?? 0n);
    const adjustmentCount = Number(adjustmentTotal[0]?.n ?? 0n);

    const [orderRows, batchRows, disputeRows, adjustmentRows] =
      await Promise.all([
        c.$queryRawUnsafe<OrderRow[]>(
          `SELECT o.id, o.order_no, o.status, o.process_type, o.created_at,
                  cp.name AS customer_name
           FROM orders o
           LEFT JOIN customer_profiles cp
             ON cp.tenant_id = o.tenant_id AND cp.id = o.customer_profile_id
           WHERE o.tenant_id = $1::uuid
             AND o.status IN (${todoStatus})
           ORDER BY o.created_at DESC
           LIMIT 5`,
          tenantId,
          ...TODO_ORDER_STATUSES,
        ),
        c.$queryRawUnsafe<BatchRow[]>(
          `SELECT id, batch_no, status, total_amount_fen, created_at
           FROM settlement_batches
           WHERE tenant_id = $1::uuid
             AND status IN (${pendingBatchStatus})
           ORDER BY created_at DESC
           LIMIT 3`,
          tenantId,
          ...PENDING_BATCH_STATUSES,
        ),
        c.$queryRaw<DisputeRow[]>`
          SELECT d.id, o.order_no, d.created_at, cp.name AS customer_name
          FROM disputes d
          JOIN orders o ON o.tenant_id = d.tenant_id AND o.id = d.order_id
          LEFT JOIN customer_profiles cp
            ON cp.tenant_id = d.tenant_id AND cp.id = d.customer_profile_id
          WHERE d.tenant_id = ${tenantId}::uuid AND d.status = 'OPEN'
          ORDER BY d.created_at DESC
          LIMIT 3`,
        c.$queryRaw<AdjustmentRow[]>`
          SELECT sa.id, s.id AS session_id, o.order_no, sa.created_at,
                 cp.name AS customer_name
          FROM session_adjustments sa
          JOIN service_sessions s
            ON s.tenant_id = sa.tenant_id AND s.id = sa.session_id
          JOIN orders o ON o.tenant_id = s.tenant_id AND o.id = s.order_id
          LEFT JOIN customer_profiles cp
            ON cp.tenant_id = o.tenant_id AND cp.id = o.customer_profile_id
          WHERE sa.tenant_id = ${tenantId}::uuid AND sa.status = 'PENDING'
          ORDER BY sa.created_at DESC
          LIMIT 3`,
      ]);

    const orderAttention: AttentionItem[] = orderRows.map((row) => ({
      id: `order-${row.id}`,
      kind: "ORDER_TODO",
      refType: "DISPATCH",
      refId: row.id,
      refNo: row.order_no,
      flow: row.process_type === "GAME_DISPATCH" ? "GAME_DISPATCH" : "CLASSIC",
      title: row.order_no,
      subtitle: row.customer_name,
      priority: orderPriority(row.status),
      action: orderAction(row.status),
      occurredAt: row.created_at.toISOString(),
    }));

    const settlementAttention: AttentionItem[] = batchRows.map((row) => ({
      id: `settlement-${row.id}`,
      kind: "SETTLEMENT_TODO",
      refType: "SETTLEMENT_BATCH",
      refId: row.id,
      refNo: row.batch_no,
      title: `${row.batch_no} · 待处理`,
      subtitle: null,
      priority: "HIGH",
      action: "GO_SETTLE",
      occurredAt: row.created_at.toISOString(),
    }));

    const disputeAttention: AttentionItem[] = disputeRows.map((row) => ({
      id: `dispute-${row.id}`,
      kind: "DISPUTE_TODO",
      refType: "DISPUTE",
      refId: row.id,
      refNo: row.order_no,
      title: row.order_no,
      subtitle: row.customer_name,
      priority: "HIGH",
      action: "GO_DISPUTE",
      occurredAt: row.created_at.toISOString(),
    }));

    const adjustmentAttention: AttentionItem[] = adjustmentRows.map((row) => ({
      id: `adjustment-${row.id}`,
      kind: "SESSION_TODO",
      refType: "SESSION",
      refId: row.session_id,
      refNo: row.order_no,
      title: `${row.order_no} · 时长调整待复核`,
      subtitle: row.customer_name,
      priority: "MEDIUM",
      action: "GO_REVIEW",
      occurredAt: row.created_at.toISOString(),
    }));

    const adjustmentRisk: RiskFeedItem[] = adjustmentRows.map((row) => ({
      id: `adjustment-risk-${row.id}`,
      kind: "ADJUSTMENT_TODO",
      refType: "SESSION",
      refId: row.session_id,
      refNo: row.order_no,
      title: `${row.order_no} · 时长调整待复核`,
      priority: "MEDIUM",
      occurredAt: row.created_at.toISOString(),
    }));

    const settlementRisk: RiskFeedItem[] = batchRows.map((row) => ({
      id: `settlement-risk-${row.id}`,
      kind: "SETTLEMENT_TODO",
      refType: "SETTLEMENT_BATCH",
      refId: row.id,
      refNo: row.batch_no,
      title: `${row.batch_no} · 结算批次待处理`,
      amountFen: row.total_amount_fen.toString(),
      priority: "HIGH",
      occurredAt: row.created_at.toISOString(),
    }));

    const disputeRisk: RiskFeedItem[] = disputeRows.map((row) => ({
      id: `dispute-risk-${row.id}`,
      kind: "DISPUTE_TODO",
      refType: "DISPUTE",
      refId: row.id,
      refNo: row.order_no,
      title: `${row.order_no} · 争议待处理`,
      priority: "HIGH",
      occurredAt: row.created_at.toISOString(),
    }));

    const riskFeed = [...adjustmentRisk, ...settlementRisk, ...disputeRisk]
      .sort((a, b) => b.occurredAt.localeCompare(a.occurredAt))
      .slice(0, 5);

    const attention = [
      ...orderAttention,
      ...settlementAttention,
      ...disputeAttention,
      ...adjustmentAttention,
    ]
      .sort((a, b) => b.occurredAt.localeCompare(a.occurredAt))
      .slice(0, 8);

    const summary: DashboardSummary = {
      day: { date: day.date, tz: STORE_TZ },
      metrics: {
        todoOrders,
        liveSessions,
        financeTodos,
        openDisputes,
        riskAlerts: financeTodos + openDisputes + adjustmentCount,
        todayServiceCount,
        pendingSettlementCount: financeTodos,
        pendingSettlementAmountFen,
      },
      attention,
      riskFeed,
    };

    return applyRoleMask(role, summary);
  }
}
