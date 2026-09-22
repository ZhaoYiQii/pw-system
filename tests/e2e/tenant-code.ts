/**
 * 门店 code 的统一读取（所有 e2e spec 共用）。
 *
 * 取值优先级：
 *   1. spec 专属变量 `<前缀>_E2E_TENANT_CODE`
 *   2. 历史别名 `<前缀>_TENANT_CODE`（例如早期的 W5_TENANT_CODE）
 *   3. 全局兜底 `E2E_TENANT_CODE`
 *   4. spec 内置默认值
 *
 * 为什么要全局兜底：本机换库时（例如 dev 库不可用、只能跑一次性测试库）只要设一个
 * `E2E_TENANT_CODE` 就能覆盖所有 spec，不必分别记住 S3_/S4_/W5_ 三个变量名——这正是
 * 之前每个 spec 各写一套 `process.env.X ?? "y"` 带来的实际困扰。
 * 注意各 spec 需要的夹具门店本来就不同（s3e2e / s4e2e / s5cwalk / c1），所以默认值必须按 spec 保留。
 */
export function tenantCode(prefix: string, fallback: string): string {
  return (
    process.env[`${prefix}_E2E_TENANT_CODE`] ??
    process.env[`${prefix}_TENANT_CODE`] ??
    process.env.E2E_TENANT_CODE ??
    fallback
  );
}
