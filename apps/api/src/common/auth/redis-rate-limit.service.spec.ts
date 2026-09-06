import { describe, expect, it } from "vitest";
import { RedisRateLimitService } from "./redis-rate-limit.service.js";

const url = process.env.REDIS_URL;
const maybe = url ? describe : describe.skip;

maybe("RedisRateLimitService（真实 Redis，需 REDIS_URL）", () => {
  it("多实例共享计数：达到阈值拦截，reset 恢复，ping 可达", async () => {
    const svc = new RedisRateLimitService(url as string);
    try {
      await svc.resetAll();
      const key = `unit:${Date.now()}`;
      expect(await svc.isBlocked(key, 3, 60_000)).toBe(false);
      for (let i = 0; i < 3; i += 1) {
        await svc.recordFailure(key, 60_000);
      }
      expect(await svc.isBlocked(key, 3, 60_000)).toBe(true);
      await svc.reset(key);
      expect(await svc.isBlocked(key, 3, 60_000)).toBe(false);
      expect(await svc.ping()).toBe(true);
    } finally {
      await svc.onApplicationShutdown();
    }
  });
});
