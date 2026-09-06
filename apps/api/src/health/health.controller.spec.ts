import "reflect-metadata";
import { describe, expect, it } from "vitest";
import { HealthController } from "./health.controller.js";

describe("HealthController", () => {
  it("reports ok for the api service", async () => {
    const controller = new HealthController({
      checks: async () => ({ database: "up", redis: "skipped" }),
    } as never);
    expect(await controller.getHealth()).toEqual({
      status: "ok",
      service: "api",
      checks: { database: "up", redis: "skipped" },
    });
  });
});
