import { Module } from "@nestjs/common";
import { createDatabaseClient } from "@pw/database";
import { readFileSync } from "node:fs";
import { WechatPayNotificationService } from "./application/wechatpay-notification.service.js";
import {
  WechatPayPartnerClient,
  loadWechatPayPartnerConfig,
} from "./infrastructure/wechatpay-partner.client.js";
import { PrismaPaymentsRepository } from "./infrastructure/prisma-payments.repository.js";
import { WechatPayNotifyController } from "./interface/wechatpay-notify.controller.js";

export const PAYMENTS_PLATFORM_CLIENT = "PAYMENTS_PLATFORM_CLIENT";
export const PAYMENTS_RUNTIME_CLIENT = "PAYMENTS_RUNTIME_CLIENT";
export const WECHATPAY_PARTNER_CLIENT = "WECHATPAY_PARTNER_CLIENT";

/**
 * 微信支付通道**默认关闭**：未显式 `WXPAY_ENABLED=true` 时回调端点返回 503、
 * 不加载任何凭证——这样没有服务商凭证的部署（包括现在的本机与 CI）不会被新门禁打崩；
 * 一旦开启就要求 `WXPAY_*` 齐全，缺项启动即失败并点名变量。
 */
export function resolveWechatPayClient(): WechatPayPartnerClient | null {
  if (process.env.WXPAY_ENABLED !== "true") return null;
  return new WechatPayPartnerClient(
    loadWechatPayPartnerConfig({
      readFile: (path) => readFileSync(path, "utf8"),
    }),
  );
}

@Module({
  controllers: [WechatPayNotifyController],
  providers: [
    {
      provide: PAYMENTS_PLATFORM_CLIENT,
      useFactory: () => {
        const url = process.env.PLATFORM_DATABASE_URL;
        if (!url) throw new Error("PLATFORM_DATABASE_URL is not configured");
        return createDatabaseClient(url);
      },
    },
    {
      provide: PAYMENTS_RUNTIME_CLIENT,
      useFactory: () => {
        const url = process.env.DATABASE_URL;
        if (!url) throw new Error("DATABASE_URL (runtime) is not configured");
        return createDatabaseClient(url);
      },
    },
    { provide: WECHATPAY_PARTNER_CLIENT, useFactory: resolveWechatPayClient },
    {
      provide: PrismaPaymentsRepository,
      useFactory: (
        platform: ReturnType<typeof createDatabaseClient>,
        runtime: ReturnType<typeof createDatabaseClient>,
      ) => new PrismaPaymentsRepository(platform, runtime),
      inject: [PAYMENTS_PLATFORM_CLIENT, PAYMENTS_RUNTIME_CLIENT],
    },
    {
      provide: WechatPayNotificationService,
      useFactory: (
        repository: PrismaPaymentsRepository,
        client: WechatPayPartnerClient | null,
      ) => new WechatPayNotificationService(repository, client),
      inject: [PrismaPaymentsRepository, WECHATPAY_PARTNER_CLIENT],
    },
  ],
  exports: [WechatPayNotificationService],
})
export class PaymentsModule {}
