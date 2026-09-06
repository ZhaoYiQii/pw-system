import { NestFactory } from "@nestjs/core";
import {
  DocumentBuilder,
  SwaggerModule,
  type OpenAPIObject,
} from "@nestjs/swagger";
import type { INestApplication } from "@nestjs/common";
import { AppModule } from "../app.module.js";

function operationId(controllerKey: string, methodKey: string): string {
  const controller = controllerKey.replace(/Controller$/, "");
  const prefix =
    controller.length > 0
      ? controller[0]?.toLowerCase() + controller.slice(1)
      : "api";
  return `${prefix}_${methodKey}`;
}

/** 生成 openapi 文档对象；仅用于契约生成/检查，不启动监听端口。 */
export async function buildApiDocument(): Promise<OpenAPIObject> {
  const app: INestApplication = await NestFactory.create(AppModule, {
    logger: false,
  });
  try {
    const options = new DocumentBuilder()
      .setTitle("陪玩门店多租户 SaaS API")
      .setDescription(
        "一期 API。金额字段一律为十进制字符串分（MoneyFen），禁止 number/浮点。",
      )
      .setVersion("1.0.0")
      .addBearerAuth(
        {
          type: "http",
          scheme: "bearer",
          bearerFormat: "JWT",
          description: "tenant/platform access token",
        },
        "access-token",
      )
      .build();
    return SwaggerModule.createDocument(app, options, {
      operationIdFactory: operationId,
    });
  } finally {
    await app.close();
  }
}
