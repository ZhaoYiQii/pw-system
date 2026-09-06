import { Injectable } from "@nestjs/common";

interface Bucket {
  count: number;
  windowStart: number;
}

/** 单实例内存限流（开发/单机）。多实例部署需换 Redis（主规格 9/17 队列与 Redis 在对应切片引入）。 */
@Injectable()
export class RateLimitService {
  private readonly buckets = new Map<string, Bucket>();

  /** 登录失败计数，超过阈值返回 true（触发 429）。成功登录应调用 reset。 */
  isBlocked(key: string, limit: number, windowMs: number): boolean {
    const now = Date.now();
    const bucket = this.buckets.get(key);
    if (!bucket) return false;
    if (now - bucket.windowStart >= windowMs) {
      this.buckets.delete(key);
      return false;
    }
    return bucket.count >= limit;
  }

  recordFailure(key: string, windowMs: number): void {
    const now = Date.now();
    const bucket = this.buckets.get(key);
    if (!bucket || now - bucket.windowStart >= windowMs) {
      this.buckets.set(key, { count: 1, windowStart: now });
      return;
    }
    bucket.count += 1;
  }

  reset(key: string): void {
    this.buckets.delete(key);
  }

  resetAll(): void {
    this.buckets.clear();
  }
}
