import "reflect-metadata";
import { Body, Controller, Module, Post } from "@nestjs/common";
import { APP_FILTER, APP_INTERCEPTOR } from "@nestjs/core";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { HttpErrorFilter } from "../http/http-error.filter.js";
import { ValidationInterceptor } from "./validation.interceptor.js";
import { routeValidations } from "./validation-registry.js";

@Controller("_validation_test")
class ValidationTestController {
  @Post()
  create(@Body() body: unknown): unknown {
    return { body };
  }
}

@Module({
  controllers: [ValidationTestController],
  providers: [
    { provide: APP_FILTER, useClass: HttpErrorFilter },
    { provide: APP_INTERCEPTOR, useClass: ValidationInterceptor },
  ],
})
class ValidationTestModule {}

describe("ValidationInterceptor（Zod 路由输入校验）", () => {
  it("未知字段被拒并返回 fieldErrors", async () => {
    routeValidations.set("POST /_validation_test", {
      body: z.strictObject({ name: z.string().min(1) }),
    });
    const moduleRef = await Test.createTestingModule({
      imports: [ValidationTestModule],
    }).compile();
    const app = moduleRef.createNestApplication();
    await app.init();
    try {
      const res = await request(app.getHttpServer())
        .post("/_validation_test")
        .send({ name: "ok", extra: 1 })
        .expect(400);
      expect(res.body).toMatchObject({
        type: "about:blank#validation-error",
        code: "ApiValidationError",
        fieldErrors: { $: [expect.stringContaining("Unrecognized key")] },
      });
    } finally {
      await app.close();
    }
  });
});
