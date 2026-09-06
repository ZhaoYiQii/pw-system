import type { DbTransaction, PrismaClient } from "@pw/database";
import { withTenantContext } from "@pw/database";

type RepoLike = { client: unknown };

/**
 * A4：为租户数据仓库生成“租户守护代理”。
 * - 每个方法调用在 withTenantContext(client, tenantId, ...) 事务内执行（SET LOCAL app.tenant_id）；
 * - 事务连接通过“方法接收者副本”注入，不修改共享实例，避免并发请求互相污染；
 * - 第一个参数必须是 tenantId；非字符串（平台/系统调用）原样直通。
 */
export function tenantGuarded<Repo>(client: PrismaClient, repo: Repo, tenantIndex = 0): Repo {
  const target = repo as unknown as RepoLike & Record<string, unknown>;
  const proxy = new Proxy(target, {
    get(obj, prop) {
      const value = Reflect.get(obj, prop, obj);
      if (typeof value !== "function") return value;
      return (...args: unknown[]): unknown => {
        const raw = args[tenantIndex];
        const argRecord = raw !== null && typeof raw === "object" ? (raw as Record<string, unknown>) : null;
        const tenantId =
          typeof raw === "string" && raw.length > 0
            ? raw
            : argRecord !== null && typeof argRecord.tenantId === "string" && argRecord.tenantId.length > 0
              ? argRecord.tenantId
              : undefined;
        if (tenantId === undefined) {
          return Reflect.apply(value as (...a: unknown[]) => unknown, obj, args);
        }
        return withTenantContext(client, tenantId, async (tx: DbTransaction) => {
          // 把 tx 包装成“兼容嵌套 $transaction 的同一连接”：repo 内现有 this.client.$transaction(fn)
          // 会在同一底层事务上执行 fn，避免逐行改写所有仓库的嵌套事务写法。
          const txLike = new Proxy(tx, {
            get(target, prop) {
              if (prop === "$transaction") {
                return (fn: (inner: DbTransaction) => Promise<unknown>) => fn(txLike as unknown as DbTransaction);
              }
              const v = Reflect.get(target, prop, target);
              return typeof v === "function" ? (v as (...a: unknown[]) => unknown).bind(target) : v;
            }
          });
          const scoped = Object.create(obj) as RepoLike & Record<string, unknown>;
          scoped.client = txLike;
          return Reflect.apply(value as (...a: unknown[]) => unknown, scoped, args);
        });
      };
    }
  });
  return proxy as Repo;
}