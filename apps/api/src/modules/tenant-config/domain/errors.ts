export class InvalidTenantConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidTenantConfigError";
  }
}

export class NoVersionToRollbackError extends Error {
  constructor() {
    super("no previous version to rollback to");
    this.name = "NoVersionToRollbackError";
  }
}
