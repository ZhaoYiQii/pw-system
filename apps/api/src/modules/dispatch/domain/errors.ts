export class DispatchNotFoundError extends Error {
  constructor(resource: string, id: string) {
    super(`${resource} not found: ${id}`);
    this.name = "DispatchNotFoundError";
  }
}

export class OrderStateConflictError extends Error {
  constructor(id: string, from: string, to: string) {
    super(`order ${id} cannot transition ${from} -> ${to}`);
    this.name = "OrderStateConflictError";
  }
}

export class PlayerNotAcceptingError extends Error {
  constructor(playerId: string) {
    super(`player is not accepting orders: ${playerId}`);
    this.name = "PlayerNotAcceptingError";
  }
}

export class PlayerSkillMissingError extends Error {
  constructor(playerId: string, gameId: string) {
    super(`player ${playerId} has no skill for game ${gameId}`);
    this.name = "PlayerSkillMissingError";
  }
}

export class PlayerTimeConflictError extends Error {
  constructor(playerId: string) {
    super(`player ${playerId} has conflicting unavailable time`);
    this.name = "PlayerTimeConflictError";
  }
}

export class ApplicationConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ApplicationConflictError";
  }
}

export class AssignmentExistsError extends Error {
  constructor(orderId: string) {
    super(`order already assigned: ${orderId}`);
    this.name = "AssignmentExistsError";
  }
}
