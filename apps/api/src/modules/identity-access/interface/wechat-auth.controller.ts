import {
  Body,
  Controller,
  Get,
  HttpException,
  HttpStatus,
  Inject,
  Logger,
  Post,
  Query,
  Req,
  Res,
} from "@nestjs/common";
import type { Request, Response } from "express";
import { Public } from "../../../common/auth/decorators.js";
import { RateLimitService } from "../../../common/auth/rate-limit.service.js";
import {
  AccountDisabledError,
  InvalidCredentialsError,
  TenantInactiveError,
} from "../domain/errors.js";
import {
  WechatAuthService,
  WechatLoginDisabledError,
  WechatStateMismatchError,
  WechatTenantNotFoundError,
} from "../application/wechat-auth.service.js";
import { WechatOauthError } from "../infrastructure/wechat-oauth.client.js";
import { WechatStateError } from "../infrastructure/wechat-state.js";
import { setCsrfCookie, setRefreshCookie } from "./auth-cookies.js";

const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_MAX_FAILURES = 10;

function requiredString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new HttpException(`${field} 必填`, HttpStatus.BAD_REQUEST);
  }
  return value.trim();
}

@Controller("api/v1/auth/wechat")
export class WechatAuthController {
  private readonly logger = new Logger(WechatAuthController.name);

  constructor(
    @Inject(WechatAuthService) private readonly wechat: WechatAuthService,
    @Inject(RateLimitService) private readonly rateLimit: RateLimitService,
  ) {}

  /** 302 跳到微信授权页（state 是签名的，returnTo 已白名单化）。 */
  @Public()
  @Get("authorize")
  async authorize(
    @Res() res: Response,
    @Query("tenantCode") tenantCode?: unknown,
    @Query("returnTo") returnTo?: unknown,
  ): Promise<void> {
    const code = requiredString(tenantCode, "tenantCode");
    try {
      const url = await this.wechat.resolveAuthorizeUrl(code, returnTo);
      res.redirect(HttpStatus.FOUND, url);
    } catch (error) {
      this.rethrow(error);
    }
  }

  /** H5 入口页拿 `code`+`state` 换会话；未绑定 openid 的直接建号（A′ 口径）。 */
  @Public()
  @Post("login")
  async login(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @Body() body: { tenantCode?: unknown; code?: unknown; state?: unknown },
  ) {
    const tenantCode = requiredString(body.tenantCode, "tenantCode");
    const code = requiredString(body.code, "code");
    const state = requiredString(body.state, "state");
    const rateKey = `${req.ip ?? "unknown"}:wechat-login:${tenantCode}`;
    if (
      await this.rateLimit.isBlocked(
        rateKey,
        LOGIN_MAX_FAILURES,
        LOGIN_WINDOW_MS,
      )
    ) {
      throw new HttpException("尝试次数过多", HttpStatus.TOO_MANY_REQUESTS);
    }
    try {
      const { bundle, returnTo } = await this.wechat.loginWithCode({
        tenantCode,
        code,
        state,
      });
      await this.rateLimit.reset(rateKey);
      setRefreshCookie(res, bundle.refreshToken);
      const csrfToken = setCsrfCookie(res);
      return {
        data: {
          accessToken: bundle.accessToken,
          principal: bundle.principal,
          expiresInSeconds: bundle.expiresInSeconds,
          csrfToken,
          returnTo,
        },
      };
    } catch (error) {
      if (
        error instanceof WechatStateError ||
        error instanceof WechatStateMismatchError
      ) {
        // 只有「客户端带来的 state 不对」才计入失败次数；
        // 微信侧/传输侧故障不算用户的错，否则对方一抖就把用户锁在限流里。
        await this.rateLimit.recordFailure(rateKey, LOGIN_WINDOW_MS);
      }
      this.rethrow(error);
    }
  }

  /** 统一错误映射；原始微信报文只进日志，不给浏览器。 */
  private rethrow(error: unknown): never {
    if (error instanceof HttpException) throw error;
    if (error instanceof WechatLoginDisabledError) {
      throw new HttpException(error.message, HttpStatus.SERVICE_UNAVAILABLE);
    }
    if (error instanceof WechatTenantNotFoundError) {
      throw new HttpException("门店不存在", HttpStatus.NOT_FOUND);
    }
    if (
      error instanceof WechatStateError ||
      error instanceof WechatStateMismatchError
    ) {
      throw new HttpException(
        "登录状态已失效，请重新发起微信登录",
        HttpStatus.BAD_REQUEST,
      );
    }
    if (
      error instanceof InvalidCredentialsError ||
      error instanceof AccountDisabledError ||
      error instanceof TenantInactiveError
    ) {
      throw new HttpException(error.message, HttpStatus.UNAUTHORIZED);
    }
    if (error instanceof WechatOauthError) {
      this.logger.error(
        `微信网页授权失败 code=${String(error.code)} kind=${error.kind} detail=${error.message}`,
      );
      if (error.kind === "rate_limited") {
        throw new HttpException(
          "微信登录繁忙，请稍后再试",
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }
      if (error.kind === "retryable") {
        throw new HttpException(
          "微信登录暂时不可用，请稍后再试",
          HttpStatus.SERVICE_UNAVAILABLE,
        );
      }
      throw new HttpException(
        "微信登录失败，请重新发起",
        HttpStatus.BAD_REQUEST,
      );
    }
    throw error;
  }
}
