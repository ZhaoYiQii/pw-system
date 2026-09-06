export class PlayerNotFoundError extends Error {
  constructor(id: string) {
    super(`player not found: ${id}`);
    this.name = "PlayerNotFoundError";
  }
}

export class DuplicatePlayerError extends Error {
  constructor(mobile: string | undefined) {
    super(`player with mobile ${mobile ?? "(none)"} already exists`);
    this.name = "DuplicatePlayerError";
  }
}

export class InvalidPlayerInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidPlayerInputError";
  }
}

export class GameNotInTenantError extends Error {
  constructor(gameId: string) {
    super(`game not found in tenant: ${gameId}`);
    this.name = "GameNotInTenantError";
  }
}

export class RegionNotInTenantError extends Error {
  constructor(regionId: string) {
    super(`region not found in tenant: ${regionId}`);
    this.name = "RegionNotInTenantError";
  }
}

export class SkillAlreadyExistsError extends Error {
  constructor() {
    super("player skill for this game already exists");
    this.name = "SkillAlreadyExistsError";
  }
}

export class SkillNotFoundError extends Error {
  constructor(id: string) {
    super(`skill not found: ${id}`);
    this.name = "SkillNotFoundError";
  }
}

export class OverlappingAvailabilityError extends Error {
  constructor() {
    super("availability overlaps an existing unavailable time");
    this.name = "OverlappingAvailabilityError";
  }
}

export class AvailabilityNotFoundError extends Error {
  constructor(id: string) {
    super(`availability not found: ${id}`);
    this.name = "AvailabilityNotFoundError";
  }
}