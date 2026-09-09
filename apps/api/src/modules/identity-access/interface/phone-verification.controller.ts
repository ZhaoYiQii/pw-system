import {
  Body,
  Controller,
  HttpException,
  HttpStatus,
  Inject,
  Post,
  Req,
} from "@nestjs/common";
import type { Request } from "express";
import { Public } from "../../../common/auth/decorators.js";
import { RateLimitService } from "../../../common/auth/rate-limit.service.js";
import { AuthService } from "../application/auth.service.js";
import { PhoneVerificationService } from "../application/phone-verification.service.js";
import {
  PhoneVerificationCodeMismatchError,
  PhoneVerificationConsumedError,
  PhoneVerificationExpiredError,
  PhoneVerificationInputError,
  PhoneVerificationThrottledError,
} from "../application/phone-verification.errors.js";

const CODE_RATE_WINDOW_MS = 60 * 1000;
const CODE_RATE_MAX = 3;

@Controller("api/v1/auth")
export class PhoneVerificationController {
  constructor(
    @Inject(PhoneVerificationService)
    private readonly phoneVerification: PhoneVerificationService,
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(RateLimitService) private readonly rateLimit: RateLimitService,
  ) {}

  @Public()
  @Post("phone-verification-code")
  async sendCode(
    @Req() req: Request,
    @Body() body: { tenantCode?: unknown; phone?: unknown },
  ) {
    const tenantCode =
      typeof body.tenantCode === "string" && body.tenantCode.trim()
        ? body.tenantCode.trim()
        : "";
    const phone =
      typeof body.phone === "string" && body.phone.trim()
        ? body.phone.trim()
        : "";
    if (!tenantCode || !phone) {
      throw new HttpException(
        "tenantCode/phone 必填",
        HttpStatus.BAD_REQUEST,
      );
    }
    const rateKey = `${req.ip ?? "unknown"}:phone-code:${phone}`;
    if (
      await this.rateLimit.isBlocked(
        rateKey,
        CODE_RATE_MAX,
        CODE_RATE_WINDOW_MS,
      )
    ) {
      throw new HttpException(
        "发送过于频繁",
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    const tenantId = await this.auth.resolveTenantId(tenantCode);
    if (!tenantId) {
      throw new HttpException("门店不存在", HttpStatus.NOT_FOUND);
    }
    try {
      const result = await this.phoneVerification.sendCode(
        tenantId,
        phone,
        "register_login",
      );
      await this.rateLimit.reset(rateKey);
      return {
        data: {
          ...(result.debugCode ? { debugCode: result.debugCode } : {}),
          expiresInSeconds: 300,
          resendAfterSeconds: 60,
        },
      };
    } catch (error) {
      if (error instanceof PhoneVerificationInputError) {
        throw new HttpException(error.message, HttpStatus.BAD_REQUEST);
      }
      if (error instanceof PhoneVerificationThrottledError) {
        throw new HttpException(
          error.message,
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }
      if (
        error instanceof PhoneVerificationExpiredError ||
        error instanceof PhoneVerificationCodeMismatchError ||
        error instanceof PhoneVerificationConsumedError
      ) {
        throw new HttpException(error.message, HttpStatus.BAD_REQUEST);
      }
      throw error;
    }
  }
}
