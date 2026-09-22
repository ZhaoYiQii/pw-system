import {
  Controller,
  HttpCode,
  HttpException,
  HttpStatus,
  Inject,
  Post,
  Req,
} from "@nestjs/common";
// 装饰器签名里引用的类型必须用 import type（isolatedModules + emitDecoratorMetadata 的要求）
import type { RawBodyRequest } from "@nestjs/common";
import type { Request } from "express";
import { Public } from "../../../common/auth/decorators.js";
import { WechatPayNotificationService } from "../application/wechatpay-notification.service.js";
import {
  WechatPayDisabledError,
  WechatPayPayloadError,
  WechatPaySignatureError,
} from "../domain/payments.errors.js";

/**
 * S4-2：微信支付回调端点（服务商模式）。
 *
 * 官方应答口径（`/doc/v3/partner/4012085146.md`，原文）：
 * - **验签通过 → HTTP 200 或 204，无需返回应答报文**；
 * - 验签不通过 → 4XX 或 5XX，并返回应答报文；
 * - 「应答后再处理后面的业务逻辑（如更新订单状态），推荐异步处理」。
 *
 * 所以这里：只验签 + 落收件箱（快），成功后返回 **204 无内容**；
 * 解密与入账由 worker 走 `processPending()`，失败的行留在收件箱里重试。
 *
 * 需要 `NestFactory.create(AppModule, { rawBody: true })` 才能拿到未解析的原始报文做验签。
 */
@Controller("api/v1/payments/wechatpay")
export class WechatPayNotifyController {
  constructor(
    @Inject(WechatPayNotificationService)
    private readonly notifications: WechatPayNotificationService,
  ) {}

  @Public()
  @Post("notify")
  @HttpCode(HttpStatus.NO_CONTENT)
  async notify(@Req() req: RawBodyRequest<Request>): Promise<void> {
    const rawBody = req.rawBody?.toString("utf8") ?? "";
    if (!rawBody) {
      throw new HttpException("回调报文为空", HttpStatus.BAD_REQUEST);
    }
    try {
      await this.notifications.ingest({
        headers: req.headers as Record<string, string | undefined>,
        rawBody,
      });
    } catch (error) {
      if (error instanceof WechatPaySignatureError) {
        // 4xx + 报文：微信会重试（最多 15 次），配置修好后仍能补上
        throw new HttpException(error.message, HttpStatus.UNAUTHORIZED);
      }
      if (error instanceof WechatPayDisabledError) {
        throw new HttpException(error.message, HttpStatus.SERVICE_UNAVAILABLE);
      }
      if (error instanceof WechatPayPayloadError) {
        throw new HttpException(error.message, HttpStatus.BAD_REQUEST);
      }
      throw error;
    }
  }
}
