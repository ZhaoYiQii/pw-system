/**
 * S4-7b：门店**可见对账**的仓储端口（接口隔离，便于单测注入假实现）。
 *
 * 对账数据本来只给后台任务用（S4-3 拉账单 → 比对本地账本 → 落差异表），
 * 但**差异最终是门店自己的账**：钱对不对得上，只有门店自己知道业务上发生了什么。
 * 所以这一片只做"读"——把账单文件与差异摆给门店看，不改任何对账结果。
 */

export interface ReconciliationStatementRow {
  id: string;
  billType: string;
  /** `@db.Date`：当天自然日（北京时间口径由拉账单那一侧保证）。 */
  billDate: Date;
  subMchid: string;
  totalCount: number;
  totalFen: bigint;
  downloadedAt: Date;
}

export interface ReconciliationDifferenceRow {
  id: string;
  /** `MISSING_LOCAL` / `MISSING_WECHAT` / `AMOUNT_MISMATCH` / `STATUS_MISMATCH`。 */
  kind: string;
  amountFen: bigint | null;
  detail: string | null;
  paymentOrderId: string | null;
  resolvedAt: Date | null;
  createdAt: Date;
}

export interface TenantReconciliationRepository {
  listStatements(input: {
    tenantId: string;
    limit: number;
  }): Promise<ReconciliationStatementRow[]>;
  /** **未解决优先**，同组内按时间倒序（已解决里按解决时间倒序）。 */
  listDifferences(input: {
    tenantId: string;
    limit: number;
  }): Promise<ReconciliationDifferenceRow[]>;
  /** 未解决差异总数：列表有 limit，徽标上的数字不能跟着被截断。 */
  countUnresolvedDifferences(tenantId: string): Promise<number>;
}
