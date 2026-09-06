export class SessionNotFoundError extends Error {
  constructor(resource: string, id: string) {
    super(`${resource} not found: ${id}`);
    this.name = "SessionNotFoundError";
  }
}

export class SessionStateConflictError extends Error {
  constructor(id: string, from: string, to: string) {
    super(`session ${id} cannot ${from} -> ${to}`);
    this.name = "SessionStateConflictError";
  }
}

export class InvalidSessionInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidSessionInputError";
  }
}

export class AdjustmentNotFoundError extends Error {
  constructor(id: string) {
    super(`adjustment not found: ${id}`);
    this.name = "AdjustmentNotFoundError";
  }
}

export class AdjustmentConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AdjustmentConflictError";
  }
}