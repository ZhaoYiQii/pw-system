import { randomBytes } from "node:crypto";
import type { PrismaClient } from "@pw/database";
import type { PaymentProvider } from "../domain/payment-provider.js";
import {
  BossWalletNotFoundError,
  PaymentStateError,
  RechargeInputError,
} from "../domain/wallet-errors.js";

function outNo(): string {
  return `RCH${Date.now().toString(36).toUpperCase()}${randomBytes(4)
    .toString("hex")
    .toUpperCase()}`;
}

function bossNo(): string {
  return `B${Date.now().toString(36).toUpperCase()}${randomBytes(3)
    .toString("hex")
    .toUpperCase()}`;
}

export class WalletService {
  public client: PrismaClient;

  constructor(
    client: PrismaClient,
    private readonly provider: PaymentProvider,
  ) {
    this.client = client;
  }

  private async profileOf(tenantId: string, customerAccountId: string) {
    const profile = await this.client.customerProfile.findFirst({
      where: { tenantId, tenantAccountId: customerAccountId },
    });
    if (!profile) throw new BossWalletNotFoundError();
    return profile;
  }

  private async ensureWallet(tenantId: string, customerProfileId: string) {
    const existing = await this.client.bossWallet.findFirst({
      where: { tenantId, customerProfileId },
    });
    if (existing) return existing;
    const wallet = await this.client.bossWallet.create({
      data: {
        tenantId,
        customerProfileId,
        bossNo: bossNo(),
        balanceFen: 0n,
      },
    });
    return wallet;
  }

  async get(tenantId: string, customerAccountId: string) {
    const profile = await this.profileOf(tenantId, customerAccountId);
    const wallet = await this.ensureWallet(tenantId, profile.id);
    const entries = await this.client.walletEntry.findMany({
      where: { tenantId, walletId: wallet.id },
      orderBy: { createdAt: "desc" },
      take: 50,
    });
    return {
      bossNo: wallet.bossNo,
      balanceFen: wallet.balanceFen.toString(),
      entries: entries.map((e) => ({
        id: e.id,
        txNo: e.txNo,
        type: e.type,
        amountFen: e.amountFen.toString(),
        balanceAfterFen: e.balanceAfterFen.toString(),
        reason: e.reason,
        createdAt: e.createdAt.toISOString(),
      })),
    };
  }

  async recharge(
    tenantId: string,
    customerAccountId: string,
    amountFen: string,
  ) {
    if (amountFen === "0") throw new RechargeInputError("充值金额需大于 0");
    const profile = await this.profileOf(tenantId, customerAccountId);
    const wallet = await this.ensureWallet(tenantId, profile.id);
    const txNo = outNo();
    const result = await this.provider.charge(txNo, amountFen);
    if (!result.success) throw new PaymentStateError("模拟支付未成功");

    await this.client.$transaction(async (tx) => {
      const locks = await tx.$queryRaw<
        Array<{ id: string; balance_fen: bigint }>
      >`
        SELECT id, balance_fen FROM boss_wallets
        WHERE id = ${wallet.id}::uuid AND tenant_id = ${tenantId}::uuid
        FOR UPDATE`;
      if (locks.length === 0) throw new BossWalletNotFoundError();
      const after =
        locks[0]?.balance_fen === undefined
          ? BigInt(amountFen)
          : locks[0].balance_fen + BigInt(amountFen);
      const order = await tx.paymentOrder.create({
        data: {
          tenantId,
          customerProfileId: profile.id,
          outNo: txNo,
          amountFen: BigInt(amountFen),
          provider: "mock",
          providerRef: result.providerRef,
          status: "SUCCESS",
        },
      });
      await tx.bossWallet.update({
        where: { id: wallet.id },
        data: { balanceFen: after },
      });
      await tx.walletEntry.create({
        data: {
          tenantId,
          customerProfileId: profile.id,
          walletId: wallet.id,
          txNo,
          type: "RECHARGE",
          amountFen: BigInt(amountFen),
          balanceAfterFen: after,
          referenceType: "payment_order",
          referenceId: order.id,
          reason: "老板充值",
        },
      });
    });
    return this.get(tenantId, customerAccountId);
  }
}
