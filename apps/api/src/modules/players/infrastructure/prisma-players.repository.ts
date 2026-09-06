import type { PrismaClient } from "@pw/database";
import type {
  PlayerDetailView,
  PlayerSkillView,
  PlayerView,
} from "../domain/player.js";
import {
  AccountNotPlayerError,
  DuplicatePlayerError,
  OverlappingAvailabilityError,
  PlayerAccountBoundError,
  PlayerNotFoundError,
  SkillAlreadyExistsError,
} from "../domain/errors.js";

function isP2002(error: unknown): boolean {
  return (
    error !== null &&
    typeof error === "object" &&
    "code" in error &&
    (error as { code?: string }).code === "P2002"
  );
}
import type {
  AvailabilityInput,
  PlayerInput,
  PlayerRepository,
  SkillInput,
} from "../application/players.service.js";

function mapPlayer(row: {
  id: string;
  tenantId: string;
  name: string;
  mobile: string | null;
  intro: string | null;
  status: string;
  acceptingOrders: boolean;
  createdAt: Date;
  updatedAt: Date;
}): PlayerView {
  return {
    id: row.id,
    tenantId: row.tenantId,
    name: row.name,
    mobile: row.mobile,
    intro: row.intro,
    status: row.status as PlayerView["status"],
    acceptingOrders: row.acceptingOrders,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

interface SkillRow {
  id: string;
  tenantId: string;
  playerId: string;
  gameId: string;
  gameRegionId: string | null;
  title: string | null;
  note: string | null;
}

async function enrichSkills(
  client: PrismaClient,
  rows: SkillRow[],
): Promise<PlayerSkillView[]> {
  if (rows.length === 0) return [];
  const gameIds = Array.from(new Set(rows.map((r) => r.gameId)));
  const regionIds = Array.from(
    new Set(
      rows
        .filter((r) => r.gameRegionId !== null)
        .map((r) => r.gameRegionId as string),
    ),
  );
  const games =
    regionIds.length > 0 || gameIds.length > 0
      ? await client.game.findMany({
          where: { id: { in: gameIds } },
          select: { id: true, name: true },
        })
      : [];
  const regions =
    regionIds.length > 0
      ? await client.gameRegion.findMany({
          where: { id: { in: regionIds } },
          select: { id: true, name: true },
        })
      : [];
  const gameName = new Map(games.map((g) => [g.id, g.name]));
  const regionName = new Map(regions.map((r) => [r.id, r.name]));
  return rows.map((r) => ({
    id: r.id,
    tenantId: r.tenantId,
    playerId: r.playerId,
    gameId: r.gameId,
    gameRegionId: r.gameRegionId,
    gameName: gameName.get(r.gameId) ?? "",
    regionName: r.gameRegionId
      ? (regionName.get(r.gameRegionId) ?? null)
      : null,
    title: r.title,
    note: r.note,
  }));
}

export class PrismaPlayerRepository implements PlayerRepository {
  constructor(private readonly client: PrismaClient) {}

  async list(
    tenantId: string,
    opts: { q?: string; status?: "ACTIVE" | "INACTIVE" },
  ): Promise<PlayerView[]> {
    const where: Record<string, unknown> = { tenantId };
    if (opts.status) where.status = opts.status;
    if (opts.q)
      where.OR = [
        { name: { contains: opts.q, mode: "insensitive" } },
        { mobile: { contains: opts.q } },
      ];
    const rows = await this.client.playerProfile.findMany({
      where,
      orderBy: { createdAt: "desc" },
    });
    return rows.map(mapPlayer);
  }

  async find(tenantId: string, id: string): Promise<PlayerView | null> {
    const row = await this.client.playerProfile.findFirst({
      where: { tenantId, id },
    });
    return row ? mapPlayer(row) : null;
  }

  async detail(tenantId: string, id: string): Promise<PlayerDetailView | null> {
    const player = await this.find(tenantId, id);
    if (!player) return null;
    const skillRows = await this.client.playerSkill.findMany({
      where: { tenantId, playerId: id },
      orderBy: { createdAt: "asc" },
    });
    const availability = await this.client.playerAvailability.findMany({
      where: { tenantId, playerId: id },
      orderBy: { startsAt: "asc" },
    });
    return {
      ...player,
      skills: await enrichSkills(this.client, skillRows),
      availability: availability.map((a) => ({
        id: a.id,
        tenantId: a.tenantId,
        playerId: a.playerId,
        startsAt: a.startsAt,
        endsAt: a.endsAt,
        reason: a.reason,
      })),
    };
  }

  async create(tenantId: string, input: PlayerInput): Promise<PlayerView> {
    try {
      const row = await this.client.playerProfile.create({
        data: {
          tenantId,
          name: input.name,
          ...(input.mobile ? { mobile: input.mobile } : {}),
          ...(input.intro ? { intro: input.intro } : {}),
          status: input.status ?? "ACTIVE",
          acceptingOrders: input.acceptingOrders ?? true,
        },
      });
      return mapPlayer(row);
    } catch (error) {
      if (
        error !== null &&
        typeof error === "object" &&
        "code" in error &&
        (error as { code?: string }).code === "P2002"
      ) {
        throw new DuplicatePlayerError(input.mobile ?? undefined);
      }
      throw error;
    }
  }

  async update(
    tenantId: string,
    id: string,
    input: Partial<PlayerInput>,
  ): Promise<PlayerView | null> {
    try {
      const res = await this.client.playerProfile.updateMany({
        where: { tenantId, id },
        data: {
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.mobile !== undefined ? { mobile: input.mobile } : {}),
          ...(input.intro !== undefined ? { intro: input.intro } : {}),
          ...(input.status !== undefined ? { status: input.status } : {}),
          ...(input.acceptingOrders !== undefined
            ? { acceptingOrders: input.acceptingOrders }
            : {}),
        },
      });
      if (res.count === 0) return null;
      return this.find(tenantId, id);
    } catch (error) {
      if (
        error !== null &&
        typeof error === "object" &&
        "code" in error &&
        (error as { code?: string }).code === "P2002"
      ) {
        throw new DuplicatePlayerError(input.mobile ?? undefined);
      }
      throw error;
    }
  }

  async remove(tenantId: string, id: string): Promise<boolean> {
    // 由 tenantGuarded 在事务内调用：this.client 已是带租户 GUC 的 tx
    const player = await this.client.playerProfile.findFirst({
      where: { tenantId, id },
      select: { id: true },
    });
    if (!player) return false;
    await this.client.playerAvailability.deleteMany({
      where: { tenantId, playerId: id },
    });
    await this.client.playerSkill.deleteMany({
      where: { tenantId, playerId: id },
    });
    const res = await this.client.playerProfile.deleteMany({
      where: { tenantId, id },
    });
    return res.count > 0;
  }

  async gameInTenant(tenantId: string, gameId: string): Promise<boolean> {
    const row = await this.client.game.findFirst({
      where: { tenantId, id: gameId },
      select: { id: true },
    });
    return row !== null;
  }

  async regionInTenant(
    tenantId: string,
    regionId: string,
    gameId: string,
  ): Promise<boolean> {
    const row = await this.client.gameRegion.findFirst({
      where: { tenantId, id: regionId, gameId },
      select: { id: true },
    });
    return row !== null;
  }

  async addSkill(
    tenantId: string,
    playerId: string,
    input: SkillInput,
  ): Promise<PlayerSkillView> {
    try {
      const created = await this.client.playerSkill.create({
        data: {
          tenantId,
          playerId,
          gameId: input.gameId,
          ...(input.gameRegionId ? { gameRegionId: input.gameRegionId } : {}),
          ...(input.title ? { title: input.title } : {}),
          ...(input.note ? { note: input.note } : {}),
        },
      });
      const enriched = await enrichSkills(this.client, [created]);
      return enriched[0] as PlayerSkillView;
    } catch (error) {
      if (
        error !== null &&
        typeof error === "object" &&
        "code" in error &&
        (error as { code?: string }).code === "P2002"
      ) {
        throw new SkillAlreadyExistsError();
      }
      throw error;
    }
  }

  async removeSkill(
    tenantId: string,
    playerId: string,
    skillId: string,
  ): Promise<boolean> {
    const res = await this.client.playerSkill.deleteMany({
      where: { tenantId, playerId, id: skillId },
    });
    return res.count > 0;
  }

  async addAvailability(
    tenantId: string,
    playerId: string,
    input: AvailabilityInput,
  ): Promise<{ id: string }> {
    // 由 tenantGuarded 在事务内调用：this.client 已是带租户 GUC 的 tx，行锁在事务提交时释放
    const lock = await this.client.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM player_profiles
      WHERE id = ${playerId}::uuid AND tenant_id = ${tenantId}::uuid
      FOR UPDATE`;
    if (lock.length === 0) throw new Error("player not found in transaction");
    const overlap = await this.client.playerAvailability.findFirst({
      where: {
        tenantId,
        playerId,
        endsAt: { gt: input.startsAt },
        startsAt: { lt: input.endsAt },
      },
      select: { id: true },
    });
    if (overlap) throw new OverlappingAvailabilityError();
    const created = await this.client.playerAvailability.create({
      data: {
        tenantId,
        playerId,
        startsAt: input.startsAt,
        endsAt: input.endsAt,
        ...(input.reason ? { reason: input.reason } : {}),
      },
      select: { id: true },
    });
    return { id: created.id };
  }

  async removeAvailability(
    tenantId: string,
    playerId: string,
    availabilityId: string,
  ): Promise<boolean> {
    const res = await this.client.playerAvailability.deleteMany({
      where: { tenantId, playerId, id: availabilityId },
    });
    return res.count > 0;
  }

  async bind(
    tenantId: string,
    playerId: string,
    accountId: string,
  ): Promise<PlayerView> {
    const account = await this.client.tenantAccount.findFirst({
      where: { tenantId, id: accountId, roles: { some: { role: "PLAYER" } } },
      select: { id: true },
    });
    if (!account) throw new AccountNotPlayerError(accountId);
    try {
      const res = await this.client.playerProfile.updateMany({
        where: { tenantId, id: playerId },
        data: { tenantAccountId: accountId },
      });
      if (res.count === 0) throw new PlayerNotFoundError(playerId);
      const row = await this.find(tenantId, playerId);
      return row as PlayerView;
    } catch (error) {
      if (isP2002(error)) throw new PlayerAccountBoundError();
      throw error;
    }
  }

  async findByAccount(
    tenantId: string,
    accountId: string,
  ): Promise<PlayerView | null> {
    const row = await this.client.playerProfile.findFirst({
      where: { tenantId, tenantAccountId: accountId },
    });
    return row ? mapPlayer(row) : null;
  }

  async updateByAccount(
    tenantId: string,
    accountId: string,
    input: Partial<PlayerInput>,
  ): Promise<PlayerView | null> {
    const res = await this.client.playerProfile.updateMany({
      where: { tenantId, tenantAccountId: accountId },
      data: {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.mobile !== undefined ? { mobile: input.mobile } : {}),
        ...(input.intro !== undefined ? { intro: input.intro } : {}),
        ...(input.status !== undefined ? { status: input.status } : {}),
        ...(input.acceptingOrders !== undefined
          ? { acceptingOrders: input.acceptingOrders }
          : {}),
      },
    });
    if (res.count === 0) return null;
    return this.findByAccount(tenantId, accountId);
  }
}
