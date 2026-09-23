import type {
  ReconciliationDifferenceRow,
  ReconciliationStatementRow,
  TenantReconciliationRepository,
} from "./tenant-reconciliation-ports.js";
import { parseLedgerLimit } from "./payment-ledger.service.js";

/**
 * S4-7b：门店可见对账（账单文件 + 差异）。
 *
 * 三条口径：
 * 1. **只读**：这一片不判定、不修复差异，只把 S4-3 已经落库的事实翻译成中文摆出来；
 * 2. 差异类型的中文说明**在这里一处定义**（前端不再自己译，避免两处文案漂移）；
 * 3. 账单只展示最近几份（对账是"最近对不对得上"，不是历史归档页）；差异列表有上限，
 *    但**未解决总数用单独 count**，不能因为分页把徽标数字截断。
 */

export const RECONCILIATION_STATEMENT_LIMIT = 5;
export const RECONCILIATION_DIFFERENCE_LIMIT_DEFAULT = 50;

/** 差异类型 → 中文说明。认不出的 kind 原样透出（对账差异必须可追，不许被静默归类）。 */
export const DIFFERENCE_KIND_LABEL: Record<string, string> = {
  MISSING_LOCAL: "微信账单有、本地没有（可能漏记）",
  MISSING_WECHAT: "本地有、微信账单没有（可能多记）",
  AMOUNT_MISMATCH: "金额不一致",
  STATUS_MISMATCH: "状态不一致",
};

export interface ReconciliationStatementView {
  id: string;
  billType: string;
  /** `YYYY-MM-DD`。 */
  billDate: string;
  subMchid: string;
  totalCount: number;
  totalFen: string;
  downloadedAt: string;
}

export interface ReconciliationDifferenceView {
  id: string;
  kind: string;
  kindLabel: string;
  amountFen: string | null;
  detail: string | null;
  paymentOrderId: string | null;
  resolvedAt: string | null;
  createdAt: string;
}

export interface TenantReconciliationView {
  statements: ReconciliationStatementView[];
  differences: ReconciliationDifferenceView[];
  unresolvedCount: number;
}

export class TenantReconciliationService {
  constructor(private readonly repository: TenantReconciliationRepository) {}

  async overview(input: {
    tenantId: string;
    limit?: string;
  }): Promise<TenantReconciliationView> {
    // limit 的口径与支付台账共用一处（认不出就 400，不静默夹取）
    const limit = parseLedgerLimit(input.limit);
    const [statements, differences, unresolvedCount] = await Promise.all([
      this.repository.listStatements({
        tenantId: input.tenantId,
        limit: RECONCILIATION_STATEMENT_LIMIT,
      }),
      this.repository.listDifferences({ tenantId: input.tenantId, limit }),
      this.repository.countUnresolvedDifferences(input.tenantId),
    ]);
    return {
      statements: statements.map(toStatementView),
      differences: differences.map(toDifferenceView),
      unresolvedCount,
    };
  }
}

export function differenceKindLabel(kind: string): string {
  return DIFFERENCE_KIND_LABEL[kind] ?? `未识别差异类型：${kind}`;
}

export function toStatementView(
  row: ReconciliationStatementRow,
): ReconciliationStatementView {
  return {
    id: row.id,
    billType: row.billType,
    billDate: row.billDate.toISOString().slice(0, 10),
    subMchid: row.subMchid,
    totalCount: row.totalCount,
    totalFen: row.totalFen.toString(),
    downloadedAt: row.downloadedAt.toISOString(),
  };
}

export function toDifferenceView(
  row: ReconciliationDifferenceRow,
): ReconciliationDifferenceView {
  return {
    id: row.id,
    kind: row.kind,
    kindLabel: differenceKindLabel(row.kind),
    amountFen: row.amountFen?.toString() ?? null,
    detail: row.detail,
    paymentOrderId: row.paymentOrderId,
    resolvedAt: row.resolvedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}
