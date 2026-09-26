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

/**
 * 切换端上下文时账号未持有目标端角色（控制器映射 403）。
 * 与 InvalidCredentialsError 区分：此处账号已通过认证，只是没有该端的角色，
 * 复用登录失败语义会让未获批准的陪玩申请显示成 500 或「账号密码错误」。
 */
export class ContextRoleMissingError extends Error {
  constructor() {
    super("该账号未开通目标端权限，请先提交对应申请或联系门店");
    this.name = "ContextRoleMissingError";
  }
}

export class PhoneAlreadyBoundError extends Error {
  constructor(message = "该手机号已绑定其他账号，请联系门店处理") {
    super(message);
    this.name = "PhoneAlreadyBoundError";
  }
}

export class InvalidRefreshTokenError extends Error {
  constructor() {
    super("invalid or expired refresh token");
    this.name = "InvalidRefreshTokenError";
  }
}

/** SP2 §5.1/§5.2：注册与改密端点的输入校验失败（控制器映射 400）。 */
export class AuthInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AuthInputError";
  }
}

/** SP2 §5.1：注册时用户名在该门店已被占用（控制器映射 409，文案取自 spec §5.1 错误表）。 */
export class UsernameTakenError extends Error {
  constructor() {
    super("该用户名已被使用");
    this.name = "UsernameTakenError";
  }
}

/** SP2 §5.1：tenantCode 未命中门店（控制器映射 404，沿用 resolveTenantId 既有语义）。 */
export class TenantNotFoundError extends Error {
  constructor() {
    super("门店不存在");
    this.name = "TenantNotFoundError";
  }
}

/** SP2 §5.2：修改分支的原密码缺失或不匹配（控制器映射 400）。 */
export class CurrentPasswordInvalidError extends Error {
  constructor() {
    super("原密码不正确");
    this.name = "CurrentPasswordInvalidError";
  }
}
