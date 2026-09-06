export class OrderNotFoundError extends Error {
  constructor(id: string) {
    super(`order not found: ${id}`);
    this.name = "OrderNotFoundError";
  }
}

export class OrderStateConflictError extends Error {
  constructor(id: string, from: string, to: string) {
    super(`order ${id} cannot transition ${from} -> ${to}`);
    this.name = "OrderStateConflictError";
  }
}

export class InvalidOrderInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidOrderInputError";
  }
}

export class CustomerNotInTenantError extends Error {
  constructor(id: string) {
    super(`customer not found in tenant: ${id}`);
    this.name = "CustomerNotInTenantError";
  }
}

export class GameNotInTenantError extends Error {
  constructor(id: string) {
    super(`game not found in tenant: ${id}`);
    this.name = "GameNotInTenantError";
  }
}

export class ProductNotInTenantError extends Error {
  constructor(id: string) {
    super(`service product not found in tenant: ${id}`);
    this.name = "ProductNotInTenantError";
  }
}

export class PricingRuleMissingError extends Error {
  constructor(productId: string, durationSeconds: number) {
    super(`no enabled pricing rule for product ${productId} @ ${durationSeconds}s`);
    this.name = "PricingRuleMissingError";
  }
}

export class ProductDisabledError extends Error {
  constructor(productId: string) {
    super(`product is disabled: ${productId}`);
    this.name = "ProductDisabledError";
  }
}