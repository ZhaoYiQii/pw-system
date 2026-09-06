import "reflect-metadata";
import { describe, expect, it } from "vitest";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { AppModule } from "./app.module.js";

describe("AppModule (health endpoint)", () => {
  it("GET /health returns 200 with ok status", async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    const app = moduleRef.createNestApplication();
    await app.init();
    try {
      const response = await request(app.getHttpServer()).get("/health").expect(200);
      expect(response.body).toEqual({ status: "ok", service: "api" });
    } finally {
      await app.close();
    }
  });
});
