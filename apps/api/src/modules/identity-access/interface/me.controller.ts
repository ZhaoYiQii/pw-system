import {
  Body,
  Controller,
  Get,
  HttpException,
  HttpStatus,
  Inject,
  Post,
  Req,
  Res,
} from "@nestjs/common";
import type { Response } from "express";
import { PlatformScope, TenantScope } from "../../../common/auth/decorators.js";
import type { AuthenticatedRequest } from "../../../common/auth/auth.guard.js";
import { AuthService } from "../application/auth.service.js";
import {
  PhoneVerificationCodeMismatchError,
  PhoneVerificationConsumedError,
  PhoneVerificationExpiredError,
  PhoneVerificationInputError,
} from "../application/phone-verification.errors.js";
import {
  AccountDisabledError,
  InvalidCredentialsError,
  PhoneAlreadyBoundError,
  TenantInactiveError,
} from "../domain/errors.js";
import { setCsrfCookie, setRefreshCookie } from "./auth-cookies.js";

@Controller("api/v1")
export class MeController {
  constructor(@Inject(AuthService) private readonly auth: AuthService) {}

  @PlatformScope()
  @Get("platform/me")
  platformMe(@Req() req: AuthenticatedRequest) {
    return { data: req.principal };
  }

  @TenantScope()
  @Get("tenant/me")
  tenantMe(@Req() req: AuthenticatedRequest) {
    return { data: req.principal };
  }

  /**
   * S3c-2：补绑手机号（已登录状态下用短信码证明手机号归属）。
   * 若该手机号本身已有账号且没绑微信，则把微信身份并过去并换发那个账号的会话（`merged: true`）。
   * 短信通道未开通时前端不显示入口，但接口先就位。
   */
  @TenantScope()
  @Post("tenant/me/phone")
  async bindPhone(
    @Req() req: AuthenticatedRequest,
    @Res({ passthrough: true }) res: Response,
    @Body() body: { phone?: unknown; code?: unknown },
  ) {
    const tenantId = req.principal?.tenantId;
    const accountId = req.principal?.sub;
    if (!tenantId || !accountId) {
      throw new HttpException(
        "tenant context missing",
        HttpStatus.UNAUTHORIZED,
      );
    }
    const phone = typeof body.phone === "string" ? body.phone.trim() : "";
    const code = typeof body.code === "string" ? body.code.trim() : "";
    if (!phone || !code) {
      throw new HttpException("phone/code 必填", HttpStatus.BAD_REQUEST);
    }
    try {
      const result = await this.auth.bindPhone({
        tenantId,
        accountId,
        phone,
        code,
      });
      if (result.session) {
        setRefreshCookie(res, result.session.refreshToken);
        const csrfToken = setCsrfCookie(res);
        return {
          data: {
            phoneTail: result.phoneTail,
            merged: result.merged,
            accessToken: result.session.accessToken,
            principal: result.session.principal,
            expiresInSeconds: result.session.expiresInSeconds,
            csrfToken,
          },
        };
      }
      return { data: { phoneTail: result.phoneTail, merged: result.merged } };
    } catch (error) {
      if (error instanceof PhoneAlreadyBoundError) {
        throw new HttpException(error.message, HttpStatus.CONFLICT);
      }
      if (
        error instanceof PhoneVerificationInputError ||
        error instanceof PhoneVerificationExpiredError ||
        error instanceof PhoneVerificationCodeMismatchError ||
        error instanceof PhoneVerificationConsumedError
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
}
