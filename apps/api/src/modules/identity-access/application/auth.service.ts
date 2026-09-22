import {
  AccountDisabledError,
  InvalidCredentialsError,
  InvalidRefreshTokenError,
  PhoneAlreadyBoundError,
  TenantInactiveError,
} from "../domain/errors.js";
import type { PhoneVerificationService } from "./phone-verification.service.js";
import { createHash, randomBytes } from "node:crypto";
import { encryptPhone } from "../../../common/pii/phone.js";
import type { AccessPrincipal, Scope } from "../domain/principal.js";
import type { RoleKey } from "../domain/roles.js";
import { hashPassword, verifyPassword } from "../infrastructure/password.js";
import { maskOpenid } from "../infrastructure/wechat-oauth.client.js";
import {
  ACCESS_TOKEN_TTL_SECONDS,
  REFRESH_TOKEN_TTL_SECONDS,
  TokenService,
} from "../infrastructure/tokens.js";
import type {
  AuthRepository,
  PlatformAccountRecord,
  TenantAccountRecord,
} from "./auth-ports.js";

export interface SessionBundle {
  accessToken: string;
  refreshToken: string;
  principal: AccessPrincipal;
  expiresInSeconds: number;
}

export class AuthService {
  constructor(
    private readonly repository: AuthRepository,
    private readonly tokens: TokenService,
    private readonly phoneVerification: PhoneVerificationService,
  ) {}

  private platformPrincipal(account: PlatformAccountRecord): AccessPrincipal {
    return {
      sub: account.id,
      scope: "platform",
      role: account.role as RoleKey,
      username: account.username,
    };
  }

  private tenantPrincipal(
    account: TenantAccountRecord,
    overrideRole?: RoleKey,
  ): AccessPrincipal {
    const role = overrideRole ?? ((account.roles[0] ?? "CUSTOMER") as RoleKey);
    return {
      sub: account.id,
      scope: "tenant",
      role,
      username: account.username,
      tenantId: account.tenantId,
    };
  }

  async loginPlatform(
    username: string,
    password: string,
  ): Promise<SessionBundle> {
    const account =
      await this.repository.findPlatformAccountByUsername(username);
    if (!account) throw new InvalidCredentialsError();
    if (account.status !== "ACTIVE") throw new AccountDisabledError();
    const ok = await verifyPassword(password, account.passwordHash);
    if (!ok) throw new InvalidCredentialsError();
    return this.issue(this.platformPrincipal(account));
  }

  async loginTenant(
    tenantCode: string,
    username: string,
    password: string,
  ): Promise<SessionBundle> {
    const account = await this.repository.findTenantAccountByCodeAndUsername(
      tenantCode,
      username,
    );
    if (!account) throw new InvalidCredentialsError();
    if (account.tenantStatus !== "ACTIVE") {
      await this.repository.recordAudit({
        tenantId: account.tenantId,
        actorType: "tenant_account",
        actorId: account.id,
        action: "auth.login_failed",
        summary: "登录失败：门店已停用",
      });
      throw new TenantInactiveError();
    }
    if (account.status !== "ACTIVE") {
      await this.repository.recordAudit({
        tenantId: account.tenantId,
        actorType: "tenant_account",
        actorId: account.id,
        action: "auth.login_failed",
        summary: "登录失败：账号停用",
      });
      throw new AccountDisabledError();
    }
    const ok = await verifyPassword(password, account.passwordHash);
    if (!ok) {
      await this.repository.recordAudit({
        tenantId: account.tenantId,
        actorType: "tenant_account",
        actorId: account.id,
        action: "auth.login_failed",
        summary: "登录失败：密码错误",
      });
      throw new InvalidCredentialsError();
    }
    const bundle = await this.issue(this.tenantPrincipal(account));
    await this.repository.recordAudit({
      tenantId: account.tenantId,
      actorType: "tenant_account",
      actorId: bundle.principal.sub,
      action: "auth.login",
      resourceType: "tenant_account",
      resourceId: bundle.principal.sub,
      summary: `门店登录成功：${username}`,
    });
    return bundle;
  }

  async resolveTenantId(tenantCode: string): Promise<string | null> {
    return this.repository.findTenantIdByCode(tenantCode);
  }

  async phoneCustomerLogin(
    tenantId: string,
    phone: string,
  ): Promise<SessionBundle> {
    const phoneCipher = encryptPhone(tenantId, phone);
    let account = await this.repository.findTenantAccountByPhoneHash(
      tenantId,
      phoneCipher.mobileHash,
    );
    if (!account) {
      const randomPassword = randomBytes(18).toString("base64url");
      const passwordHash = await hashPassword(randomPassword);
      account = await this.repository.registerPhoneCustomer(tenantId, {
        username: `p${phoneCipher.mobileHash.slice(0, 16)}`,
        passwordHash,
        phoneEnc: phoneCipher.mobileEnc,
        phoneHash: phoneCipher.mobileHash,
        displayName: `用户${phone.slice(-4)}`,
      });
    }
    if (account.tenantStatus !== "ACTIVE") throw new TenantInactiveError();
    if (account.status !== "ACTIVE") throw new AccountDisabledError();
    if (!account.roles.includes("CUSTOMER")) {
      throw new InvalidCredentialsError();
    }
    const bundle = await this.issue(this.tenantPrincipal(account, "CUSTOMER"));
    await this.repository.recordAudit({
      tenantId: account.tenantId,
      actorType: "tenant_account",
      actorId: bundle.principal.sub,
      action: "auth.phone_login",
      resourceType: "tenant_account",
      resourceId: bundle.principal.sub,
      summary: `手机号登录/注册成功：${account.username}`,
    });
    return bundle;
  }

  /**
   * S3（A′ 口径）：微信登录即建号——首次不需要手机号，短信资质到位前也能先跑通试运营。
   * 账号身份键是 (tenantId, wechatOpenid)；手机号可在登录后补绑（S3c）。
   */
  async wechatCustomerLogin(
    tenantId: string,
    openid: string,
  ): Promise<SessionBundle> {
    let account = await this.repository.findTenantAccountByOpenid(
      tenantId,
      openid,
    );
    if (!account) {
      const randomPassword = randomBytes(18).toString("base64url");
      const passwordHash = await hashPassword(randomPassword);
      account = await this.repository.registerWechatCustomer(tenantId, {
        // 用 openid 的哈希前缀当用户名：确定且不会撞车，也不把 openid 明文写进用户名
        username: `w${createHash("sha256").update(openid).digest("hex").slice(0, 16)}`,
        passwordHash,
        wechatOpenid: openid,
        displayName: "微信用户",
      });
    }
    if (account.tenantStatus !== "ACTIVE") throw new TenantInactiveError();
    if (account.status !== "ACTIVE") throw new AccountDisabledError();
    if (!account.roles.includes("CUSTOMER")) {
      throw new InvalidCredentialsError();
    }
    const bundle = await this.issue(this.tenantPrincipal(account, "CUSTOMER"));
    await this.repository.recordAudit({
      tenantId: account.tenantId,
      actorType: "tenant_account",
      actorId: bundle.principal.sub,
      action: "auth.wechat_login",
      resourceType: "tenant_account",
      resourceId: bundle.principal.sub,
      summary: `微信登录成功：${account.username} openid=${maskOpenid(openid)}`,
    });
    return bundle;
  }

  /**
   * S3c-2：把已验证的手机号挂到**当前登录账号**上（A′ 口径下手机号是后补的）。
   *
   * 规则（都是为了让「一个人一个账号」）：
   * - 号码没人用 → 直接挂上，当前会话继续有效；
   * - 号码就是自己的 → 幂等；
   * - 号码属于另一个客户账号且那个账号没绑微信 → 把 openid 迁过去，并**换发那个账号的会话**
   *   （否则用户会留在没有订单的空账号里）；
   * - 号码属于另一个账号且已绑别的微信、或目标不是客户 → 拒绝（409），不做静默合并。
   *
   * 先验证短信码再动数据：验证失败时一行都不写。
   */
  async bindPhone(input: {
    tenantId: string;
    accountId: string;
    phone: string;
    code: string;
  }): Promise<{
    phoneTail: string;
    merged: boolean;
    session: SessionBundle | null;
  }> {
    const phoneCipher = encryptPhone(input.tenantId, input.phone);
    await this.phoneVerification.consumeCode(
      input.tenantId,
      input.phone,
      input.code,
      "register_login",
    );
    const account = await this.repository.findTenantAccountById(
      input.accountId,
      input.tenantId,
    );
    if (!account) throw new InvalidCredentialsError();
    if (account.tenantStatus !== "ACTIVE") throw new TenantInactiveError();
    if (account.status !== "ACTIVE") throw new AccountDisabledError();

    const phoneTail = input.phone.slice(-4);
    const existing = await this.repository.findTenantAccountByPhoneHash(
      input.tenantId,
      phoneCipher.mobileHash,
    );
    if (!existing) {
      await this.repository.setAccountPhone(input.tenantId, input.accountId, {
        phoneEnc: phoneCipher.mobileEnc,
        phoneHash: phoneCipher.mobileHash,
      });
      await this.repository.recordAudit({
        tenantId: input.tenantId,
        actorType: "tenant_account",
        actorId: input.accountId,
        action: "auth.bind_phone",
        resourceType: "tenant_account",
        resourceId: input.accountId,
        summary: `补绑手机号成功 phone_tail=****${phoneTail}`,
      });
      return { phoneTail, merged: false, session: null };
    }
    if (existing.id === input.accountId) {
      return { phoneTail, merged: false, session: null };
    }

    const callerOpenid = account.wechatOpenid ?? null;
    if (
      existing.wechatOpenid ||
      !callerOpenid ||
      !existing.roles.includes("CUSTOMER")
    ) {
      throw new PhoneAlreadyBoundError();
    }
    await this.repository.transferWechatOpenid(input.tenantId, {
      fromAccountId: input.accountId,
      toAccountId: existing.id,
    });
    const session = await this.issue(
      this.tenantPrincipal(
        { ...existing, wechatOpenid: callerOpenid },
        "CUSTOMER",
      ),
    );
    await this.repository.recordAudit({
      tenantId: input.tenantId,
      actorType: "tenant_account",
      actorId: session.principal.sub,
      action: "auth.bind_phone_merged",
      resourceType: "tenant_account",
      resourceId: existing.id,
      summary: `补绑手机号时合并到已有账号 ${existing.username} phone_tail=****${phoneTail}`,
    });
    return { phoneTail, merged: true, session };
  }

  async switchTenantContext(
    tenantId: string,
    accountId: string,
    context: RoleKey,
  ): Promise<SessionBundle> {
    const account = await this.repository.findTenantAccountById(
      accountId,
      tenantId,
    );
    if (!account) throw new InvalidCredentialsError();
    if (account.tenantStatus !== "ACTIVE") throw new TenantInactiveError();
    if (account.status !== "ACTIVE") throw new AccountDisabledError();
    if (!account.roles.includes(context)) {
      throw new InvalidCredentialsError();
    }
    const bundle = await this.issue(this.tenantPrincipal(account, context));
    await this.repository.recordAudit({
      tenantId: account.tenantId,
      actorType: "tenant_account",
      actorId: bundle.principal.sub,
      action: "auth.switch_context",
      resourceType: "tenant_account",
      resourceId: bundle.principal.sub,
      summary: `切换到 ${context}`,
    });
    return bundle;
  }

  private async issue(principal: AccessPrincipal): Promise<SessionBundle> {
    const refreshToken = this.tokens.createRefreshToken();
    const now = Date.now();
    await this.repository.createRefreshSession({
      subjectType: principal.scope,
      accountId: principal.sub,
      ...(principal.tenantId !== undefined
        ? { tenantId: principal.tenantId }
        : {}),
      tokenHash: this.tokens.hashRefreshToken(refreshToken),
      expiresAt: new Date(now + REFRESH_TOKEN_TTL_SECONDS * 1000),
    });
    return {
      accessToken: await this.tokens.signAccess(principal),
      refreshToken,
      principal,
      expiresInSeconds: ACCESS_TOKEN_TTL_SECONDS,
    };
  }

  async refresh(refreshToken: string, scope: Scope): Promise<SessionBundle> {
    const session = await this.repository.findRefreshSessionByTokenHash(
      this.tokens.hashRefreshToken(refreshToken),
    );
    if (
      !session ||
      session.revokedAt !== null ||
      session.expiresAt.getTime() < Date.now()
    ) {
      throw new InvalidRefreshTokenError();
    }
    if (session.subjectType !== scope) throw new InvalidRefreshTokenError();

    const account =
      scope === "platform"
        ? await this.repository.findPlatformAccountById(session.accountId)
        : await this.repository.findTenantAccountById(
            session.accountId,
            session.tenantId,
          );

    if (!account || account.status !== "ACTIVE") {
      await this.repository.revokeRefreshSession(session.id);
      throw new InvalidRefreshTokenError();
    }
    if (scope === "tenant") {
      const tenantAccount = account as TenantAccountRecord;
      if (tenantAccount.tenantStatus !== "ACTIVE") {
        await this.repository.revokeRefreshSession(session.id);
        throw new InvalidRefreshTokenError();
      }
    }

    const principal =
      scope === "platform"
        ? this.platformPrincipal(account as PlatformAccountRecord)
        : this.tenantPrincipal(account as TenantAccountRecord);

    await this.repository.revokeRefreshSession(session.id);
    return this.issue(principal);
  }

  async logout(refreshToken: string): Promise<void> {
    const session = await this.repository.findRefreshSessionByTokenHash(
      this.tokens.hashRefreshToken(refreshToken),
    );
    if (session) await this.repository.revokeRefreshSession(session.id);
  }

  verifyAccess(
    token: string,
    allowedAudiences: readonly string[],
  ): Promise<AccessPrincipal> {
    return this.tokens.verifyAccess(token, allowedAudiences);
  }
}
