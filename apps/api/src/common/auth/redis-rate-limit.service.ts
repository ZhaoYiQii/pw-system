import { Injectable, OnApplicationShutdown } from "@nestjs/common";
import { Redis } from "ioredis";

const INCR_SCRIPT = `
local count = redis.call("INCR", KEYS[1])
if count == 1 then
  redis.call("EXPIRE", KEYS[1], ARGV[1])
end
return count
`;

/**
 * 多实例共享的 Redis 登录限流（本地/测试未配置 REDIS_URL 时由
 * identity-access.module 退回内存 RateLimitService）。
 */
@Injectable()
export class RedisRateLimitService implements OnApplicationShutdown {
  private readonly redis: Redis;

  constructor(url: string) {
    this.redis = new Redis(url, {
      maxRetriesPerRequest: 1,
      connectTimeout: 2000,
      retryStrategy: (times: number) =>
        times > 5 ? null : Math.min(times * 200, 1000),
    });
    // 连接错误只影响限流降级，不应因 Redis 抖动把 API 进程打崩；
    // Redis 不可用时视为未超过阈值（fail-open 对登录可用性优先，
    // 生产通过 /ready redis 探测告警）。
    this.redis.on("error", () => {});
  }

  private key(name: string): string {
    return `pw:ratelimit:${name}`;
  }

  async isBlocked(
    key: string,
    limit: number,
    windowMs: number,
  ): Promise<boolean> {
    void windowMs;
    try {
      const current = await this.redis.get(this.key(key));
      return Number(current ?? "0") >= limit;
    } catch {
      return false;
    }
  }

  async recordFailure(key: string, windowMs: number): Promise<void> {
    try {
      await this.redis.eval(
        INCR_SCRIPT,
        1,
        this.key(key),
        String(Math.max(1, Math.ceil(windowMs / 1000))),
      );
    } catch {
      // Redis 不可用时跳过记录（fail-open）。
    }
  }

  async reset(key: string): Promise<void> {
    try {
      await this.redis.del(this.key(key));
    } catch {
      // ignore
    }
  }

  async resetAll(): Promise<void> {
    try {
      const stream = this.redis.scanStream({ match: "pw:ratelimit:*" });
      const keys: string[] = [];
      for await (const chunk of stream) keys.push(...(chunk as string[]));
      if (keys.length > 0) await this.redis.del(...keys);
    } catch {
      // ignore
    }
  }

  async ping(): Promise<boolean> {
    try {
      return (await this.redis.ping()) === "PONG";
    } catch {
      return false;
    }
  }

  async onApplicationShutdown(): Promise<void> {
    this.redis.disconnect();
  }
}
