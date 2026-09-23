import { withTenantContext } from "@pw/database";
import type { DbTransaction, PrismaClient } from "@pw/database";
import type {
  TenantWalletQuery,
  TenantWalletRepository,
  TenantWalletRow,
  TenantWalletDetail,
} from "../application/tenant-wallet-ports.js";

/**
 * S4-9a：门店客户钱包台账的真库实现（**只读**）。
 *
 * 走**运行时连接 + 租户上下文**（RLS 生效）：钱包与流水都是租户级资源，
 * 租户 id 来自登录态，不需要平台连接（那是回调链路跨租户找单才需要的）。
 *
 * 列表用两次查询（钱包分页 + 该页钱包的流水聚合）：一次 join 会把行数放大
 * （一个钱包多笔流水 → 钱包重复计数），金额与条数必须分开算。
 */
export class PrismaTenantWalletRepository implements TenantWalletRepository {
  constructor(private readonly runtime: PrismaClient) {}

  async listWallets(query: TenantWalletQuery): Promise<TenantWalletRow[]> {
    return withTenantContext(
      this.runtime,
      query.tenantId,
      async (tx: DbTransaction) => {
        // 搜索按**两步**做：`BossWallet` 上没有指向 `CustomerProfile` 的关系字段
        // （schema 里只有 customerProfileId 标量），所以不能写 `customerProfile: { is: ... }`
        // ——真库探针当场把这种写法打成了 500。先按名字取档案 id，再按 id 过滤钱包。
        let profileIdFilter: string[] | null = null;
        if (query.query) {
          const matched = await tx.customerProfile.findMany({
            where: {
              tenantId: query.tenantId,
              name: { contains: query.query, mode: "insensitive" },
            },
            select: { id: true },
          });
          profileIdFilter = matched.map((profile) => profile.id);
          if (profileIdFilter.length === 0) return [];
        }

        const wallets = await tx.bossWallet.findMany({
          where: {
            tenantId: query.tenantId,
            ...(profileIdFilter
              ? { customerProfileId: { in: profileIdFilter } }
              : {}),
          },
          // 最近有变动的钱包在前：门店先看"刚充过钱/刚退过款"的客户
          orderBy: [{ updatedAt: "desc" }, { bossNo: "asc" }],
          take: query.limit,
          select: {
            id: true,
            bossNo: true,
            customerProfileId: true,
            balanceFen: true,
          },
        });
        if (wallets.length === 0) return [];

        const walletIds = wallets.map((wallet) => wallet.id);
        const stats = await tx.walletEntry.groupBy({
          by: ["walletId"],
          where: { tenantId: query.tenantId, walletId: { in: walletIds } },
          _count: { _all: true },
          _max: { createdAt: true },
        });
        const statByWallet = new Map(
          stats.map((item) => [item.walletId, item]),
        );

        const profiles = await tx.customerProfile.findMany({
          where: {
            tenantId: query.tenantId,
            id: {
              in: [
                ...new Set(wallets.map((wallet) => wallet.customerProfileId)),
              ],
            },
          },
          select: { id: true, name: true },
        });
        const nameByProfile = new Map(
          profiles.map((profile) => [profile.id, profile.name]),
        );

        return wallets.map((wallet) => {
          const stat = statByWallet.get(wallet.id);
          return {
            walletId: wallet.id,
            bossNo: wallet.bossNo,
            customerProfileId: wallet.customerProfileId,
            customerName: nameByProfile.get(wallet.customerProfileId) ?? null,
            balanceFen: wallet.balanceFen,
            entryCount: stat?._count._all ?? 0,
            lastEntryAt: stat?._max.createdAt ?? null,
          };
        });
      },
    );
  }

  async findWalletDetail(input: {
    tenantId: string;
    customerProfileId: string;
    entryLimit: number;
  }): Promise<TenantWalletDetail | null> {
    return withTenantContext(
      this.runtime,
      input.tenantId,
      async (tx: DbTransaction) => {
        const wallet = await tx.bossWallet.findFirst({
          where: {
            tenantId: input.tenantId,
            customerProfileId: input.customerProfileId,
          },
          select: {
            id: true,
            bossNo: true,
            customerProfileId: true,
            balanceFen: true,
          },
        });
        if (!wallet) return null;

        const profile = await tx.customerProfile.findFirst({
          where: { tenantId: input.tenantId, id: wallet.customerProfileId },
          select: { name: true },
        });
        // 按钱包 id 过滤（不是按客户档案）：同一客户理论上只有一把钱包，
        // 但流水正确性不能依赖这个假设——钱包 id 才是流水的真实归属。
        const entries = await tx.walletEntry.findMany({
          where: { tenantId: input.tenantId, walletId: wallet.id },
          orderBy: { createdAt: "desc" },
          take: input.entryLimit,
          select: {
            id: true,
            txNo: true,
            type: true,
            amountFen: true,
            balanceAfterFen: true,
            reason: true,
            referenceType: true,
            referenceId: true,
            createdAt: true,
          },
        });
        return {
          walletId: wallet.id,
          bossNo: wallet.bossNo,
          customerProfileId: wallet.customerProfileId,
          customerName: profile?.name ?? null,
          balanceFen: wallet.balanceFen,
          entries,
        };
      },
    );
  }
}
