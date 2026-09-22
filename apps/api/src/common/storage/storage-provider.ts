/**
 * 证据文件的存储通道（S1b）。
 *
 * 为什么需要它：证据（报单/计时的截图与录屏）是结算与争议的唯一凭据，而当前两个控制器
 * 各自直接读写本地磁盘。单实例可用，但多实例或容器重建会丢文件、或互相看不到——
 * 上线到云服务器并扩容之前，必须把「存哪」抽出来，之后用对象存储实现替换（S5）。
 */
export type StorageProviderKind = "local" | "object";

export interface PutObjectOptions {
  mimeType: string;
}

export interface StorageProvider {
  readonly kind: StorageProviderKind;
  /** 写入对象；key 由调用方生成（含 uuid），同 key 重复写入按冲突处理。 */
  put(key: string, bytes: Buffer, options: PutObjectOptions): Promise<void>;
  read(key: string): Promise<Buffer>;
  /** 幂等删除：对象不存在时不报错。 */
  remove(key: string): Promise<void>;
}
