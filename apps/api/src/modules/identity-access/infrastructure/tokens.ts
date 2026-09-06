import { jwtVerify, SignJWT } from "jose";
import { createHash, randomBytes } from "node:crypto";
import { UnauthorizedError } from "../domain/errors.js";
import type { AccessPrincipal, Scope } from "../domain/principal.js";

const ISSUER = "pw-saas-api";
export const AUD_PLATFORM = "pw-platform";
export const AUD_TENANT = "pw-tenant";
export const ACCESS_TOKEN_TTL_SECONDS = 15 * 60;
export const REFRESH_TOKEN_TTL_SECONDS = 14 * 24 * 60 * 60;

interface TokenClaims {
  sub: string;
  iss: string;
  aud: string;
  exp: number;
  iat: number;
  jti: string;
  scope: Scope;
  role: string;
  username: string;
  tenantId?: string;
}

export class TokenService {
  private readonly key: Uint8Array;

  constructor(secret: string) {
    if (secret.length < 32) {
      throw new Error("SESSION_SECRET must be at least 32 characters");
    }
    this.key = new TextEncoder().encode(secret);
  }

  async signAccess(principal: AccessPrincipal): Promise<string> {
    const aud = principal.scope === "platform" ? AUD_PLATFORM : AUD_TENANT;
    const now = Math.floor(Date.now() / 1000);
    return new SignJWT({
      scope: principal.scope,
      role: principal.role,
      username: principal.username,
      ...(principal.tenantId !== undefined
        ? { tenantId: principal.tenantId }
        : {}),
    })
      .setProtectedHeader({ alg: "HS256", typ: "JWT" })
      .setSubject(principal.sub)
      .setIssuer(ISSUER)
      .setAudience(aud)
      .setJti(randomBytes(12).toString("hex"))
      .setIssuedAt(now)
      .setExpirationTime(now + ACCESS_TOKEN_TTL_SECONDS)
      .sign(this.key);
  }

  /** 校验签名/issuer/audience/expiration（主规格 16.1）；audience 必须在允许列表内。 */
  async verifyAccess(
    token: string,
    allowedAudiences: readonly string[],
  ): Promise<AccessPrincipal> {
    let payload: TokenClaims;
    try {
      const { payload: p } = await jwtVerify(token, this.key, {
        issuer: ISSUER,
        audience: allowedAudiences as unknown as string,
      });
      payload = p as unknown as TokenClaims;
    } catch {
      throw new UnauthorizedError("invalid or expired access token");
    }
    if (!allowedAudiences.includes(payload.aud)) {
      throw new UnauthorizedError("invalid audience");
    }
    return {
      sub: payload.sub,
      scope: payload.scope,
      role: payload.role as AccessPrincipal["role"],
      username: payload.username,
      ...(payload.tenantId !== undefined ? { tenantId: payload.tenantId } : {}),
    };
  }

  createRefreshToken(): string {
    return randomBytes(48).toString("base64url");
  }

  hashRefreshToken(token: string): string {
    return createHash("sha256").update(token).digest("hex");
  }
}
