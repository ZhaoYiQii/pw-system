import type { PrismaClient } from "@pw/database";
import { FundAccountDuplicateCodeError } from "../domain/fund-account.js";
import type {
  FundAccountRecord,
  NormalizedFundAccountInput,
} from "../domain/fund-account.js";

/** Prisma 唯一约束冲突（每租户 code 唯一）。 */
function isUniqueViolation(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  return (error as { code?: unknown }).code === "P2002";
}

/** 只保留领域字段，丢掉 updatedAt/version 等表内实现细节。 */
function toRecord(row: FundAccountRecord): FundAccountRecord {
  return {
    id: row.id,
    tenantId: row.tenantId,
    code: row.code,
    name: row.name,
    kind: row.kind,
    status: row.status,
    externalRef: row.externalRef,
    createdAt: row.createdAt,
  };
}

export class PrismaFundAccountsRepository {
  constructor(private readonly client: PrismaClient) {}

  async list(tenantId: string): Promise<FundAccountRecord[]> {
    const rows = await this.client.fundAccount.findMany({
      where: { tenantId },
      orderBy: { createdAt: "asc" },
    });
    return rows.map(toRecord);
  }

  async create(
    tenantId: string,
    input: NormalizedFundAccountInput,
  ): Promise<FundAccountRecord> {
    try {
      const row = await this.client.fundAccount.create({
        data: {
          tenantId,
          code: input.code,
          name: input.name,
          kind: input.kind,
          status: "ACTIVE",
          externalRef: input.externalRef,
        },
      });
      return toRecord(row);
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new FundAccountDuplicateCodeError(
          `资金账户 code 已存在：${input.code}`,
        );
      }
      throw error;
    }
  }
}
