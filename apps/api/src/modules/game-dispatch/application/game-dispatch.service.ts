import { randomBytes } from "node:crypto";
import type { PrismaClient, DbTransaction } from "@pw/database";
import type {
  DispatchApplicationView,
  DispatchCopyResult,
  DispatchDraftInput,
  DispatchListRow,
  DispatchLineView,
  DispatchView,
} from "../domain/dispatch.js";
import {
  DispatchConflictError,
  DispatchInputError,
  DispatchNotFoundError,
  DispatchStateError,
} from "../domain/dispatch-errors.js";

type Tx = DbTransaction;

interface RankRuleJson {
  rankLabel: string;
  addPriceFen: string;
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

function fen(fenString: string): bigint {
  return BigInt(fenString);
}

export class GameDispatchService {
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

  private async rankAdd(
    tx: Tx,
    tenantId: string,
    snapshotId: string,
    rankLabel: string | undefined | null,
  ): Promise<bigint> {
    if (!snapshotId) return 0n;
    const snapshot = await tx.gameDispatchTemplateSnapshot.findFirst({
      where: { tenantId, id: snapshotId },
    });
    if (!snapshot) return 0n;
    const rules = (snapshot.rankRulesJson ?? []) as unknown as RankRuleJson[];
    const hit = rules.find((r) => r.rankLabel === rankLabel);
    return hit ? fen(hit.addPriceFen) : 0n;
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
    const formValues = input.formValues ?? {};
    const mode =
      typeof formValues["mode"] === "string" ? formValues["mode"] : null;
    const rankField = templateFields.find(
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
          templateId: template.id,
          templateName: template.name,
          fieldsJson: JSON.parse(
            JSON.stringify(
              templateFields.map((f) => ({
                fieldKey: f.fieldKey,
                label: f.label,
                fieldType: f.fieldType,
                options: f.options ?? [],
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

  async list(tenantId: string): Promise<DispatchListRow[]> {
    const rows = await this.client.gameDispatchOrder.findMany({
      where: { tenantId },
      orderBy: { createdAt: "desc" },
      take: 100,
    });
    const out: DispatchListRow[] = [];
    for (const row of rows) {
      const order = await this.client.order.findFirst({
        where: { tenantId, id: row.orderId },
        select: { status: true },
      });
      out.push({
        orderId: row.orderId,
        dispatchNo: row.dispatchNo,
        status: order?.status ?? "UNKNOWN",
        durationMinutes: row.durationMinutes,
        customerProfileId: row.tenantId,
        createdAt: row.createdAt.toISOString(),
      });
    }
    return out;
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
          closesAt: new Date(now.getTime() + 10 * 60 * 1000),
          status: "OPEN",
        },
      });
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
    return this.view(tenantId, orderId);
  }

  async applications(
    tenantId: string,
    orderId: string,
  ): Promise<DispatchView["lines"]> {
    const found = await this.findDispatch(tenantId, orderId);
    if (!found) throw new DispatchNotFoundError();
    return this.lines(tenantId, found.gd.id, orderId);
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
    return this.view(tenantId, orderId);
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
      if (found.order.status !== "DISPATCHING")
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
      return {
        id: row.id,
        playerId: player.id,
        playerName: player.name,
        positionLabel: line.positionLabel,
        status: row.status,
        createdAt: row.createdAt.toISOString(),
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
  ): Promise<DispatchView> {
    if (applicationIds.length === 0)
      throw new DispatchInputError("至少选择一个报名");
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
        where: { tenantId, orderId },
      });
      const lines = await tx.gameDispatchLine.findMany({
        where: { tenantId, orderId },
      });
      const slotPrices = slotRows.map((s) => s.unitPriceFen);
      for (const app of apps) {
        const line = lines.find((l) => l.id === app.lineId);
        if (!line) continue;
        const player = await tx.playerProfile.findFirst({
          where: { tenantId, id: app.playerId },
        });
        if (!player) throw new DispatchInputError("陪玩不存在");
        const snapshot = found.gd.snapshotId
          ? await tx.gameDispatchTemplateSnapshot.findFirst({
              where: { tenantId, id: found.gd.snapshotId },
            })
          : null;
        const rules = (snapshot?.rankRulesJson ??
          []) as unknown as RankRuleJson[];
        const hit = rules.find((r) => r.rankLabel === found.gd.targetRankLabel);
        slotPrices.push(
          player.basePricePerHourFen + (hit ? fen(hit.addPriceFen) : 0n),
        );
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
      const snapshot = found.gd.snapshotId
        ? await tx.gameDispatchTemplateSnapshot.findFirst({
            where: { tenantId, id: found.gd.snapshotId },
          })
        : null;
      const rules = (snapshot?.rankRulesJson ??
        []) as unknown as RankRuleJson[];
      const hit = rules.find((r) => r.rankLabel === found.gd.targetRankLabel);
      for (const app of apps) {
        const player = await tx.playerProfile.findFirst({
          where: { tenantId, id: app.playerId },
        });
        if (!player) throw new DispatchInputError("陪玩不存在");
        const line = lines.find((l) => l.id === app.lineId);
        if (!line) continue;
        await tx.orderSlot.create({
          data: {
            tenantId,
            orderId,
            dispatchOrderId: found.gd.id,
            lineId: app.lineId,
            applicationId: app.id,
            playerId: app.playerId,
            positionLabel: app.positionLabel,
            unitPriceFen:
              player.basePricePerHourFen + (hit ? fen(hit.addPriceFen) : 0n),
            createdBy: actorId,
          },
        });
        await tx.gameDispatchApplication.update({
          where: { id: app.id },
          data: { status: "SELECTED" },
        });
      }
      const selected = await tx.orderSlot.count({
        where: { tenantId, orderId },
      });
      const totalRequired = lines.reduce((acc, l) => acc + l.requiredCount, 0);
      if (selected >= totalRequired) {
        await tx.order.update({
          where: { id: orderId },
          data: { status: "ASSIGNED" },
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
    return this.view(tenantId, orderId);
  }

  async view(tenantId: string, orderId: string): Promise<DispatchView> {
    const found = await this.findDispatch(tenantId, orderId);
    if (!found) throw new DispatchNotFoundError();
    return this.viewWith(tenantId, orderId, found);
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
  ): Promise<DispatchView> {
    const lines = await this.lines(tenantId, found.gd.id, orderId);
    const round = await this.client.gameDispatchRound.findFirst({
      where: { tenantId, orderId },
      orderBy: { roundNo: "desc" },
    });
    const copy = await this.copyResult(tenantId, orderId, found);
    return {
      orderId,
      dispatchOrderId: found.gd.id,
      dispatchNo: found.gd.dispatchNo,
      status: found.order.status,
      customerProfileId: found.order.customerProfileId,
      templateName: "",
      formValues: (found.gd.formValuesJson ?? {}) as Record<string, string>,
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

  private async lines(
    tenantId: string,
    dispatchOrderId: string,
    orderId: string,
  ): Promise<DispatchLineView[]> {
    const rows = await this.client.gameDispatchLine.findMany({
      where: { tenantId, dispatchOrderId },
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
        })),
    }));
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
    const lines = await this.lines(tenantId, found.gd.id, orderId);
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
