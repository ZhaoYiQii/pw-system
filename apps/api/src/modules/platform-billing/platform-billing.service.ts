import { randomBytes, scrypt as scryptCb } from "node:crypto";
import type { DbTransaction, PrismaClient } from "@pw/database";
import { PACKAGES, packageByCode } from "./packages.js";

async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = await new Promise<Buffer>((resolvePromise, rejectPromise) => {
    scryptCb(password, salt, 64, { N: 16384, r: 8, p: 1 }, (err, key) => {
      if (err) rejectPromise(err);
      else resolvePromise(key as Buffer);
    });
  });
  return `scrypt:16384:8:1:${salt.toString("base64")}:${hash.toString("base64")}`;
}

export interface OnboardInput {
  code: string;
  name: string;
  host: string;
  ownerUsername: string;
  ownerPassword: string;
  brandPrimary?: string;
  brandAccent?: string;
  logoText?: string;
  storeCutBp?: number;
  packageCode?: string;
}

export class PlatformBillingService {
  constructor(private readonly client: PrismaClient) {}

  listPackages() {
    return PACKAGES;
  }

  async onboard(input: OnboardInput, actorId: string) {
    const pkg = packageByCode(input.packageCode ?? "BASIC");
    if (!pkg) throw new Error("未知套餐");
    if (!/^[a-z0-9][a-z0-9_-]{1,31}$/.test(input.code))
      throw new Error("门店 code 非法");
    if (!input.host || !input.ownerUsername || input.ownerPassword.length < 8)
      throw new Error("host/owner 凭据不完整");
    if (!input.brandPrimary || !/^#[0-9a-fA-F]{6}$/.test(input.brandPrimary))
      throw new Error("缺少合法品牌主色（开通不完整）");
    const storeCutBp = input.storeCutBp ?? 2000;
    if (storeCutBp < 0 || storeCutBp + 300 > 10000)
      throw new Error("门店抽成非法");

    const created = await this.client.$transaction(async (tx) => {
      const tenant = await tx.tenant.create({
        data: { code: input.code, name: input.name, status: "ACTIVE" },
      });
      const now = new Date();
      await tx.tenantDomain.create({
        data: { tenantId: tenant.id, host: input.host, isPrimary: true },
      });
      const passHash = await hashPassword(input.ownerPassword);
      const account = await tx.tenantAccount.create({
        data: {
          tenantId: tenant.id,
          username: input.ownerUsername,
          passwordHash: passHash,
        },
      });
      await tx.tenantAccountRole.create({
        data: {
          tenantId: tenant.id,
          tenantAccountId: account.id,
          role: "TENANT_OWNER",
        },
      });
      await tx.tenantConfigVersion.create({
        data: {
          tenantId: tenant.id,
          version: 1,
          status: "ACTIVE",
          config: {
            schemaVersion: "v1",
            brand: {
              primaryColor: input.brandPrimary,
              accentColor: input.brandAccent ?? "#fa8c16",
              logoText: (input.logoText ?? input.name).slice(0, 40),
              borderRadius: 8,
            },
            storefront: {
              allowCustomerSelection: true,
              showServiceDuration: true,
            },
          },
          createdBy: actorId,
        },
      });
      await tx.financeRateRule.create({
        data: { tenantId: tenant.id, platformFeeBp: 300, storeCutBp },
      });
      await tx.tenantSubscription.create({
        data: {
          tenantId: tenant.id,
          packageCode: pkg.code,
          status: "ACTIVE",
          startsAt: now,
          endsAt: addDays(now, pkg.durationDays),
        },
      });
      await replacePackageEntitlements(
        tx,
        tenant.id,
        pkg,
        actorId,
        "tenant.onboard",
        `平台开通门店 ${tenant.code}（套餐 ${pkg.code}）`,
      );
      return tenant;
    });
    return { tenantId: created.id, tenantCode: created.code };
  }

  async assignPackage(tenantId: string, packageCode: string, actorId: string) {
    const pkg = packageByCode(packageCode);
    if (!pkg) throw new Error("未知套餐");
    return this.client.$transaction(async (tx) => {
      const t = await tx.tenant.findFirst({ where: { id: tenantId } });
      if (!t) throw new Error("租户不存在");
      const now = new Date();
      await tx.tenantSubscription.updateMany({
        where: { tenantId, status: "ACTIVE" },
        data: { status: "SUPERSEDED", endsAt: now },
      });
      await tx.tenantSubscription.create({
        data: {
          tenantId,
          packageCode: pkg.code,
          status: "ACTIVE",
          startsAt: now,
          endsAt: addDays(now, pkg.durationDays),
        },
      });
      await replacePackageEntitlements(
        tx,
        tenantId,
        pkg,
        actorId,
        "tenant.package.assign",
        `指派套餐 ${pkg.code}`,
      );
      return { tenantId, packageCode: pkg.code, addons: pkg.addons };
    });
  }

  async activate(tenantId: string, actorId: string) {
    return this.client.$transaction(async (tx) => {
      const t = await tx.tenant.findFirst({ where: { id: tenantId } });
      if (!t) throw new Error("租户不存在");
      const [config, finance, ownerRole, subscription] = await Promise.all([
        tx.tenantConfigVersion.findFirst({
          where: { tenantId, status: "ACTIVE" },
          select: { id: true },
        }),
        tx.financeRateRule.findFirst({
          where: { tenantId },
          select: { id: true },
        }),
        tx.tenantAccountRole.findFirst({
          where: { tenantId, role: "TENANT_OWNER" },
          select: { id: true },
        }),
        tx.tenantSubscription.findFirst({
          where: { tenantId, status: "ACTIVE" },
          select: { id: true },
        }),
      ]);
      const missing = [
        config ? null : "配置版本",
        finance ? null : "分账费率",
        ownerRole ? null : "店主账号",
        subscription ? null : "有效订阅",
      ].filter((x): x is string => x !== null);
      if (missing.length > 0)
        throw new Error(`门店开通不完整（缺 ${missing.join("/")}）`);
      await tx.tenant.update({
        where: { id: tenantId },
        data: { status: "ACTIVE" },
      });
      await tx.auditLog.create({
        data: {
          tenantId,
          actorType: "platform_account",
          actorId,
          action: "tenant.activate",
          resourceType: "tenant",
          resourceId: tenantId,
          summary: "激活门店",
        },
      });
      return { id: tenantId, status: "ACTIVE" };
    });
  }

  /** 平台侧订阅续费：仅可延长 ACTIVE 订阅，从当前到期日（未过期）或今天起顺延。 */
  async renewSubscription(
    subscriptionId: string,
    monthsInput: unknown,
    actorId: string,
    note?: unknown,
  ): Promise<{
    subscriptionId: string;
    tenantId: string;
    packageCode: string;
    startsAt: Date;
    endsAt: Date;
  }> {
    const months = Number(monthsInput);
    if (![1, 3, 6, 12].includes(months))
      throw new Error("续费周期仅支持 1/3/6/12 个月");
    const noteText =
      typeof note === "string" && note.trim().length > 0
        ? note.trim().slice(0, 200)
        : null;
    const result = await this.client.$transaction(async (tx) => {
      const current = await tx.tenantSubscription.findUnique({
        where: { id: subscriptionId },
      });
      if (!current) throw new Error("订阅不存在");
      if (current.status !== "ACTIVE")
        throw new Error(
          `仅可续费生效中的订阅（当前 ${current.status}）；请先重新指派套餐`,
        );
      const now = new Date();
      const base =
        current.endsAt && current.endsAt.getTime() > now.getTime()
          ? current.endsAt
          : now;
      const endsAt = addMonths(base, months);
      const updated = await tx.tenantSubscription.update({
        where: { id: current.id },
        data: { endsAt },
      });
      await tx.auditLog.create({
        data: {
          tenantId: current.tenantId,
          actorType: "platform_account",
          actorId,
          action: "subscription.renew",
          resourceType: "tenant_subscription",
          resourceId: current.id,
          summary: `续费 ${months} 个月${noteText ? `，备注：${noteText}` : ""}`,
        },
      });
      return {
        subscriptionId: updated.id,
        tenantId: updated.tenantId,
        packageCode: updated.packageCode,
        startsAt: updated.startsAt,
        endsAt: updated.endsAt ?? endsAt,
      };
    });
    return result;
  }

  /** 平台维护/worker 调用：把已到期 ACTIVE 订阅置 EXPIRED，并回收其套餐 addon 权限。 */
  async expireDueSubscriptions(): Promise<number> {
    return this.client.$transaction(async (tx) => {
      const now = new Date();
      const due = await tx.tenantSubscription.findMany({
        where: { status: "ACTIVE", endsAt: { lt: now } },
        select: { tenantId: true },
      });
      if (due.length === 0) return 0;
      const tenantIds = Array.from(new Set(due.map((d) => d.tenantId)));
      const res = await tx.tenantSubscription.updateMany({
        where: {
          tenantId: { in: tenantIds },
          status: "ACTIVE",
          endsAt: { lt: now },
        },
        data: { status: "EXPIRED", endsAt: now },
      });
      const renewed = await tx.tenantSubscription.findMany({
        where: { tenantId: { in: tenantIds }, status: "ACTIVE" },
        select: { tenantId: true },
      });
      const stillActive = new Set(renewed.map((r) => r.tenantId));
      const expiredTenants = tenantIds.filter((id) => !stillActive.has(id));
      if (expiredTenants.length > 0) {
        await tx.tenantEntitlement.deleteMany({
          where: {
            tenantId: { in: expiredTenants },
            featureKey: { startsWith: "addon." },
            source: { startsWith: "package:" },
          },
        });
      }
      return res.count;
    });
  }
}

function addDays(from: Date, days: number): Date {
  return new Date(from.getTime() + days * 24 * 60 * 60 * 1000);
}

function addMonths(from: Date, months: number): Date {
  const next = new Date(from);
  const day = next.getDate();
  next.setMonth(next.getMonth() + months);
  if (next.getDate() !== day) next.setDate(0);
  return next;
}

async function replacePackageEntitlements(
  tx: DbTransaction,
  tenantId: string,
  pkg: { code: string; addons: string[] },
  actorId: string,
  action: string,
  summary: string,
): Promise<void> {
  await tx.tenantEntitlement.deleteMany({
    where: { tenantId, featureKey: { startsWith: "addon." } },
  });
  for (const addon of pkg.addons) {
    await tx.tenantEntitlement.create({
      data: {
        tenantId,
        featureKey: addon,
        enabled: true,
        source: `package:${pkg.code}`,
      },
    });
  }
  await tx.auditLog.create({
    data: {
      tenantId,
      actorType: "platform_account",
      actorId,
      action,
      resourceType: "tenant",
      resourceId: tenantId,
      summary,
    },
  });
}
