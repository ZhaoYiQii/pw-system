import { Module } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { createDatabaseClient } from "@pw/database";
import { AuthGuard } from "../../common/auth/auth.guard.js";
import { PermissionsGuard } from "../../common/auth/permissions.guard.js";
import { EntitlementGuard } from "../../common/auth/entitlement.guard.js";
import { AuthService } from "./application/auth.service.js";
import { PrismaAuthRepository } from "./infrastructure/auth.repository.js";
import { TokenService } from "./infrastructure/tokens.js";
import { AuthController } from "./interface/auth.controller.js";
import { MeController } from "./interface/me.controller.js";
import { TenantAccountsController } from "./interface/tenant-accounts.controller.js";
import { PhoneVerificationController } from "./interface/phone-verification.controller.js";
import { TenantAccountsService } from "./application/tenant-accounts.service.js";
import { PhoneVerificationService } from "./application/phone-verification.service.js";
import { RateLimitService } from "../../common/auth/rate-limit.service.js";
import { RedisRateLimitService } from "../../common/auth/redis-rate-limit.service.js";
import { EntitlementsModule } from "../entitlements/entitlements.module.js";
import { Logger } from "@nestjs/common";
import type { SmsProvider } from "./domain/sms-provider.js";
import { MockSmsProvider } from "./infrastructure/mock-sms.provider.js";
import {
  resolveTencentSmsConfig,
  TencentSmsProvider,
} from "./infrastructure/tencent-sms.provider.js";
import {
  resolveWechatOauthConfig,
  WechatOauthClient,
} from "./infrastructure/wechat-oauth.client.js";
import { WechatStateService } from "./infrastructure/wechat-state.js";
import {
  WechatAuthService,
  type WechatLoginRuntime,
} from "./application/wechat-auth.service.js";
import { WechatAuthController } from "./interface/wechat-auth.controller.js";

export const AUTH_PLATFORM_CLIENT = "AUTH_PLATFORM_CLIENT";
export const AUTH_RUNTIME_CLIENT = "AUTH_RUNTIME_CLIENT";
export const SMS_PROVIDER = "SMS_PROVIDER";
export const WECHAT_LOGIN = "WECHAT_LOGIN";

/**
 * 短信通道装配（与 `wallet.module.ts` 的 `resolvePaymentProvider` 同范式）。
 * 导出以便单测直接钉住两条硬规则：**未知值不退回 mock**、**缺凭证启动即失败**。
 */
export function resolveSmsProvider(): SmsProvider {
  const provider = process.env.SMS_PROVIDER ?? "mock";
  if (provider === "tencent") {
    // 缺任一 TENCENT_SMS_* 会在这里抛出并点名变量，不允许带着半配置启动
    return new TencentSmsProvider(resolveTencentSmsConfig());
  }
  if (provider !== "mock") {
    throw new Error(
      `SMS_PROVIDER 不支持：${provider}（可选 mock | tencent；见 docs/runbooks/env-inventory.md）`,
    );
  }
  if (
    process.env.NODE_ENV === "production" &&
    process.env.ALLOW_MOCK_SMS !== "true"
  ) {
    throw new Error(
      "mock sms is not allowed in production unless ALLOW_MOCK_SMS=true (demo only)",
    );
  }
  return new MockSmsProvider(new Logger("SmsProvider"));
}

/**
 * 微信登录运行态。**默认关闭**：未显式 `WECHAT_LOGIN_ENABLED=true` 时端点返回 503，
 * 这样没有公众号凭证的部署不会被新门禁打崩；一旦启用就要求变量齐全，缺项启动即失败。
 */
export function resolveWechatLogin(): WechatLoginRuntime {
  if (process.env.WECHAT_LOGIN_ENABLED !== "true") return { enabled: false };
  const secret = process.env.SESSION_SECRET;
  if (!secret) throw new Error("SESSION_SECRET is not configured");
  return {
    enabled: true,
    client: new WechatOauthClient(resolveWechatOauthConfig()),
    state: new WechatStateService(secret),
  };
}

@Module({
  imports: [EntitlementsModule],
  controllers: [
    AuthController,
    MeController,
    TenantAccountsController,
    PhoneVerificationController,
    WechatAuthController,
  ],
  providers: [
    {
      provide: SMS_PROVIDER,
      useFactory: resolveSmsProvider,
    },
    { provide: WECHAT_LOGIN, useFactory: resolveWechatLogin },
    {
      provide: WechatAuthService,
      useFactory: (runtime: WechatLoginRuntime, auth: AuthService) =>
        new WechatAuthService(runtime, auth),
      inject: [WECHAT_LOGIN, AuthService],
    },
    {
      provide: AUTH_PLATFORM_CLIENT,
      useFactory: () => {
        const url = process.env.PLATFORM_DATABASE_URL;
        if (!url) throw new Error("PLATFORM_DATABASE_URL is not configured");
        return createDatabaseClient(url);
      },
    },
    {
      provide: AUTH_RUNTIME_CLIENT,
      useFactory: () => {
        const url = process.env.DATABASE_URL;
        if (!url) throw new Error("DATABASE_URL (runtime) is not configured");
        return createDatabaseClient(url);
      },
    },
    {
      provide: TokenService,
      useFactory: () => {
        const secret = process.env.SESSION_SECRET;
        if (!secret) throw new Error("SESSION_SECRET is not configured");
        return new TokenService(secret);
      },
    },
    {
      provide: PrismaAuthRepository,
      useFactory: (
        client: ReturnType<typeof createDatabaseClient>,
        runtimeClient: ReturnType<typeof createDatabaseClient>,
      ) => new PrismaAuthRepository(client, runtimeClient),
      inject: [AUTH_PLATFORM_CLIENT, AUTH_RUNTIME_CLIENT],
    },
    {
      provide: AuthService,
      useFactory: (repo: PrismaAuthRepository, tokens: TokenService) =>
        new AuthService(repo, tokens),
      inject: [PrismaAuthRepository, TokenService],
    },
    {
      provide: TenantAccountsService,
      useFactory: (runtimeClient: ReturnType<typeof createDatabaseClient>) =>
        new TenantAccountsService(runtimeClient),
      inject: [AUTH_RUNTIME_CLIENT],
    },
    {
      provide: PhoneVerificationService,
      useFactory: (
        runtimeClient: ReturnType<typeof createDatabaseClient>,
        sms: SmsProvider,
      ) => new PhoneVerificationService(runtimeClient, sms),
      inject: [AUTH_RUNTIME_CLIENT, SMS_PROVIDER],
    },
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_GUARD, useClass: PermissionsGuard },
    { provide: APP_GUARD, useClass: EntitlementGuard },
    {
      // 多实例共享限流：配置 REDIS_URL 时用 Redis，否则退回进程内存实现。
      provide: RateLimitService,
      useFactory: () => {
        const url = process.env.REDIS_URL;
        return url ? new RedisRateLimitService(url) : new RateLimitService();
      },
    },
  ],
  exports: [AuthService, RateLimitService, PhoneVerificationService],
})
export class IdentityAccessModule {}
