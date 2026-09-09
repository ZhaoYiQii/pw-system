import type { PrismaClient } from "@pw/database";
import { withTenantContext } from "@pw/database";
import {
  PlayerApplicationAlreadyPlayerError,
  PlayerApplicationDuplicatePendingError,
  PlayerApplicationNotCustomerError,
  PlayerApplicationNotFoundError,
  PlayerApplicationNotPendingError,
  PlayerApplicationReviewReasonRequiredError,
} from "./player-applications.errors.js";

export interface PlayerApplicationView {
  id: string;
  tenantId: string;
  accountId: string;
  customerProfileId: string;
  customerName?: string;
  accountUsername?: string;
  status: string;
  intro: string | null;
  reviewNote: string | null;
  reviewedAt: string | null;
  createdAt: string;
}

function toView(row: {
  id: string;
  tenantId: string;
  accountId: string;
  customerProfileId: string;
  status: string;
  intro: string | null;
  reviewNote: string | null;
  reviewedAt: Date | null;
  createdAt: Date;
}): PlayerApplicationView {
  return {
    id: row.id,
    tenantId: row.tenantId,
    accountId: row.accountId,
    customerProfileId: row.customerProfileId,
    status: row.status,
    intro: row.intro,
    reviewNote: row.reviewNote,
    reviewedAt: row.reviewedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

export class PlayerApplicationsService {
  constructor(private readonly client: PrismaClient) {}

  async apply(
    tenantId: string,
    accountId: string,
    intro: string,
  ): Promise<PlayerApplicationView> {
    const normalizedIntro = intro.trim().slice(0, 500);
    if (normalizedIntro.length < 1) {
      throw new PlayerApplicationReviewReasonRequiredError(
        "请填写申请说明",
      );
    }
    return withTenantContext(this.client, tenantId, async (tx) => {
      const customer = await tx.customerProfile.findFirst({
        where: { tenantId, tenantAccountId: accountId },
      });
      if (!customer) throw new PlayerApplicationNotCustomerError();
      const role = await tx.tenantAccountRole.findFirst({
        where: { tenantId, tenantAccountId: accountId, role: "CUSTOMER" },
      });
      if (!role) throw new PlayerApplicationNotCustomerError();
      const pending = await tx.playerApplication.findFirst({
        where: { tenantId, accountId, status: "PENDING" },
      });
      if (pending) {
        throw new PlayerApplicationDuplicatePendingError(
          "已有待审核的陪玩申请",
        );
      }
      const app = await tx.playerApplication.create({
        data: {
          tenantId,
          accountId,
          customerProfileId: customer.id,
          status: "PENDING",
          intro: normalizedIntro,
        },
      });
      await tx.auditLog.create({
        data: {
          tenantId,
          actorType: "tenant_account",
          actorId: accountId,
          action: "player-application.apply",
          resourceType: "player_application",
          resourceId: app.id,
          summary: "申请成为陪玩",
        },
      });
      return toView(app);
    });
  }

  async list(tenantId: string): Promise<PlayerApplicationView[]> {
    return withTenantContext(this.client, tenantId, async (tx) => {
      const rows = await tx.playerApplication
        .findMany({
          where: { tenantId },
          orderBy: { createdAt: "desc" },
        });
      const customerIds = rows.map((r) => r.customerProfileId);
      const accountIds = rows.map((r) => r.accountId);
      const customers = customerIds.length
        ? await tx.customerProfile.findMany({
            where: { tenantId, id: { in: customerIds } },
            select: { id: true, name: true },
          })
        : [];
      const accounts = accountIds.length
        ? await tx.tenantAccount.findMany({
            where: { tenantId, id: { in: accountIds } },
            select: { id: true, username: true },
          })
        : [];
      const customerName = new Map(customers.map((c) => [c.id, c.name]));
      const username = new Map(accounts.map((a) => [a.id, a.username]));
      return rows.map((row) => {
        const view = toView(row);
        const name = customerName.get(row.customerProfileId);
        const user = username.get(row.accountId);
        if (name) view.customerName = name;
        if (user) view.accountUsername = user;
        return view;
      });
    });
  }

  async approve(
    tenantId: string,
    actorId: string,
    applicationId: string,
  ): Promise<PlayerApplicationView> {
    return withTenantContext(this.client, tenantId, async (tx) => {
      const app = await tx.playerApplication.findFirst({
        where: { tenantId, id: applicationId },
      });
      if (!app) throw new PlayerApplicationNotFoundError();
      if (app.status !== "PENDING") {
        throw new PlayerApplicationNotPendingError();
      }
      const customer = await tx.customerProfile.findUnique({
        where: { id: app.customerProfileId },
      });
      if (!customer) throw new PlayerApplicationNotCustomerError();
      const roles = await tx.tenantAccountRole.findMany({
        where: { tenantId, tenantAccountId: app.accountId },
      });
      const existingProfile = await tx.playerProfile.findFirst({
        where: { tenantId, tenantAccountId: app.accountId },
      });
      if (
        existingProfile &&
        roles.some((r) => r.role === "PLAYER")
      ) {
        throw new PlayerApplicationAlreadyPlayerError(
          "该账号已具备陪玩身份",
        );
      }
      if (!existingProfile) {
        await tx.playerProfile.create({
          data: {
            tenantId,
            tenantAccountId: app.accountId,
            name: customer.name,
            mobileEnc: customer.mobileEnc,
            mobileHash: customer.mobileHash,
            intro: app.intro,
          },
        });
      }
      if (!roles.some((r) => r.role === "PLAYER")) {
        await tx.tenantAccountRole.create({
          data: {
            tenantId,
            tenantAccountId: app.accountId,
            role: "PLAYER",
          },
        });
      }
      const updated = await tx.playerApplication.update({
        where: { id: app.id },
        data: { status: "APPROVED", reviewedBy: actorId, reviewedAt: new Date() },
      });
      await tx.auditLog.create({
        data: {
          tenantId,
          actorType: "tenant_account",
          actorId,
          action: "player-application.approve",
          resourceType: "player_application",
          resourceId: app.id,
          summary: `批准陪玩申请 ${app.accountId}`,
        },
      });
      return toView(updated);
    });
  }

  async reject(
    tenantId: string,
    actorId: string,
    applicationId: string,
    reason: string,
  ): Promise<PlayerApplicationView> {
    const note = reason.trim().slice(0, 300);
    if (note.length < 1) {
      throw new PlayerApplicationReviewReasonRequiredError(
        "请填写拒绝原因",
      );
    }
    return withTenantContext(this.client, tenantId, async (tx) => {
      const app = await tx.playerApplication.findFirst({
        where: { tenantId, id: applicationId },
      });
      if (!app) throw new PlayerApplicationNotFoundError();
      if (app.status !== "PENDING") {
        throw new PlayerApplicationNotPendingError();
      }
      const updated = await tx.playerApplication.update({
        where: { id: app.id },
        data: {
          status: "REJECTED",
          reviewNote: note,
          reviewedBy: actorId,
          reviewedAt: new Date(),
        },
      });
      await tx.auditLog.create({
        data: {
          tenantId,
          actorType: "tenant_account",
          actorId,
          action: "player-application.reject",
          resourceType: "player_application",
          resourceId: app.id,
          summary: `拒绝陪玩申请：${note}`,
        },
      });
      return toView(updated);
    });
  }
}
