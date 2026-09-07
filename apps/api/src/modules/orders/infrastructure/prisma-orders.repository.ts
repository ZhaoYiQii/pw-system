import type { PrismaClient, Prisma } from "@pw/database";
import type { OrderView } from "../domain/order.js";
import {
  InvalidOrderInputError,
  OrderStateConflictError,
  PricingRuleMissingError,
  ProductDisabledError,
} from "../domain/errors.js";
import type {
  OrdersRepository,
  ProductLookup,
  RequirementInput,
} from "../application/orders.service.js";

const IDEM_OP_CREATE = "createOrder";

function isP2002(error: unknown): boolean {
  return (
    error !== null &&
    typeof error === "object" &&
    "code" in error &&
    (error as { code?: string }).code === "P2002"
  );
}

function asDate(v: string | null | undefined): Date | null {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

export class PrismaOrdersRepository implements OrdersRepository {
  constructor(private readonly client: PrismaClient) {}

  async customerInTenant(tenantId: string, id: string): Promise<boolean> {
    const row = await this.client.customerProfile.findFirst({
      where: { tenantId, id },
      select: { id: true },
    });
    return row !== null;
  }

  async gameInTenant(tenantId: string, id: string): Promise<boolean> {
    const row = await this.client.game.findFirst({
      where: { tenantId, id },
      select: { id: true },
    });
    return row !== null;
  }

  async productInTenant(
    tenantId: string,
    id: string,
  ): Promise<ProductLookup | null> {
    const row = await this.client.serviceProduct.findFirst({
      where: { tenantId, id },
      select: { id: true, name: true, gameRegionId: true, enabled: true },
    });
    if (!row) return null;
    let regionName: string | null = null;
    if (row.gameRegionId) {
      const region = await this.client.gameRegion.findFirst({
        where: { tenantId, id: row.gameRegionId },
        select: { name: true },
      });
      regionName = region?.name ?? null;
    }
    return { id: row.id, name: row.name, regionName, enabled: row.enabled };
  }

  async loadFull(tenantId: string, orderId: string): Promise<OrderView | null> {
    const order = await this.client.order.findFirst({
      where: { tenantId, id: orderId, processType: "CLASSIC" },
    });
    if (!order) return null;
    const customer = await this.client.customerProfile.findFirst({
      where: { tenantId, id: order.customerProfileId },
      select: { name: true },
    });
    const reqRow = await this.client.orderRequirement.findFirst({
      where: { tenantId, orderId },
      orderBy: { createdAt: "desc" },
    });
    let requirement: OrderView["requirement"] = null;
    if (reqRow) {
      const [game, product] = await Promise.all([
        reqRow.gameId
          ? this.client.game.findFirst({
              where: { tenantId, id: reqRow.gameId },
              select: { name: true },
            })
          : null,
        reqRow.serviceProductId
          ? this.client.serviceProduct.findFirst({
              where: { tenantId, id: reqRow.serviceProductId },
              select: { name: true },
            })
          : null,
      ]);
      requirement = {
        description: reqRow.description,
        gameId: reqRow.gameId,
        serviceProductId: reqRow.serviceProductId,
        gameName: game?.name ?? null,
        productName: product?.name ?? null,
        desiredStartAt: reqRow.desiredStartAt,
        durationSeconds: reqRow.durationSeconds,
        minBudgetFen:
          reqRow.minBudgetFen === null ? null : reqRow.minBudgetFen.toString(),
        maxBudgetFen:
          reqRow.maxBudgetFen === null ? null : reqRow.maxBudgetFen.toString(),
        note: reqRow.note,
      };
    }
    const snapRows = await this.client.orderPriceSnapshot.findMany({
      where: { tenantId, orderId },
      orderBy: [{ snapshotVersion: "asc" }, { id: "asc" }],
    });
    const events = await this.client.orderEvent.findMany({
      where: { tenantId, orderId },
      orderBy: { occurredAt: "asc" },
    });
    return {
      id: order.id,
      tenantId: order.tenantId,
      orderNo: order.orderNo,
      customerProfileId: order.customerProfileId,
      customerName: customer?.name ?? "",
      status: order.status,
      scheduledStartAt: order.scheduledStartAt,
      remark: order.remark,
      version: order.version,
      createdAt: order.createdAt,
      updatedAt: order.updatedAt,
      requirement,
      snapshot: snapRows.map((s) => ({
        serviceProductId: s.serviceProductId,
        productName: s.productName,
        regionName: s.regionName,
        durationSeconds: s.durationSeconds,
        unitPriceFen: s.unitPriceFen.toString(),
        playerCostFen: s.playerCostFen.toString(),
        lineTotalFen: s.lineTotalFen.toString(),
        currency: s.currency,
      })),
      timeline: events.map((e) => ({
        id: e.id,
        eventType: e.eventType,
        fromStatus: e.fromStatus,
        toStatus: e.toStatus,
        occurredAt: e.occurredAt,
      })),
    };
  }

  async list(
    tenantId: string,
    opts: { status?: string },
  ): Promise<OrderView[]> {
    const rows = await this.client.order.findMany({
      where: {
        tenantId,
        processType: "CLASSIC",
        ...(opts.status ? { status: opts.status as never } : {}),
      },
      orderBy: { createdAt: "desc" },
      take: 100,
    });
    const out: OrderView[] = [];
    for (const row of rows) {
      const full = await this.loadFull(tenantId, row.id);
      if (full) out.push(full);
    }
    return out;
  }

  async listByCustomer(
    tenantId: string,
    customerProfileId: string,
  ): Promise<OrderView[]> {
    const rows = await this.client.order.findMany({
      where: { tenantId, customerProfileId, processType: "CLASSIC" },
      orderBy: { createdAt: "desc" },
      take: 100,
    });
    const out: OrderView[] = [];
    for (const row of rows) {
      const full = await this.loadFull(tenantId, row.id);
      if (full) out.push(full);
    }
    return out;
  }

  private async requirementData(
    tenantId: string,
    r: RequirementInput,
  ): Promise<Prisma.OrderRequirementCreateManyInput> {
    return {
      tenantId,
      orderId: "", // filled after order
      description: r.description.trim(),
      gameId: r.gameId ?? null,
      serviceProductId: r.serviceProductId ?? null,
      gender: r.gender?.trim() || null,
      desiredStartAt: asDate(r.desiredStartAt ?? null),
      durationSeconds: r.durationSeconds ?? null,
      minBudgetFen:
        r.minBudgetFen === undefined || r.minBudgetFen === null
          ? null
          : BigInt(r.minBudgetFen),
      maxBudgetFen:
        r.maxBudgetFen === undefined || r.maxBudgetFen === null
          ? null
          : BigInt(r.maxBudgetFen),
      note: r.note?.trim() || null,
    };
  }

  async createDraft(opts: {
    tenantId: string;
    actorId: string;
    orderNo: string;
    customerProfileId: string;
    remark: string | null;
    requirement: RequirementInput;
    idempotencyKey?: string;
  }): Promise<{ orderId: string; duplicate: boolean }> {
    try {
      return await this.client.$transaction(async (tx) => {
        if (opts.idempotencyKey) {
          const existing = await tx.idempotencyRecord.findUnique({
            where: {
              tenantId_idempotencyKey_operation: {
                tenantId: opts.tenantId,
                idempotencyKey: opts.idempotencyKey,
                operation: IDEM_OP_CREATE,
              },
            },
          });
          if (existing?.entityId)
            return { orderId: existing.entityId, duplicate: true };
        }
        const order = await tx.order.create({
          data: {
            tenantId: opts.tenantId,
            orderNo: opts.orderNo,
            customerProfileId: opts.customerProfileId,
            remark: opts.remark,
          },
        });
        const req = await this.requirementData(opts.tenantId, opts.requirement);
        await tx.orderRequirement.create({
          data: { ...req, orderId: order.id },
        });
        await tx.orderEvent.create({
          data: {
            tenantId: opts.tenantId,
            orderId: order.id,
            eventType: "ORDER_CREATED",
            fromStatus: null,
            toStatus: "DRAFT",
            actorType: "tenant_account",
            actorId: opts.actorId,
            payload: { orderNo: order.orderNo },
          },
        });
        await tx.outboxEvent.create({
          data: {
            tenantId: opts.tenantId,
            aggregateType: "order",
            aggregateId: order.id,
            eventType: "order.created",
            payload: {
              orderId: order.id,
              orderNo: order.orderNo,
              status: "DRAFT",
            },
          },
        });
        if (opts.idempotencyKey) {
          await tx.idempotencyRecord.create({
            data: {
              tenantId: opts.tenantId,
              idempotencyKey: opts.idempotencyKey,
              operation: IDEM_OP_CREATE,
              entityType: "order",
              entityId: order.id,
            },
          });
        }
        return { orderId: order.id, duplicate: false };
      });
    } catch (error) {
      if (isP2002(error)) {
        if (opts.idempotencyKey) {
          const rec = await this.client.idempotencyRecord.findUnique({
            where: {
              tenantId_idempotencyKey_operation: {
                tenantId: opts.tenantId,
                idempotencyKey: opts.idempotencyKey,
                operation: IDEM_OP_CREATE,
              },
            },
          });
          if (rec?.entityId) return { orderId: rec.entityId, duplicate: true };
        }
        throw new InvalidOrderInputError("orderNo 已存在");
      }
      throw error;
    }
  }

  async confirm(
    tenantId: string,
    orderId: string,
    actorId: string,
  ): Promise<void> {
    await this.client.$transaction(async (tx) => {
      const lock = await tx.$queryRaw<
        Array<{ id: string; status: string; order_no: string }>
      >`
        SELECT id, status, order_no FROM orders
        WHERE id = ${orderId}::uuid AND tenant_id = ${tenantId}::uuid FOR UPDATE`;
      if (lock.length === 0) return;
      const current = lock[0] as {
        id: string;
        status: string;
        order_no: string;
      };
      if (current.status !== "DRAFT")
        throw new OrderStateConflictError(orderId, current.status, "CONFIRMED");
      const req = await tx.orderRequirement.findFirst({
        where: { tenantId, orderId },
      });
      if (!req || !req.serviceProductId || !req.durationSeconds) {
        throw new InvalidOrderInputError(
          "确认订单需要 serviceProductId 与 durationSeconds",
        );
      }
      const product = await tx.serviceProduct.findFirst({
        where: { tenantId, id: req.serviceProductId },
        select: { id: true, name: true, enabled: true, gameRegionId: true },
      });
      if (!product) throw new InvalidOrderInputError("服务产品不存在");
      if (!product.enabled) throw new ProductDisabledError(product.id);
      const rule = await tx.pricingRule.findFirst({
        where: {
          tenantId,
          serviceProductId: product.id,
          durationSeconds: req.durationSeconds,
          enabled: true,
        },
      });
      if (!rule)
        throw new PricingRuleMissingError(product.id, req.durationSeconds);
      let regionName: string | null = null;
      if (product.gameRegionId) {
        const region = await tx.gameRegion.findFirst({
          where: { tenantId, id: product.gameRegionId },
          select: { name: true },
        });
        regionName = region?.name ?? null;
      }
      const unitPriceFen = rule.priceFen;
      const playerCostFen = rule.playerCostFen;
      const quantity = 1;
      await tx.orderPriceSnapshot.create({
        data: {
          tenantId,
          orderId,
          snapshotVersion: 1,
          serviceProductId: product.id,
          productName: product.name,
          regionName,
          durationSeconds: req.durationSeconds,
          unitPriceFen,
          playerCostFen,
          quantity,
          lineTotalFen: unitPriceFen * BigInt(quantity),
        },
      });
      await tx.orderEvent.create({
        data: {
          tenantId,
          orderId,
          eventType: "SNAPSHOT_CREATED",
          fromStatus: null,
          toStatus: null,
          actorType: "tenant_account",
          actorId,
          payload: { version: 1 },
        },
      });
      await tx.orderEvent.create({
        data: {
          tenantId,
          orderId,
          eventType: "ORDER_CONFIRMED",
          fromStatus: "DRAFT",
          toStatus: "CONFIRMED",
          actorType: "tenant_account",
          actorId,
          payload: { orderNo: current.order_no },
        },
      });
      await tx.order.update({
        where: { id: orderId },
        data: { status: "CONFIRMED" },
      });
      await tx.outboxEvent.create({
        data: {
          tenantId,
          aggregateType: "order",
          aggregateId: orderId,
          eventType: "order.confirmed",
          payload: {
            orderId,
            orderNo: current.order_no,
            status: "CONFIRMED",
            unitPriceFen: unitPriceFen.toString(),
          },
        },
      });
    });
  }

  async cancel(
    tenantId: string,
    orderId: string,
    actorId: string,
    reason: string | null,
  ): Promise<void> {
    await this.client.$transaction(async (tx) => {
      const lock = await tx.$queryRaw<
        Array<{ id: string; status: string; order_no: string }>
      >`
        SELECT id, status, order_no FROM orders
        WHERE id = ${orderId}::uuid AND tenant_id = ${tenantId}::uuid FOR UPDATE`;
      if (lock.length === 0) return;
      const current = lock[0] as {
        id: string;
        status: string;
        order_no: string;
      };
      if (
        !["DRAFT", "CONFIRMED", "DISPATCHING", "ASSIGNED", "READY"].includes(
          current.status,
        )
      ) {
        throw new OrderStateConflictError(orderId, current.status, "CANCELLED");
      }
      await tx.order.update({
        where: { id: orderId },
        data: { status: "CANCELLED" },
      });
      await tx.orderEvent.create({
        data: {
          tenantId,
          orderId,
          eventType: "ORDER_CANCELLED",
          fromStatus: current.status,
          toStatus: "CANCELLED",
          actorType: "tenant_account",
          actorId,
          payload: { reason: reason ?? null, orderNo: current.order_no },
        },
      });
      // 取消后的业务清理：关闭公开派单，过期仍未处理的报名
      await tx.dispatchPublication.updateMany({
        where: { tenantId, orderId, status: "OPEN" },
        data: { status: "CLOSED", closedAt: new Date() },
      });
      await tx.application.updateMany({
        where: {
          tenantId,
          orderId,
          status: { in: ["APPLIED", "SHORTLISTED"] },
        },
        data: { status: "EXPIRED" },
      });
      await tx.outboxEvent.create({
        data: {
          tenantId,
          aggregateType: "order",
          aggregateId: orderId,
          eventType: "order.cancelled",
          payload: { orderId, orderNo: current.order_no, status: "CANCELLED" },
        },
      });
    });
  }
}
