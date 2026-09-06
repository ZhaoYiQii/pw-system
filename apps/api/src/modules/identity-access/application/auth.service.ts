import { AccountDisabledError, InvalidCredentialsError, InvalidRefreshTokenError } from "../domain/errors.js";
import type { AccessPrincipal, Scope } from "../domain/principal.js";
import type { RoleKey } from "../domain/roles.js";
import { verifyPassword } from "../infrastructure/password.js";
import { ACCESS_TOKEN_TTL_SECONDS, REFRESH_TOKEN_TTL_SECONDS, TokenService } from "../infrastructure/tokens.js";
import type { AuthRepository, PlatformAccountRecord, TenantAccountRecord } from "./auth-ports.js";

export interface SessionBundle {
  accessToken: string;
  refreshToken: string;
  principal: AccessPrincipal;
  expiresInSeconds: number;
}

export class AuthService {
  constructor(
    private readonly repository: AuthRepository,
    private readonly tokens: TokenService
  ) {}

  private platformPrincipal(account: PlatformAccountRecord): AccessPrincipal {
    return {
      sub: account.id,
      scope: "platform",
      role: account.role as RoleKey,
      username: account.username
    };
  }

  private tenantPrincipal(account: TenantAccountRecord): AccessPrincipal {
    const role = (account.roles[0] ?? "CUSTOMER") as RoleKey;
    return {
      sub: account.id,
      scope: "tenant",
      role,
      username: account.username,
      tenantId: account.tenantId
    };
  }

  async loginPlatform(username: string, password: string): Promise<SessionBundle> {
    const account = await this.repository.findPlatformAccountByUsername(username);
    if (!account) throw new InvalidCredentialsError();
    if (account.status !== "ACTIVE") throw new AccountDisabledError();
    const ok = await verifyPassword(password, account.passwordHash);
    if (!ok) throw new InvalidCredentialsError();
    return this.issue(this.platformPrincipal(account));
  }

  async loginTenant(tenantCode: string, username: string, password: string): Promise<SessionBundle> {
    const account = await this.repository.findTenantAccountByCodeAndUsername(tenantCode, username);
    if (!account) throw new InvalidCredentialsError();
    if (account.status !== "ACTIVE") throw new AccountDisabledError();
    const ok = await verifyPassword(password, account.passwordHash);
    if (!ok) throw new InvalidCredentialsError();
    return this.issue(this.tenantPrincipal(account));
  }

  private async issue(principal: AccessPrincipal): Promise<SessionBundle> {
    const refreshToken = this.tokens.createRefreshToken();
    const now = Date.now();
    await this.repository.createRefreshSession({
      subjectType: principal.scope,
      accountId: principal.sub,
      ...(principal.tenantId !== undefined ? { tenantId: principal.tenantId } : {}),
      tokenHash: this.tokens.hashRefreshToken(refreshToken),
      expiresAt: new Date(now + REFRESH_TOKEN_TTL_SECONDS * 1000)
    });
    return {
      accessToken: await this.tokens.signAccess(principal),
      refreshToken,
      principal,
      expiresInSeconds: ACCESS_TOKEN_TTL_SECONDS
    };
  }

  async refresh(refreshToken: string, scope: Scope): Promise<SessionBundle> {
    const session = await this.repository.findRefreshSessionByTokenHash(
      this.tokens.hashRefreshToken(refreshToken)
    );
    if (!session || session.revokedAt !== null || session.expiresAt.getTime() < Date.now()) {
      throw new InvalidRefreshTokenError();
    }
    if (session.subjectType !== scope) throw new InvalidRefreshTokenError();

    const account =
      scope === "platform"
        ? await this.repository.findPlatformAccountById(session.accountId)
        : await this.repository.findTenantAccountById(session.accountId);

    if (!account || account.status !== "ACTIVE") {
      await this.repository.revokeRefreshSession(session.id);
      throw new InvalidRefreshTokenError();
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
      this.tokens.hashRefreshToken(refreshToken)
    );
    if (session) await this.repository.revokeRefreshSession(session.id);
  }

  verifyAccess(token: string, allowedAudiences: readonly string[]): Promise<AccessPrincipal> {
    return this.tokens.verifyAccess(token, allowedAudiences);
  }
}
