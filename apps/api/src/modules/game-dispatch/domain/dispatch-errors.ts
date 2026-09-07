export class DispatchNotFoundError extends Error {
  constructor(message = "派单不存在") {
    super(message);
    this.name = "DispatchNotFoundError";
  }
}

export class DispatchStateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DispatchStateError";
  }
}

export class DispatchConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DispatchConflictError";
  }
}

export class DispatchInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DispatchInputError";
  }
}
