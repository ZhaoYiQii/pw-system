export class InvalidTenantCodeError extends Error {
  constructor(code: string) {
    super(`invalid tenant code: ${code}`);
    this.name = "InvalidTenantCodeError";
  }
}

export class DuplicateTenantCodeError extends Error {
  constructor(code: string) {
    super(`tenant code already exists: ${code}`);
    this.name = "DuplicateTenantCodeError";
  }
}

export class TenantNotFoundError extends Error {
  constructor(id: string) {
    super(`tenant not found: ${id}`);
    this.name = "TenantNotFoundError";
  }
}

export class ClientSuppliedTenantIdError extends Error {
  constructor() {
    super(
      "client-supplied tenantId is not trusted; tenant context is derived server-side",
    );
    this.name = "ClientSuppliedTenantIdError";
  }
}
