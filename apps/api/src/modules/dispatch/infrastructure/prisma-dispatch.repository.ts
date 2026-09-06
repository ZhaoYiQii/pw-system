import type { PrismaClient } from "@pw/database";
import type { ApplicationView, AssignView, HallOrderView } from "../domain/dispatch.js";
import {
  ApplicationConflictError,
  AssignmentExistsError,
  DispatchNotFoundError,
  OrderStateConflictError,
  PlayerNotAcceptingError,
  PlayerSkillMissingError,
  PlayerTimeConflictError
} from "../domain/errors.js";
import type { DispatchRepository } from "../application/dispatch.service.js";

export class PrismaDispatchRepository implements DispatchRepository {
  constructor(private readonly client: PrismaClient) {}

  async publish(tenantId: string, orderId: string, actorId: string): Promise<void> {
    await this.client.$transaction(async (tx) => {
      const lock = await tx.$queryRaw<Array<{ id: string; status: string; order_no: string }>>`
        SELECT id, status, order_no FROM orders WHERE id = ${orderId}::uuid AND tenant_id = ${tenantId}::uuid FOR UPDATE`;
      if (lock.length === 0) throw new DispatchNotFoundError("order", orderId);
      const order = lock[0] as { id: string; status: string; order_no: string };
      if (order.status !== "CONFIRMED") throw new OrderStateConflictError(orderId, order.status, "DISPATCHING");
      const existing = await tx.dispatchPublication.findFirst({ where: { tenantId, orderId }, select: { id: true, status: true } });
      if (existing) {
        if (existing.status !== "OPEN") {
          await tx.dispatchPublication.update({ where: { id: existing.id }, data: { status: "OPEN", closedAt: null } });
        }
      } else {
        await tx.dispatchPublication.create({ data: { tenantId, orderId } });
      }
      await tx.order.update({ where: { id: orderId }, data: { status: "DISPATCHING" } });
      await tx.orderEvent.create({
        data: { tenantId, orderId, eventType: "ORDER_PUBLISHED", fromStatus: "CONFIRMED", toStatus: "DISPATCHING", actorType: "tenant_account", actorId, payload: { orderNo: order.order_no } }
      });
      await tx.outboxEvent.create({
        data: { tenantId, aggregateType: "order", aggregateId: orderId, eventType: "order.published", payload: { orderId, orderNo: order.order_no } }
      });
    });
  }

  private async verifyPlayer(tenantId: string, playerId: string): Promise<void> {
    const player = await this.client.playerProfile.findFirst({ where: { tenantId, id: playerId }, select: { acceptingOrders: true, status: true } });
    if (!player || player.status !== "ACTIVE") throw new DispatchNotFoundError("player", playerId);
    if (!player.acceptingOrders) throw new PlayerNotAcceptingError(playerId);
  }

  private async verifySkillAndTime(tenantId: string, orderId: string, playerId: string): Promise<void> {
    const req = await this.client.orderRequirement.findFirst({ where: { tenantId, orderId } });
    if (!req) throw new DispatchNotFoundError("requirement", orderId);
    let gameId: string | null = null;
    if (req.serviceProductId) {
      const product = await this.client.serviceProduct.findFirst({ where: { tenantId, id: req.serviceProductId }, select: { gameId: true } });
      gameId = product?.gameId ?? null;
    }
    if (gameId) {
      const skill = await this.client.playerSkill.findFirst({ where: { tenantId, playerId, gameId }, select: { id: true } });
      if (!skill) throw new PlayerSkillMissingError(playerId, gameId);
    }
    if (req.desiredStartAt && req.durationSeconds) {
      const start = req.desiredStartAt;
      const end = new Date(start.getTime() + req.durationSeconds * 1000);
      const conflict = await this.client.playerAvailability.findFirst({
        where: { tenantId, playerId, endsAt: { gt: start }, startsAt: { lt: end } },
        select: { id: true }
      });
      if (conflict) throw new PlayerTimeConflictError(playerId);
    }
  }

  async apply(tenantId: string, orderId: string, playerId: string, actorId: string, note?: string | null): Promise<void> {
    await this.client.$transaction(async (tx) => {
      const order = await tx.order.findFirst({ where: { tenantId, id: orderId }, select: { status: true, orderNo: true } });
      if (!order) throw new DispatchNotFoundError("order", orderId);
      if (order.status !== "DISPATCHING") throw new OrderStateConflictError(orderId, order.status, "APPLY");
      const pub = await tx.dispatchPublication.findFirst({ where: { tenantId, orderId, status: "OPEN" }, select: { id: true } });
      if (!pub) throw new DispatchNotFoundError("publication", orderId);
      await this.verifyPlayer(tenantId, playerId);
      await this.verifySkillAndTime(tenantId, orderId, playerId);
      const existing = await tx.application.findFirst({ where: { tenantId, orderId, playerId } });
      if (existing) {
        if (existing.status === "APPLIED" || existing.status === "SHORTLISTED") throw new ApplicationConflictError("已报名，请勿重复提交");
        if (existing.status === "SELECTED" || existing.status === "EXPIRED") throw new ApplicationConflictError("该报名已失效，不能重新报名");
        await tx.application.update({ where: { id: existing.id }, data: { status: "APPLIED", playerNote: note ?? existing.playerNote } });
      } else {
        await tx.application.create({ data: { tenantId, orderId, playerId, playerNote: note ?? null } });
      }
      await tx.orderEvent.create({
        data: { tenantId, orderId, eventType: "APPLICATION_APPLIED", fromStatus: null, toStatus: "APPLIED", actorType: "tenant_account", actorId, payload: { playerId } }
      });
      await tx.outboxEvent.create({
        data: { tenantId, aggregateType: "application", aggregateId: orderId, eventType: "order.application_applied", payload: { orderId, playerId } }
      });
    });
  }

  async hallOrders(tenantId: string): Promise<HallOrderView[]> {
    const pubs = await this.client.dispatchPublication.findMany({
      where: { tenantId, status: "OPEN" },
      orderBy: { publishedAt: "desc" },
      take: 50
    });
    const out: HallOrderView[] = [];
    for (const pub of pubs) {
      const order = await this.client.order.findFirst({ where: { tenantId, id: pub.orderId }, select: { id: true, orderNo: true, createdAt: true } });
      if (!order) continue;
      const req = await this.client.orderRequirement.findFirst({ where: { tenantId, orderId: pub.orderId } });
      let productName = "服务";
      if (req?.serviceProductId) {
        const p = await this.client.serviceProduct.findFirst({ where: { tenantId, id: req.serviceProductId }, select: { name: true } });
        productName = p?.name ?? "服务";
      }
      const snapshot = await this.client.orderPriceSnapshot.findFirst({
        where: { tenantId, orderId: pub.orderId },
        orderBy: [{ snapshotVersion: "desc" }, { id: "desc" }]
      });
      out.push({
        id: order.id,
        orderNo: order.orderNo,
        productName,
        durationSeconds: req?.durationSeconds ?? snapshot?.durationSeconds ?? 0,
        unitPriceFen: snapshot ? snapshot.unitPriceFen.toString() : "0",
        desiredStartAt: req?.desiredStartAt ?? null,
        createdAt: order.createdAt
      });
    }
    return out;
  }

  async myApplications(tenantId: string, playerId: string): Promise<ApplicationView[]> {
    const rows = await this.client.application.findMany({ where: { tenantId, playerId }, orderBy: { createdAt: "desc" }, take: 50 });
    return rows.map((r) => ({ id: r.id, orderId: r.orderId, playerId: r.playerId, playerName: "", status: r.status, playerNote: r.playerNote, createdAt: r.createdAt }));
  }

  async applications(tenantId: string, orderId: string): Promise<ApplicationView[]> {
    const rows = await this.client.application.findMany({ where: { tenantId, orderId }, orderBy: { createdAt: "asc" } });
    const out: ApplicationView[] = [];
    for (const r of rows) {
      const player = await this.client.playerProfile.findFirst({ where: { tenantId, id: r.playerId }, select: { name: true } });
      out.push({ id: r.id, orderId: r.orderId, playerId: r.playerId, playerName: player?.name ?? "", status: r.status, playerNote: r.playerNote, createdAt: r.createdAt });
    }
    return out;
  }

  async shortlist(tenantId: string, orderId: string, applicationId: string, shortlisted: boolean, actorId: string): Promise<void> {
    await this.client.$transaction(async (tx) => {
      const app = await tx.application.findFirst({ where: { tenantId, orderId, id: applicationId } });
      if (!app) throw new DispatchNotFoundError("application", applicationId);
      if (shortlisted && app.status !== "APPLIED") throw new ApplicationConflictError("只能对 APPLIED 报名入候选");
      if (!shortlisted && app.status !== "APPLIED" && app.status !== "SHORTLISTED") throw new ApplicationConflictError("当前状态不可拒绝");
      await tx.application.update({ where: { id: app.id }, data: { status: shortlisted ? "SHORTLISTED" : "REJECTED" } });
      await tx.orderEvent.create({
        data: { tenantId, orderId, eventType: shortlisted ? "APPLICATION_SHORTLISTED" : "APPLICATION_REJECTED", fromStatus: app.status, toStatus: shortlisted ? "SHORTLISTED" : "REJECTED", actorType: "tenant_account", actorId, payload: { applicationId, playerId: app.playerId } }
      });
    });
  }

  async assign(tenantId: string, orderId: string, applicationId: string, actorId: string): Promise<AssignView> {
    return this.client.$transaction(async (tx) => {
      const lock = await tx.$queryRaw<Array<{ id: string; status: string; order_no: string }>>`
        SELECT id, status, order_no FROM orders WHERE id = ${orderId}::uuid AND tenant_id = ${tenantId}::uuid FOR UPDATE`;
      if (lock.length === 0) throw new DispatchNotFoundError("order", orderId);
      const order = lock[0] as { id: string; status: string; order_no: string };
      if (order.status !== "DISPATCHING") throw new OrderStateConflictError(orderId, order.status, "ASSIGNED");
      const existingAssign = await tx.assignment.findFirst({ where: { tenantId, orderId }, select: { id: true } });
      if (existingAssign) throw new AssignmentExistsError(orderId);
      const app = await tx.application.findFirst({ where: { tenantId, orderId, id: applicationId } });
      if (!app) throw new DispatchNotFoundError("application", applicationId);
      if (app.status !== "APPLIED" && app.status !== "SHORTLISTED") throw new ApplicationConflictError("仅 APPLIED/SHORTLISTED 可被选中");
      await this.verifyPlayer(tenantId, app.playerId);
      await this.verifySkillAndTime(tenantId, orderId, app.playerId);
      let created: {
        id: string;
        tenantId: string;
        orderId: string;
        playerId: string;
        applicationId: string | null;
        createdAt: Date;
      };
      try {
        const row = await tx.assignment.create({
          data: { tenantId, orderId, playerId: app.playerId, applicationId: app.id, createdBy: actorId }
        });
        created = row;
      } catch (error) {
        if (error !== null && typeof error === "object" && "code" in error && (error as { code?: string }).code === "P2002") {
          throw new AssignmentExistsError(orderId);
        }
        throw error;
      }
      await tx.application.update({ where: { id: app.id }, data: { status: "SELECTED" } });
      await tx.application.updateMany({
        where: { tenantId, orderId, id: { not: app.id }, status: { in: ["APPLIED", "SHORTLISTED"] } },
        data: { status: "EXPIRED" }
      });
      await tx.dispatchPublication.updateMany({ where: { tenantId, orderId }, data: { status: "CLOSED", closedAt: new Date() } });
      await tx.order.update({ where: { id: orderId }, data: { status: "ASSIGNED" } });
      await tx.orderEvent.create({
        data: { tenantId, orderId, eventType: "ORDER_ASSIGNED", fromStatus: "DISPATCHING", toStatus: "ASSIGNED", actorType: "tenant_account", actorId, payload: { applicationId: app.id, playerId: app.playerId } }
      });
      await tx.outboxEvent.create({
        data: { tenantId, aggregateType: "order", aggregateId: orderId, eventType: "order.assigned", payload: { orderId, orderNo: order.order_no, playerId: app.playerId } }
      });
      return { id: created.id, orderId, playerId: app.playerId, applicationId: app.id, createdAt: created.createdAt };
    });
  }
}
