export class UnauthorizedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnauthorizedError";
  }
}

export class AccountDisabledError extends Error {
  constructor() {
    super("account is disabled");
    this.name = "AccountDisabledError";
  }
}

export class TenantInactiveError extends Error {
  constructor() {
    super("门店已停用，无法登录");
    this.name = "TenantInactiveError";
  }
}

export class InvalidCredentialsError extends Error {
  constructor() {
    super("invalid username or password");
    this.name = "InvalidCredentialsError";
  }
}

export class InvalidRefreshTokenError extends Error {
  constructor() {
    super("invalid or expired refresh token");
    this.name = "InvalidRefreshTokenError";
  }
}
