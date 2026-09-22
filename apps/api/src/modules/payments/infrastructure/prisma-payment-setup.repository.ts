import { withTenantContext } from "@pw/database";
import type { DbTransaction, PrismaClient } from "@pw/database";
import type {
  PaymentAccountRecord,
  PaymentSetupRepository,
  RejectDetailItem,
} from "../application/payment-setup-ports.js";

/**
 * S4-5：门店支付账户的真库实现（运行时连接 + 租户上下文，RLS 生效）。
 * 与其它支付仓储一致：所有读写都在租户上下文里，禁止用平台连接绕过 RLS。
 */
export class PrismaPaymentSetupRepository implements PaymentSetupRepository {
  constructor(private readonly runtime: PrismaClient) {}

  async findAccount(tenantId: string): Promise<PaymentAccountRecord | null> {
    return withTenantContext(
      this.runtime,
      tenantId,
      async (tx: DbTransaction) => {
        const row = await tx.tenantPaymentAccount.findFirst({
          where: { tenantId },
        });
        return row ? toRecord(row) : null;
      },
    );
  }

  async bindSubMchid(input: {
    tenantId: string;
    subMchid: string;
    operatorAccountId: string;
  }): Promise<PaymentAccountRecord> {
    return withTenantContext(
      this.runtime,
      input.tenantId,
      async (tx: DbTransaction) => {
        const existing = await tx.tenantPaymentAccount.findFirst({
          where: { tenantId: input.tenantId },
        });
        // 已 ACTIVE 不降级：绑定只是补子商户号，不该把能收款的门店打回待确认
        const row = existing
          ? await tx.tenantPaymentAccount.update({
              where: { id: existing.id },
              data:
                existing.status === "ACTIVE"
                  ? { subMchid: input.subMchid }
                  : { subMchid: input.subMchid, status: "PENDING_CONFIRM" },
            })
          : await tx.tenantPaymentAccount.create({
              data: {
                tenantId: input.tenantId,
                subMchid: input.subMchid,
                status: "PENDING_CONFIRM",
              },
            });
        await tx.auditLog.create({
          data: {
            tenantId: input.tenantId,
            actorType: "tenant_account",
            actorId: input.operatorAccountId,
            action: "payment.setup.bind",
            resourceType: "tenant_payment_account",
            resourceId: row.id,
            summary: `人工绑定子商户号 ${input.subMchid}（来自服务商后台进件）`,
          },
        });
        return toRecord(row);
      },
    );
  }

  async recordSubmittedApplyment(input: {
    tenantId: string;
    businessCode: string;
    applyNo: string;
    submittedAt: Date;
    operatorAccountId: string;
    summary: string;
  }): Promise<PaymentAccountRecord> {
    return withTenantContext(
      this.runtime,
      input.tenantId,
      async (tx: DbTransaction) => {
        const existing = await tx.tenantPaymentAccount.findFirst({
          where: { tenantId: input.tenantId },
        });
        // 提交后微信侧状态未知 → 清空上一次的查询结果（provider_state / sign_url），等刷新再填，
        // 避免把过期状态当成当前状态展示。rejectDetail 有意保留：老板要照着上次的驳回原因改资料。
        const data = {
          businessCode: input.businessCode,
          applyNo: input.applyNo,
          status: "APPLYING",
          submittedAt: input.submittedAt,
          providerState: null,
          providerStateMsg: null,
          signUrl: null,
        };
        const row = existing
          ? await tx.tenantPaymentAccount.update({
              where: { id: existing.id },
              data,
            })
          : await tx.tenantPaymentAccount.create({
              data: { tenantId: input.tenantId, ...data },
            });
        await tx.auditLog.create({
          data: {
            tenantId: input.tenantId,
            actorType: "tenant_account",
            actorId: input.operatorAccountId,
            action: "payment.setup.submit",
            resourceType: "tenant_payment_account",
            resourceId: row.id,
            summary: input.summary,
          },
        });
        return toRecord(row);
      },
    );
  }

  async applyProviderStatus(input: {
    tenantId: string;
    status: string;
    subMchid: string | null;
    providerState: string | null;
    providerStateMsg: string | null;
    rejectDetail: RejectDetailItem[] | null;
    signUrl: string | null;
    authorizeState: string | null;
    syncedAt: Date;
    operatorAccountId: string;
    summary: string;
  }): Promise<{ account: PaymentAccountRecord; changed: boolean }> {
    return withTenantContext(
      this.runtime,
      input.tenantId,
      async (tx: DbTransaction) => {
        const existing = await tx.tenantPaymentAccount.findFirst({
          where: { tenantId: input.tenantId },
        });
        if (!existing) {
          // 刷新只处理已存在的账户；不存在时由服务层给 400，不该凭空造账户
          throw new Error("payment account not found");
        }
        // 落 JSON 列：map 成"新鲜对象字面量"，这样带隐式索引签名、能直接当 Prisma Json 入参
        const rejectDetail =
          input.rejectDetail && input.rejectDetail.length > 0
            ? input.rejectDetail.map((item) => ({
                field: item.field,
                fieldName: item.fieldName,
                rejectReason: item.rejectReason,
              }))
            : undefined;
        const changed =
          existing.status !== input.status ||
          existing.subMchid !== input.subMchid ||
          existing.providerState !== input.providerState ||
          existing.providerStateMsg !== input.providerStateMsg ||
          existing.authorizeState !== input.authorizeState ||
          existing.signUrl !== input.signUrl ||
          fingerprint(existing.rejectDetail) !==
            fingerprint(rejectDetail ?? null);
        const row = await tx.tenantPaymentAccount.update({
          where: { id: existing.id },
          data: {
            status: input.status,
            subMchid: input.subMchid,
            providerState: input.providerState,
            providerStateMsg: input.providerStateMsg,
            authorizeState: input.authorizeState,
            signUrl: input.signUrl,
            ...(rejectDetail === undefined ? {} : { rejectDetail }),
            lastSyncedAt: input.syncedAt,
          },
        });
        if (changed) {
          await tx.auditLog.create({
            data: {
              tenantId: input.tenantId,
              actorType: "tenant_account",
              actorId: input.operatorAccountId,
              action: "payment.setup.refresh",
              resourceType: "tenant_payment_account",
              resourceId: row.id,
              summary: input.summary,
            },
          });
        }
        return { account: toRecord(row), changed };
      },
    );
  }
}

type AccountRow = {
  status: string;
  subMchid: string | null;
  subAppid: string | null;
  applyNo: string | null;
  businessCode: string | null;
  providerState: string | null;
  providerStateMsg: string | null;
  rejectDetail: unknown;
  signUrl: string | null;
  authorizeState: string | null;
  submittedAt: Date | null;
  lastSyncedAt: Date | null;
};

function toRecord(row: AccountRow): PaymentAccountRecord {
  return {
    status: row.status,
    subMchid: row.subMchid,
    subAppid: row.subAppid,
    applyNo: row.applyNo,
    businessCode: row.businessCode,
    providerState: row.providerState,
    providerStateMsg: row.providerStateMsg,
    rejectDetail: row.rejectDetail,
    signUrl: row.signUrl,
    authorizeState: row.authorizeState,
    submittedAt: row.submittedAt,
    lastSyncedAt: row.lastSyncedAt,
  };
}

/** 用稳定的字符串指纹比对 JSON（顺序无关：先按键排序再序列化）。 */
function fingerprint(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (Array.isArray(value)) {
    return `[${value.map((item) => fingerprint(item)).join(",")}]`;
  }
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries
      .map(([key, item]) => `${key}:${fingerprint(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}
