import {
  normalizeCreateFundAccountInput,
  toFundAccountView,
} from "../domain/fund-account.js";
import type {
  FundAccountRepositoryPort,
  FundAccountView,
} from "../domain/fund-account.js";

/** 资金账户应用层：只编排领域规范化、仓储调用与视图转换。 */
export class FundAccountsService {
  constructor(private readonly repo: FundAccountRepositoryPort) {}

  async list(tenantId: string): Promise<FundAccountView[]> {
    const records = await this.repo.list(tenantId);
    return records.map(toFundAccountView);
  }

  /** tenantId 只来自服务端上下文；仓储抛出的领域错误原样上抛，不在此吞掉。 */
  async create(tenantId: string, input: unknown): Promise<FundAccountView> {
    const normalized = normalizeCreateFundAccountInput(input);
    return toFundAccountView(await this.repo.create(tenantId, normalized));
  }
}
