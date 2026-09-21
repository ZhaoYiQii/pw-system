import { randomBytes } from "node:crypto";
import { Logger } from "@nestjs/common";
import {
  TEMPLATE_EVENTS,
  emitTemplateEvent,
} from "./game-template-observability.js";
import type { PrismaClient, DbTransaction } from "@pw/database";
import type {
  DispatchApplicationView,
  DispatchCopyResult,
  DispatchDraftInput,
  DispatchListRow,
  DispatchDocumentView,
  DispatchLineView,
  DispatchView,
  PlayerApplicationView,
  PlayerHallOrderView,
  DispatchSettlementView,
  SlotReleaseView,
} from "../domain/dispatch.js";
import {
  DispatchConflictError,
  DispatchInputError,
  DispatchNotFoundError,
  DispatchStateError,
} from "../domain/dispatch-errors.js";
import { renderDispatchDocument } from "../domain/game-template-document.js";
import {
  partitionValuesV2,
  visibleConfigV2,
  type TemplateAudienceV2,
} from "../domain/game-template-config-v2.js";
import { readPublishedConfig } from "../domain/game-template-published-read.js";
import {
  activeTemplateFields,
  activeTemplateValues,
  templateFormValueError,
} from "../domain/game-template-values.js";
import {
  pricingDimensionKeys,
  resolveUnitPriceFen,
  type PricingDimensionField,
  type PricingRuleItem,
} from "../domain/game-pricing.js";
import type { MoneyFen } from "../../../common/money.js";
import { splitSettlement } from "../../ledger/domain/split.js";
import { assertOrderTransition } from "../../orders/domain/order-state-machine.js";
import { resolveRoundWindowMs } from "../domain/dispatch-window.js";
import {
  loadGameRuleItems,
  loadPlayerGameBases,
} from "../infrastructure/prisma-game-pricing.repository.js";

/** ADR-0005 切片二：订单状态迁移统一走集中表校验（表外迁移 → OrderStateConflictError → 409）。 */
function assertTransition(from: string, to: string, orderId: string): void {
  // 入参来自数据库列（string 列），这里收敛到集中表的联合类型做校验；表外取值会直接抛错。
  assertOrderTransition(
    orderId,
    from as Parameters<typeof assertOrderTransition>[1],
    to as Parameters<typeof assertOrderTransition>[1],
  );
}

type Tx = DbTransaction;

/** 列表分页上限（订单中心列表 Slice 0）：默认 20、最多 100。 */
export const DISPATCH_LIST_DEFAULT_LIMIT = 20;
export const DISPATCH_LIST_MAX_LIMIT = 100;

export function clampListLimit(limit: number | undefined): number {
  if (limit === undefined || !Number.isFinite(limit)) {
    return DISPATCH_LIST_DEFAULT_LIMIT;
  }
  return Math.min(Math.max(Math.trunc(limit), 1), DISPATCH_LIST_MAX_LIMIT);
}

export function clampListOffset(offset: number | undefined): number {
  if (offset === undefined || !Number.isFinite(offset)) return 0;
  return Math.max(Math.trunc(offset), 0);
}

/**
 * 列表金额区间参数（整数分）。非法值返回 null = 该边界不参与比较。
 *
 * 用字符串走 BigInt，避免大额（> 2^53）在 Number 上丢精度；`"abc"` / `""` / 负数都不生效。
 */
export function parseAmountFenFilter(value: string | undefined): bigint | null {
  if (value === undefined) return null;
  const trimmed = value.trim();
  if (!/^\d+$/.test(trimmed)) return null;
  try {
    return BigInt(trimmed);
  } catch {
    return null;
  }
}

/** 列表排序键：创建时间倒序（默认）/ 正序 / 按订单状态流转顺序。 */
export type DispatchListSort = "created_desc" | "created_asc" | "status";

/** 状态流转顺序（与商家端页签一致）：不在表内的一律排最后。 */
export const DISPATCH_STATUS_ORDER = [
  "DRAFT",
  "CONFIRMED",
  "DISPATCHING",
  "ASSIGNED",
  "READY",
  "IN_PROGRESS",
  "PENDING_CONFIRMATION",
  "COMPLETED",
  "CANCELLED",
] as const;

export function normalizeListSort(sort: string | undefined): DispatchListSort {
  return sort === "created_asc" || sort === "status" ? sort : "created_desc";
}

/** 报单状态（设计规格 §3.3）：未报单 / 待客服审批 / 已通过（已落金额）/ 已驳回。 */
export type SlotReportStatus =
  "NOT_REPORTED" | "PENDING_REVIEW" | "APPROVED" | "REJECTED";

/** 报单与审批视图：金额来自审批后的 SlotEarning，证据计时长只作对照。 */
export interface SlotReportView {
  slotId: string;
  sessionId: string;
  orderId: string;
  playerId: string;
  unitPriceFen: string;
  reportStatus: SlotReportStatus;
  declaredDurationMinutes: number | null;
  durationSeconds: number | null;
  reportSubmittedAt: string | null;
  reportReviewedAt: string | null;
  reportReviewedBy: string | null;
  reportReviewNote: string | null;
  earningFen: string | null;
}

/** 申报时长边界（设计规格 §3.3 / §6）：15–1440 分钟。 */
const DECLARED_MINUTES_MIN = 15;
const DECLARED_MINUTES_MAX = 1440;
/** 报单证据用途：复用既有 SlotEvidence 通道（设计规格 §9 第 4 条）。 */
const REPORT_EVIDENCE_TYPES = ["REPORT_START", "REPORT_END"] as const;

function declaredMinutesOrThrow(value: number): number {
  if (
    !Number.isInteger(value) ||
    value < DECLARED_MINUTES_MIN ||
    value > DECLARED_MINUTES_MAX
  )
    throw new DispatchInputError(
      `申报时长需为 ${DECLARED_MINUTES_MIN}–${DECLARED_MINUTES_MAX} 分钟`,
    );
  return value;
}

/** 计费金额 = 单价 × 核定分钟 / 60，向上取整到分（(price*minutes+59)/60，全整数分，无浮点）。 */
function slotEarningFen(unitPriceFen: bigint, minutes: number): bigint {
  return (unitPriceFen * BigInt(minutes) + 59n) / 60n;
}

function slotReportStatusOf(
  submittedAt: Date | null,
  reviewedAt: Date | null,
  hasEarning: boolean,
): SlotReportStatus {
  if (submittedAt === null) return "NOT_REPORTED";
  if (hasEarning) return "APPROVED";
  return reviewedAt === null ? "PENDING_REVIEW" : "REJECTED";
}

function slotReportViewOf(
  slot: {
    id: string;
    orderId: string;
    playerId: string;
    unitPriceFen: bigint;
  },
  session: {
    id: string;
    declaredDurationMinutes: number | null;
    durationSeconds: number | null;
    reportSubmittedAt: Date | null;
    reportReviewedAt: Date | null;
    reportReviewedBy: string | null;
    reportReviewNote: string | null;
  },
  earningFen: bigint | null,
): SlotReportView {
  return {
    slotId: slot.id,
    sessionId: session.id,
    orderId: slot.orderId,
    playerId: slot.playerId,
    unitPriceFen: slot.unitPriceFen.toString(),
    reportStatus: slotReportStatusOf(
      session.reportSubmittedAt,
      session.reportReviewedAt,
      earningFen !== null,
    ),
    declaredDurationMinutes: session.declaredDurationMinutes ?? null,
    durationSeconds: session.durationSeconds ?? null,
    reportSubmittedAt: session.reportSubmittedAt?.toISOString() ?? null,
    reportReviewedAt: session.reportReviewedAt?.toISOString() ?? null,
    reportReviewedBy: session.reportReviewedBy ?? null,
    reportReviewNote: session.reportReviewNote ?? null,
    earningFen: earningFen === null ? null : earningFen.toString(),
  };
}

/** 报单必须同时带开始/结束截图（设计规格 §9 第 5 条），供客服审批时人工核查。 */
async function assertReportEvidence(
  tx: Tx,
  tenantId: string,
  slotId: string,
): Promise<void> {
  const rows = await tx.slotEvidence.findMany({
    where: {
      tenantId,
      orderSlotId: slotId,
      evidenceType: { in: [...REPORT_EVIDENCE_TYPES] },
    },
    select: { evidenceType: true },
  });
  const kinds = new Set(rows.map((row) => row.evidenceType));
  if (!kinds.has("REPORT_START") || !kinds.has("REPORT_END"))
    throw new DispatchInputError("报单需先上传开始截图与结束截图");
}

/**
 * 订单行锁（Task 4 / 设计规格 §6）：陪玩报名与后台「无人报名自动关单」都在该锁内
 * 重新校验状态，保证并发下只有一方成功。租户过滤写在 SQL 里（RLS 之外的双保险）。
 */
async function lockOrderRow(
  tx: Tx,
  tenantId: string,
  orderId: string,
): Promise<void> {
  await tx.$queryRaw`
    SELECT id FROM orders
    WHERE id = ${orderId}::uuid AND tenant_id = ${tenantId}::uuid
    FOR UPDATE`;
}

/**
 * 档位收入的「老板支出（整额）」：ADR-0004 之后 `SlotEarning.amountFen` 存的是**陪玩实收**，
 * 整额落在 `detailJson.grossFen`；切换前的历史行没有该字段，此时 amountFen 本身就是整额。
 */
function grossFenOf(earning: {
  amountFen: bigint;
  detailJson?: unknown;
}): bigint {
  const detail = (earning.detailJson ?? {}) as Record<string, unknown>;
  const raw = detail.grossFen;
  if (typeof raw === "string" && /^\d+$/.test(raw)) return BigInt(raw);
  return earning.amountFen;
}

function code(): string {
  return `${Date.now().toString(36).toUpperCase()}${randomBytes(4)
    .toString("hex")
    .toUpperCase()}`;
}

function bossNo(): string {
  return `B${Date.now().toString(36).toUpperCase()}${randomBytes(3)
    .toString("hex")
    .toUpperCase()}`;
}

/** v1 快照字段（fieldsJson）→ 参与维度命中的字段；选项在 v1 里是字符串数组。 */
function snapshotPricingFields(fieldsJson: unknown): PricingDimensionField[] {
  if (!Array.isArray(fieldsJson)) return [];
  const fields: PricingDimensionField[] = [];
  for (const raw of fieldsJson) {
    if (raw === null || typeof raw !== "object") continue;
    const field = raw as { fieldKey?: unknown; options?: unknown };
    if (typeof field.fieldKey !== "string") continue;
    fields.push({
      key: field.fieldKey,
      optionValues: Array.isArray(field.options)
        ? field.options.filter(
            (value): value is string => typeof value === "string",
          )
        : [],
    });
  }
  return fields;
}

/** 订单提交值：非对象一律当空（v1 的 formValuesJson 由服务端写入，结构受控）。 */
function orderFormValues(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export class GameDispatchService {
  private readonly logger = new Logger(GameDispatchService.name);
  public client: PrismaClient;

  constructor(client: PrismaClient) {
    this.client = client;
  }

  private async findDispatch(
    tenantId: string,
    orderId: string,
    tx: Tx = this.client,
  ): Promise<{
    order: {
      id: string;
      status: string;
      customerProfileId: string;
      orderNo: string;
      createdAt: Date;
    };
    gd: {
      id: string;
      orderId: string;
      gameId: string | null;
      dispatchNo: string;
      formValuesJson: unknown;
      durationMinutes: number;
      desiredStartAt: Date | null;
      snapshotId: string | null;
      modeLabel: string | null;
      targetRankLabel: string | null;
    };
  } | null> {
    const gd = await tx.gameDispatchOrder.findFirst({
      where: { tenantId, orderId },
    });
    if (!gd) return null;
    const order = await tx.order.findFirst({
      where: { tenantId, id: orderId },
    });
    if (!order) return null;
    return { gd, order };
  }

  /**
   * 本单的加价上下文（ADR-0003）：规则唯一来源是该游戏的加价规则库，
   * 命中键由订单取值算出（模板字段 stableKey=选项值）；段位只是其中一种维度。
   *
   * - 游戏归属取 `gd.gameId`（v2 模板下单会写入），v1 派单回退到模板快照的 gameId；
   * - 未归类到游戏的模板（gameId 为空）不参与加价：迁移只报告、不落地兜底规则；
   * - 规则在调用方事务内读取，与随后的落价保持同一视图。
   */
  private async pricingContext(
    tx: Tx,
    tenantId: string,
    gd: {
      gameId: string | null;
      formValuesJson: unknown;
      targetRankLabel: string | null;
    },
    snapshot: { gameId: string | null; fieldsJson: unknown } | null,
  ): Promise<{
    gameId: string | null;
    dimensionKeys: string[];
    ruleItems: PricingRuleItem[];
  }> {
    const gameId = gd.gameId ?? snapshot?.gameId ?? null;
    return {
      gameId,
      ruleItems: gameId ? await loadGameRuleItems(tx, tenantId, gameId) : [],
      dimensionKeys: pricingDimensionKeys({
        fields: snapshotPricingFields(snapshot?.fieldsJson),
        values: orderFormValues(gd.formValuesJson),
        rankLabel: gd.targetRankLabel,
      }),
    };
  }

  async createDraft(
    tenantId: string,
    actorId: string,
    input: DispatchDraftInput,
  ): Promise<{ orderId: string; dispatchOrderId: string; dispatchNo: string }> {
    const customer = await this.client.customerProfile.findFirst({
      where: { tenantId, id: input.customerProfileId },
    });
    if (!customer) throw new DispatchInputError("客户不存在");
    const template = await this.client.gameDispatchTemplate.findFirst({
      where: { tenantId, id: input.templateId, enabled: true },
    });
    if (!template) throw new DispatchInputError("模板不存在或已停用");
    const templateFields = await this.client.gameDispatchTemplateField.findMany(
      {
        where: { templateId: template.id },
        orderBy: { sortOrder: "asc" },
      },
    );
    const templatePositions = await this.client.gameDispatchPosition.findMany({
      where: { templateId: template.id, enabled: true },
      orderBy: { sortOrder: "asc" },
    });
    const templateRanks = await this.client.gameDispatchRankRule.findMany({
      where: { templateId: template.id },
      orderBy: { sortOrder: "asc" },
    });
    const templateSections =
      await this.client.gameDispatchTemplateSection.findMany({
        where: { templateId: template.id },
        orderBy: { sortOrder: "asc" },
      });
    const submittedFormValues = input.formValues ?? {};
    const effectiveTemplateFields = activeTemplateFields(
      templateSections,
      templateFields,
    );
    const formValues = activeTemplateValues(
      effectiveTemplateFields,
      submittedFormValues,
    );
    const valueError = templateFormValueError(
      effectiveTemplateFields,
      formValues,
    );
    if (valueError) throw new DispatchInputError(valueError);
    const effectiveTemplateSections = templateSections.filter(
      (section) => section.enabled,
    );
    const mode =
      typeof formValues["mode"] === "string" ? formValues["mode"] : null;
    const rankField = effectiveTemplateFields.find(
      (f) => f.fieldKey.includes("rank") || f.label.includes("段位"),
    );
    const targetRank =
      rankField && typeof formValues[rankField.fieldKey] === "string"
        ? formValues[rankField.fieldKey]
        : null;
    const description =
      Object.entries(formValues)
        .map(([key, value]) => `${key}:${value}`)
        .join("\n") || "游戏派单";
    const orderNo = `GDOR${code()}`;
    const dispatchNo = `GD${code()}`;
    const result = await this.client.$transaction(async (tx) => {
      const order = await tx.order.create({
        data: {
          tenantId,
          orderNo,
          customerProfileId: customer.id,
          status: "DRAFT",
          processType: "GAME_DISPATCH",
        },
      });
      const snapshot = await tx.gameDispatchTemplateSnapshot.create({
        data: {
          tenantId,
          orderId: order.id,
          // 规则库按游戏隔离：快照带上游戏归属，选人时据此取该游戏的加价规则。
          gameId: template.gameId,
          templateId: template.id,
          templateName: template.name,
          fieldsJson: JSON.parse(
            JSON.stringify(
              effectiveTemplateFields.map((f) => ({
                fieldKey: f.fieldKey,
                label: f.label,
                fieldType: f.fieldType,
                options: f.options ?? [],
                sectionId: f.sectionId,
                colSpan: f.colSpan,
                rowBreakBefore: f.rowBreakBefore,
              })),
            ),
          ),
          sectionsJson: JSON.parse(
            JSON.stringify(
              effectiveTemplateSections.map((s) => ({
                name: s.name,
                columns: s.columns,
                sortOrder: s.sortOrder,
              })),
            ),
          ),
          positionsJson: JSON.parse(
            JSON.stringify(
              templatePositions.map((p) => ({
                label: p.label,
                defaultCount: p.defaultCount,
              })),
            ),
          ),
          rankRulesJson: JSON.parse(
            JSON.stringify(
              templateRanks.map((r) => ({
                rankLabel: r.rankLabel,
                addPriceFen: r.addPriceFen.toString(),
              })),
            ),
          ),
          copyLinesJson: JSON.parse(JSON.stringify(template.copyLines ?? [])),
        },
      });
      const gd = await tx.gameDispatchOrder.create({
        data: {
          tenantId,
          orderId: order.id,
          // 游戏归属随模板落库（此前只写进快照）：列表按游戏过滤、加价上下文都用同一列。
          ...(template.gameId ? { gameId: template.gameId } : {}),
          snapshotId: snapshot.id,
          dispatchNo,
          formValuesJson: formValues,
          modeLabel: mode,
          ...(targetRank ? { targetRankLabel: targetRank } : {}),
          desiredStartAt: input.desiredStartAt
            ? new Date(input.desiredStartAt)
            : null,
          durationMinutes: input.durationMinutes,
        },
      });
      const merged = new Map<string, number>();
      for (const line of input.lines) {
        const count = Math.max(1, Math.min(10, line.requiredCount || 1));
        merged.set(
          line.positionLabel,
          (merged.get(line.positionLabel) ?? 0) + count,
        );
      }
      if (merged.size === 0) throw new DispatchInputError("至少需要一个位置行");
      await tx.gameDispatchLine.createMany({
        data: Array.from(merged.entries()).map(([label, count], index) => ({
          tenantId,
          dispatchOrderId: gd.id,
          orderId: order.id,
          positionLabel: label,
          requiredCount: count,
          sortOrder: index,
        })),
      });
      await tx.orderRequirement.create({
        data: {
          tenantId,
          orderId: order.id,
          description,
          desiredStartAt: input.desiredStartAt
            ? new Date(input.desiredStartAt)
            : null,
          durationSeconds: input.durationMinutes * 60,
        },
      });
      await tx.orderEvent.create({
        data: {
          tenantId,
          orderId: order.id,
          eventType: "GAME_DISPATCH_DRAFT",
          fromStatus: null,
          toStatus: "DRAFT",
          actorType: "tenant_account",
          actorId,
          payload: { dispatchNo },
        },
      });
      await tx.auditLog.create({
        data: {
          tenantId,
          actorType: "tenant_account",
          actorId,
          action: "game_dispatch.draft",
          resourceType: "order",
          resourceId: order.id,
          summary: `创建派单 ${dispatchNo}`,
        },
      });
      return { orderId: order.id, dispatchOrderId: gd.id, dispatchNo };
    });
    return result;
  }

  /**
   * 派单列表（订单中心列表 Slice 0）：
   * - 支持 `status` 过滤与 `limit`/`offset` 分页，并返回 `total`（不再用 `take: 100` 硬截断）；
   * - 订单状态用**一次**批量查询取回，去掉原先逐条 `order.findFirst` 的 N+1；
   * - `limit` 上限 100、默认 20；`offset` 默认 0（调用方给非法值时按默认处理）。
   * - 筛选维度：状态 / 创建时间范围 / 游戏 / 陪玩 / 老板 / 金额区间；`total` 与筛选同步。
   *
   * 可行下推的维度先在 SQL 侧收窄（tenant、gameId、createdAt），剩余维度（订单状态、老板、
   * 陪玩、金额区间）在映射后的行上过滤：订单状态与老板在 `Order` 表、陪玩在 `OrderSlot` 表，
   * 而金额区间依赖「单价 × 时长」派生值，三者都不在 `GameDispatchOrder` 上，所以必须本地判定后
   * 再分页，否则 `total` 会与筛选条件不一致。
   */
  async list(
    tenantId: string,
    query: {
      status?: string;
      /** 时间范围（含边界，ISO 字符串）；按派单创建时间过滤。 */
      from?: string;
      to?: string;
      sort?: string;
      /** 按游戏（`GameDispatchOrder.gameId`）过滤；v1 派单按模板快照的游戏归属兜底。 */
      gameId?: string;
      /** 按已选中陪玩（`OrderSlot.playerId`）过滤。 */
      playerId?: string;
      /** 按老板档案（`Order.customerProfileId`）过滤。 */
      customerProfileId?: string;
      /** 金额区间下界（整数分，含边界），作用于 `estimatedAmountFen`。 */
      minAmountFen?: string;
      /** 金额区间上界（整数分，含边界），作用于 `estimatedAmountFen`。 */
      maxAmountFen?: string;
      limit?: number;
      offset?: number;
    } = {},
  ): Promise<{ items: DispatchListRow[]; total: number }> {
    const limit = clampListLimit(query.limit);
    const offset = clampListOffset(query.offset);
    const sort = normalizeListSort(query.sort);
    const fromMs = query.from ? Date.parse(query.from) : Number.NaN;
    const toMs = query.to ? Date.parse(query.to) : Number.NaN;
    // 金额一律整数分；非法输入按「未提供」处理，不静默当成 0 或 NaN 参与比较。
    const minAmountFen = parseAmountFenFilter(query.minAmountFen);
    const maxAmountFen = parseAmountFenFilter(query.maxAmountFen);
    const createdAtFilter: { gte?: Date; lte?: Date } = {
      ...(Number.isNaN(fromMs) ? {} : { gte: new Date(fromMs) }),
      ...(Number.isNaN(toMs) ? {} : { lte: new Date(toMs) }),
    };
    // 游戏过滤：优先用 `gd.gameId`（v2 模板下单写入），并为历史 v1 派单按同模板快照兜底，
    // 口径与加价上下文（pricingContext）保持一致。
    let gameSnapshotIds: string[] | null = null;
    if (query.gameId) {
      const snapshots = await this.client.gameDispatchTemplateSnapshot.findMany(
        {
          where: { tenantId, gameId: query.gameId },
          select: { id: true },
        },
      );
      gameSnapshotIds = snapshots.map((snapshot) => snapshot.id);
    }
    const rows = await this.client.gameDispatchOrder.findMany({
      where: {
        tenantId,
        ...(query.gameId ? { gameId: query.gameId } : {}),
        ...(Number.isNaN(fromMs) && Number.isNaN(toMs)
          ? {}
          : { createdAt: createdAtFilter }),
      },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        orderId: true,
        dispatchNo: true,
        durationMinutes: true,
        gameId: true,
        snapshotId: true,
        tenantId: true,
        createdAt: true,
      },
    });
    // N+1 修复：订单（状态 + 老板）、档位（陪玩 + 单价）、陪玩名、老板名各查一次后本地映射。
    const orderIds = Array.from(new Set(rows.map((row) => row.orderId)));
    // 列表「游戏 / 位置」列：游戏名按 gameId 批量取回（v1 单 gameId 为空则显示 —）。
    const gameIds = Array.from(
      new Set(
        rows
          .map((row) => row.gameId)
          .filter((id): id is string => typeof id === "string"),
      ),
    );
    const orders = orderIds.length
      ? await this.client.order.findMany({
          where: { tenantId, id: { in: orderIds } },
          select: { id: true, status: true, customerProfileId: true },
        })
      : [];
    const orderById = new Map(orders.map((o) => [o.id, o]));
    const slots = orderIds.length
      ? await this.client.orderSlot.findMany({
          where: {
            tenantId,
            orderId: { in: orderIds },
            status: { not: "RELEASED" },
          },
          // id 一并取回：审核列要按档位精确映射报单队列（列表行没有它就只能给总数提示）。
          select: {
            id: true,
            orderId: true,
            playerId: true,
            unitPriceFen: true,
          },
        })
      : [];
    const slotByOrder = new Map(slots.map((slot) => [slot.orderId, slot]));
    const playerIds = Array.from(new Set(slots.map((slot) => slot.playerId)));
    const customerIds = Array.from(
      new Set(orders.map((o) => o.customerProfileId)),
    );
    const [players, customers, games, lines] = await Promise.all([
      playerIds.length
        ? this.client.playerProfile.findMany({
            where: { tenantId, id: { in: playerIds } },
            select: { id: true, name: true },
          })
        : Promise.resolve([]),
      customerIds.length
        ? this.client.customerProfile.findMany({
            where: { tenantId, id: { in: customerIds } },
            select: { id: true, name: true },
          })
        : Promise.resolve([]),
      // 列表「游戏 / 位置」列：游戏名取派单订单的 gameId，位置取该单第一个岗位行。
      gameIds.length
        ? this.client.game.findMany({
            where: { tenantId, id: { in: gameIds } },
            select: { id: true, name: true },
          })
        : Promise.resolve([]),
      orderIds.length
        ? this.client.gameDispatchLine.findMany({
            where: { tenantId, orderId: { in: orderIds } },
            orderBy: { sortOrder: "asc" },
            select: { orderId: true, positionLabel: true },
          })
        : Promise.resolve([]),
    ]);
    const playerNameById = new Map(players.map((p) => [p.id, p.name]));
    const customerNameById = new Map(customers.map((c) => [c.id, c.name]));
    const gameNameById = new Map(games.map((g) => [g.id, g.name]));
    const positionByOrder = new Map<string, string>();
    for (const line of lines) {
      // 只保留每单第一个岗位行（按 sortOrder 升序，先到先存）。
      if (!positionByOrder.has(line.orderId)) {
        positionByOrder.set(line.orderId, line.positionLabel);
      }
    }
    const mapped: DispatchListRow[] = rows.map((row) => {
      const order = orderById.get(row.orderId);
      const slot = slotByOrder.get(row.orderId);
      const unitPriceFen = slot ? slot.unitPriceFen : null;
      return {
        orderId: row.orderId,
        dispatchNo: row.dispatchNo,
        status: order?.status ?? "UNKNOWN",
        durationMinutes: row.durationMinutes,
        customerProfileId: order?.customerProfileId ?? "",
        customerName: order
          ? (customerNameById.get(order.customerProfileId) ?? "未知老板")
          : "未知老板",
        playerName: slot
          ? (playerNameById.get(slot.playerId) ?? "未知陪玩")
          : null,
        /** 游戏名（列表「游戏 / 位置」列）；未归类到游戏的派单为 null。 */
        gameName: row.gameId ? (gameNameById.get(row.gameId) ?? null) : null,
        /** 该单第一个岗位名（与游戏名同列展示）；没有岗位行为 null。 */
        positionLabel: positionByOrder.get(row.orderId) ?? null,
        /** 已选中档位 id；未选人为 null。审核列据此精确对应报单队列。 */
        slotId: slot ? slot.id : null,
        unitPriceFen: unitPriceFen === null ? null : unitPriceFen.toString(),
        estimatedAmountFen:
          unitPriceFen === null
            ? null
            : (
                (unitPriceFen * BigInt(row.durationMinutes) + 59n) /
                60n
              ).toString(),
        createdAt: row.createdAt.toISOString(),
      };
    });
    const statusIndex = new Map<string, number>(
      DISPATCH_STATUS_ORDER.map((status, index) => [status as string, index]),
    );
    const filtered = mapped
      .filter((row, index) => {
        if (!query.gameId) return true;
        const source = rows[index];
        if (source?.gameId === query.gameId) return true;
        return Boolean(
          source?.snapshotId && gameSnapshotIds?.includes(source.snapshotId),
        );
      })
      .filter((row) => {
        if (!query.playerId) return true;
        const slot = slotByOrder.get(row.orderId);
        return slot?.playerId === query.playerId;
      })
      .filter((row) => (query.status ? row.status === query.status : true))
      .filter((row) =>
        query.customerProfileId
          ? row.customerProfileId === query.customerProfileId
          : true,
      )
      .filter((row) => {
        if (minAmountFen === null && maxAmountFen === null) return true;
        if (row.estimatedAmountFen === null) return false;
        const amount = BigInt(row.estimatedAmountFen);
        if (minAmountFen !== null && amount < minAmountFen) return false;
        if (maxAmountFen !== null && amount > maxAmountFen) return false;
        return true;
      })
      .filter((row) => {
        if (Number.isNaN(fromMs) && Number.isNaN(toMs)) return true;
        const created = Date.parse(row.createdAt);
        if (Number.isNaN(created)) return false;
        if (!Number.isNaN(fromMs) && created < fromMs) return false;
        if (!Number.isNaN(toMs) && created > toMs) return false;
        return true;
      })
      .sort((a, b) => {
        if (sort === "created_asc")
          return a.createdAt.localeCompare(b.createdAt);
        if (sort === "status") {
          const ai = statusIndex.get(a.status) ?? Number.MAX_SAFE_INTEGER;
          const bi = statusIndex.get(b.status) ?? Number.MAX_SAFE_INTEGER;
          if (ai !== bi) return ai - bi;
        }
        return b.createdAt.localeCompare(a.createdAt);
      });
    return {
      items: filtered.slice(offset, offset + limit),
      total: filtered.length,
    };
  }

  async publish(
    tenantId: string,
    actorId: string,
    orderId: string,
  ): Promise<DispatchView> {
    await this.client.$transaction(async (tx) => {
      const foundLocal = await this.findDispatch(tenantId, orderId, tx);
      if (!foundLocal) throw new DispatchNotFoundError();
      if (!["DRAFT", "CONFIRMED"].includes(foundLocal.order.status)) {
        throw new DispatchStateError("仅草稿/待发布派单可发布");
      }
      const roundCount = await tx.gameDispatchRound.count({
        where: { tenantId, orderId },
      });
      const now = new Date();
      await tx.gameDispatchRound.create({
        data: {
          tenantId,
          dispatchOrderId: foundLocal.gd.id,
          orderId,
          roundNo: roundCount + 1,
          opensAt: now,
          // P3 / D4：报名窗口与关单窗口共用同一配置源（默认 10 分钟）。
          closesAt: new Date(now.getTime() + resolveRoundWindowMs()),
          status: "OPEN",
        },
      });
      assertTransition(foundLocal.order.status, "DISPATCHING", orderId);
      await tx.order.update({
        where: { id: orderId },
        data: { status: "DISPATCHING" },
      });
      await tx.orderEvent.create({
        data: {
          tenantId,
          orderId,
          eventType: "GAME_DISPATCH_PUBLISHED",
          fromStatus: foundLocal.order.status,
          toStatus: "DISPATCHING",
          actorType: "tenant_account",
          actorId,
          payload: { dispatchNo: foundLocal.gd.dispatchNo },
        },
      });
      await tx.auditLog.create({
        data: {
          tenantId,
          actorType: "tenant_account",
          actorId,
          action: "game_dispatch.publish",
          resourceType: "order",
          resourceId: orderId,
          summary: `发布派单 ${foundLocal.gd.dispatchNo}`,
        },
      });
      return foundLocal;
    });
    // 发布派单是商家端动作：回读时按 CS 端口过滤。
    return this.view(tenantId, orderId, "CS");
  }

  async applications(
    tenantId: string,
    orderId: string,
  ): Promise<DispatchView["lines"]> {
    const found = await this.findDispatch(tenantId, orderId);
    if (!found) throw new DispatchNotFoundError();
    return this.lines(tenantId, found.gd, orderId);
  }

  async playerSignup(
    tenantId: string,
    playerAccountId: string,
    orderId: string,
  ): Promise<{
    orderId: string;
    status: string;
    round: DispatchView["round"];
    lines: Array<{
      lineId: string;
      positionLabel: string;
      requiredCount: number;
      myApplicationId: string | null;
      myStatus: string | null;
    }>;
  }> {
    const player = await this.client.playerProfile.findFirst({
      where: { tenantId, tenantAccountId: playerAccountId },
    });
    if (!player) throw new DispatchNotFoundError("陪玩档案未绑定");
    const found = await this.findDispatch(tenantId, orderId);
    if (!found) throw new DispatchNotFoundError();
    const lines = await this.client.gameDispatchLine.findMany({
      where: { tenantId, dispatchOrderId: found.gd.id },
      orderBy: { sortOrder: "asc" },
    });
    const apps = await this.client.gameDispatchApplication.findMany({
      where: { tenantId, orderId, playerId: player.id },
    });
    const round = await this.client.gameDispatchRound.findFirst({
      where: { tenantId, orderId },
      orderBy: { roundNo: "desc" },
    });
    return {
      orderId,
      status: found.order.status,
      round: round
        ? {
            roundNo: round.roundNo,
            opensAt: round.opensAt.toISOString(),
            closesAt: round.closesAt.toISOString(),
            status: round.status,
          }
        : null,
      lines: lines.map((line) => {
        const mine = apps.find(
          (a) => a.lineId === line.id && a.status === "APPLIED",
        );
        return {
          lineId: line.id,
          positionLabel: line.positionLabel,
          requiredCount: line.requiredCount,
          myApplicationId: mine?.id ?? null,
          myStatus: mine?.status ?? null,
        };
      }),
    };
  }

  private async customerOf(
    tenantId: string,
    customerAccountId: string,
    orderId: string,
  ): Promise<{ customerProfileId: string }> {
    const profile = await this.client.customerProfile.findFirst({
      where: { tenantId, tenantAccountId: customerAccountId },
    });
    if (!profile) throw new DispatchNotFoundError("老板档案未绑定");
    const order = await this.client.order.findFirst({
      where: { tenantId, id: orderId },
    });
    if (!order || order.customerProfileId !== profile.id)
      throw new DispatchNotFoundError("无权操作该订单");
    return { customerProfileId: profile.id };
  }

  async customerView(
    tenantId: string,
    customerAccountId: string,
    orderId: string,
  ): Promise<DispatchView> {
    await this.customerOf(tenantId, customerAccountId, orderId);
    return this.view(tenantId, orderId, "CUSTOMER");
  }

  async customerAssign(
    tenantId: string,
    customerAccountId: string,
    orderId: string,
    applicationIds: string[],
  ): Promise<DispatchView> {
    await this.customerOf(tenantId, customerAccountId, orderId);
    return this.assign(tenantId, customerAccountId, orderId, applicationIds);
  }

  async customerCreateDraft(
    tenantId: string,
    customerAccountId: string,
    input: Omit<DispatchDraftInput, "customerProfileId">,
  ): Promise<{ orderId: string; dispatchOrderId: string; dispatchNo: string }> {
    const profile = await this.client.customerProfile.findFirst({
      where: { tenantId, tenantAccountId: customerAccountId },
    });
    if (!profile) throw new DispatchNotFoundError("老板档案未绑定");
    return this.createDraft(tenantId, customerAccountId, {
      ...input,
      customerProfileId: profile.id,
    });
  }

  async customerTemplates(
    tenantId: string,
  ): Promise<Array<{ id: string; name: string }>> {
    const rows = await this.client.gameDispatchTemplate.findMany({
      where: { tenantId, enabled: true },
      orderBy: { createdAt: "asc" },
      select: { id: true, name: true },
    });
    return rows;
  }

  async customerTemplate(
    tenantId: string,
    id: string,
  ): Promise<{
    id: string;
    name: string;
    fields: Array<{
      fieldKey: string;
      label: string;
      fieldType: string;
      required: boolean;
      options: string[];
    }>;
    positions: Array<{ id: string; label: string; defaultCount: number }>;
  }> {
    const template = await this.client.gameDispatchTemplate.findFirst({
      where: { tenantId, id, enabled: true },
    });
    if (!template) throw new DispatchNotFoundError("模板不存在或已停用");
    const [fields, positions] = await Promise.all([
      this.client.gameDispatchTemplateField.findMany({
        where: { tenantId, templateId: id, enabled: true },
        orderBy: { sortOrder: "asc" },
      }),
      this.client.gameDispatchPosition.findMany({
        where: { tenantId, templateId: id, enabled: true },
        orderBy: { sortOrder: "asc" },
      }),
    ]);
    return {
      id: template.id,
      name: template.name,
      fields: fields.map((f) => ({
        fieldKey: f.fieldKey,
        label: f.label,
        fieldType: f.fieldType,
        required: f.required,
        options: (f.options ?? []) as string[],
      })),
      positions: positions.map((p) => ({
        id: p.id,
        label: p.label,
        defaultCount: p.defaultCount,
      })),
    };
  }

  async serviceSlots(tenantId: string, accountId: string, orderId: string) {
    const player = await this.client.playerProfile.findFirst({
      where: { tenantId, tenantAccountId: accountId },
    });
    if (!player) throw new DispatchNotFoundError("陪玩档案未绑定");
    const slots = await this.client.orderSlot.findMany({
      where: { tenantId, orderId, playerId: player.id },
      orderBy: { createdAt: "asc" },
    });
    const sessions = await this.client.slotSession.findMany({
      where: { tenantId, orderId, playerId: player.id },
    });
    const earnings = await this.client.slotEarning.findMany({
      where: { tenantId, orderId, playerId: player.id },
    });
    return {
      orderId,
      playerName: player.name,
      slots: slots.map((slot) => {
        const session = sessions.find((s) => s.orderSlotId === slot.id);
        const earning = earnings.find((e) => e.orderSlotId === slot.id);
        return {
          orderSlotId: slot.id,
          positionLabel: slot.positionLabel,
          unitPriceFen: slot.unitPriceFen.toString(),
          session: session
            ? {
                id: session.id,
                status: session.status,
                startedAt: session.startedAt?.toISOString() ?? null,
                endedAt: session.endedAt?.toISOString() ?? null,
                // 证据计时长仅作对照；计费以申报（或客服修正后）的分钟数为准。
                durationSeconds: session.durationSeconds ?? null,
                declaredDurationMinutes:
                  session.declaredDurationMinutes ?? null,
                reportStatus: slotReportStatusOf(
                  session.reportSubmittedAt,
                  session.reportReviewedAt,
                  earning !== undefined,
                ),
                reportSubmittedAt:
                  session.reportSubmittedAt?.toISOString() ?? null,
                reportReviewedAt:
                  session.reportReviewedAt?.toISOString() ?? null,
                reportReviewNote: session.reportReviewNote ?? null,
                earningFen: earning ? earning.amountFen.toString() : null,
              }
            : null,
        };
      }),
    };
  }

  async startSlot(tenantId: string, actorId: string, slotId: string) {
    return this.client.$transaction(async (tx) => {
      const slot = await tx.orderSlot.findFirst({
        where: { tenantId, id: slotId },
      });
      if (!slot) throw new DispatchNotFoundError("服务档位不存在");
      const player = await tx.playerProfile.findFirst({
        where: { tenantId, tenantAccountId: actorId },
      });
      if (!player || player.id !== slot.playerId)
        throw new DispatchStateError("只能开始自己被指派的场次");
      const now = new Date();
      const session = await tx.slotSession.upsert({
        where: {
          tenantId_orderSlotId: { tenantId, orderSlotId: slot.id },
        },
        update: { status: "STARTED", startedAt: now },
        create: {
          tenantId,
          orderSlotId: slot.id,
          orderId: slot.orderId,
          playerId: slot.playerId,
          status: "STARTED",
          startedAt: now,
        },
      });
      const order = await tx.order.findFirst({
        where: { tenantId, id: slot.orderId },
      });
      if (order && order.status === "ASSIGNED") {
        assertTransition(order.status, "IN_PROGRESS", slot.orderId);
        await tx.order.update({
          where: { id: slot.orderId },
          data: { status: "IN_PROGRESS" },
        });
        // ADR-0005 切片一：状态迁移必须留事件（此前这里只改状态、不写 order_events）。
        await tx.orderEvent.create({
          data: {
            tenantId,
            orderId: slot.orderId,
            eventType: "GAME_DISPATCH_SESSION_STARTED",
            fromStatus: "ASSIGNED",
            toStatus: "IN_PROGRESS",
            actorType: "tenant_account",
            actorId,
            payload: { orderSlotId: slot.id, startedAt: now.toISOString() },
          },
        });
      }
      return session;
    });
  }

  async endSlot(tenantId: string, actorId: string, slotId: string) {
    return this.client.$transaction(async (tx) => {
      const slot = await tx.orderSlot.findFirst({
        where: { tenantId, id: slotId },
      });
      if (!slot) throw new DispatchNotFoundError("服务档位不存在");
      const player = await tx.playerProfile.findFirst({
        where: { tenantId, tenantAccountId: actorId },
      });
      if (!player || player.id !== slot.playerId)
        throw new DispatchStateError("只能结束自己被指派的场次");
      const session = await tx.slotSession.findFirst({
        where: { tenantId, orderSlotId: slot.id },
      });
      if (!session || session.status !== "STARTED")
        throw new DispatchStateError("场次尚未开始或已结束");
      const count = await tx.slotEvidence.count({
        where: { tenantId, orderSlotId: slot.id },
      });
      if (count === 0) throw new DispatchStateError("结束前需要至少一份证据");
      const now = new Date();
      const durationSeconds = Math.max(
        0,
        Math.floor(
          (now.getTime() - (session.startedAt?.getTime() ?? now.getTime())) /
            1000,
        ),
      );
      if (durationSeconds <= 0)
        throw new DispatchStateError("服务时长不足，请稍后再结束");
      const updated = await tx.slotSession.update({
        where: { id: session.id },
        data: {
          status: "ENDED",
          endedAt: now,
          durationSeconds,
        },
      });
      // 算价模型 Task 3（设计规格 §3.3 / ADR-0003）：结束只落「证据计时长」作对照，
      // 金额改由陪玩报单（申报时长）→ 客服审批后产生，见 reportSlot / reviewSlotReport。
      const totalSlots = await tx.orderSlot.count({
        // 释放过的档位不再需要服务（Task 4）：只按生效档位判断是否全部结束。
        where: { tenantId, orderId: slot.orderId, status: { not: "RELEASED" } },
      });
      const endedSessions = await tx.slotSession.count({
        where: { tenantId, orderId: slot.orderId, status: "ENDED" },
      });
      if (totalSlots > 0 && endedSessions >= totalSlots) {
        const endedOrder = await tx.order.findFirst({
          where: { tenantId, id: slot.orderId },
          select: { status: true },
        });
        if (endedOrder)
          assertTransition(
            endedOrder.status,
            "PENDING_CONFIRMATION",
            slot.orderId,
          );
        await tx.order.update({
          where: { id: slot.orderId },
          data: { status: "PENDING_CONFIRMATION" },
        });
        // ADR-0005 切片一：全部档位结束进入待核算时补写 order_events（此前只改状态）。
        await tx.orderEvent.create({
          data: {
            tenantId,
            orderId: slot.orderId,
            eventType: "GAME_DISPATCH_SESSION_ENDED",
            fromStatus: "IN_PROGRESS",
            toStatus: "PENDING_CONFIRMATION",
            actorType: "tenant_account",
            actorId,
            payload: { endedSessions, totalSlots },
          },
        });
      }
      return updated;
    });
  }

  /**
   * 陪玩报单（设计规格 §3.3）：结束服务后申报总时长，并携带报单开始/结束截图。
   * 报单本身不产生金额；金额在客服审批（reviewSlotReport）时按申报 / 修正时长落库。
   */
  async reportSlot(
    tenantId: string,
    actorId: string,
    slotId: string,
    input: { declaredDurationMinutes: number },
  ): Promise<SlotReportView> {
    const minutes = declaredMinutesOrThrow(input.declaredDurationMinutes);
    return this.client.$transaction(async (tx) => {
      const slot = await tx.orderSlot.findFirst({
        where: { tenantId, id: slotId },
      });
      if (!slot) throw new DispatchNotFoundError("服务档位不存在");
      const player = await tx.playerProfile.findFirst({
        where: { tenantId, tenantAccountId: actorId },
      });
      if (!player || player.id !== slot.playerId)
        throw new DispatchStateError("只能提交自己被指派场次的报单");
      const session = await tx.slotSession.findFirst({
        where: { tenantId, orderSlotId: slot.id },
      });
      if (!session || session.status !== "ENDED")
        throw new DispatchStateError("请先结束服务再报单");
      const isResubmit = session.reportSubmittedAt !== null;
      if (isResubmit && session.reportReviewedAt === null)
        throw new DispatchConflictError("报单已提交，等待客服审批");
      if (isResubmit) {
        // 审批通过后不可重复报单；被驳回可重新报单（驳回留痕在 audit_logs）。
        const earned = await tx.slotEarning.findFirst({
          where: { tenantId, orderSlotId: slot.id },
        });
        if (earned)
          throw new DispatchConflictError("该场次报单已审批通过，不可重复报单");
      }
      await assertReportEvidence(tx, tenantId, slot.id);
      const now = new Date();
      // 行级 CAS：并发重复提交只有一个能改写报单状态，另一个受控 409。
      const claimed = await tx.slotSession.updateMany({
        where: {
          tenantId,
          id: session.id,
          ...(isResubmit
            ? { reportReviewedAt: { not: null } }
            : { reportSubmittedAt: null }),
        },
        data: {
          declaredDurationMinutes: minutes,
          reportSubmittedAt: now,
          reportReviewedAt: null,
          reportReviewedBy: null,
          reportReviewNote: null,
        },
      });
      if (claimed.count === 0)
        throw new DispatchConflictError("报单状态已变化，请刷新后重试");
      await tx.auditLog.create({
        data: {
          tenantId,
          actorType: "tenant_account",
          actorId,
          action: "game_dispatch.slot_report.submitted",
          resourceType: "slot",
          resourceId: slot.id,
          summary: `报单申报时长 ${minutes} 分钟（证据计时 ${
            session.durationSeconds ?? "无"
          } 秒，仅作对照）`,
        },
      });
      return slotReportViewOf(
        slot,
        {
          id: session.id,
          declaredDurationMinutes: minutes,
          durationSeconds: session.durationSeconds ?? null,
          reportSubmittedAt: now,
          reportReviewedAt: null,
          reportReviewedBy: null,
          reportReviewNote: null,
        },
        null,
      );
    });
  }

  /**
   * 客服审批报单（设计规格 §3.3）：对照开始/结束截图人工核查，可修正时长；
   * 通过时按核定分钟数落 SlotEarning，修正前后的时长都写进 audit_logs 留痕。
   */
  async reviewSlotReport(
    tenantId: string,
    actorId: string,
    slotId: string,
    input: {
      approve: boolean;
      declaredDurationMinutes?: number;
      reason?: string;
    },
  ): Promise<SlotReportView> {
    return this.client.$transaction(async (tx) => {
      const slot = await tx.orderSlot.findFirst({
        where: { tenantId, id: slotId },
      });
      if (!slot) throw new DispatchNotFoundError("服务档位不存在");
      const session = await tx.slotSession.findFirst({
        where: { tenantId, orderSlotId: slot.id },
      });
      if (!session) throw new DispatchNotFoundError("服务场次不存在");
      if (
        session.reportSubmittedAt === null ||
        session.declaredDurationMinutes === null
      )
        throw new DispatchConflictError("该场次尚未报单");
      if (session.reportReviewedAt !== null)
        throw new DispatchConflictError("该报单已审批");
      const declared = session.declaredDurationMinutes;
      const effective = input.approve
        ? declaredMinutesOrThrow(input.declaredDurationMinutes ?? declared)
        : declared;
      const note = input.reason ?? null;
      const now = new Date();
      // 行级 CAS：并发审批只有一个能把「已审批」写进去，另一个受控 409（不产生双份金额）。
      const claimed = await tx.slotSession.updateMany({
        where: {
          tenantId,
          id: session.id,
          reportSubmittedAt: { not: null },
          reportReviewedAt: null,
        },
        data: {
          ...(input.approve ? { declaredDurationMinutes: effective } : {}),
          reportReviewedAt: now,
          reportReviewedBy: actorId,
          reportReviewNote: note,
        },
      });
      if (claimed.count === 0) throw new DispatchConflictError("该报单已审批");
      const reviewed = {
        id: session.id,
        declaredDurationMinutes: effective,
        durationSeconds: session.durationSeconds ?? null,
        reportSubmittedAt: session.reportSubmittedAt,
        reportReviewedAt: now,
        reportReviewedBy: actorId,
        reportReviewNote: note,
      };
      if (!input.approve) {
        await tx.auditLog.create({
          data: {
            tenantId,
            actorType: "tenant_account",
            actorId,
            action: "game_dispatch.slot_report.rejected",
            resourceType: "slot",
            resourceId: slot.id,
            summary: `驳回报单：申报 ${declared} 分钟${
              note === null ? "" : `（理由：${note}）`
            }`,
          },
        });
        return slotReportViewOf(slot, reviewed, null);
      }
      // ADR-0004：审批通过即按费率分账——金额按整额算，落库的 amountFen 是**陪玩实收**，
      // 整额/平台费/门店抽成写进 detailJson（老板支出仍按整额 = grossFen 扣钱包）。
      const grossFen = slotEarningFen(slot.unitPriceFen, effective);
      const rates = await this.settlementRates(tx, tenantId);
      const split =
        grossFen > 0n
          ? splitSettlement(grossFen, rates)
          : { platformFeeFen: 0n, storeCutFen: 0n, playerShareFen: 0n };
      const amountFen = split.playerShareFen;
      const detailJson = {
        unitPriceFen: slot.unitPriceFen.toString(),
        declaredDurationMinutes: declared,
        reviewedDurationMinutes: effective,
        durationSeconds: session.durationSeconds ?? null,
        grossFen: grossFen.toString(),
        platformFeeFen: split.platformFeeFen.toString(),
        storeCutFen: split.storeCutFen.toString(),
      };
      await tx.slotEarning.upsert({
        where: { tenantId_orderSlotId: { tenantId, orderSlotId: slot.id } },
        update: {
          amountFen,
          status: "PENDING",
          detailJson,
        },
        create: {
          tenantId,
          orderSlotId: slot.id,
          orderId: slot.orderId,
          playerId: slot.playerId,
          amountFen,
          status: "PENDING",
          detailJson,
        },
      });
      await tx.auditLog.create({
        data: {
          tenantId,
          actorType: "tenant_account",
          actorId,
          action: "game_dispatch.slot_report.reviewed",
          resourceType: "slot",
          resourceId: slot.id,
          summary: `报单审批通过：申报 ${declared} 分钟 → 核定 ${effective} 分钟，金额 ${amountFen.toString()} 分（单价 ${slot.unitPriceFen.toString()} 分/小时，证据计时 ${
            session.durationSeconds ?? "无"
          } 秒仅作对照；整额 ${grossFen.toString()} 分 = 陪玩实收 ${amountFen.toString()} 分 + 平台费 ${split.platformFeeFen.toString()} 分 + 门店抽成 ${split.storeCutFen.toString()} 分）`,
        },
      });
      // Task 5a：全部生效档位都拿到已审批报单 → 通知门店「可结算」（老板按订单同样可见），
      // 避免订单停在待核算却没人知道该点「确认结算」。
      const activeSlots = await tx.orderSlot.findMany({
        where: { tenantId, orderId: slot.orderId, status: { not: "RELEASED" } },
        select: { id: true },
      });
      const approvedEarnings = await tx.slotEarning.count({
        where: {
          tenantId,
          orderId: slot.orderId,
          orderSlotId: { in: activeSlots.map((s) => s.id) },
        },
      });
      if (activeSlots.length > 0 && approvedEarnings === activeSlots.length) {
        const settledOrder = await tx.order.findFirst({
          where: { tenantId, id: slot.orderId },
          select: { orderNo: true },
        });
        await tx.outboxEvent.create({
          data: {
            tenantId,
            aggregateType: "order",
            aggregateId: slot.orderId,
            eventType: "order.ready_to_settle",
            payload: {
              orderId: slot.orderId,
              orderNo: settledOrder?.orderNo ?? "",
            },
          },
        });
      }
      return slotReportViewOf(slot, reviewed, amountFen);
    });
  }

  async confirmSettlement(tenantId: string, actorId: string, orderId: string) {
    return this.client.$transaction(async (tx) => {
      const order = await tx.order.findFirst({
        where: { tenantId, id: orderId },
      });
      if (!order) throw new DispatchNotFoundError("订单不存在");
      if (order.status !== "PENDING_CONFIRMATION")
        throw new DispatchStateError("订单不在待确认结算状态");
      const earnings = await tx.slotEarning.findMany({
        where: { tenantId, orderId, status: "PENDING" },
      });
      const slots = await tx.orderSlot.findMany({
        // 释放过的档位不再计入结算所需人数（Task 4）。
        where: { tenantId, orderId, status: { not: "RELEASED" } },
      });
      // 走查修复 F4：档位全部被释放时不能按 0 元把订单结算掉（否则老板支出=0、订单直接完成）。
      if (slots.length === 0)
        throw new DispatchStateError(
          "没有生效档位，无法结算：请先重新选人或取消订单",
        );
      if (earnings.length !== slots.length)
        // 结束只留证据计时长；金额在报单审批后才落库（设计规格 §3.3）。
        throw new DispatchStateError("仍有档位未完成报单审批");
      // ADR-0004：老板支出按整额（grossFen）扣钱包；amountFen 已是陪玩实收。
      const total = earnings.reduce((acc, e) => acc + grossFenOf(e), 0n);
      const playerShare = earnings.reduce((acc, e) => acc + e.amountFen, 0n);
      const wallet = await tx.bossWallet.findFirst({
        where: { tenantId, customerProfileId: order.customerProfileId },
      });
      if (!wallet) throw new DispatchStateError("老板钱包不存在");
      const locks = await tx.$queryRaw<Array<{ balance_fen: bigint }>>`
        SELECT balance_fen FROM boss_wallets
        WHERE id = ${wallet.id}::uuid AND tenant_id = ${tenantId}::uuid
        FOR UPDATE`;
      const balance = locks[0]?.balance_fen ?? 0n;
      if (balance < total)
        throw new DispatchStateError("老板余额不足，无法完成结算");
      const after = balance - total;
      await tx.bossWallet.update({
        where: { id: wallet.id },
        data: { balanceFen: after },
      });
      await tx.walletEntry.create({
        data: {
          tenantId,
          customerProfileId: order.customerProfileId,
          walletId: wallet.id,
          txNo: `SET${Date.now().toString(36).toUpperCase()}${actorId
            .slice(0, 6)
            .toUpperCase()}`,
          type: "DEDUCT",
          amountFen: total,
          balanceAfterFen: after,
          referenceType: "order",
          referenceId: orderId,
          reason: "订单结算扣费",
        },
      });
      await tx.slotEarning.updateMany({
        where: { tenantId, orderId, status: "PENDING" },
        data: { status: "SETTLED" },
      });
      assertTransition(order.status, "COMPLETED", orderId);
      await tx.order.update({
        where: { id: orderId },
        data: { status: "COMPLETED" },
      });
      await tx.auditLog.create({
        data: {
          tenantId,
          actorType: "tenant_account",
          actorId,
          action: "game_dispatch.settlement",
          resourceType: "order",
          resourceId: orderId,
          summary:
            playerShare === total
              ? `结算扣费 ${total.toString()} 分`
              : `结算扣费 ${total.toString()} 分（陪玩实收 ${playerShare.toString()} 分，门店抽成/平台费 ${(total - playerShare).toString()} 分）`,
        },
      });
      return { totalFen: total.toString(), balanceAfterFen: after.toString() };
    });
  }

  async addSlotEvidence(
    tenantId: string,
    actorId: string,
    slotId: string,
    meta: {
      objectKey: string;
      originalName: string;
      mimeType: string;
      sizeBytes: number;
      sha256: string;
      evidenceType: string;
    },
  ) {
    const player = await this.client.playerProfile.findFirst({
      where: { tenantId, tenantAccountId: actorId },
    });
    const slot = await this.client.orderSlot.findFirst({
      where: { tenantId, id: slotId },
    });
    if (!slot || !player || player.id !== slot.playerId)
      throw new DispatchStateError("无权上传该档位证据");
    const session = await this.client.slotSession.findFirst({
      where: { tenantId, orderSlotId: slot.id },
    });
    if (!session) throw new DispatchStateError("请先开始场次再上传证据");
    return this.client.slotEvidence.create({
      data: {
        tenantId,
        sessionId: session.id,
        orderSlotId: slot.id,
        ...meta,
        uploadedBy: actorId,
      },
    });
  }

  async apply(
    tenantId: string,
    playerAccountId: string,
    orderId: string,
    lineId: string,
  ): Promise<DispatchApplicationView> {
    return this.client.$transaction(async (tx) => {
      const player = await tx.playerProfile.findFirst({
        where: { tenantId, tenantAccountId: playerAccountId },
      });
      if (!player) throw new DispatchInputError("陪玩档案未绑定");
      const found = await this.findDispatch(tenantId, orderId, tx);
      if (!found) throw new DispatchNotFoundError();
      // 行锁：与「无人报名自动关单」（worker）串行化，避免关单与报名同时成功。
      // 加锁后重新读取状态，保证锁内看到的是最新状态。
      await lockOrderRow(tx, tenantId, orderId);
      const lockedOrder = await tx.order.findFirst({
        where: { tenantId, id: orderId },
        select: { status: true },
      });
      if (!lockedOrder) throw new DispatchNotFoundError();
      if (lockedOrder.status !== "DISPATCHING")
        throw new DispatchStateError("订单不在报名阶段");
      const round = await tx.gameDispatchRound.findFirst({
        where: {
          tenantId,
          orderId,
          status: "OPEN",
          closesAt: { gt: new Date() },
        },
        orderBy: { roundNo: "desc" },
      });
      if (!round) throw new DispatchStateError("当前报名通道已关闭");
      const line = await tx.gameDispatchLine.findFirst({
        where: { tenantId, orderId, id: lineId },
      });
      if (!line) throw new DispatchInputError("报名位置不存在");
      const existing = await tx.gameDispatchApplication.findFirst({
        where: {
          tenantId,
          roundId: round.id,
          lineId,
          playerId: player.id,
        },
      });
      if (existing && existing.status === "APPLIED")
        throw new DispatchConflictError("已报名该位置");
      const row = existing
        ? await tx.gameDispatchApplication.update({
            where: { id: existing.id },
            data: { status: "APPLIED", playerNote: null },
          })
        : await tx.gameDispatchApplication.create({
            data: {
              tenantId,
              roundId: round.id,
              lineId,
              orderId,
              playerId: player.id,
              positionLabel: line.positionLabel,
              status: "APPLIED",
            },
          });
      await tx.auditLog.create({
        data: {
          tenantId,
          actorType: "tenant_account",
          actorId: playerAccountId,
          action: "game_dispatch.apply",
          resourceType: "application",
          resourceId: row.id,
          summary: "陪玩报名",
        },
      });
      const priceByPlayer = await this.unitPriceByPlayer(
        tenantId,
        found.gd,
        [player.id],
        tx,
      );
      return {
        id: row.id,
        playerId: player.id,
        playerName: player.name,
        positionLabel: line.positionLabel,
        status: row.status,
        createdAt: row.createdAt.toISOString(),
        // 刚报名（或重新报名）时还没有档位；选中后由选人流程写入。
        slotId: null,
        unitPriceFen: priceByPlayer.get(player.id) ?? null,
      };
    });
  }

  async withdraw(
    tenantId: string,
    playerAccountId: string,
    applicationId: string,
  ): Promise<void> {
    const player = await this.client.playerProfile.findFirst({
      where: { tenantId, tenantAccountId: playerAccountId },
    });
    if (!player) throw new DispatchInputError("陪玩档案未绑定");
    const application = await this.client.gameDispatchApplication.findFirst({
      where: { tenantId, id: applicationId, playerId: player.id },
    });
    if (!application) throw new DispatchConflictError("仅可取消本人报名");
    if (application.status === "SELECTED") {
      // 设计规格 §3.5 / §6：选中（老板锁定）后不可自助取消，只能由商家释放名额。
      throw new DispatchConflictError(
        "APPLICATION_LOCKED：已被选中锁定，需商家释放名额后才能取消",
      );
    }
    const res = await this.client.gameDispatchApplication.updateMany({
      where: {
        tenantId,
        id: applicationId,
        playerId: player.id,
        status: "APPLIED",
      },
      data: { status: "WITHDRAWN" },
    });
    if (res.count === 0)
      throw new DispatchConflictError("仅可取消 APPLIED 状态的本人报名");
  }

  /**
   * 陪玩端报名大厅（Task 4 / 设计规格 §3.5）：只列仍在报名阶段、且报名通道未关闭的派单，
   * 每个位置行带上需要人数、已报名人数与「我的报名」，供陪玩端渲染报名入口。
   */
  async playerHall(
    tenantId: string,
    accountId: string,
  ): Promise<PlayerHallOrderView[]> {
    const player = await this.client.playerProfile.findFirst({
      where: { tenantId, tenantAccountId: accountId },
    });
    if (!player) throw new DispatchNotFoundError("陪玩档案未绑定");
    const orders = await this.client.order.findMany({
      where: { tenantId, status: "DISPATCHING" },
      orderBy: { createdAt: "desc" },
      take: 50,
      select: { id: true, orderNo: true },
    });
    const out: PlayerHallOrderView[] = [];
    for (const order of orders) {
      const gd = await this.client.gameDispatchOrder.findFirst({
        where: { tenantId, orderId: order.id },
      });
      if (!gd) continue;
      const round = await this.client.gameDispatchRound.findFirst({
        where: {
          tenantId,
          orderId: order.id,
          status: "OPEN",
          closesAt: { gt: new Date() },
        },
        orderBy: { roundNo: "desc" },
      });
      if (!round) continue;
      const lines = await this.client.gameDispatchLine.findMany({
        where: { tenantId, orderId: order.id },
        orderBy: { sortOrder: "asc" },
      });
      const applications = await this.client.gameDispatchApplication.findMany({
        where: { tenantId, roundId: round.id },
        select: { id: true, lineId: true, playerId: true, status: true },
      });
      const myPrice = await this.unitPriceByPlayer(tenantId, gd, [player.id]);
      out.push({
        orderId: order.id,
        dispatchNo: gd.dispatchNo,
        orderNo: order.orderNo,
        durationMinutes: gd.durationMinutes,
        desiredStartAt: gd.desiredStartAt?.toISOString() ?? null,
        roundClosesAt: round.closesAt.toISOString(),
        // 设计规格 §3.4：报名界面显示单价（不乘时长），未设置底价时为 null。
        unitPriceFen: myPrice.get(player.id) ?? null,
        lines: lines.map((line) => {
          const lineApps = applications.filter((a) => a.lineId === line.id);
          const mine = lineApps.find((a) => a.playerId === player.id);
          return {
            lineId: line.id,
            positionLabel: line.positionLabel,
            requiredCount: line.requiredCount,
            appliedCount: lineApps.filter((a) => a.status === "APPLIED").length,
            myApplicationId: mine?.id ?? null,
            myApplicationStatus: mine?.status ?? null,
          };
        }),
      });
    }
    return out;
  }

  /**
   * 陪玩端「我的接单」（Task 4）：报名状态、是否可自助取消，以及选中后落下的档位 id
   * （档位是开始/结束服务与报单的入口）。释放过的档位不再返回，玩家可重新报名。
   */
  async playerApplications(
    tenantId: string,
    accountId: string,
  ): Promise<PlayerApplicationView[]> {
    const player = await this.client.playerProfile.findFirst({
      where: { tenantId, tenantAccountId: accountId },
    });
    if (!player) throw new DispatchNotFoundError("陪玩档案未绑定");
    const applications = await this.client.gameDispatchApplication.findMany({
      where: { tenantId, playerId: player.id },
      orderBy: { createdAt: "desc" },
      take: 100,
    });
    const out: PlayerApplicationView[] = [];
    for (const application of applications) {
      const order = await this.client.order.findFirst({
        where: { tenantId, id: application.orderId },
        select: { orderNo: true, status: true },
      });
      const gd = await this.client.gameDispatchOrder.findFirst({
        where: { tenantId, orderId: application.orderId },
        select: { dispatchNo: true },
      });
      const slot = await this.client.orderSlot.findFirst({
        where: {
          tenantId,
          applicationId: application.id,
          status: { not: "RELEASED" },
        },
        select: { id: true, unitPriceFen: true },
      });
      const gdRow = await this.client.gameDispatchOrder.findFirst({
        where: { tenantId, orderId: application.orderId },
      });
      const priceByPlayer = gdRow
        ? await this.unitPriceByPlayer(tenantId, gdRow, [player.id])
        : new Map<string, string | null>();
      out.push({
        applicationId: application.id,
        orderId: application.orderId,
        dispatchNo: gd?.dispatchNo ?? "",
        orderNo: order?.orderNo ?? "",
        orderStatus: order?.status ?? "UNKNOWN",
        lineId: application.lineId,
        positionLabel: application.positionLabel,
        status: application.status,
        createdAt: application.createdAt.toISOString(),
        slotId: slot?.id ?? null,
        canWithdraw: application.status === "APPLIED" && slot === null,
        // 选中后取档位快照价（锁定值）；未选中按当前规则库实时计算。
        unitPriceFen:
          slot?.unitPriceFen !== undefined
            ? slot.unitPriceFen.toString()
            : (priceByPlayer.get(player.id) ?? null),
      });
    }
    return out;
  }

  /**
   * 商家释放名额（Task 4 / 设计规格 §3.5）：档位标记 RELEASED（保留单价快照与审计），
   * 报名置 RELEASED，订单回到报名阶段并重开一轮报名，让老板可以重新选人。
   */
  async releaseSlot(
    tenantId: string,
    actorId: string,
    slotId: string,
    input: { reason?: string } = {},
  ): Promise<SlotReleaseView> {
    return this.client.$transaction(async (tx) => {
      const slot = await tx.orderSlot.findFirst({
        where: { tenantId, id: slotId },
      });
      if (!slot) throw new DispatchNotFoundError("服务档位不存在");
      if (slot.status === "RELEASED")
        throw new DispatchConflictError("该名额已释放");
      const session = await tx.slotSession.findFirst({
        where: { tenantId, orderSlotId: slot.id },
        select: { id: true },
      });
      if (session)
        throw new DispatchStateError("该档位已开始服务，不能释放名额");
      const earning = await tx.slotEarning.findFirst({
        where: { tenantId, orderSlotId: slot.id },
        select: { id: true },
      });
      if (earning)
        throw new DispatchStateError("该档位已产生金额，不能释放名额");
      const gd = await tx.gameDispatchOrder.findFirst({
        where: { tenantId, orderId: slot.orderId },
      });
      if (!gd) throw new DispatchNotFoundError();
      // 订单行锁：与报名/关单串行化，保证「回到报名阶段 + 重开一轮」的原子性。
      await lockOrderRow(tx, tenantId, slot.orderId);
      const order = await tx.order.findFirst({
        where: { tenantId, id: slot.orderId },
      });
      if (!order) throw new DispatchNotFoundError();
      if (!["DISPATCHING", "ASSIGNED"].includes(order.status))
        throw new DispatchStateError("订单不在可释放名额的阶段");
      const now = new Date();
      await tx.orderSlot.update({
        where: { id: slot.id },
        data: { status: "RELEASED" },
      });
      const application = await tx.gameDispatchApplication.findFirst({
        where: { tenantId, id: slot.applicationId },
      });
      if (application && application.status === "SELECTED") {
        await tx.gameDispatchApplication.update({
          where: { id: application.id },
          data: { status: "RELEASED" },
        });
      }
      const roundCount = await tx.gameDispatchRound.count({
        where: { tenantId, orderId: slot.orderId },
      });
      await tx.gameDispatchRound.updateMany({
        where: { tenantId, orderId: slot.orderId, status: "OPEN" },
        data: { status: "CLOSED" },
      });
      // 与 publish 同一配置源（P3 / D4：默认 10 分钟，可配置），重新开放报名。
      const round = await tx.gameDispatchRound.create({
        data: {
          tenantId,
          dispatchOrderId: gd.id,
          orderId: slot.orderId,
          roundNo: roundCount + 1,
          opensAt: now,
          closesAt: new Date(now.getTime() + resolveRoundWindowMs()),
          status: "OPEN",
        },
      });
      const fromStatus = order.status;
      if (fromStatus !== "DISPATCHING") {
        assertTransition(fromStatus, "DISPATCHING", order.id);
        await tx.order.update({
          where: { id: order.id },
          data: { status: "DISPATCHING" },
        });
      }
      await tx.orderEvent.create({
        data: {
          tenantId,
          orderId: order.id,
          eventType: "GAME_DISPATCH_SLOT_RELEASED",
          fromStatus,
          toStatus: "DISPATCHING",
          actorType: "tenant_account",
          actorId,
          payload: {
            slotId: slot.id,
            playerId: slot.playerId,
            reason: input.reason ?? null,
          },
        },
      });
      await tx.auditLog.create({
        data: {
          tenantId,
          actorType: "tenant_account",
          actorId,
          action: "game_dispatch.slot_release",
          resourceType: "slot",
          resourceId: slot.id,
          summary: `释放名额（订单 ${order.orderNo}，陪玩 ${slot.playerId}）${
            input.reason ? `：${input.reason}` : ""
          }`,
        },
      });
      return {
        slotId: slot.id,
        orderId: order.id,
        playerId: slot.playerId,
        orderStatus: "DISPATCHING",
        roundNo: round.roundNo,
        releasedAt: now.toISOString(),
      };
    });
  }

  async staffRemove(
    tenantId: string,
    actorId: string,
    applicationId: string,
  ): Promise<void> {
    const res = await this.client.gameDispatchApplication.updateMany({
      where: { tenantId, id: applicationId, status: "APPLIED" },
      data: { status: "REJECTED" },
    });
    if (res.count === 0) throw new DispatchConflictError("仅可移除有效报名");
    await this.client.auditLog.create({
      data: {
        tenantId,
        actorType: "tenant_account",
        actorId,
        action: "game_dispatch.staff_remove",
        resourceType: "application",
        resourceId: applicationId,
      },
    });
  }

  async assign(
    tenantId: string,
    actorId: string,
    orderId: string,
    applicationIds: string[],
    /** P3 / D1：可选的「本单固定价」（分/小时），按报名 id 指定；覆盖算法单价。 */
    fixedPrices: Array<{ applicationId: string; unitPriceFen: string }> = [],
  ): Promise<DispatchView> {
    if (applicationIds.length === 0)
      throw new DispatchInputError("至少选择一个报名");
    // 入参已在 API 校验层过滤（整数分 1..1000000）；这里再收敛成 bigint 并校验归属。
    const fixedByApplication = new Map<string, bigint>();
    for (const item of fixedPrices) {
      if (!applicationIds.includes(item.applicationId)) {
        throw new DispatchInputError("固定价只能用于本次选中的报名");
      }
      const amount = BigInt(item.unitPriceFen);
      if (amount < 1n || amount > 1_000_000n) {
        throw new DispatchInputError("固定价需在 1–1000000 分/小时之间");
      }
      fixedByApplication.set(item.applicationId, amount);
    }
    await this.client.$transaction(async (tx) => {
      const found = await this.findDispatch(tenantId, orderId, tx);
      if (!found) throw new DispatchNotFoundError();
      const apps = await tx.gameDispatchApplication.findMany({
        where: { tenantId, orderId, id: { in: applicationIds } },
      });
      if (apps.length !== applicationIds.length)
        throw new DispatchInputError("部分报名不存在");
      for (const app of apps) {
        if (app.status !== "APPLIED")
          throw new DispatchConflictError("仅可选中有效报名");
      }
      const order = await tx.order.findFirst({
        where: { tenantId, id: orderId },
      });
      if (!order) throw new DispatchNotFoundError();
      const wallet = await tx.bossWallet.findFirst({
        where: { tenantId, customerProfileId: order.customerProfileId },
      });
      const walletRow =
        wallet ??
        (await tx.bossWallet.create({
          data: {
            tenantId,
            customerProfileId: order.customerProfileId,
            bossNo: bossNo(),
            balanceFen: 0n,
          },
        }));
      const locks = await tx.$queryRaw<Array<{ balance_fen: bigint }>>`
        SELECT balance_fen FROM boss_wallets
        WHERE id = ${walletRow.id}::uuid AND tenant_id = ${tenantId}::uuid
        FOR UPDATE`;
      const balance = locks[0]?.balance_fen ?? 0n;
      const slotRows = await tx.orderSlot.findMany({
        // 释放过的档位不再占用名额、也不参与余额估算（Task 4）。
        where: { tenantId, orderId, status: { not: "RELEASED" } },
      });
      const lines = await tx.gameDispatchLine.findMany({
        where: { tenantId, orderId },
      });
      const snapshot = found.gd.snapshotId
        ? await tx.gameDispatchTemplateSnapshot.findFirst({
            where: { tenantId, id: found.gd.snapshotId },
          })
        : null;
      const pricing = await this.pricingContext(
        tx,
        tenantId,
        found.gd,
        snapshot,
      );
      const gameBases = pricing.gameId
        ? await loadPlayerGameBases(
            tx,
            tenantId,
            pricing.gameId,
            apps.map((app) => app.playerId),
          )
        : new Map<string, MoneyFen>();
      /** 单价先算后落：既无陪玩×游戏底价也无陪玩级兜底时拒绝选人，不静默按 0 计（规格 §6）。 */
      const unitPriceOf = async (
        playerId: string,
        options: { allowMissing?: boolean } = {},
      ): Promise<bigint | null> => {
        const player = await tx.playerProfile.findFirst({
          where: { tenantId, id: playerId },
        });
        if (!player) throw new DispatchInputError("陪玩不存在");
        const unitPrice = resolveUnitPriceFen({
          gameBaseFen: gameBases.get(playerId) ?? null,
          // PlayerProfile.basePricePerHourFen 默认 0：0 视为「没有兜底价」，
          // 否则未定价的陪玩会被静默按 0 计价。
          fallbackBaseFen:
            player.basePricePerHourFen > 0n
              ? player.basePricePerHourFen.toString()
              : null,
          dimensionKeys: pricing.dimensionKeys,
          ruleItems: pricing.ruleItems,
        });
        if (unitPrice === null) {
          // P3 / D1：填了固定价时允许没有算法价（客服直接议价）；此时审计里 from 记 null。
          if (options.allowMissing) return null;
          throw new DispatchStateError(
            `陪玩「${player.name}」在该游戏没有底价，无法确认：请先维护算价模型底价`,
          );
        }
        return BigInt(unitPrice);
      };
      const unitPrices = new Map<string, bigint>();
      /** P3 / D1：需要写审计的固定价（算法价 from → 固定价 to）。 */
      const fixedPriceAudits: Array<{
        applicationId: string;
        from: bigint | null;
        to: bigint;
      }> = [];
      const slotPrices = slotRows.map((s) => s.unitPriceFen);
      for (const app of apps) {
        const line = lines.find((l) => l.id === app.lineId);
        if (!line) continue;
        const fixed = fixedByApplication.get(app.id);
        const algorithmic = await unitPriceOf(app.playerId, {
          allowMissing: fixed !== undefined,
        });
        const effective = fixed ?? algorithmic;
        if (effective === null) {
          // 无固定价且无算法价：保持原有受控失败（unitPriceOf 已抛错，这里兜底）。
          throw new DispatchStateError(
            "该陪玩在该游戏没有底价，无法确认：请先维护算价模型底价",
          );
        }
        unitPrices.set(app.id, effective);
        slotPrices.push(effective);
        if (fixed !== undefined) {
          fixedPriceAudits.push({
            applicationId: app.id,
            from: algorithmic,
            to: fixed,
          });
        }
      }
      const expectedFen = slotPrices.reduce(
        (acc, price) =>
          acc + (price * BigInt(found.gd.durationMinutes) + 59n) / 60n,
        0n,
      );
      if (balance < expectedFen)
        throw new DispatchStateError("老板余额不足，无法确认陪玩，请先充值");
      const slotsByLine = new Map<string, number>();
      for (const app of apps) {
        const line = lines.find((l) => l.id === app.lineId);
        if (!line) throw new DispatchInputError("位置行不存在");
        const used = slotsByLine.get(line.id) ?? 0;
        if (used + 1 > line.requiredCount)
          throw new DispatchConflictError(
            `位置 ${line.positionLabel} 已超过需要人数`,
          );
        slotsByLine.set(line.id, used + 1);
      }
      for (const app of apps) {
        const line = lines.find((l) => l.id === app.lineId);
        if (!line) throw new DispatchInputError("位置行不存在");
        const unitPriceFen = unitPrices.get(app.id);
        if (unitPriceFen === undefined) {
          throw new DispatchInputError("位置行不存在");
        }
        // order_slots 的唯一键是 (tenant_id, order_id, player_id)：同一陪玩在本单只有一行档位。
        // 「释放名额」后该行保留（status=RELEASED）作为留痕，重新选中同一陪玩时复用这一行
        // 而不是新插一行（否则会撞唯一键），并刷新为本次选中的报名与单价快照。
        const existingSlot = await tx.orderSlot.findFirst({
          where: { tenantId, orderId, playerId: app.playerId },
          select: { id: true },
        });
        const slotData = {
          lineId: app.lineId,
          applicationId: app.id,
          positionLabel: app.positionLabel,
          unitPriceFen,
          status: "SELECTED",
        };
        const savedSlot = await (existingSlot
          ? tx.orderSlot.update({
              where: { id: existingSlot.id },
              data: { ...slotData, createdBy: actorId },
            })
          : tx.orderSlot.create({
              data: {
                tenantId,
                orderId,
                dispatchOrderId: found.gd.id,
                playerId: app.playerId,
                createdBy: actorId,
                ...slotData,
              },
            }));
        // P3 / D1：固定价必须留痕（算法价 → 固定价 + 操作人），低于底价时审计是唯一凭据。
        const fixedAudit = fixedPriceAudits.find(
          (item) => item.applicationId === app.id,
        );
        if (fixedAudit) {
          await tx.auditLog.create({
            data: {
              tenantId,
              actorType: "tenant_account",
              actorId,
              action: "game_dispatch.slot_fixed_price",
              resourceType: "slot",
              resourceId: savedSlot.id,
              summary: `固定价（订单 ${orderId}，陪玩 ${app.playerId}）：${
                fixedAudit.from === null
                  ? "无算法价"
                  : `${fixedAudit.from.toString()} 分/小时`
              } → ${fixedAudit.to.toString()} 分/小时`,
            },
          });
        }
        await tx.gameDispatchApplication.update({
          where: { id: app.id },
          data: { status: "SELECTED" },
        });
      }
      const selected = await tx.orderSlot.count({
        where: { tenantId, orderId, status: { not: "RELEASED" } },
      });
      const totalRequired = lines.reduce((acc, l) => acc + l.requiredCount, 0);
      if (selected >= totalRequired) {
        assertTransition(order.status, "ASSIGNED", orderId);
        await tx.order.update({
          where: { id: orderId },
          data: { status: "ASSIGNED" },
        });
        // ADR-0005 切片一：状态迁移必须留事件（此前这里只写了 auditLog）。
        await tx.orderEvent.create({
          data: {
            tenantId,
            orderId,
            eventType: "GAME_DISPATCH_ASSIGNED",
            fromStatus: "DISPATCHING",
            toStatus: "ASSIGNED",
            actorType: "tenant_account",
            actorId,
            payload: { selected, totalRequired },
          },
        });
      }
      await tx.auditLog.create({
        data: {
          tenantId,
          actorType: "tenant_account",
          actorId,
          action: "game_dispatch.assign",
          resourceType: "order",
          resourceId: orderId,
          summary: `选定 ${applicationIds.length} 名陪玩`,
        },
      });
    });
    // 选定陪玩由客服执行：回读时按 CS 端口过滤。
    return this.view(tenantId, orderId, "CS");
  }

  /**
   * 订单视图。`audience` 决定这个端口能看到的字段与值（V-5 / V-6）：
   * 商家端传 "CS"，客户自查传 "CUSTOMER"，两边看到的字段集可能不同。
   */
  async view(
    tenantId: string,
    orderId: string,
    audience: TemplateAudienceV2,
  ): Promise<DispatchView> {
    const found = await this.findDispatch(tenantId, orderId);
    if (!found) throw new DispatchNotFoundError();
    return this.viewWith(tenantId, orderId, found, audience);
  }

  async copy(tenantId: string, orderId: string): Promise<DispatchCopyResult> {
    const found = await this.findDispatch(tenantId, orderId);
    if (!found) throw new DispatchNotFoundError();
    const copy = await this.copyResult(tenantId, orderId, found);
    return copy;
  }

  private async viewWith(
    tenantId: string,
    orderId: string,
    found: NonNullable<
      Awaited<ReturnType<GameDispatchService["findDispatch"]>>
    >,
    audience: TemplateAudienceV2,
  ): Promise<DispatchView> {
    const lines = await this.lines(tenantId, found.gd, orderId);
    const round = await this.client.gameDispatchRound.findFirst({
      where: { tenantId, orderId },
      orderBy: { roundNo: "desc" },
    });
    const copy = await this.copyResult(tenantId, orderId, found);
    const snapshotView = await this.orderSnapshotView(
      tenantId,
      orderId,
      (found.gd.formValuesJson ?? {}) as Record<string, unknown>,
      audience,
    );
    const settlement = await this.settlementView(tenantId, orderId);
    return {
      orderId,
      dispatchOrderId: found.gd.id,
      dispatchNo: found.gd.dispatchNo,
      status: found.order.status,
      customerProfileId: found.order.customerProfileId,
      templateName: "",
      formValues: snapshotView.values as Record<string, string>,
      document: snapshotView.document,
      settlement,
      durationMinutes: found.gd.durationMinutes,
      desiredStartAt: found.gd.desiredStartAt
        ? found.gd.desiredStartAt.toISOString()
        : null,
      lines,
      round: round
        ? {
            roundNo: round.roundNo,
            opensAt: round.opensAt.toISOString(),
            closesAt: round.closesAt.toISOString(),
            status: round.status,
          }
        : null,
      ...copy,
    };
  }

  /**
   * 费用口径（Task 5b-2/A，设计规格 §3.2 / §3.4）：只报链路里真实存在的数字。
   *
   * 现状：档位金额**整额**扣老板钱包并整额进结算批次，门店抽成与平台费尚未分账，
   * 所以抽成/平台费返回 null 并用 `splitApplied=false` 显式标注，不按规格公式编造毛利。
   * 分账落地（ADR 批准后）时，这里改为复用 `splitSettlement` 并把 flag 置 true。
   */
  private async settlementView(
    tenantId: string,
    orderId: string,
  ): Promise<DispatchSettlementView> {
    const activeSlots = await this.client.orderSlot.findMany({
      where: { tenantId, orderId, status: { not: "RELEASED" } },
      select: { id: true },
    });
    const earnings = await this.client.slotEarning.findMany({
      where: {
        tenantId,
        orderId,
        orderSlotId: { in: activeSlots.map((s) => s.id) },
      },
      select: { amountFen: true, detailJson: true },
    });
    // ADR-0004 之后：amountFen 是陪玩实收，整额与分账明细在 detailJson；
    // 切换前的历史行没有 grossFen，此时整额 == amountFen（历史口径，用 splitApplied=false 标出）。
    let orderAmountFen = 0n;
    let playerShareFen = 0n;
    let platformFeeFen = 0n;
    let storeCutFen = 0n;
    let allSplit = earnings.length > 0;
    for (const earning of earnings) {
      const detail = (earning.detailJson ?? {}) as Record<string, unknown>;
      const gross = grossFenOf(earning);
      const split = typeof detail.grossFen === "string";
      if (!split) allSplit = false;
      orderAmountFen += gross;
      playerShareFen += earning.amountFen;
      platformFeeFen += split
        ? BigInt(String(detail.platformFeeFen ?? "0"))
        : 0n;
      storeCutFen += split ? BigInt(String(detail.storeCutFen ?? "0")) : 0n;
    }
    return {
      orderAmountFen: orderAmountFen.toString(),
      playerShareFen: playerShareFen.toString(),
      // 门店毛利 = 老板支出 − 陪玩实收 = 平台费 + 门店抽成
      storeProfitFen: (orderAmountFen - playerShareFen).toString(),
      storeCutFen: allSplit ? storeCutFen.toString() : null,
      platformFeeFen: allSplit ? platformFeeFen.toString() : null,
      splitApplied: allSplit,
      approvedSlotCount: earnings.length,
      activeSlotCount: activeSlots.length,
    };
  }

  /** 分账费率：租户费率行优先，缺失时按 ADR-0004 的兜底（平台费 0 / 门店抽成 2000bp）。 */
  private async settlementRates(
    tx: Tx,
    tenantId: string,
  ): Promise<{ platformFeeBp: number; storeCutBp: number }> {
    const row = await tx.financeRateRule.findUnique({ where: { tenantId } });
    return row
      ? { platformFeeBp: row.platformFeeBp, storeCutBp: row.storeCutBp }
      : { platformFeeBp: 0, storeCutBp: 2000 };
  }

  /**
   * 订单快照的端口视图：一次读取订单自己的快照（配置 + 值 + 快照时间），
   * 同时产出"这个端口能看到的字段值"与按同一端口过滤后的自动文案（V-5 / V-6）。
   *
   * 旧订单（schemaVersion 非 2）或快照不可解析时不做端口过滤（既有的 v1 值原样返回）、
   * document 降级为 null 并留一条 warn，不影响既有字段，也不回退去读当前模板。
   */
  private async orderSnapshotView(
    tenantId: string,
    orderId: string,
    rawValues: Record<string, unknown>,
    audience: TemplateAudienceV2,
  ): Promise<{
    values: Record<string, unknown>;
    document: DispatchDocumentView | null;
  }> {
    const snapshot = await this.client.gameDispatchTemplateSnapshot.findFirst({
      where: { tenantId, orderId },
      select: { schemaVersion: true, configJson: true, createdAt: true },
    });
    if (!snapshot || snapshot.schemaVersion !== 2) {
      return { values: rawValues, document: null };
    }
    const config = readPublishedConfig(snapshot.configJson);
    if (config === null) {
      this.logger.warn(
        `订单 ${orderId} 的快照配置不可解析，自动文案降级为 null`,
      );
      emitTemplateEvent(TEMPLATE_EVENTS.DOCUMENT_FAILED, {
        tenantId,
        orderId,
        code: "TEMPLATE_COMPONENT_INVALID",
        outcome: "failed",
      });
      // 快照坏了就无法判定端口可见性：客户侧宁可少给（V-6），
      // 商家端保留原值以便排查——这是自己门店的数据。
      return {
        values: audience === "CUSTOMER" ? {} : rawValues,
        document: null,
      };
    }
    const values = partitionValuesV2(config, rawValues, audience).visible;
    try {
      const document = renderDispatchDocument(
        visibleConfigV2(config, audience),
        values,
      );
      return {
        values,
        document: {
          ...document,
          generatedFromSnapshotAt: snapshot.createdAt.toISOString(),
        },
      };
    } catch (error) {
      this.logger.warn(
        `订单 ${orderId} 自动文案生成失败：${error instanceof Error ? error.message : String(error)}`,
      );
      emitTemplateEvent(TEMPLATE_EVENTS.DOCUMENT_FAILED, {
        tenantId,
        orderId,
        outcome: "failed",
      });
      return { values, document: null };
    }
  }

  private async lines(
    tenantId: string,
    gd: {
      id: string;
      gameId: string | null;
      formValuesJson: unknown;
      targetRankLabel: string | null;
      snapshotId: string | null;
    },
    orderId: string,
    options: { withPrices?: boolean } = {},
  ): Promise<DispatchLineView[]> {
    const rows = await this.client.gameDispatchLine.findMany({
      where: { tenantId, dispatchOrderId: gd.id },
      orderBy: { sortOrder: "asc" },
    });
    const apps = await this.client.gameDispatchApplication.findMany({
      where: { tenantId, orderId },
    });
    const playerIds = apps.map((a) => a.playerId);
    const players = playerIds.length
      ? await this.client.playerProfile.findMany({
          where: { tenantId, id: { in: playerIds } },
        })
      : [];
    const byId = new Map(players.map((p) => [p.id, p]));
    // Task 5a：把「已选中」的档位 id 一起返回，商家端据此提供「释放名额」入口；
    // 释放过的档位不再返回（该报名回到可重新报名的状态）。
    const slots = await this.client.orderSlot.findMany({
      where: { tenantId, orderId, status: { not: "RELEASED" } },
      select: { id: true, applicationId: true, unitPriceFen: true },
    });
    const slotByApplication = new Map(
      slots.map((s) => [s.applicationId, s.id]),
    );
    // P3 / D1：已选中的报名必须显示**档位快照单价**（可能与算法价不同，例如客服填了固定价；
    // 结算用的就是快照）。未选中的报名才按当前规则现算。
    const slotPriceByApplication = new Map(
      slots
        .filter((s) => s.applicationId !== null)
        .map((s) => [s.applicationId as string, s.unitPriceFen.toString()]),
    );
    // 展示口径（设计规格 §3.4）：报名详情显示单价（老板端与陪玩端同一数字，不乘时长）。
    const priceByPlayer =
      options.withPrices === false
        ? new Map<string, string | null>()
        : await this.unitPriceByPlayer(
            tenantId,
            gd,
            apps.map((a) => a.playerId),
          );
    return rows.map((row) => ({
      id: row.id,
      positionLabel: row.positionLabel,
      requiredCount: row.requiredCount,
      applications: apps
        .filter((a) => a.lineId === row.id)
        .map<DispatchApplicationView>((a) => ({
          id: a.id,
          playerId: a.playerId,
          playerName: byId.get(a.playerId)?.name ?? "未知陪玩",
          positionLabel: a.positionLabel,
          status: a.status,
          createdAt: a.createdAt.toISOString(),
          slotId: slotByApplication.get(a.id) ?? null,
          unitPriceFen:
            slotPriceByApplication.get(a.id) ??
            priceByPlayer.get(a.playerId) ??
            null,
        })),
    }));
  }

  /**
   * 一批陪玩在本单的单价（分/小时）：底价（陪玩×游戏，缺省用陪玩级兜底）+ 命中维度键的加价。
   * 与选人计价共用 `resolveUnitPriceFen`，保证「界面上看到的价」与「下单快照的价」同源。
   */
  private async unitPriceByPlayer(
    tenantId: string,
    gd: {
      gameId: string | null;
      formValuesJson: unknown;
      targetRankLabel: string | null;
      snapshotId: string | null;
    },
    playerIds: readonly string[],
    tx: Tx = this.client,
  ): Promise<Map<string, string | null>> {
    const out = new Map<string, string | null>();
    const unique = Array.from(new Set(playerIds));
    if (unique.length === 0) return out;
    const snapshot = gd.snapshotId
      ? await tx.gameDispatchTemplateSnapshot.findFirst({
          where: { tenantId, id: gd.snapshotId },
        })
      : null;
    const pricing = await this.pricingContext(tx, tenantId, gd, snapshot);
    const bases = pricing.gameId
      ? await loadPlayerGameBases(tx, tenantId, pricing.gameId, unique)
      : new Map<string, MoneyFen>();
    const players = await tx.playerProfile.findMany({
      where: { tenantId, id: { in: unique } },
      select: { id: true, basePricePerHourFen: true },
    });
    const byId = new Map(players.map((p) => [p.id, p]));
    for (const playerId of unique) {
      const player = byId.get(playerId);
      if (!player) {
        out.set(playerId, null);
        continue;
      }
      out.set(
        playerId,
        resolveUnitPriceFen({
          gameBaseFen: bases.get(playerId) ?? null,
          // 与选人一致：底价为 0 视为「未设置」，不静默按 0 展示。
          fallbackBaseFen:
            player.basePricePerHourFen > 0n
              ? player.basePricePerHourFen.toString()
              : null,
          dimensionKeys: pricing.dimensionKeys,
          ruleItems: pricing.ruleItems,
        }),
      );
    }
    return out;
  }

  private async copyResult(
    tenantId: string,
    orderId: string,
    found: NonNullable<
      Awaited<ReturnType<GameDispatchService["findDispatch"]>>
    >,
  ): Promise<DispatchCopyResult> {
    const snapshot = found.gd.snapshotId
      ? await this.client.gameDispatchTemplateSnapshot.findFirst({
          where: { tenantId, id: found.gd.snapshotId },
        })
      : null;
    // 群文案不需要单价，跳过计价查询。
    const lines = await this.lines(tenantId, found.gd, orderId, {
      withPrices: false,
    });
    const form = (found.gd.formValuesJson ?? {}) as Record<string, string>;
    const copyLines = (snapshot?.copyLinesJson ?? []) as unknown as Array<{
      label: string;
      valueKey: string | null;
    }>;
    const positionsText = lines
      .map((l) => `${l.positionLabel}×${l.requiredCount}`)
      .join("/");
    const valueOf = (key: string | null): string => {
      if (!key) return "";
      if (key === "dispatchNo") return found.gd.dispatchNo;
      if (key === "positions") return positionsText;
      if (key === "duration") return `${found.gd.durationMinutes} 分钟`;
      if (key === "startAt")
        return found.gd.desiredStartAt
          ? found.gd.desiredStartAt.toLocaleString("zh-CN")
          : "";
      return form[key] ?? "";
    };
    const copyText = (
      copyLines.length
        ? copyLines
        : [{ label: "派单编号", valueKey: "dispatchNo" }]
    )
      .map((c) => `${c.label}：${valueOf(c.valueKey)}`)
      .join("\n");
    const h5Origin = process.env.H5_ORIGIN ?? "";
    const tenantRow = await this.client.tenant.findUnique({
      where: { id: tenantId },
      select: { code: true },
    });
    const query = `order=${orderId}&tenant=${encodeURIComponent(
      tenantRow?.code ?? "",
    )}`;
    return {
      copyText,
      applyUrl: `${h5Origin}/#/pages/player/game-signup/index?${query}`,
      bossUrl: `${h5Origin}/#/pages/customer/game-select/index?${query}`,
    };
  }
}
