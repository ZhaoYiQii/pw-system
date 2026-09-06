import "reflect-metadata";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Test } from "@nestjs/testing";
import request from "supertest";
import type { INestApplication } from "@nestjs/common";
import { AppModule } from "../../apps/api/src/app.module.js";

describe("R2-a HTTP 错误结构与 /ready 门禁", () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    if (app) await app.close();
  });

  it("受保护接口未授权返回 RFC9457 风格错误且回显 x-request-id", async () => {
    const res = await request(app.getHttpServer())
      .get("/api/v1/tenant/orders")
      .set("x-request-id", "req-http-error-r2")
      .expect(401);
    expect(res.headers["x-request-id"]).toBe("req-http-error-r2");
    expect(res.body).toMatchObject({
      type: expect.any(String),
      title: "Unauthorized",
      status: 401,
      code: expect.any(String),
      message: expect.any(String),
      requestId: "req-http-error-r2",
    });
  });

  it("缺少 requestId 时自动生成并回写响应头", async () => {
    const res = await request(app.getHttpServer())
      .get("/api/v1/tenant/orders")
      .expect(401);
    expect(typeof res.headers["x-request-id"]).toBe("string");
    expect(res.headers["x-request-id"]).toHaveLength(36);
  });

  it("GET /ready 在测试库可达时返回 ready", async () => {
    const res = await request(app.getHttpServer()).get("/ready").expect(200);
    expect(res.body).toMatchObject({
      status: "ready",
      checks: { database: "up" },
    });
  });
});
