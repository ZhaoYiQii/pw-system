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
export class AccountNotCustomerError extends Error {
  constructor(accountId: string) {
    super(`account is not a CUSTOMER role account: ${accountId}`);
    this.name = "AccountNotCustomerError";
  }
}

export class CustomerAccountBoundError extends Error {
  constructor() {
    super("account already bound to another customer profile");
    this.name = "CustomerAccountBoundError";
  }
}