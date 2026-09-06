import { randomBytes, scrypt as scryptCb } from "node:crypto";
import type { PrismaClient } from "@pw/database";
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
    if (!/^[a-z0-9][a-z0-9_-]{1,31}$/.test(input.code)) throw new Error("门店 code 非法");
    if (!input.host || !input.ownerUsername || input.ownerPassword.length < 8) throw new Error("host/owner 凭据不完整");
    if (!input.brandPrimary || !/^#[0-9a-fA-F]{6}$/.test(input.brandPrimary)) throw new Error("缺少合法品牌主色（开通不完整）");
    const storeCutBp = input.storeCutBp ?? 2000;
    if (storeCutBp < 0 || storeCutBp + 300 > 10000) throw new Error("门店抽成非法");

    const created = await this.client.$transaction(async (tx) => {
      const tenant = await tx.tenant.create({ data: { code: input.code, name: input.name, status: "ACTIVE" } });
      await tx.tenantDomain.create({ data: { tenantId: tenant.id, host: input.host, isPrimary: true } });
      const passHash = await hashPassword(input.ownerPassword);
      const account = await tx.tenantAccount.create({ data: { tenantId: tenant.id, username: input.ownerUsername, passwordHash: passHash } });
      await tx.tenantAccountRole.create({ data: { tenantId: tenant.id, tenantAccountId: account.id, role: "TENANT_OWNER" } });
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
              borderRadius: 8
            },
            storefront: { allowCustomerSelection: true, showServiceDuration: true }
          },
          createdBy: actorId
        }
      });
      await tx.financeRateRule.create({ data: { tenantId: tenant.id, platformFeeBp: 300, storeCutBp } });
      await tx.tenantSubscription.create({ data: { tenantId: tenant.id, packageCode: pkg?.code ?? "BASIC", status: "ACTIVE" } });
      return tenant;
    });
    if (pkg) await this.assignPackage(created.id, pkg.code, actorId);
    return { tenantId: created.id, tenantCode: created.code };
  }

  async assignPackage(tenantId: string, packageCode: string, actorId: string) {
    const pkg = packageByCode(packageCode);
    if (!pkg) throw new Error("未知套餐");
    await this.client.$transaction(async (tx) => {
      const t = await tx.tenant.findFirst({ where: { id: tenantId } });
      if (!t) throw new Error("租户不存在");
      await tx.tenantSubscription.create({ data: { tenantId, packageCode: pkg.code, status: "ACTIVE" } });
      await tx.tenantEntitlement.deleteMany({ where: { tenantId, featureKey: { startsWith: "addon." } } });
      for (const addon of pkg.addons) {
        await tx.tenantEntitlement.create({ data: { tenantId, featureKey: addon, enabled: true, source: `package:${pkg.code}` } });
      }
      await tx.auditLog.create({
        data: { tenantId, actorType: "platform_account", actorId, action: "tenant.package.assign", resourceType: "tenant", resourceId: tenantId, summary: `指派套餐 ${pkg.code}` }
      });
    });
    return { tenantId, packageCode: pkg.code, addons: pkg.addons };
  }

  async activate(tenantId: string) {
    const t = await this.client.tenant.findFirst({ where: { id: tenantId } });
    if (!t) throw new Error("租户不存在");
    await this.client.tenant.update({ where: { id: tenantId }, data: { status: "ACTIVE" } });
    return { id: tenantId, status: "ACTIVE" };
  }
}