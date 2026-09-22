import { Logger, Module } from "@nestjs/common";
import { LocalStorageProvider } from "./local-storage.provider.js";
import type { StorageProvider } from "./storage-provider.js";

export const STORAGE_PROVIDER = "STORAGE_PROVIDER";

/**
 * 证据存储通道的选择。
 *
 * 语义**有意与支付/短信不同**：
 * - 未配置或 `local` → 本地磁盘实现；
 * - **未知取值 → 启动即报错**（防止写错名字悄悄退回本地盘）；
 * - **生产 + local → 只告警，不拒绝启动**：现有 `container-smoke` 与生产 compose 用的就是
 *   `EVIDENCE_ROOT` 本地盘，硬失败会直接打红 CI 与部署。多实例共享要靠 S5（对象存储）。
 */
export function resolveStorageProvider(): StorageProvider {
  const provider = process.env.STORAGE_PROVIDER ?? "local";
  if (provider !== "local") {
    throw new Error(
      `STORAGE_PROVIDER only supports 'local' until an object-storage adapter lands (S5); got '${provider}'`,
    );
  }
  if (process.env.NODE_ENV === "production") {
    new Logger("StorageProvider").warn(
      "生产环境使用本地磁盘存储证据：多实例或容器重建会丢文件；扩容前应接入对象存储（S5）",
    );
  }
  return new LocalStorageProvider();
}

@Module({
  providers: [
    { provide: STORAGE_PROVIDER, useFactory: resolveStorageProvider },
  ],
  exports: [STORAGE_PROVIDER],
})
export class StorageModule {}
