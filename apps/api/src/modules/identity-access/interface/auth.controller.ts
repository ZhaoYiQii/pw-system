import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpException,
  HttpStatus,
  Inject,
  Post,
  Req,
  Res,
} from "@nestjs/common";
import type { Request, Response } from "express";
import { AuthService } from "../application/auth.service.js";
import { PhoneVerificationService } from "../application/phone-verification.service.js";
import {
  PhoneVerificationCodeMismatchError,
  PhoneVerificationConsumedError,
  PhoneVerificationExpiredError,
  PhoneVerificationInputError,
} from "../application/phone-verification.errors.js";
import {
  Permissions,
  Public,
  TenantScope,
} from "../../../common/auth/decorators.js";
import { RateLimitService } from "../../../common/auth/rate-limit.service.js";
import type { AuthenticatedRequest } from "../../../common/auth/auth.guard.js";
import {
  AccountDisabledError,
  AuthInputError,
  ContextRoleMissingError,
  CurrentPasswordInvalidError,
  InvalidCredentialsError,
  InvalidRefreshTokenError,
  PhoneAlreadyBoundError,
  TenantInactiveError,
  TenantNotFoundError,
  UsernameTakenError,
} from "../domain/errors.js";
import type { Scope } from "../domain/principal.js";
import {
  REFRESH_COOKIE,
  clearRefreshCookie,
  readCookie,
  requireCsrf,
  setCsrfCookie,
  setRefreshCookie,
} from "./auth-cookies.js";

const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_MAX_FAILURES = 5;
const REGISTER_WINDOW_MS = 15 * 60 * 1000;
const REGISTER_MAX_ATTEMPTS = 5;

interface LoginBody {
  kind?: unknown;
  username?: unknown;
  password?: unknown;
  tenantCode?: unknown;
}

interface RegisterBody {
  tenantCode?: unknown;
  username?: unknown;
  password?: unknown;
  displayName?: unknown;
  phone?: unknown;
  code?: unknown;
}

interface TokenBody {
  scope?: unknown;
  refreshToken?: unknown;
}

interface PasswordBody {
  newPassword?: unknown;
  currentPassword?: unknown;
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new HttpException(field + " is required", HttpStatus.BAD_REQUEST);
  }
  return value;
}

function tenantIdOf(req: AuthenticatedRequest): string {
  const id = req.principal?.tenantId;
  if (!id)
    throw new HttpException("tenant context missing", HttpStatus.UNAUTHORIZED);
  return id;
}

function originAllowed(req: Request): boolean {
  const origin = req.headers.origin;
  if (!origin) return true;
  const hostOrigin = req.protocol + "://" + (req.headers.host ?? "");
  const allowed = new Set<string>();
  if (process.env.ADMIN_WEB_ORIGIN) allowed.add(process.env.ADMIN_WEB_ORIGIN);
  if (process.env.H5_ORIGIN) allowed.add(process.env.H5_ORIGIN);
  allowed.add(hostOrigin);
  return allowed.has(origin);
}

@Controller("api/v1/auth")
export class AuthController {
  constructor(
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(RateLimitService) private readonly rateLimit: RateLimitService,
    @Inject(PhoneVerificationService)
    private readonly phoneVerification: PhoneVerificationService,
  ) {}

  @Public()
  @Post("login")
  async login(
    @Body() body: LoginBody,
    @Req() req: AuthenticatedRequest,
    @Res({ passthrough: true }) res: Response,
  ) {
    const kind =
      body.kind === "platform"
        ? "platform"
        : body.kind === "tenant"
          ? "tenant"
          : null;
    if (!kind)
      throw new HttpException(
        "kind must be platform|tenant",
        HttpStatus.BAD_REQUEST,
      );
    const username = requiredString(body.username, "username");
    const password = requiredString(body.password, "password");
    const rateKey = (req.ip ?? "unknown") + ":" + kind + ":" + username;
    if (
      await this.rateLimit.isBlocked(
        rateKey,
        LOGIN_MAX_FAILURES,
        LOGIN_WINDOW_MS,
      )
    ) {
      throw new HttpException(
        "too many attempts",
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    try {
      const bundle =
        kind === "platform"
          ? await this.auth.loginPlatform(username, password)
          : await this.auth.loginTenant(
              requiredString(body.tenantCode, "tenantCode"),
              username,
              password,
            );
      await this.rateLimit.reset(rateKey);
      setRefreshCookie(res, bundle.refreshToken);
      const csrfToken = setCsrfCookie(res);
      return {
        data: {
          accessToken: bundle.accessToken,
          principal: bundle.principal,
          expiresInSeconds: bundle.expiresInSeconds,
          csrfToken,
        },
      };
    } catch (error) {
      if (
        error instanceof InvalidCredentialsError ||
        error instanceof AccountDisabledError ||
        error instanceof TenantInactiveError
      ) {
        await this.rateLimit.recordFailure(rateKey, LOGIN_WINDOW_MS);
        throw new HttpException(error.message, HttpStatus.UNAUTHORIZED);
      }
      if (error instanceof InvalidRefreshTokenError) {
        throw new HttpException(error.message, HttpStatus.UNAUTHORIZED);
      }
      throw error;
    }
  }

  @Public()
  @Post("phone-login")
  async phoneLogin(
    @Req() req: AuthenticatedRequest,
    @Res({ passthrough: true }) res: Response,
    @Body() body: { tenantCode?: unknown; phone?: unknown; code?: unknown },
  ) {
    const tenantCode = requiredString(body.tenantCode, "tenantCode");
    const phone = requiredString(body.phone, "phone");
    const code = requiredString(body.code, "code");
    const rateKey =
      (req.ip ?? "unknown") + ":phone-login:" + phone + ":" + tenantCode;
    if (
      await this.rateLimit.isBlocked(
        rateKey,
        LOGIN_MAX_FAILURES,
        LOGIN_WINDOW_MS,
      )
    ) {
      throw new HttpException("尝试次数过多", HttpStatus.TOO_MANY_REQUESTS);
    }
    const tenantId = await this.auth.resolveTenantId(tenantCode);
    if (!tenantId) {
      throw new HttpException("门店不存在", HttpStatus.NOT_FOUND);
    }
    try {
      await this.phoneVerification.consumeCode(
        tenantId,
        phone,
        code,
        "register_login",
      );
    } catch (error) {
      if (
        error instanceof PhoneVerificationInputError ||
        error instanceof PhoneVerificationExpiredError ||
        error instanceof PhoneVerificationCodeMismatchError ||
        error instanceof PhoneVerificationConsumedError
      ) {
        await this.rateLimit.recordFailure(rateKey, LOGIN_WINDOW_MS);
        throw new HttpException(error.message, HttpStatus.BAD_REQUEST);
      }
      throw error;
    }
    const bundle = await this.auth.phoneCustomerLogin(tenantId, phone);
    await this.rateLimit.reset(rateKey);
    setRefreshCookie(res, bundle.refreshToken);
    const csrfToken = setCsrfCookie(res);
    return {
      data: {
        accessToken: bundle.accessToken,
        principal: bundle.principal,
        expiresInSeconds: bundle.expiresInSeconds,
        csrfToken,
      },
    };
  }

  /**
   * SP2（spec §5.1）：租户内自助注册。
   *
   * 限流按「尝试次数」计数（§5.1）：成功也占额度，故无条件记一次——同一 IP 对同一门店
   * 15 分钟内最多 5 次注册尝试，第 6 次 429。这是有意的（防批量刷号），代价是成功注册后
   * 该 IP 在本窗口内不能再注册。
   */
  @Public()
  @Post("register")
  async register(
    @Req() req: AuthenticatedRequest,
    @Res({ passthrough: true }) res: Response,
    @Body() body: RegisterBody,
  ) {
    const tenantCode = requiredString(body.tenantCode, "tenantCode");
    const rateKey = (req.ip ?? "unknown") + ":register:" + tenantCode;
    if (
      await this.rateLimit.isBlocked(
        rateKey,
        REGISTER_MAX_ATTEMPTS,
        REGISTER_WINDOW_MS,
      )
    ) {
      throw new HttpException("尝试次数过多", HttpStatus.TOO_MANY_REQUESTS);
    }
    await this.rateLimit.recordFailure(rateKey, REGISTER_WINDOW_MS);
    try {
      const bundle = await this.auth.registerTenantCustomer({
        tenantCode,
        username: requiredString(body.username, "username"),
        password: requiredString(body.password, "password"),
        ...(typeof body.displayName === "string"
          ? { displayName: body.displayName }
          : {}),
        ...(typeof body.phone === "string" ? { phone: body.phone } : {}),
        ...(typeof body.code === "string" ? { code: body.code } : {}),
      });
      setRefreshCookie(res, bundle.refreshToken);
      const csrfToken = setCsrfCookie(res);
      return {
        data: {
          accessToken: bundle.accessToken,
          principal: bundle.principal,
          expiresInSeconds: bundle.expiresInSeconds,
          csrfToken,
        },
      };
    } catch (error) {
      if (
        error instanceof UsernameTakenError ||
        error instanceof PhoneAlreadyBoundError
      ) {
        throw new HttpException(error.message, HttpStatus.CONFLICT);
      }
      if (error instanceof TenantNotFoundError) {
        throw new HttpException(error.message, HttpStatus.NOT_FOUND);
      }
      if (error instanceof TenantInactiveError) {
        throw new HttpException(error.message, HttpStatus.FORBIDDEN);
      }
      if (
        error instanceof AuthInputError ||
        error instanceof PhoneVerificationInputError ||
        error instanceof PhoneVerificationExpiredError ||
        error instanceof PhoneVerificationCodeMismatchError ||
        error instanceof PhoneVerificationConsumedError
      ) {
        throw new HttpException(error.message, HttpStatus.BAD_REQUEST);
      }
      throw error;
    }
  }

  @TenantScope()
  @Permissions("tenant.view")
  @Post("switch-context")
  async switchContext(
    @Req() req: AuthenticatedRequest,
    @Res({ passthrough: true }) res: Response,
    @Body() body: { context?: unknown },
  ) {
    const context = String(body.context ?? "");
    if (context !== "CUSTOMER" && context !== "PLAYER") {
      throw new HttpException(
        "context must be CUSTOMER|PLAYER",
        HttpStatus.BAD_REQUEST,
      );
    }
    const tenantId = tenantIdOf(req);
    let bundle;
    try {
      bundle = await this.auth.switchTenantContext(
        tenantId,
        req.principal?.sub ?? "",
        context,
      );
    } catch (error) {
      // 账号已通过认证，只是缺少目标端角色：必须是 403，客户端据此提示
      // 「陪玩申请审核中」并保留会话，而不是把域错误升级成 500。
      if (error instanceof ContextRoleMissingError) {
        throw new HttpException(error.message, HttpStatus.FORBIDDEN);
      }
      // 会话本身不可继续（账号禁用 / 门店停用 / 账号已不存在）：401，
      // 客户端据此清 token 退回登录卡。消息不透出域错误原文。
      if (
        error instanceof AccountDisabledError ||
        error instanceof TenantInactiveError ||
        error instanceof InvalidCredentialsError
      ) {
        throw new HttpException(
          "登录状态已失效，请重新登录。",
          HttpStatus.UNAUTHORIZED,
        );
      }
      throw error;
    }
    setRefreshCookie(res, bundle.refreshToken);
    const csrfToken = setCsrfCookie(res);
    return {
      data: {
        accessToken: bundle.accessToken,
        principal: bundle.principal,
        expiresInSeconds: bundle.expiresInSeconds,
        csrfToken,
      },
    };
  }

  @Public()
  @Post("refresh")
  async refresh(
    @Body() body: TokenBody,
    @Req() req: AuthenticatedRequest,
    @Res({ passthrough: true }) res: Response,
  ) {
    const scope =
      body.scope === "tenant"
        ? ("tenant" as Scope)
        : body.scope === "platform"
          ? ("platform" as Scope)
          : null;
    if (!scope)
      throw new HttpException(
        "scope must be platform|tenant",
        HttpStatus.BAD_REQUEST,
      );
    const cookieToken = readCookie(req, REFRESH_COOKIE);
    if (!cookieToken) {
      throw new HttpException(
        "refresh token cookie required",
        HttpStatus.UNAUTHORIZED,
      );
    }
    if (!originAllowed(req)) {
      throw new HttpException(
        "cross-site request rejected",
        HttpStatus.FORBIDDEN,
      );
    }
    requireCsrf(req);
    try {
      const bundle = await this.auth.refresh(cookieToken, scope);
      setRefreshCookie(res, bundle.refreshToken);
      const csrfToken = setCsrfCookie(res);
      return {
        data: {
          accessToken: bundle.accessToken,
          principal: bundle.principal,
          expiresInSeconds: bundle.expiresInSeconds,
          csrfToken,
        },
      };
    } catch (error) {
      if (error instanceof InvalidRefreshTokenError) {
        throw new HttpException(error.message, HttpStatus.UNAUTHORIZED);
      }
      throw error;
    }
  }

  @Public()
  @Post("logout")
  async logout(
    @Req() req: AuthenticatedRequest,
    @Res({ passthrough: true }) res: Response,
  ) {
    const cookieToken = readCookie(req, REFRESH_COOKIE);
    if (!cookieToken) {
      clearRefreshCookie(res);
      return { data: { ok: true } };
    }
    if (!originAllowed(req)) {
      throw new HttpException(
        "cross-site request rejected",
        HttpStatus.FORBIDDEN,
      );
    }
    requireCsrf(req);
    await this.auth.logout(cookieToken);
    clearRefreshCookie(res);
    return { data: { ok: true } };
  }

  /**
   * SP2（spec §5.2）：设置/修改密码。不加 scope 装饰器 → platform 与 tenant 两种 audience 都接受，
   * 由 AuthGuard 保证未认证 401；「初次设置 / 修改」的分支判定在 AuthService.setPassword 内。
   * 错误映射按 §5.2 的错误集：400（入参、原密码）/ 401（未认证、账号或门店不可用）。
   */
  @Post("password")
  @HttpCode(HttpStatus.OK)
  async setPassword(
    @Req() req: AuthenticatedRequest,
    @Body() body: PasswordBody,
  ) {
    const principal = req.principal;
    if (!principal) {
      throw new HttpException("missing bearer token", HttpStatus.UNAUTHORIZED);
    }
    const newPassword = requiredString(body.newPassword, "newPassword");
    try {
      await this.auth.setPassword({
        scope: principal.scope,
        accountId: principal.sub,
        newPassword,
        ...(principal.tenantId !== undefined
          ? { tenantId: principal.tenantId }
          : {}),
        ...(typeof body.currentPassword === "string"
          ? { currentPassword: body.currentPassword }
          : {}),
      });
      return { data: { ok: true } };
    } catch (error) {
      if (
        error instanceof AuthInputError ||
        error instanceof CurrentPasswordInvalidError
      ) {
        throw new HttpException(error.message, HttpStatus.BAD_REQUEST);
      }
      if (
        error instanceof InvalidCredentialsError ||
        error instanceof AccountDisabledError ||
        error instanceof TenantInactiveError
      ) {
        throw new HttpException(error.message, HttpStatus.UNAUTHORIZED);
      }
      throw error;
    }
  }

  @Get("me")
  me(@Req() req: AuthenticatedRequest) {
    return { data: req.principal };
  }
}
