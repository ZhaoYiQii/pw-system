import "reflect-metadata";
import { describe, expect, it } from "vitest";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { AppModule } from "./app.module.js";

describe("AppModule (health endpoint)", () => {
  it("GET /health returns 200 with ok status", async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    const app = moduleRef.createNestApplication();
    await app.init();
    try {
      const response = await request(app.getHttpServer())
        .get("/health")
        .expect(200);
      expect(response.body).toMatchObject({
        status: "ok",
        service: "api",
        checks: { database: "up" },
      });
      // redis 取决于是否配置 REDIS_URL（本机无、CI 有）：不锁死 skipped，只要求是合法状态。
      expect(["up", "down", "skipped"]).toContain(
        (response.body as { checks?: { redis?: string } }).checks?.redis,
      );
    } finally {
      await app.close();
    }
  });
});
