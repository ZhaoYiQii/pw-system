import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module.js";
import { parseAllowedOrigins } from "./common/http/cors-origins.js";

async function bootstrap(): Promise<void> {
  // rawBody: true —— 微信支付回调必须对**未解析的原始报文**验签（S4-2）。
  const app = await NestFactory.create(AppModule, { rawBody: true });
  // 仅当显式配置前端来源时启用 CORS（开发：ADMIN_WEB_ORIGIN/H5_ORIGIN）；默认关闭更安全。
  // 两个变量都支持逗号分隔多值（localhost 与 127.0.0.1 并存），见 parseAllowedOrigins。
  const allowedOrigins = parseAllowedOrigins(process.env);
  if (allowedOrigins.length > 0) {
    app.enableCors({ origin: allowedOrigins, credentials: true });
  }
  const port = Number(process.env.PORT ?? 3000);
  await app.listen(port);
}

void bootstrap();
