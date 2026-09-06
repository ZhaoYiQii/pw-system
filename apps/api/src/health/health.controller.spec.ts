import "reflect-metadata";
import { describe, expect, it } from "vitest";
import { HealthController } from "./health.controller.js";

describe("HealthController", () => {
  it("reports ok for the api service", () => {
    expect(new HealthController().getHealth()).toEqual({
      status: "ok",
      service: "api",
    });
  });
});
