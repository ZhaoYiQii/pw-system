import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module.js";

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  // 仅当显式配置前端来源时启用 CORS（开发：ADMIN_WEB_ORIGIN/H5_ORIGIN）；默认关闭更安全。
  const allowedOrigins = [
    process.env.ADMIN_WEB_ORIGIN,
    process.env.H5_ORIGIN,
  ].filter((v): v is string => typeof v === "string" && v.length > 0);
  if (allowedOrigins.length > 0) {
    app.enableCors({ origin: allowedOrigins, credentials: true });
  }
  const port = Number(process.env.PORT ?? 3000);
  await app.listen(port);
}

void bootstrap();
