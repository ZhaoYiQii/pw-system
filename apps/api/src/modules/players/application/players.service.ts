import type {
  PlayerDetailView,
  PlayerSkillView,
  PlayerView,
} from "../domain/player.js";
import {
  AvailabilityNotFoundError,
  DuplicatePlayerError,
  GameNotInTenantError,
  InvalidPlayerInputError,
  OverlappingAvailabilityError,
  PlayerNotFoundError,
  RegionNotInTenantError,
  SkillAlreadyExistsError,
  SkillNotFoundError,
} from "../domain/errors.js";
import type { MoneyFen } from "../../../common/money.js";
import { parseFenString } from "../../../common/money.js";

export interface PlayerInput {
  name: string;
  mobile?: string | null;
  intro?: string | null;
  status?: "ACTIVE" | "INACTIVE";
  acceptingOrders?: boolean;
  basePricePerHourFen?: MoneyFen;
}

export interface SkillInput {
  gameId: string;
  gameRegionId?: string | null;
  title?: string | null;
  note?: string | null;
}

export interface AvailabilityInput {
  startsAt: Date;
  endsAt: Date;
  reason?: string | null;
}

export interface PlayerRepository {
  list(
    tenantId: string,
    opts: { q?: string; status?: "ACTIVE" | "INACTIVE" },
  ): Promise<PlayerView[]>;
  find(tenantId: string, id: string): Promise<PlayerView | null>;
  detail(tenantId: string, id: string): Promise<PlayerDetailView | null>;
  create(tenantId: string, input: PlayerInput): Promise<PlayerView>;
  update(
    tenantId: string,
    id: string,
    input: Partial<PlayerInput>,
  ): Promise<PlayerView | null>;
  remove(tenantId: string, id: string): Promise<boolean>;
  gameInTenant(tenantId: string, gameId: string): Promise<boolean>;
  regionInTenant(
    tenantId: string,
    regionId: string,
    gameId: string,
  ): Promise<boolean>;
  addSkill(
    tenantId: string,
    playerId: string,
    input: SkillInput,
  ): Promise<PlayerSkillView>;
  removeSkill(
    tenantId: string,
    playerId: string,
    skillId: string,
  ): Promise<boolean>;
  addAvailability(
    tenantId: string,
    playerId: string,
    input: AvailabilityInput,
  ): Promise<{ id: string }>;
  removeAvailability(
    tenantId: string,
    playerId: string,
    availabilityId: string,
  ): Promise<boolean>;
  bind(
    tenantId: string,
    playerId: string,
    accountId: string,
  ): Promise<PlayerView>;
  findByAccount(
    tenantId: string,
    accountId: string,
  ): Promise<PlayerView | null>;
  updateByAccount(
    tenantId: string,
    accountId: string,
    input: Partial<PlayerInput>,
  ): Promise<PlayerView | null>;
}

function assertPlayerInput(input: Partial<PlayerInput>): void {
  if (
    input.name !== undefined &&
    (typeof input.name !== "string" ||
      input.name.trim().length < 1 ||
      input.name.length > 80)
  ) {
    throw new InvalidPlayerInputError("name 需为 1-80 字符");
  }
  if (
    input.mobile !== undefined &&
    input.mobile !== null &&
    typeof input.mobile === "string" &&
    !/^[0-9+\- ]{5,20}$/.test(input.mobile.trim())
  ) {
    throw new InvalidPlayerInputError("mobile 格式非法");
  }
  if (
    input.intro !== undefined &&
    input.intro !== null &&
    typeof input.intro === "string" &&
    input.intro.length > 500
  ) {
    throw new InvalidPlayerInputError("intro 超出 500 字符");
  }
  if (
    input.basePricePerHourFen !== undefined &&
    parseFenString(input.basePricePerHourFen, true) === null
  ) {
    throw new InvalidPlayerInputError(
      "basePricePerHourFen 必须为非负整数十进制字符串（分）",
    );
  }
}

export class PlayersService {
  constructor(private readonly repository: PlayerRepository) {}

  async list(
    tenantId: string,
    opts: { q?: string; status?: "ACTIVE" | "INACTIVE" } = {},
  ): Promise<PlayerView[]> {
    const where: { q?: string; status?: "ACTIVE" | "INACTIVE" } = {};
    if (opts.q && opts.q.trim()) where.q = opts.q.trim();
    if (opts.status) where.status = opts.status;
    return this.repository.list(tenantId, where);
  }

  async get(tenantId: string, id: string): Promise<PlayerDetailView> {
    const row = await this.repository.detail(tenantId, id);
    if (!row) throw new PlayerNotFoundError(id);
    return row;
  }

  async create(tenantId: string, input: PlayerInput): Promise<PlayerView> {
    assertPlayerInput(input);
    try {
      return await this.repository.create(tenantId, {
        name: input.name.trim(),
        mobile: input.mobile?.trim() || null,
        intro: input.intro?.trim() || null,
        status: input.status ?? "ACTIVE",
        acceptingOrders: input.acceptingOrders ?? true,
      });
    } catch (error) {
      if (error instanceof DuplicatePlayerError) throw error;
      throw error;
    }
  }

  async update(
    tenantId: string,
    id: string,
    input: Partial<PlayerInput>,
  ): Promise<PlayerView> {
    assertPlayerInput(input);
    const clean: Partial<PlayerInput> = {};
    if (input.name !== undefined) clean.name = input.name.trim();
    if (input.mobile !== undefined) clean.mobile = input.mobile?.trim() || null;
    if (input.intro !== undefined) clean.intro = input.intro?.trim() || null;
    if (input.status !== undefined) clean.status = input.status;
    if (input.acceptingOrders !== undefined)
      clean.acceptingOrders = input.acceptingOrders;
    const row = await this.repository.update(tenantId, id, clean);
    if (!row) throw new PlayerNotFoundError(id);
    return row;
  }

  async remove(tenantId: string, id: string): Promise<void> {
    const ok = await this.repository.remove(tenantId, id);
    if (!ok) throw new PlayerNotFoundError(id);
  }

  async addSkill(
    tenantId: string,
    playerId: string,
    input: SkillInput,
  ): Promise<PlayerSkillView> {
    const player = await this.repository.find(tenantId, playerId);
    if (!player) throw new PlayerNotFoundError(playerId);
    if (!(await this.repository.gameInTenant(tenantId, input.gameId))) {
      throw new GameNotInTenantError(input.gameId);
    }
    if (
      input.gameRegionId &&
      !(await this.repository.regionInTenant(
        tenantId,
        input.gameRegionId,
        input.gameId,
      ))
    ) {
      throw new RegionNotInTenantError(input.gameRegionId);
    }
    try {
      return await this.repository.addSkill(tenantId, playerId, {
        gameId: input.gameId,
        gameRegionId: input.gameRegionId || null,
        title: input.title?.trim() || null,
        note: input.note?.trim() || null,
      });
    } catch (error) {
      if (error instanceof SkillAlreadyExistsError) throw error;
      throw error;
    }
  }

  async removeSkill(
    tenantId: string,
    playerId: string,
    skillId: string,
  ): Promise<void> {
    const ok = await this.repository.removeSkill(tenantId, playerId, skillId);
    if (!ok) throw new SkillNotFoundError(skillId);
  }

  async addAvailability(
    tenantId: string,
    playerId: string,
    input: AvailabilityInput,
  ): Promise<void> {
    if (
      !(input.endsAt instanceof Date) ||
      !(input.startsAt instanceof Date) ||
      Number.isNaN(input.startsAt.getTime()) ||
      Number.isNaN(input.endsAt.getTime())
    ) {
      throw new InvalidPlayerInputError("startsAt/endsAt 需为合法时间");
    }
    if (input.endsAt.getTime() <= input.startsAt.getTime()) {
      throw new InvalidPlayerInputError("endsAt 必须晚于 startsAt");
    }
    const player = await this.repository.find(tenantId, playerId);
    if (!player) throw new PlayerNotFoundError(playerId);
    try {
      await this.repository.addAvailability(tenantId, playerId, {
        startsAt: input.startsAt,
        endsAt: input.endsAt,
        reason: input.reason?.trim() || null,
      });
    } catch (error) {
      if (error instanceof OverlappingAvailabilityError) throw error;
      throw error;
    }
  }

  async removeAvailability(
    tenantId: string,
    playerId: string,
    availabilityId: string,
  ): Promise<void> {
    const ok = await this.repository.removeAvailability(
      tenantId,
      playerId,
      availabilityId,
    );
    if (!ok) throw new AvailabilityNotFoundError(availabilityId);
  }

  async bind(
    tenantId: string,
    playerId: string,
    accountId: string,
  ): Promise<PlayerView> {
    const player = await this.repository.find(tenantId, playerId);
    if (!player) throw new PlayerNotFoundError(playerId);
    return this.repository.bind(tenantId, playerId, accountId);
  }

  async getByAccount(
    tenantId: string,
    accountId: string,
  ): Promise<PlayerDetailView> {
    const player = await this.repository.findByAccount(tenantId, accountId);
    if (!player) throw new PlayerNotFoundError(accountId);
    const row = await this.repository.detail(tenantId, player.id);
    if (!row) throw new PlayerNotFoundError(player.id);
    return row;
  }

  async setAcceptingByAccount(
    tenantId: string,
    accountId: string,
    acceptingOrders: boolean,
  ): Promise<PlayerView> {
    const row = await this.repository.updateByAccount(tenantId, accountId, {
      acceptingOrders,
    });
    if (!row) throw new PlayerNotFoundError(accountId);
    return row;
  }

  async addAvailabilityByAccount(
    tenantId: string,
    accountId: string,
    input: AvailabilityInput,
  ): Promise<void> {
    const player = await this.repository.findByAccount(tenantId, accountId);
    if (!player) throw new PlayerNotFoundError(accountId);
    await this.addAvailability(tenantId, player.id, input);
  }

  async removeAvailabilityByAccount(
    tenantId: string,
    accountId: string,
    availabilityId: string,
  ): Promise<void> {
    const player = await this.repository.findByAccount(tenantId, accountId);
    if (!player) throw new PlayerNotFoundError(accountId);
    await this.removeAvailability(tenantId, player.id, availabilityId);
  }
}
