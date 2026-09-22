import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { LocalStorageProvider } from "./local-storage.provider.js";
import type { StorageProvider } from "./storage-provider.js";
import { resolveStorageProvider } from "./storage.module.js";

let roots: string[] = [];
async function tempRoot(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "pw-storage-"));
  roots.push(dir);
  return dir;
}

afterEach(async () => {
  for (const dir of roots) await rm(dir, { recursive: true, force: true });
  roots = [];
});

describe("S1b-1：证据存储通道", () => {
  it("本地实现 put / read / remove 往返一致，且 remove 幂等", async () => {
    // 走接口类型：真实调用方（控制器）注入的就是这个接口，少声明参数的实现细节不该泄漏到调用侧
    const storage: StorageProvider = new LocalStorageProvider(await tempRoot());
    const key = "tenant/slots/abc/pic.png";
    const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
    await storage.put(key, bytes, { mimeType: "image/png" });
    expect((await storage.read(key)).equals(bytes)).toBe(true);
    await storage.remove(key);
    await expect(storage.read(key)).rejects.toThrow();
    await expect(storage.remove(key)).resolves.toBeUndefined();
  });

  it("拒绝越出根目录的 key", async () => {
    const storage: StorageProvider = new LocalStorageProvider(await tempRoot());
    await expect(
      storage.put("../escape.png", Buffer.from("x"), { mimeType: "image/png" }),
    ).rejects.toThrow(/escapes root/);
  });

  it("未知 STORAGE_PROVIDER 取值启动即失败，并在错误里点名变量", () => {
    const saved = process.env.STORAGE_PROVIDER;
    process.env.STORAGE_PROVIDER = "oss";
    try {
      expect(() => resolveStorageProvider()).toThrowError(/STORAGE_PROVIDER/);
    } finally {
      if (saved === undefined) delete process.env.STORAGE_PROVIDER;
      else process.env.STORAGE_PROVIDER = saved;
    }
  });

  it("未配置时走本地实现；生产环境同样返回本地实现（只告警，不拒绝启动）", () => {
    const savedProvider = process.env.STORAGE_PROVIDER;
    const savedNodeEnv = process.env.NODE_ENV;
    delete process.env.STORAGE_PROVIDER;
    try {
      expect(resolveStorageProvider().kind).toBe("local");
      process.env.NODE_ENV = "production";
      // 生产选 local 不硬失败：现有 container-smoke / 生产 compose 用的就是本地盘
      expect(resolveStorageProvider().kind).toBe("local");
    } finally {
      if (savedProvider === undefined) delete process.env.STORAGE_PROVIDER;
      else process.env.STORAGE_PROVIDER = savedProvider;
      if (savedNodeEnv === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = savedNodeEnv;
    }
  });
});
