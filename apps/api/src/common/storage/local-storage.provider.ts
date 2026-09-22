import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import type { StorageProvider } from "./storage-provider.js";

/**
 * 本地磁盘实现（开发、单实例与现有生产 compose 使用）。
 *
 * 根目录仍是 `EVIDENCE_ROOT`（默认 `<cwd>/data/evidence`），与改造前完全一致，
 * 因此已存在的证据文件无需迁移。
 */
export class LocalStorageProvider implements StorageProvider {
  readonly kind = "local" as const;
  private readonly root: string;

  constructor(root?: string) {
    this.root =
      root ??
      process.env.EVIDENCE_ROOT ??
      path.join(process.cwd(), "data", "evidence");
  }

  /** key 由服务端生成，但仍做前缀校验：避免将来有人把外部输入接到这里（同 H5 静态服务那次逃逸）。 */
  private resolveKey(key: string): string {
    const rootResolved = path.resolve(this.root);
    const full = path.resolve(rootResolved, key);
    if (full !== rootResolved && !full.startsWith(rootResolved + path.sep)) {
      throw new Error(`storage key escapes root: ${key}`);
    }
    return full;
  }

  // 本地实现用不到 mimeType（文件类型由调用方 detect 后写进 DB），故不声明第三个参数；
  // 接口仍要求它存在，实现方允许少声明参数。
  async put(key: string, bytes: Buffer): Promise<void> {
    const full = this.resolveKey(key);
    await mkdir(path.dirname(full), { recursive: true });
    await writeFile(full, bytes, { flag: "wx" });
  }

  async read(key: string): Promise<Buffer> {
    return readFile(this.resolveKey(key));
  }

  async remove(key: string): Promise<void> {
    await rm(this.resolveKey(key), { force: true });
  }
}
