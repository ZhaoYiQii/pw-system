import { withTenantContext } from "@pw/database";
import type { DbTransaction, Prisma, PrismaClient } from "@pw/database";
import {
  assertReconciliationCaseTransition,
  type ReconciliationCaseStatus,
} from "../domain/reconciliation-case-state.js";
import {
  RECONCILIATION_CASE_IGNORED_RESOLUTION_TYPE,
  RECONCILIATION_RESOLUTION_TYPES,
  ReconciliationCaseConflictError,
  ReconciliationCaseInputError,
  ReconciliationCaseNotFoundError,
} from "../application/reconciliation-case-ports.js";
import type {
  ReconciliationCaseIgnoreCommand,
  ReconciliationCaseQuery,
  ReconciliationCaseRepository,
  ReconciliationCaseRow,
  ReconciliationCaseSubmitReviewCommand,
  ReconciliationCaseTransitionCommand,
  ReconciliationResolutionType,
} from "../application/reconciliation-case-ports.js";

/** 命令各自的落点状态（DS-013/DS-014 固定契约；来源状态由 DS-010 裁决，这里不列第二张转移表）。 */
const OPEN_STATUS: ReconciliationCaseStatus = "OPEN";
const CLAIMED_STATUS: ReconciliationCaseStatus = "CLAIMED";
const PROCESSING_STATUS: ReconciliationCaseStatus = "PROCESSING";
const PENDING_REVIEW_STATUS: ReconciliationCaseStatus = "PENDING_REVIEW";
const CLOSED_STATUS: ReconciliationCaseStatus = "CLOSED";
const IGNORED_STATUS: ReconciliationCaseStatus = "IGNORED";

/** 审计资源类型：与既有审计口径同名同形（处理单是一个资源，不是一个动作）。 */
const RECONCILIATION_CASE_RESOURCE_TYPE = "reconciliation_case";

/** 审计口径：动作名与固定中文摘要（摘要含精确的前后状态，不含差异明细、金额或客户端原文）。 */
const CLAIMED_AUDIT_ACTION = "payment.reconciliation_case.claimed";
const CLAIMED_AUDIT_SUMMARY = "对账处理单认领（OPEN -> CLAIMED）";
const PROCESSING_AUDIT_ACTION =
  "payment.reconciliation_case.processing_started";
const PROCESSING_AUDIT_SUMMARY = "对账处理单开始处理（CLAIMED -> PROCESSING）";
const SUBMIT_REVIEW_AUDIT_ACTION =
  "payment.reconciliation_case.review_submitted";
const SUBMIT_REVIEW_AUDIT_SUMMARY =
  "对账处理单提交复核（PROCESSING -> PENDING_REVIEW，处理结果已留在处理单上）";
const CLOSED_AUDIT_ACTION = "payment.reconciliation_case.closed";
const CLOSED_AUDIT_SUMMARY =
  "对账处理单复核关闭（PENDING_REVIEW -> CLOSED，复核人与处理人分离）";
const IGNORED_AUDIT_ACTION = "payment.reconciliation_case.ignored";

/** 冲突文案固定：不回显请求内容，也不泄漏差异/客户数据。 */
const STALE_VERSION_CONFLICT = "处理单已被其他人更新，请刷新后重试";
const OWNERSHIP_CONFLICT = "处理单由其他处理人认领，无法开始处理";
const REVIEWER_CONFLICT = "复核人不能是处理人本人，请由其他财务复核";
const IGNORE_OWNERSHIP_CONFLICT = "处理单由其他处理人认领，无法忽略";
const RACE_CONFLICT = "处理单状态已被并发变更，请刷新后重试";
const SUBMIT_OWNERSHIP_CONFLICT = "处理单由其他处理人处理中，无法提交复核";

/**
 * 不变量失败文案（通用 `Error` → 500）：这些行形状本切片产生不出来。
 *
 * 出现即说明有人在切片之外写过这一行（或数据被直接改过），必须炸出来、整笔回滚，
 * 绝不降级成 404、400 或「当作没这回事」继续走——那会让一张来历不明的单静默进入终态。
 */
const RESOLUTION_NOTE_MISSING =
  "对账处理单缺少处理说明（数据不在本切片可产生的形状内）";
const RESOLUTION_LINK_INCONSISTENT =
  "对账处理单的处理结果与关联交易不自洽（数据不在本切片可产生的形状内）";
const DIFFERENCE_RESOLVE_FAILED =
  "对账差异解析失败（已解析、不存在或不属于本租户），事务回滚";

/**
 * 关联交易不可用（不存在 / 跨租户 / 非 `CONFIRMED`）合成**一个**固定 400。
 *
 * 三种情况必须不可区分：区分它们等于给探测者一个「这个 id 在别的租户存在」的判据。
 */
const LINKED_TRANSACTION_UNAVAILABLE =
  "关联交易不可用（必须是本租户已确认的统一账本交易）";

/**
 * 行投影：列表与全部命令共用同一份字段清单——命令返回的行必须与列表里的行是同一个契约，
 * 两份 select 迟早会漂移。只取契约字段，不返回整行记录。
 */
const CASE_ROW_SELECT = {
  id: true,
  differenceId: true,
  status: true,
  ownerId: true,
  resolutionType: true,
  resolutionNote: true,
  linkedTransactionId: true,
  reviewedBy: true,
  reviewedAt: true,
  closedAt: true,
  createdAt: true,
  updatedAt: true,
  version: true,
  difference: {
    select: {
      kind: true,
      amountFen: true,
      detail: true,
      paymentOrderId: true,
      resolvedAt: true,
      createdAt: true,
    },
  },
} satisfies Prisma.ReconciliationCaseSelect;

/**
 * 命令路径的守卫投影：裁决精确重放、归属、复核人分离与差异解析所需的字段**一次取全**。
 *
 * 比 `CASE_ROW_SELECT` 轻（不取差异的类型、金额、明细），但比「只看状态/处理人/版本」宽：
 * DS-014 的重放判定要求处理结果三件套逐字段相等（提交复核、忽略），关闭还要看复核人与差异是否已解析。
 * 而重放必须在「拒绝终态」**之前**判——分两次读会让判定落在两个时刻上，所以这里一次读，
 * DS-013/DS-014 五个命令共用同一份投影，不各写一份逐渐漂移的字段清单。
 */
const CASE_GUARD_SELECT = {
  status: true,
  ownerId: true,
  version: true,
  resolutionType: true,
  resolutionNote: true,
  linkedTransactionId: true,
  reviewedBy: true,
  reviewedAt: true,
  closedAt: true,
  differenceId: true,
  difference: { select: { resolvedAt: true } },
} satisfies Prisma.ReconciliationCaseSelect;

/** 命令路径的一次读：足够裁决重放/归属/复核人/差异解析，且不取整行。 */
interface ReconciliationCaseGuardRow {
  status: ReconciliationCaseStatus;
  ownerId: string | null;
  version: number;
  resolutionType: string | null;
  resolutionNote: string | null;
  linkedTransactionId: string | null;
  reviewedBy: string | null;
  reviewedAt: Date | null;
  closedAt: Date | null;
  differenceId: string;
  difference: { resolvedAt: Date | null };
}

/**
 * 精确重放判定：当前行**正好**是本命令上一次成功的落地结果——
 * 目标状态 + 操作人就是处理人 + 版本恰好是 `expectedVersion + 1`。
 *
 * 这是这些一次性命令的幂等机制（因此不需要 `Idempotency-Key` 头或去重表）：
 * 精确重放返回当前视图、**不写第二条审计、不第二次更新**；
 * 任何更晚的状态/版本变化都不算重放——那是冲突，不是成功。
 * `expectedVersion + 1` 越出安全整数时不可能构成重放，直接判否，
 * 免得溢出后的相等比较给出假命中。
 */
function isExactReplay(
  current: ReconciliationCaseGuardRow,
  targetStatus: ReconciliationCaseStatus,
  operatorAccountId: string,
  expectedVersion: number,
): boolean {
  const replayedVersion = expectedVersion + 1;
  if (!Number.isSafeInteger(replayedVersion)) return false;
  return (
    current.status === targetStatus &&
    current.ownerId === operatorAccountId &&
    current.version === replayedVersion
  );
}

/**
 * 提交复核的精确重放：与 DS-013 同形，另加**处理结果三件套逐字段相等**。
 *
 * 为什么必须比内容：同一个 `expectedVersion` 重发一次不同的说明，行上已经是
 * `PENDING_REVIEW`、版本也正好是 `expectedVersion + 1`——只比状态与版本就会把
 * 「这份说明已存下」当成事实回给客户端，而库里存的其实是上一份。
 * 状态是 `PENDING_REVIEW` 时 `PROCESSING -> PENDING_REVIEW` 已不可再走，
 * 所以内容不符不是冲突之外的新情况，它落到状态机拒绝（409）上。
 */
function isSubmitReviewReplay(
  current: ReconciliationCaseGuardRow,
  command: ReconciliationCaseSubmitReviewCommand,
): boolean {
  const replayedVersion = command.expectedVersion + 1;
  if (!Number.isSafeInteger(replayedVersion)) return false;
  return (
    current.status === PENDING_REVIEW_STATUS &&
    current.ownerId === command.operatorAccountId &&
    current.version === replayedVersion &&
    current.resolutionType === command.resolutionType &&
    current.resolutionNote === command.resolutionNote &&
    current.linkedTransactionId === command.linkedTransactionId
  );
}

/**
 * 复核关闭的精确重放：状态/复核人/版本，且复核时间、关闭时间与差异解析都已落。
 *
 * 三个时间字段只判「在不在」而不是「相不相等」：`version === expectedVersion + 1` 已经证明
 * 最后一次转移就是本命令这一次，再比时间戳等于自我求证。
 */
function isCloseReplay(
  current: ReconciliationCaseGuardRow,
  command: ReconciliationCaseTransitionCommand,
): boolean {
  const replayedVersion = command.expectedVersion + 1;
  if (!Number.isSafeInteger(replayedVersion)) return false;
  return (
    current.status === CLOSED_STATUS &&
    current.reviewedBy === command.operatorAccountId &&
    current.version === replayedVersion &&
    current.reviewedAt !== null &&
    current.closedAt !== null &&
    current.difference.resolvedAt !== null
  );
}

/**
 * 忽略的精确重放：状态/版本/落库词表/理由逐字符相等，且关闭时间与差异解析都已落。
 *
 * 这里**不**看归属：`ReconciliationCase` 没有「忽略人」列（本切片不加迁移），
 * 重放身份因此是有意的「载荷 + 版本」判定。这不是信息泄漏——同租户同权限的调用者
 * 本来就能从列表里读到这一行的状态与理由，重放没有多给出任何一个字段。
 */
function isIgnoreReplay(
  current: ReconciliationCaseGuardRow,
  command: ReconciliationCaseIgnoreCommand,
): boolean {
  const replayedVersion = command.expectedVersion + 1;
  if (!Number.isSafeInteger(replayedVersion)) return false;
  return (
    current.status === IGNORED_STATUS &&
    current.version === replayedVersion &&
    current.resolutionType === RECONCILIATION_CASE_IGNORED_RESOLUTION_TYPE &&
    current.resolutionNote === command.reason &&
    current.linkedTransactionId === null &&
    current.closedAt !== null &&
    current.difference.resolvedAt !== null
  );
}

/**
 * 忽略的审计摘要：来源状态是 DS-010 的封闭枚举值，且已过状态机校验（只可能是 `OPEN`/`CLAIMED`），
 * 插值不等于「把客户端原文写进摘要」——摘要是两个固定字符串之一，理由本身留在处理单上。
 */
function ignoredAuditSummary(sourceStatus: ReconciliationCaseStatus): string {
  return `对账处理单忽略（${sourceStatus} -> IGNORED，理由已留在处理单上）`;
}

/**
 * 读出**已落库**的处理结果类型（不是客户端输入）。
 *
 * 认不出只能是有人在切片之外写过这一行：`submit-review` 是唯一的写入口，
 * 它的词表就是这两个值。按不变量失败上抛（500），绝不降级成「当作没处理结果」继续关闭——
 * 那会让一张处理过程不明的单静默进入终态。
 */
function readPersistedResolutionType(
  value: string | null,
): ReconciliationResolutionType {
  const found = RECONCILIATION_RESOLUTION_TYPES.find(
    (candidate) => candidate === value,
  );
  if (!found) {
    throw new Error(
      "对账处理单的处理结果类型无法识别（不在本切片词表内，数据不自洽）",
    );
  }
  return found;
}

/**
 * 同一个事务内取**一个**数据库时间戳，用于终态命令的 `reviewedAt`/`closedAt`
 * 与差异的 `resolvedAt`——三个字段必须同源同刻，否则「什么时候关的」有两个答案。
 *
 * 用 `SELECT now()` 而不是 `new Date()`：后者是应用进程时钟，与库里其他时间列不同源。
 * PostgreSQL 的 `now()` 是 `transaction_timestamp()`，在**同一事务内恒定**，
 * 所以这一次读贯穿整笔事务，重复读也只会得到同一个值。
 */
async function readDatabaseNow(tx: DbTransaction): Promise<Date> {
  const rows = await tx.$queryRaw<{ now: Date }[]>`SELECT now() AS now`;
  const row = rows[0];
  if (row === undefined) {
    throw new Error("读取数据库时间戳失败（查询未返回行）");
  }
  return row.now;
}

/**
 * DS-012/DS-013/DS-014：对账处理单的真库实现。
 *
 * 列表（DS-012，只读）：
 * 1. 不创建、不补齐、不推进任何处理单——没有处理单的历史差异在列表里就是不出现；
 * 2. 租户过滤**显式写在 where 里**，与 RLS 并存：RLS 是纵深防御，不是唯一防线；
 * 3. 行查询与计数在**同一个** `withTenantContext` 回调、用**同一份** where 执行。
 *
 * 命令（DS-013 认领/开始处理，DS-014 提交复核/关闭/忽略，写）：
 * 4. 每个命令**一个事务**：条件更新、差异解析与审计同生共死，任一写不进去则整笔回滚；
 * 5. 状态/版本/租户/处理人一起进 `updateMany` 的 where——**不是**「先查再改」，
 *    初次读到的行在并发下随时会过期；
 * 6. 领域状态机 DS-010 是拓扑的唯一事实来源，这里只调用它，不复制转移表；
 * 7. 精确重放**先于**拒绝终态判定，且 DS-014 的重放要逐字段比对载荷（见各自的 `is*Replay`）；
 * 8. 终态（关闭、忽略）在同事务内用**一个**数据库时间戳解析差异，
 *    这是切片内唯一会写 `ReconciliationDifference.resolvedAt` 的地方；
 * 9. 五个命令共用一份守卫投影与一份行投影，命令返回的行与列表里的行是同一个契约。
 *
 * 只用运行时连接：平台/owner 连接能跨租户读写，门店侧没有理由拿它。
 */
export class PrismaReconciliationCaseRepository implements ReconciliationCaseRepository {
  constructor(private readonly runtime: PrismaClient) {}

  async list(input: ReconciliationCaseQuery): Promise<{
    rows: ReconciliationCaseRow[];
    total: number;
  }> {
    return withTenantContext(
      this.runtime,
      input.tenantId,
      async (tx: DbTransaction) => {
        // `null` = 不过滤：只留 tenantId，绝不把 null 拼进 where（那会变成 `status IS NULL`）。
        const where: Prisma.ReconciliationCaseWhereInput = {
          tenantId: input.tenantId,
          ...(input.status === null ? {} : { status: input.status }),
        };
        const rows = await tx.reconciliationCase.findMany({
          where,
          // 固定排序：时间相同时用 id 兜底，翻页不会重复或漏行。
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          skip: (input.page - 1) * input.pageSize,
          take: input.pageSize,
          // 只取契约里的字段：不返回整行记录，也就没有「顺手多带一个字段」的余地。
          // 与两个命令共用同一份 `CASE_ROW_SELECT`：列表与命令返回的行必须是同一个契约。
          select: CASE_ROW_SELECT,
        });
        const total = await tx.reconciliationCase.count({ where });
        return { rows, total };
      },
    );
  }

  /**
   * DS-013 认领：`OPEN -> CLAIMED`，成功即把 `ownerId` 写成操作人。
   *
   * 顺序即口径：
   * 1. 先在**本事务内**按 `id + tenantId` 读当前行——别的租户的单读不到，等同不存在（404）；
   * 2. 精确重放直接返回当前视图：不更新、不写第二条审计、不报冲突；
   * 3. 领域状态机裁决拓扑（这里只问 DS-010，「能不能从当前状态到 CLAIMED」）；
   * 4. 版本不一致即冲突——调用方拿的是过期视图，不能凭过期视图推进；
   * 5. 条件更新把 `id / tenantId / 来源状态 / 版本 / ownerId IS NULL` 一起写进 where：
   *    并发者只要先动过这一行，`count` 就是 0，绝不覆盖别人的结果；
   * 6. `count !== 1` 时在**同一事务内**重读复核：要么是重放（返回），要么是冲突（409）——
   *    绝不把「一行都没改到」当成功返回；
   * 7. 审计与状态变更同一事务：审计写不进去则整笔回滚，不留「改了状态却没留痕」。
   */
  async claim(
    input: ReconciliationCaseTransitionCommand,
  ): Promise<ReconciliationCaseRow> {
    return withTenantContext(
      this.runtime,
      input.tenantId,
      async (tx: DbTransaction) => {
        const current = await this.readCurrentCase(
          tx,
          input.tenantId,
          input.caseId,
        );
        if (current === null) throw new ReconciliationCaseNotFoundError();
        if (
          isExactReplay(
            current,
            CLAIMED_STATUS,
            input.operatorAccountId,
            input.expectedVersion,
          )
        ) {
          return this.readCaseRow(tx, input.tenantId, input.caseId);
        }
        assertReconciliationCaseTransition(current.status, CLAIMED_STATUS);
        if (current.version !== input.expectedVersion) {
          throw new ReconciliationCaseConflictError(STALE_VERSION_CONFLICT);
        }
        const updated = await tx.reconciliationCase.updateMany({
          where: {
            id: input.caseId,
            tenantId: input.tenantId,
            status: current.status,
            version: input.expectedVersion,
            // 无主单才能认领：别人已认领的单推不动（切片内没有抢占/改派）。
            ownerId: null,
          },
          data: {
            status: CLAIMED_STATUS,
            ownerId: input.operatorAccountId,
            version: { increment: 1 },
          },
        });
        if (updated.count !== 1) {
          const reread = await this.readCurrentCase(
            tx,
            input.tenantId,
            input.caseId,
          );
          if (reread === null) throw new ReconciliationCaseNotFoundError();
          if (
            isExactReplay(
              reread,
              CLAIMED_STATUS,
              input.operatorAccountId,
              input.expectedVersion,
            )
          ) {
            return this.readCaseRow(tx, input.tenantId, input.caseId);
          }
          throw new ReconciliationCaseConflictError(RACE_CONFLICT);
        }
        await this.writeAudit(tx, {
          tenantId: input.tenantId,
          actorId: input.operatorAccountId,
          action: CLAIMED_AUDIT_ACTION,
          resourceId: input.caseId,
          summary: CLAIMED_AUDIT_SUMMARY,
        });
        return this.readCaseRow(tx, input.tenantId, input.caseId);
      },
    );
  }

  /**
   * DS-013 开始处理：`CLAIMED -> PROCESSING`，只有该单**当前**处理人能推进。
   *
   * 与认领同一条流水线，两处差别即本命令的全部语义：
   * - 归属先判：处理人不是本命令操作人就冲突（409），**不**顺手改归属、也**不**接管；
   *   越权与版本过期撞在同一个状态码上，外部无法用错误差异探测别人的单；
   * - CAS 的 where 里 `ownerId` 是**操作人**（不是 `null`），`data` 里**不写** `ownerId`：
   *   开始处理不改归属，只推状态与版本。
   */
  async startProcessing(
    input: ReconciliationCaseTransitionCommand,
  ): Promise<ReconciliationCaseRow> {
    return withTenantContext(
      this.runtime,
      input.tenantId,
      async (tx: DbTransaction) => {
        const current = await this.readCurrentCase(
          tx,
          input.tenantId,
          input.caseId,
        );
        if (current === null) throw new ReconciliationCaseNotFoundError();
        if (
          isExactReplay(
            current,
            PROCESSING_STATUS,
            input.operatorAccountId,
            input.expectedVersion,
          )
        ) {
          return this.readCaseRow(tx, input.tenantId, input.caseId);
        }
        assertReconciliationCaseTransition(current.status, PROCESSING_STATUS);
        if (current.ownerId !== input.operatorAccountId) {
          throw new ReconciliationCaseConflictError(OWNERSHIP_CONFLICT);
        }
        if (current.version !== input.expectedVersion) {
          throw new ReconciliationCaseConflictError(STALE_VERSION_CONFLICT);
        }
        const updated = await tx.reconciliationCase.updateMany({
          where: {
            id: input.caseId,
            tenantId: input.tenantId,
            status: current.status,
            version: input.expectedVersion,
            ownerId: input.operatorAccountId,
          },
          data: {
            status: PROCESSING_STATUS,
            // 归属保持不变：谁认领的谁开始处理，命令里没有换人的口子。
            version: { increment: 1 },
          },
        });
        if (updated.count !== 1) {
          const reread = await this.readCurrentCase(
            tx,
            input.tenantId,
            input.caseId,
          );
          if (reread === null) throw new ReconciliationCaseNotFoundError();
          if (
            isExactReplay(
              reread,
              PROCESSING_STATUS,
              input.operatorAccountId,
              input.expectedVersion,
            )
          ) {
            return this.readCaseRow(tx, input.tenantId, input.caseId);
          }
          throw new ReconciliationCaseConflictError(RACE_CONFLICT);
        }
        await this.writeAudit(tx, {
          tenantId: input.tenantId,
          actorId: input.operatorAccountId,
          action: PROCESSING_AUDIT_ACTION,
          resourceId: input.caseId,
          summary: PROCESSING_AUDIT_SUMMARY,
        });
        return this.readCaseRow(tx, input.tenantId, input.caseId);
      },
    );
  }

  /**
   * DS-014 提交复核：`PROCESSING -> PENDING_REVIEW`，只有该单**当前**处理人能提交。
   *
   * 与 DS-013 同一条流水线，本命令的专属语义是「处理结果」：
   * - 归属先判（不是本人即冲突）；越权与版本过期共用 409，外部无法用错误差异探测别人的单；
   * - 关联交易在**同一事务内**验证：存在、本租户、`CONFIRMED`，三者合一固定 400；
   * - 只写状态、处理结果三件套与版本：**不**写复核人、复核时间、关闭时间，也**不**解析差异——
   *   自己提交的单不该由自己这一次调用顺手「解决」掉，那等于自审自批。
   */
  async submitReview(
    input: ReconciliationCaseSubmitReviewCommand,
  ): Promise<ReconciliationCaseRow> {
    return withTenantContext(
      this.runtime,
      input.tenantId,
      async (tx: DbTransaction) => {
        const current = await this.readCurrentCase(
          tx,
          input.tenantId,
          input.caseId,
        );
        if (current === null) throw new ReconciliationCaseNotFoundError();
        if (isSubmitReviewReplay(current, input)) {
          return this.readCaseRow(tx, input.tenantId, input.caseId);
        }
        assertReconciliationCaseTransition(
          current.status,
          PENDING_REVIEW_STATUS,
        );
        if (current.ownerId !== input.operatorAccountId) {
          throw new ReconciliationCaseConflictError(SUBMIT_OWNERSHIP_CONFLICT);
        }
        if (input.linkedTransactionId !== null) {
          await this.assertLinkedTransactionUsable(
            tx,
            input.tenantId,
            input.linkedTransactionId,
          );
        }
        if (current.version !== input.expectedVersion) {
          throw new ReconciliationCaseConflictError(STALE_VERSION_CONFLICT);
        }
        const updated = await tx.reconciliationCase.updateMany({
          where: {
            id: input.caseId,
            tenantId: input.tenantId,
            status: current.status,
            version: input.expectedVersion,
            ownerId: input.operatorAccountId,
          },
          data: {
            status: PENDING_REVIEW_STATUS,
            resolutionType: input.resolutionType,
            resolutionNote: input.resolutionNote,
            linkedTransactionId: input.linkedTransactionId,
            version: { increment: 1 },
          },
        });
        if (updated.count !== 1) {
          const reread = await this.readCurrentCase(
            tx,
            input.tenantId,
            input.caseId,
          );
          if (reread === null) throw new ReconciliationCaseNotFoundError();
          if (isSubmitReviewReplay(reread, input)) {
            return this.readCaseRow(tx, input.tenantId, input.caseId);
          }
          throw new ReconciliationCaseConflictError(RACE_CONFLICT);
        }
        await this.writeAudit(tx, {
          tenantId: input.tenantId,
          actorId: input.operatorAccountId,
          action: SUBMIT_REVIEW_AUDIT_ACTION,
          resourceId: input.caseId,
          summary: SUBMIT_REVIEW_AUDIT_SUMMARY,
        });
        return this.readCaseRow(tx, input.tenantId, input.caseId);
      },
    );
  }

  /**
   * DS-014 复核关闭：`PENDING_REVIEW -> CLOSED`，复核人**必须不是**处理人。
   *
   * 本命令是切片内**唯一**能让差异落 `resolvedAt` 的地方，所以三件事必须同时成立：
   * - 复核人与处理人分离（本切片没有 owner/admin 覆盖口子，自己提交的单自己关不了）；
   * - 已落库的处理结果自洽，且 `LEDGER_TRANSACTION` 指向的交易**此刻**仍是本租户 `CONFIRMED`；
   * - 状态、版本、归属一起进 CAS，关闭与差异解析在**同一事务、同一个数据库时间戳**内完成。
   *
   * 请求体只带 `expectedVersion`：复核人只在服务端从登录态取，处理结果只从库里读。
   */
  async close(
    input: ReconciliationCaseTransitionCommand,
  ): Promise<ReconciliationCaseRow> {
    return withTenantContext(
      this.runtime,
      input.tenantId,
      async (tx: DbTransaction) => {
        const current = await this.readCurrentCase(
          tx,
          input.tenantId,
          input.caseId,
        );
        if (current === null) throw new ReconciliationCaseNotFoundError();
        if (isCloseReplay(current, input)) {
          return this.readCaseRow(tx, input.tenantId, input.caseId);
        }
        assertReconciliationCaseTransition(current.status, CLOSED_STATUS);
        // 复核人分离先于一切：自己提交的单，连「处理结果是否自洽」都不该替对方看。
        if (current.ownerId === input.operatorAccountId) {
          throw new ReconciliationCaseConflictError(REVIEWER_CONFLICT);
        }
        // 下面校验的是**已落库**的处理结果，不是请求体——关闭命令根本不接受这些字段。
        const persistedResolutionType = readPersistedResolutionType(
          current.resolutionType,
        );
        if (
          current.resolutionNote === null ||
          current.resolutionNote.trim() === ""
        ) {
          throw new Error(RESOLUTION_NOTE_MISSING);
        }
        if (persistedResolutionType === "LEDGER_TRANSACTION") {
          if (current.linkedTransactionId === null) {
            throw new Error(RESOLUTION_LINK_INCONSISTENT);
          }
          // 「仍然」指向：提交复核时确认过的交易，可能在复核期间被反向或改了状态。
          await this.assertLinkedTransactionUsable(
            tx,
            input.tenantId,
            current.linkedTransactionId,
          );
        } else if (current.linkedTransactionId !== null) {
          throw new Error(RESOLUTION_LINK_INCONSISTENT);
        }
        if (current.version !== input.expectedVersion) {
          throw new ReconciliationCaseConflictError(STALE_VERSION_CONFLICT);
        }
        const now = await readDatabaseNow(tx);
        const updated = await tx.reconciliationCase.updateMany({
          where: {
            id: input.caseId,
            tenantId: input.tenantId,
            status: current.status,
            version: input.expectedVersion,
            // 处理人也要进 CAS：并发改派（本切片没有，属纵深防御）不会把单关到别人名下。
            ownerId: current.ownerId,
          },
          data: {
            status: CLOSED_STATUS,
            reviewedBy: input.operatorAccountId,
            // 同一个数据库时间戳写两列：分成两次取会给出两个时刻，「复核」与「关闭」就不同刻了。
            reviewedAt: now,
            closedAt: now,
            version: { increment: 1 },
          },
        });
        if (updated.count !== 1) {
          const reread = await this.readCurrentCase(
            tx,
            input.tenantId,
            input.caseId,
          );
          if (reread === null) throw new ReconciliationCaseNotFoundError();
          if (isCloseReplay(reread, input)) {
            return this.readCaseRow(tx, input.tenantId, input.caseId);
          }
          throw new ReconciliationCaseConflictError(RACE_CONFLICT);
        }
        await this.resolveDifference(
          tx,
          input.tenantId,
          current.differenceId,
          now,
        );
        await this.writeAudit(tx, {
          tenantId: input.tenantId,
          actorId: input.operatorAccountId,
          action: CLOSED_AUDIT_ACTION,
          resourceId: input.caseId,
          summary: CLOSED_AUDIT_SUMMARY,
        });
        return this.readCaseRow(tx, input.tenantId, input.caseId);
      },
    );
  }

  /**
   * DS-014 忽略：带理由终止，`OPEN -> IGNORED` 任意 `finance.manage` 可做，
   * `CLAIMED -> IGNORED` 只有**当前处理人**能做；`PROCESSING`/`PENDING_REVIEW`/终态都进不来（DS-010 裁决）。
   *
   * - `resolutionType` 写的是内部字面量 `IGNORED`：它不在客户端可请求的词表里，
   *   只能由这条命令产生，所以「想忽略」没有第二条路径；
   * - `reviewedBy` / `reviewedAt` **保持为空**：忽略不是复核通过，
   *   拿复核字段记「是谁忽略的」会污染这两个字段的语义（库里也没有忽略人列）；
   * - 与关闭同权限地解析差异：忽略也是终态，差异同样必须落 `resolvedAt`，
   *   否则未解决计数永远降不下来。
   */
  async ignore(
    input: ReconciliationCaseIgnoreCommand,
  ): Promise<ReconciliationCaseRow> {
    return withTenantContext(
      this.runtime,
      input.tenantId,
      async (tx: DbTransaction) => {
        const current = await this.readCurrentCase(
          tx,
          input.tenantId,
          input.caseId,
        );
        if (current === null) throw new ReconciliationCaseNotFoundError();
        if (isIgnoreReplay(current, input)) {
          return this.readCaseRow(tx, input.tenantId, input.caseId);
        }
        assertReconciliationCaseTransition(current.status, IGNORED_STATUS);
        // 来源决定归属：OPEN 还没人认领，谁都能判它无效；CLAIMED 是别人正在处理的单，推不动。
        if (
          current.status === CLAIMED_STATUS &&
          current.ownerId !== input.operatorAccountId
        ) {
          throw new ReconciliationCaseConflictError(IGNORE_OWNERSHIP_CONFLICT);
        }
        if (current.version !== input.expectedVersion) {
          throw new ReconciliationCaseConflictError(STALE_VERSION_CONFLICT);
        }
        const now = await readDatabaseNow(tx);
        const updated = await tx.reconciliationCase.updateMany({
          where: {
            id: input.caseId,
            tenantId: input.tenantId,
            status: current.status,
            version: input.expectedVersion,
            // 来源决定的归属谓词：OPEN 必须**仍**无主，CLAIMED 必须**仍**是本人。
            ownerId:
              current.status === OPEN_STATUS ? null : input.operatorAccountId,
          },
          data: {
            status: IGNORED_STATUS,
            resolutionType: RECONCILIATION_CASE_IGNORED_RESOLUTION_TYPE,
            resolutionNote: input.reason,
            linkedTransactionId: null,
            closedAt: now,
            version: { increment: 1 },
          },
        });
        if (updated.count !== 1) {
          const reread = await this.readCurrentCase(
            tx,
            input.tenantId,
            input.caseId,
          );
          if (reread === null) throw new ReconciliationCaseNotFoundError();
          if (isIgnoreReplay(reread, input)) {
            return this.readCaseRow(tx, input.tenantId, input.caseId);
          }
          throw new ReconciliationCaseConflictError(RACE_CONFLICT);
        }
        await this.resolveDifference(
          tx,
          input.tenantId,
          current.differenceId,
          now,
        );
        await this.writeAudit(tx, {
          tenantId: input.tenantId,
          actorId: input.operatorAccountId,
          action: IGNORED_AUDIT_ACTION,
          resourceId: input.caseId,
          summary: ignoredAuditSummary(current.status),
        });
        return this.readCaseRow(tx, input.tenantId, input.caseId);
      },
    );
  }

  /** 命令路径的一次读：`id + tenantId` 都进 where，取 `CASE_GUARD_SELECT` 那份投影。 */
  private async readCurrentCase(
    tx: DbTransaction,
    tenantId: string,
    caseId: string,
  ): Promise<ReconciliationCaseGuardRow | null> {
    return tx.reconciliationCase.findFirst({
      where: { id: caseId, tenantId },
      select: CASE_GUARD_SELECT,
    });
  }

  /**
   * 关联交易校验：存在、本租户、`CONFIRMED` 三者合一，任一不满足都是**同一个**固定 400。
   *
   * 用 `findFirst` 而不是 `findUnique`：`tenantId` 必须显式进 where，
   * 否则别的租户的 id 会被当成「存在」——RLS 是纵深防御，不是唯一防线。
   * 三种失败不可区分：区分它们等于给探测者一个「这个 id 在别的租户存在」的判据。
   */
  private async assertLinkedTransactionUsable(
    tx: DbTransaction,
    tenantId: string,
    linkedTransactionId: string,
  ): Promise<void> {
    const linked = await tx.ledgerTransaction.findFirst({
      where: { id: linkedTransactionId, tenantId, status: "CONFIRMED" },
      select: { id: true },
    });
    if (linked === null) {
      throw new ReconciliationCaseInputError(LINKED_TRANSACTION_UNAVAILABLE);
    }
  }

  /**
   * 终态命令解析差异：`resolvedAt` 从 null 落到 `now`，**只能成功一次**。
   *
   * `count !== 1` 即不变量失败（500，通用 `Error`）：差异已被解析、不存在或不在本租户，
   * 都说明「赢下终态转移」与「差异可解析」这两件事对不上。抛在这里即整笔回滚，
   * 绝不静默成功——那会留下一个已终态却仍未解决的差异。
   */
  private async resolveDifference(
    tx: DbTransaction,
    tenantId: string,
    differenceId: string,
    now: Date,
  ): Promise<void> {
    const resolved = await tx.reconciliationDifference.updateMany({
      where: { id: differenceId, tenantId, resolvedAt: null },
      data: { resolvedAt: now },
    });
    if (resolved.count !== 1) {
      throw new Error(DIFFERENCE_RESOLVE_FAILED);
    }
  }

  /**
   * 读回完整契约行（成功路径与重放路径共用）。
   *
   * 这里读不到行是**不可能**的：调用点要么刚在同一事务里改过这一行，要么刚读到过它。
   * 真出现只能是数据被并发删除之类的完整性问题，所以按不变量失败上抛（500），
   * 绝不降级成 404 或假成功——「改了但查不到」必须炸出来，不能被静默吞掉。
   */
  private async readCaseRow(
    tx: DbTransaction,
    tenantId: string,
    caseId: string,
  ): Promise<ReconciliationCaseRow> {
    const row = await tx.reconciliationCase.findFirst({
      where: { id: caseId, tenantId },
      select: CASE_ROW_SELECT,
    });
    if (row === null) {
      throw new Error("对账处理单在更新后消失（数据不一致）");
    }
    return row;
  }

  /** 一条审计：与状态变更同事务写入；`action`/`summary` 由调用点给定固定值，不含客户端原文。 */
  private async writeAudit(
    tx: DbTransaction,
    entry: {
      tenantId: string;
      actorId: string;
      action: string;
      resourceId: string;
      summary: string;
    },
  ): Promise<void> {
    await tx.auditLog.create({
      data: {
        tenantId: entry.tenantId,
        actorType: "tenant_account",
        actorId: entry.actorId,
        action: entry.action,
        resourceType: RECONCILIATION_CASE_RESOURCE_TYPE,
        resourceId: entry.resourceId,
        summary: entry.summary,
      },
    });
  }
}
