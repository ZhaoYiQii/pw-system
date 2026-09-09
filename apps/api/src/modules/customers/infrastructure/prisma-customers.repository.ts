import type { PrismaClient } from "@pw/database";
import type {
  CustomerAccountView,
  CustomerOrderHistoryRow,
  CustomerView,
} from "../domain/customer.js";
import {
  decryptPhone,
  encryptPhone,
  phoneHash,
} from "../../../common/pii/phone.js";
import {
  AccountNotCustomerError,
  CustomerAccountBoundError,
  CustomerNotFoundError,
  DuplicateCustomerError,
} from "../domain/errors.js";

function isP2002(error: unknown): boolean {
  return (
    error !== null &&
    typeof error === "object" &&
    "code" in error &&
    (error as { code?: string }).code === "P2002"
  );
}
import type {
  CustomerInput,
  CustomerRepository,
} from "../application/customers.service.js";

function map(row: {
  id: string;
  tenantId: string;
  name: string;
  mobileEnc: string | null;
  mobileHash: string | null;
  remark: string | null;
  status: string;
  createdAt: Date;
  updatedAt: Date;
}): CustomerView {
  return {
    id: row.id,
    tenantId: row.tenantId,
    name: row.name,
    mobile: row.mobileEnc ? decryptPhone(row.mobileEnc) : null,
    remark: row.remark,
    status: row.status as CustomerView["status"],
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export class PrismaCustomerRepository implements CustomerRepository {
  constructor(private readonly client: PrismaClient) {}

  async list(tenantId: string, query?: string): Promise<CustomerView[]> {
    const rows = await this.client.customerProfile.findMany({
      where: {
        tenantId,
        ...(query
          ? {
              OR: [
                { name: { contains: query, mode: "insensitive" } },
                // 明文不再落库：仅支持归一化后的完整号码精确命中哈希。
                { mobileHash: phoneHash(tenantId, query) },
              ],
            }
          : {}),
      },
      orderBy: { createdAt: "desc" },
    });
    return rows.map(map);
  }

  async find(tenantId: string, id: string): Promise<CustomerView | null> {
    const row = await this.client.customerProfile.findFirst({
      where: { tenantId, id },
    });
    return row ? map(row) : null;
  }

  async create(tenantId: string, input: CustomerInput): Promise<CustomerView> {
    try {
      const phone = input.mobile
        ? encryptPhone(tenantId, input.mobile)
        : { mobileEnc: null, mobileHash: null };
      const row = await this.client.customerProfile.create({
        data: {
          tenantId,
          name: input.name,
          mobileEnc: phone.mobileEnc,
          mobileHash: phone.mobileHash,
          ...(input.remark ? { remark: input.remark } : {}),
          status: input.status ?? "ACTIVE",
        },
      });
      return map(row);
    } catch (error) {
      if (
        error !== null &&
        typeof error === "object" &&
        "code" in error &&
        (error as { code?: string }).code === "P2002"
      ) {
        throw new DuplicateCustomerError();
      }
      throw error;
    }
  }

  async update(
    tenantId: string,
    id: string,
    input: Partial<CustomerInput>,
  ): Promise<CustomerView | null> {
    try {
      const phone =
        input.mobile !== undefined
          ? input.mobile
            ? encryptPhone(tenantId, input.mobile)
            : { mobileEnc: null, mobileHash: null }
          : undefined;
      const row = await this.client.customerProfile.updateMany({
        where: { tenantId, id },
        data: {
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(phone
            ? { mobileEnc: phone.mobileEnc, mobileHash: phone.mobileHash }
            : {}),
          ...(input.remark !== undefined ? { remark: input.remark } : {}),
          ...(input.status !== undefined ? { status: input.status } : {}),
        },
      });
      if (row.count === 0) return null;
      return this.find(tenantId, id);
    } catch (error) {
      if (
        error !== null &&
        typeof error === "object" &&
        "code" in error &&
        (error as { code?: string }).code === "P2002"
      ) {
        throw new DuplicateCustomerError();
      }
      throw error;
    }
  }

  async remove(tenantId: string, id: string): Promise<boolean> {
    const res = await this.client.customerProfile.deleteMany({
      where: { tenantId, id },
    });
    return res.count > 0;
  }

  async bind(
    tenantId: string,
    customerId: string,
    accountId: string,
  ): Promise<CustomerView> {
    const account = await this.client.tenantAccount.findFirst({
      where: { tenantId, id: accountId, roles: { some: { role: "CUSTOMER" } } },
      select: { id: true },
    });
    if (!account) throw new AccountNotCustomerError(accountId);
    try {
      const res = await this.client.customerProfile.updateMany({
        where: { tenantId, id: customerId },
        data: { tenantAccountId: accountId },
      });
      if (res.count === 0) throw new CustomerNotFoundError(customerId);
      const row = await this.find(tenantId, customerId);
      return row as CustomerView;
    } catch (error) {
      if (isP2002(error)) throw new CustomerAccountBoundError();
      throw error;
    }
  }

  async findByAccount(
    tenantId: string,
    accountId: string,
  ): Promise<CustomerView | null> {
    const row = await this.client.customerProfile.findFirst({
      where: { tenantId, tenantAccountId: accountId },
    });
    return row ? map(row) : null;
  }

  async account(
    tenantId: string,
    customerId: string,
  ): Promise<CustomerAccountView> {
    const wallet = await this.client.bossWallet.findFirst({
      where: { tenantId, customerProfileId: customerId },
    });
    if (!wallet) {
      return { customerId, wallet: null };
    }
    const entries = await this.client.walletEntry.findMany({
      where: { tenantId, walletId: wallet.id },
      orderBy: { createdAt: "desc" },
      take: 100,
    });
    return {
      customerId,
      wallet: {
        bossNo: wallet.bossNo,
        balanceFen: wallet.balanceFen.toString(),
        entries: entries.map((e) => ({
          id: e.id,
          txNo: e.txNo,
          type: e.type,
          amountFen: e.amountFen.toString(),
          balanceAfterFen: e.balanceAfterFen.toString(),
          reason: e.reason,
          createdAt: e.createdAt,
        })),
      },
    };
  }

  async orderHistory(
    tenantId: string,
    customerId: string,
  ): Promise<CustomerOrderHistoryRow[]> {
    const rows = await this.client.order.findMany({
      where: { tenantId, customerProfileId: customerId },
      orderBy: { createdAt: "desc" },
      take: 100,
    });
    if (rows.length === 0) return [];
    const gdOrderIds = rows
      .filter((r) => r.processType === "GAME_DISPATCH")
      .map((r) => r.id);
    const gdRows =
      gdOrderIds.length > 0
        ? await this.client.gameDispatchOrder.findMany({
            where: { tenantId, orderId: { in: gdOrderIds } },
            select: { orderId: true, dispatchNo: true },
          })
        : [];
    const dispatchNoByOrderId = new Map(
      gdRows.map((r) => [r.orderId, r.dispatchNo]),
    );
    return rows.map((r) => ({
      orderId: r.id,
      orderNo:
        r.processType === "GAME_DISPATCH"
          ? (dispatchNoByOrderId.get(r.id) ?? r.orderNo)
          : r.orderNo,
      dispatchNo:
        r.processType === "GAME_DISPATCH"
          ? (dispatchNoByOrderId.get(r.id) ?? null)
          : null,
      processType:
        r.processType === "GAME_DISPATCH" ? "GAME_DISPATCH" : "CLASSIC",
      status: r.status,
      remark: r.remark,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
    }));
  }
}
