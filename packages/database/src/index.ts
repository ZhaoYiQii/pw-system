import { PrismaPg } from "@prisma/adapter-pg";
import { Prisma, PrismaClient } from "./generated/prisma/client.js";

export type { Prisma, PrismaClient };

export type DbTransaction = Prisma.TransactionClient;

/**
 * 创建 Prisma Client（Prisma 7 SQL provider 需要 driver adapter）。
 * 每个进程应只创建一个实例（连接池），见官方 prisma-client-setup。
 */
export function createDatabaseClient(connectionString: string): PrismaClient {
  const adapter = new PrismaPg({ connectionString });
  return new PrismaClient({ adapter });
}

/**
 * 在单个数据库事务中设置租户上下文并执行业务回调。
 * - 使用 `set_config('app.tenant_id', ..., true)`（等价 SET LOCAL），仅对当前事务生效；
 * - RLS policy 依据该 GUC 过滤/校验，未设置时返回 ''，默认拒绝（主规格 8.1/8.2）。
 * 注意：所有查询必须使用回调中的 tx，禁止在事务外使用全局 client。
 */
export async function withTenantContext<T>(
  client: PrismaClient,
  tenantId: string,
  fn: (tx: DbTransaction) => Promise<T>
): Promise<T> {
  return client.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, true)`;
    return fn(tx);
  });
}
