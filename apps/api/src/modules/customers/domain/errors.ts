export class CustomerNotFoundError extends Error {
  constructor(id: string) {
    super(`customer not found: ${id}`);
    this.name = "CustomerNotFoundError";
  }
}

export class DuplicateCustomerError extends Error {
  constructor(mobile: string | undefined) {
    super(`customer with mobile ${mobile ?? "(none)"} already exists`);
    this.name = "DuplicateCustomerError";
  }
}

export class InvalidCustomerInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidCustomerInputError";
  }
}