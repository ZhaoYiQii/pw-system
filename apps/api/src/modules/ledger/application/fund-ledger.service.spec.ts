import { describe, expect, it } from "vitest";
import {
  FundLedgerExportLimitError,
  FundLedgerInputError,
  FUND_LEDGER_DEFAULT_PAGE_SIZE,
  FUND_LEDGER_EXPORT_MAX_ROWS,
  FUND_LEDGER_MAX_PAGE_SIZE,
  FUND_LEDGER_SEARCH_MAX_LENGTH,
  FUND_LEDGER_SOURCE_TYPE_MAX_LENGTH,
} from "./fund-ledger-ports.js";
import type {
  FundLedgerEntryRow,
  FundLedgerPage,
  FundLedgerQuery,
  FundLedgerQueryInput,
  FundLedgerRepository,
  FundLedgerTransactionRow,
} from "./fund-ledger-ports.js";
import { FundLedgerService } from "./fund-ledger.service.js";

const TENANT_ID = "11111111-1111-1111-1111-111111111111";
const TRANSACTION_ID = "22222222-2222-2222-2222-222222222222";
const FUND_ACCOUNT_ID = "33333333-3333-3333-3333-333333333333";
const OTHER_FUND_ACCOUNT_ID = "44444444-4444-4444-4444-444444444444";
const CUSTOMER_PROFILE_ID = "55555555-5555-5555-5555-555555555555";
const SETTLEMENT_BATCH_ID = "66666666-6666-6666-6666-666666666666";
const ACTOR_ID = "77777777-7777-7777-7777-777777777777";

/** 内存 fake：只记录服务交给仓储的查询，不做数据库、不 mock Prisma 内部。 */
class FakeFundLedgerRepository implements FundLedgerRepository {
  lastQuery: FundLedgerQuery | null = null;
  callCount = 0;

  constructor(private readonly page: FundLedgerPage) {}

  async listTransactions(query: FundLedgerQuery): Promise<FundLedgerPage> {
    this.lastQuery = query;
    this.callCount += 1;
    return this.page;
  }
}

function emptyPage(): FundLedgerPage {
  return { rows: [], total: 0 };
}

function serviceWith(page: FundLedgerPage = emptyPage()): {
  service: FundLedgerService;
  repo: FakeFundLedgerRepository;
} {
  const repo = new FakeFundLedgerRepository(page);
  return { service: new FundLedgerService(repo), repo };
}

function entry(
  overrides: Partial<FundLedgerEntryRow> = {},
): FundLedgerEntryRow {
  return {
    transactionId: TRANSACTION_ID,
    direction: "DEBIT",
    amountFen: 10000n,
    fundAccountId: null,
    auxiliaryType: "customer_profile",
    auxiliaryId: CUSTOMER_PROFILE_ID,
    ...overrides,
  };
}

/** 一借一贷的常规交易；默认贷方挂在交易头资金账户上。 */
function balancedEntries(amountFen = 10000n): FundLedgerEntryRow[] {
  return [
    entry({ direction: "DEBIT", amountFen, fundAccountId: null }),
    entry({ direction: "CREDIT", amountFen, fundAccountId: FUND_ACCOUNT_ID }),
  ];
}

function transactionRow(
  overrides: Partial<FundLedgerTransactionRow> = {},
): FundLedgerTransactionRow {
  return {
    id: TRANSACTION_ID,
    txNo: "LT00000000000000000000000000000001",
    description: "支付已确认",
    sourceType: "payment_order",
    sourceId: "88888888-8888-8888-8888-888888888888",
    eventType: "PAYMENT_CONFIRMED",
    status: "CONFIRMED",
    fundAccountId: FUND_ACCOUNT_ID,
    createdBy: ACTOR_ID,
    confirmedBy: ACTOR_ID,
    occurredAt: new Date("2026-09-24T12:00:00.000Z"),
    confirmedAt: new Date("2026-09-24T12:00:00.000Z"),
    createdAt: new Date("2026-09-24T12:00:00.000Z"),
    entries: balancedEntries(),
    fundAccount: {
      id: FUND_ACCOUNT_ID,
      code: "WECHAT_MAIN",
      name: "微信主账户",
      kind: "WECHAT_SETTLEMENT",
      status: "ACTIVE",
    },
    ...overrides,
  };
}

async function viewOf(
  overrides: Partial<FundLedgerTransactionRow> = {},
): Promise<Awaited<ReturnType<FundLedgerService["list"]>>> {
  const { service } = serviceWith({
    rows: [transactionRow(overrides)],
    total: 1,
  });
  return service.list({ tenantId: TENANT_ID });
}

describe("DS-007 统一资金台账查询：默认值与边界规范化", () => {
  it("未提供分页与排序时使用默认值（默认 occurredAt desc、第 1 页、50 条）", async () => {
    const { service, repo } = serviceWith();

    const view = await service.list({ tenantId: TENANT_ID });

    expect(view.rows).toEqual([]);
    expect(view.total).toBe(0);
    expect(view.page).toBe(1);
    expect(view.pageSize).toBe(FUND_LEDGER_DEFAULT_PAGE_SIZE);
    expect(view.sortBy).toBe("occurredAt");
    expect(view.sortDir).toBe("desc");
    expect(repo.lastQuery?.page).toBe(1);
    expect(repo.lastQuery?.pageSize).toBe(50);
    expect(repo.lastQuery?.sortBy).toBe("occurredAt");
    expect(repo.lastQuery?.sortDir).toBe("desc");
    // 一次查询只调用仓储一次：列表与计数必须来自同一次读取。
    expect(repo.callCount).toBe(1);
  });

  it("未提供的过滤条件保持缺席，不被空串或默认值顶替", async () => {
    const { service, repo } = serviceWith();

    await service.list({ tenantId: TENANT_ID });

    const query = repo.lastQuery;
    expect(query).not.toBeNull();
    expect(Object.keys(query ?? {}).sort()).toEqual([
      "page",
      "pageSize",
      "sortBy",
      "sortDir",
      "tenantId",
    ]);
    expect(query !== null && "status" in query).toBe(false);
    expect(query !== null && "q" in query).toBe(false);
    expect(query !== null && "minAmountFen" in query).toBe(false);
  });

  it("合法枚举、账户、来源、搜索、时间与金额被规范化后交给仓储", async () => {
    const { service, repo } = serviceWith();

    await service.list({
      tenantId: TENANT_ID,
      eventType: "PAYMENT_CONFIRMED",
      status: "RECONCILED",
      fundAccountId: ` ${FUND_ACCOUNT_ID} `,
      sourceType: " payment_order ",
      q: "  LT2026  ",
      occurredFrom: "2026-09-01T00:00:00.000Z",
      occurredTo: "2026-09-24T20:00:00+08:00",
      minAmountFen: " 100 ",
      maxAmountFen: "9007199254740993",
      sortBy: "amountFen",
      sortDir: "asc",
      page: "3",
      pageSize: "200",
    });

    const query = repo.lastQuery;
    expect(query?.tenantId).toBe(TENANT_ID);
    expect(query?.eventType).toBe("PAYMENT_CONFIRMED");
    expect(query?.status).toBe("RECONCILED");
    expect(query?.fundAccountId).toBe(FUND_ACCOUNT_ID);
    expect(query?.sourceType).toBe("payment_order");
    expect(query?.q).toBe("LT2026");
    expect(query?.occurredFrom?.toISOString()).toBe("2026-09-01T00:00:00.000Z");
    // 带 +08:00 的等价写法：按同一时刻收下，不做静默改写。
    expect(query?.occurredTo?.toISOString()).toBe("2026-09-24T12:00:00.000Z");
    expect(query?.minAmountFen).toBe(100n);
    // 超过 Number.MAX_SAFE_INTEGER 的边界值必须原样成为 BigInt，不经过 number。
    expect(query?.maxAmountFen).toBe(9007199254740993n);
    expect(query?.sortBy).toBe("amountFen");
    expect(query?.sortDir).toBe("asc");
    expect(query?.page).toBe(3);
    expect(query?.pageSize).toBe(FUND_LEDGER_MAX_PAGE_SIZE);
  });

  it("只有 q 的空白串按「未提供」处理（不报错、也不当成过滤条件）", async () => {
    const { service, repo } = serviceWith();

    await service.list({ tenantId: TENANT_ID, q: "  \t " });

    const query = repo.lastQuery;
    expect(query).not.toBeNull();
    expect(query !== null && "q" in query).toBe(false);
    // 空白 q 只是不过滤，查询照常执行一次。
    expect(repo.callCount).toBe(1);
  });

  it("超过 int8 上限的金额（9223372036854775808）仍无精度损失地解析成 BigInt", async () => {
    const { service, repo } = serviceWith();

    await service.list({
      tenantId: TENANT_ID,
      minAmountFen: " 9223372036854775808 ",
      maxAmountFen: "9223372036854775808",
    });

    // 该值超出 PostgreSQL int8（2^63 - 1）：必须以十进制字符串一路带到 SQL 端按 numeric 比较，
    // 任何一次 `Number()` 或 int8 cast 都会在这里变成溢出。
    expect(typeof repo.lastQuery?.minAmountFen).toBe("bigint");
    expect(repo.lastQuery?.minAmountFen).toBe(9223372036854775808n);
    expect(repo.lastQuery?.maxAmountFen).toBe(9223372036854775808n);
    expect(repo.lastQuery?.minAmountFen?.toString()).toBe(
      "9223372036854775808",
    );
  });
});

describe("DS-007 非法输入一律拒绝并指出字段（不静默回退）", () => {
  const invalidInputs: ReadonlyArray<{
    label: string;
    input: Omit<FundLedgerQueryInput, "tenantId">;
    field: string;
  }> = [
    {
      label: "枚举外的 eventType",
      input: { eventType: "PAYMENT" },
      field: "eventType",
    },
    { label: "枚举外的 status", input: { status: "PAID" }, field: "status" },
    {
      label: "非 uuid 的资金账户",
      input: { fundAccountId: "not-a-uuid" },
      field: "fundAccountId",
    },
    {
      label: "超长 sourceType",
      input: {
        sourceType: "x".repeat(FUND_LEDGER_SOURCE_TYPE_MAX_LENGTH + 1),
      },
      field: "sourceType",
    },
    {
      label: "超长搜索词",
      input: { q: "x".repeat(FUND_LEDGER_SEARCH_MAX_LENGTH + 1) },
      field: "q",
    },
    {
      label: "模糊日期串",
      input: { occurredFrom: "2026-09-24" },
      field: "occurredFrom",
    },
    {
      label: "不带时区的时间",
      input: { occurredTo: "2026-09-24T12:00:00" },
      field: "occurredTo",
    },
    {
      label: "滚动日期（2 月 31 日）",
      input: { occurredFrom: "2026-02-31T00:00:00.000Z" },
      field: "occurredFrom",
    },
    {
      label: "区间反向",
      input: {
        occurredFrom: "2026-09-24T12:00:00.000Z",
        occurredTo: "2026-09-23T12:00:00.000Z",
      },
      field: "occurredTo",
    },
    {
      label: "区间为空（上下界相等）",
      input: {
        occurredFrom: "2026-09-24T12:00:00.000Z",
        occurredTo: "2026-09-24T12:00:00.000Z",
      },
      field: "occurredTo",
    },
    {
      label: "小数金额",
      input: { minAmountFen: "1.5" },
      field: "minAmountFen",
    },
    { label: "负数金额", input: { minAmountFen: "-1" }, field: "minAmountFen" },
    {
      label: "前导零金额",
      input: { maxAmountFen: "01" },
      field: "maxAmountFen",
    },
    {
      label: "非字符串金额",
      input: { minAmountFen: 100 },
      field: "minAmountFen",
    },
    {
      label: "金额上界小于下界",
      input: { minAmountFen: "100", maxAmountFen: "99" },
      field: "maxAmountFen",
    },
    {
      label: "白名单外的 sortBy",
      input: { sortBy: "amount" },
      field: "sortBy",
    },
    { label: "大写 sortDir", input: { sortDir: "ASC" }, field: "sortDir" },
    { label: "页码 0", input: { page: "0" }, field: "page" },
    { label: "页码小数", input: { page: "1.5" }, field: "page" },
    { label: "页码非数字", input: { page: "first" }, field: "page" },
    { label: "页大小 0", input: { pageSize: "0" }, field: "pageSize" },
    {
      label: "页大小超过上限",
      input: { pageSize: String(FUND_LEDGER_MAX_PAGE_SIZE + 1) },
      field: "pageSize",
    },
    // 重复查询参数在 NestJS 里会变成数组；运行时按「非字符串」拒绝，而不是当成合法值。
    {
      label: "重复的枚举参数",
      input: { status: ["CONFIRMED", "RECONCILED"] },
      field: "status",
    },
  ];

  it.each(invalidInputs)(
    "$label → 输入错误并指明字段，且未触达仓储",
    async ({ input, field }) => {
      const { service, repo } = serviceWith();
      const call = () => service.list({ tenantId: TENANT_ID, ...input });

      await expect(call()).rejects.toBeInstanceOf(FundLedgerInputError);
      await expect(call()).rejects.toThrow(field);
      // 非法输入绝不能带着默认值进仓储（否则就是静默回退）。
      expect(repo.lastQuery).toBeNull();
      expect(repo.callCount).toBe(0);
    },
  );

  /**
   * 除 `q` 外，任何参数「提供了但 trim 后为空」都必须报错：
   * 空白若被当成「未提供」，用户以为过滤生效、实际拿到的是全量数据（或默认页）。
   */
  const blankInputs: ReadonlyArray<{
    label: string;
    input: Omit<FundLedgerQueryInput, "tenantId">;
    field: string;
  }> = [
    {
      label: "空白的 eventType",
      input: { eventType: " " },
      field: "eventType",
    },
    { label: "空白的 status", input: { status: "\t" }, field: "status" },
    {
      label: "空白的 fundAccountId",
      input: { fundAccountId: "  " },
      field: "fundAccountId",
    },
    {
      label: "空白的 sourceType",
      input: { sourceType: "" },
      field: "sourceType",
    },
    {
      label: "空白的 occurredFrom",
      input: { occurredFrom: " \n " },
      field: "occurredFrom",
    },
    {
      label: "空白的 occurredTo",
      input: { occurredTo: "   " },
      field: "occurredTo",
    },
    {
      label: "空白的 minAmountFen",
      input: { minAmountFen: " " },
      field: "minAmountFen",
    },
    {
      label: "空白的 maxAmountFen",
      input: { maxAmountFen: "" },
      field: "maxAmountFen",
    },
    { label: "空白的 sortBy", input: { sortBy: "  " }, field: "sortBy" },
    { label: "空白的 sortDir", input: { sortDir: " " }, field: "sortDir" },
    { label: "空白的 page", input: { page: " " }, field: "page" },
    { label: "空白的 pageSize", input: { pageSize: "  " }, field: "pageSize" },
  ];

  it.each(blankInputs)(
    "$label → 拒绝而不是回退默认值，且未触达仓储",
    async ({ input, field }) => {
      const { service, repo } = serviceWith();
      const call = () => service.list({ tenantId: TENANT_ID, ...input });

      await expect(call()).rejects.toBeInstanceOf(FundLedgerInputError);
      await expect(call()).rejects.toThrow(field);
      // 绝不能带着默认值进仓储（否则就是静默回退）。
      expect(repo.lastQuery).toBeNull();
      expect(repo.callCount).toBe(0);
    },
  );

  it("缺少租户上下文时拒绝（租户只来自服务端登录态）", async () => {
    const { service } = serviceWith();

    await expect(service.list({ tenantId: " " })).rejects.toBeInstanceOf(
      FundLedgerInputError,
    );
  });
});

describe("DS-007 金额派生：整数分不丢失精度、借贷不重复累计", () => {
  it("BigInt 只以十进制字符串输出，超过 Number.MAX_SAFE_INTEGER 也不丢精度", async () => {
    const huge = 9007199254740993n;
    const view = await viewOf({ entries: balancedEntries(huge) });
    const first = view.rows[0];

    expect(typeof first?.amountFen).toBe("string");
    expect(first?.amountFen).toBe("9007199254740993");
    expect(first?.debitFen).toBe("9007199254740993");
    expect(first?.creditFen).toBe("9007199254740993");
    // 若中途经过 number，末位会被抹成 ...992。
    expect(first?.amountFen).not.toBe("9007199254740992");
  });

  it("借贷两边相等时 amountFen 不翻倍且 balanced=true", async () => {
    const view = await viewOf({ entries: balancedEntries(10000n) });
    const first = view.rows[0];

    expect(first?.amountFen).toBe("10000");
    expect(first?.debitFen).toBe("10000");
    expect(first?.creditFen).toBe("10000");
    expect(first?.amountFen).not.toBe("20000");
    expect(first?.balanced).toBe(true);
  });

  it("不平衡的历史行仍然返回并标记 balanced=false，不会让整页查询失败", async () => {
    const view = await viewOf({
      entries: [
        entry({ direction: "DEBIT", amountFen: 10000n }),
        entry({
          direction: "CREDIT",
          amountFen: 6000n,
          fundAccountId: FUND_ACCOUNT_ID,
        }),
      ],
    });
    const first = view.rows[0];

    expect(view.rows).toHaveLength(1);
    expect(first?.amountFen).toBe("10000");
    expect(first?.creditFen).toBe("6000");
    expect(first?.balanced).toBe(false);
    expect(first?.reconciliationStatus).toBe("UNRECONCILED");
  });

  it("没有分录或金额为零的交易不算平衡（amountFen 为 0）", async () => {
    const empty = await viewOf({ entries: [] });
    expect(empty.rows[0]?.amountFen).toBe("0");
    expect(empty.rows[0]?.balanced).toBe(false);

    const zero = await viewOf({
      entries: [
        entry({ direction: "DEBIT", amountFen: 0n }),
        entry({
          direction: "CREDIT",
          amountFen: 0n,
          fundAccountId: FUND_ACCOUNT_ID,
        }),
      ],
    });
    expect(zero.rows[0]?.balanced).toBe(false);
  });
});

describe("DS-007 资金流方向派生（只看交易头资金账户上的分录）", () => {
  it("只有借方 → DEBIT，只有贷方 → CREDIT，两种都有 → MIXED", async () => {
    const debitOnly = await viewOf({
      entries: [entry({ direction: "DEBIT", fundAccountId: FUND_ACCOUNT_ID })],
    });
    expect(debitOnly.rows[0]?.fundFlowDirection).toBe("DEBIT");

    const creditOnly = await viewOf({
      entries: [entry({ direction: "CREDIT", fundAccountId: FUND_ACCOUNT_ID })],
    });
    expect(creditOnly.rows[0]?.fundFlowDirection).toBe("CREDIT");

    const mixed = await viewOf({
      entries: [
        entry({ direction: "DEBIT", fundAccountId: FUND_ACCOUNT_ID }),
        entry({ direction: "CREDIT", fundAccountId: FUND_ACCOUNT_ID }),
      ],
    });
    expect(mixed.rows[0]?.fundFlowDirection).toBe("MIXED");
  });

  it("没有挂接交易头资金账户的分录 → null（含交易头资金账户为空的情况）", async () => {
    const otherAccount = await viewOf({
      entries: [
        entry({ direction: "CREDIT", fundAccountId: OTHER_FUND_ACCOUNT_ID }),
      ],
    });
    expect(otherAccount.rows[0]?.fundFlowDirection).toBeNull();

    const noHeaderAccount = await viewOf({
      fundAccountId: null,
      fundAccount: null,
      entries: [entry({ direction: "CREDIT", fundAccountId: FUND_ACCOUNT_ID })],
    });
    expect(noHeaderAccount.rows[0]?.fundFlowDirection).toBeNull();
  });
});

describe("DS-007 辅助核算引用：去重且稳定排序", () => {
  it("按 (type, id) 去重排序，任一字段为空的分录不生成引用", async () => {
    const view = await viewOf({
      entries: [
        entry({
          auxiliaryType: "settlement_batch",
          auxiliaryId: SETTLEMENT_BATCH_ID,
        }),
        entry({
          auxiliaryType: "customer_profile",
          auxiliaryId: CUSTOMER_PROFILE_ID,
        }),
        // 重复项
        entry({
          auxiliaryType: "settlement_batch",
          auxiliaryId: SETTLEMENT_BATCH_ID,
        }),
        // 缺 type / 缺 id / 空 type / 空 id：都不生成引用（空 = null 或空串）
        entry({ auxiliaryType: null, auxiliaryId: SETTLEMENT_BATCH_ID }),
        entry({ auxiliaryType: "customer_profile", auxiliaryId: null }),
        entry({ auxiliaryType: "", auxiliaryId: SETTLEMENT_BATCH_ID }),
        entry({ auxiliaryType: "customer_profile", auxiliaryId: "" }),
      ],
      fundAccountId: null,
      fundAccount: null,
    });

    expect(view.rows[0]?.auxiliaries).toEqual([
      { type: "customer_profile", id: CUSTOMER_PROFILE_ID },
      { type: "settlement_batch", id: SETTLEMENT_BATCH_ID },
    ]);
  });

  it("输入顺序不同不会改变输出顺序（稳定排序）", async () => {
    const forward = await viewOf({
      entries: [
        entry({
          auxiliaryType: "customer_profile",
          auxiliaryId: CUSTOMER_PROFILE_ID,
        }),
        entry({
          auxiliaryType: "settlement_batch",
          auxiliaryId: SETTLEMENT_BATCH_ID,
        }),
      ],
    });
    const backward = await viewOf({
      entries: [
        entry({
          auxiliaryType: "settlement_batch",
          auxiliaryId: SETTLEMENT_BATCH_ID,
        }),
        entry({
          auxiliaryType: "customer_profile",
          auxiliaryId: CUSTOMER_PROFILE_ID,
        }),
      ],
    });

    expect(forward.rows[0]?.auxiliaries).toEqual(backward.rows[0]?.auxiliaries);
  });
});

describe("DS-007 视图契约：字段集合固定、可空显式 null、分页原样透传", () => {
  it("视图行恰好包含契约字段，可空字段显式为 null 而不是缺失", async () => {
    const view = await viewOf({
      description: null,
      sourceType: null,
      sourceId: null,
      eventType: null,
      confirmedAt: null,
      createdBy: null,
      confirmedBy: null,
      fundAccount: null,
    });
    const first = view.rows[0];

    expect(Object.keys(first ?? {}).sort()).toEqual([
      "amountFen",
      "auxiliaries",
      "balanced",
      "confirmedAt",
      "confirmedBy",
      "createdAt",
      "createdBy",
      "creditFen",
      "debitFen",
      "description",
      "eventType",
      "fundAccount",
      "fundFlowDirection",
      "occurredAt",
      "reconciliationStatus",
      "sourceId",
      "sourceType",
      "status",
      "transactionId",
      "txNo",
    ]);
    expect(first?.description).toBeNull();
    expect(first?.fundAccount).toBeNull();
    expect(first?.confirmedAt).toBeNull();
    // 「显式为 null」而不是「字段被省略」
    expect(first !== undefined && "confirmedAt" in first).toBe(true);
    expect(first?.occurredAt).toBe("2026-09-24T12:00:00.000Z");
    expect(first?.createdAt).toBe("2026-09-24T12:00:00.000Z");
  });

  it("资金账户与操作者按仓储返回原样输出", async () => {
    const view = await viewOf();
    const first = view.rows[0];

    expect(first?.fundAccount).toEqual({
      id: FUND_ACCOUNT_ID,
      code: "WECHAT_MAIN",
      name: "微信主账户",
      kind: "WECHAT_SETTLEMENT",
      status: "ACTIVE",
    });
    expect(first?.createdBy).toBe(ACTOR_ID);
    expect(first?.sourceType).toBe("payment_order");
    expect(first?.eventType).toBe("PAYMENT_CONFIRMED");
    expect(first?.status).toBe("CONFIRMED");
  });

  it("reconciliationStatus 只映射 RECONCILED，原始 status 同时保留", async () => {
    const reconciled = await viewOf({ status: "RECONCILED" });
    expect(reconciled.rows[0]?.reconciliationStatus).toBe("RECONCILED");
    expect(reconciled.rows[0]?.status).toBe("RECONCILED");

    for (const status of ["DRAFT", "CONFIRMED", "REVERSED"] as const) {
      const view = await viewOf({ status });
      expect(view.rows[0]?.reconciliationStatus).toBe("UNRECONCILED");
      expect(view.rows[0]?.status).toBe(status);
    }
  });

  it("原样保留仓储的 total/page/pageSize/sortBy/sortDir", async () => {
    const { service, repo } = serviceWith({
      rows: [transactionRow()],
      total: 137,
    });

    const view = await service.list({
      tenantId: TENANT_ID,
      page: "4",
      pageSize: "25",
      sortBy: "txNo",
      sortDir: "asc",
    });

    expect(view.total).toBe(137);
    expect(view.page).toBe(4);
    expect(view.pageSize).toBe(25);
    expect(view.sortBy).toBe("txNo");
    expect(view.sortDir).toBe("asc");
    expect(view.rows).toHaveLength(1);
    expect(Object.keys(view).sort()).toEqual([
      "page",
      "pageSize",
      "rows",
      "sortBy",
      "sortDir",
      "total",
    ]);
    expect(repo.callCount).toBe(1);
  });

  it("空结果：rows 为空数组、total 照常返回", async () => {
    const { service } = serviceWith({ rows: [], total: 12 });

    const view = await service.list({ tenantId: TENANT_ID, page: "2" });

    expect(view.rows).toEqual([]);
    expect(view.total).toBe(12);
    expect(view.page).toBe(2);
  });
});

/** BOM 用 `String.fromCharCode` 构造：字面量控制字符会让源文件在 diff/grep 中失真。 */
const BOM = String.fromCharCode(0xfeff);
const ROW_CREATED_AT = "2026-09-24T12:00:00.000Z";

/** 去掉 BOM 后按 CRLF 切行：末行之后留下的空串即「末尾 CRLF」。 */
function csvLines(csv: string): string[] {
  return csv.slice(1).split("\r\n");
}

/** 第 `lineIndex` 行（0 = 表头）的单元格。 */
function csvCells(csv: string, lineIndex: number): string[] {
  return (csvLines(csv)[lineIndex] ?? "").split(",");
}

describe("DS-008 资金台账 CSV 导出：参数同源与固定内部分页", () => {
  it("复用列表的同一解析入口，并只调用一次仓储（内部分页固定为 page=1/pageSize=5000）", async () => {
    const { service, repo } = serviceWith({ rows: [], total: 0 });

    await service.exportCsv({
      tenantId: TENANT_ID,
      eventType: "PAYMENT_CONFIRMED",
      q: " 支付 ",
      occurredFrom: "2026-09-01T00:00:00.000Z",
      occurredTo: "2026-10-01T00:00:00.000Z",
      minAmountFen: "100",
      sortBy: "amountFen",
      sortDir: "asc",
    });

    expect(repo.callCount).toBe(1);
    expect(repo.lastQuery).toEqual({
      tenantId: TENANT_ID,
      eventType: "PAYMENT_CONFIRMED",
      q: "支付",
      occurredFrom: new Date("2026-09-01T00:00:00.000Z"),
      occurredTo: new Date("2026-10-01T00:00:00.000Z"),
      minAmountFen: 100n,
      sortBy: "amountFen",
      sortDir: "asc",
      page: 1,
      pageSize: FUND_LEDGER_EXPORT_MAX_ROWS,
    });
  });

  it("不传筛选/排序时用列表同一套默认值（occurredAt desc）", async () => {
    const { service, repo } = serviceWith();

    await service.exportCsv({ tenantId: TENANT_ID });

    expect(repo.lastQuery?.sortBy).toBe("occurredAt");
    expect(repo.lastQuery?.sortDir).toBe("desc");
  });

  it("非法参数抛 FundLedgerInputError 且一次都不调用仓储（不静默回退默认值）", async () => {
    const { service, repo } = serviceWith();

    await expect(
      service.exportCsv({ tenantId: TENANT_ID, status: "UNKNOWN" }),
    ).rejects.toBeInstanceOf(FundLedgerInputError);
    await expect(
      service.exportCsv({ tenantId: TENANT_ID, sortBy: "customerName" }),
    ).rejects.toBeInstanceOf(FundLedgerInputError);
    await expect(
      service.exportCsv({ tenantId: TENANT_ID, occurredTo: " " }),
    ).rejects.toBeInstanceOf(FundLedgerInputError);
    await expect(
      service.exportCsv({ tenantId: TENANT_ID, minAmountFen: "12.5" }),
    ).rejects.toBeInstanceOf(FundLedgerInputError);

    expect(repo.callCount).toBe(0);
    expect(repo.lastQuery).toBeNull();
  });

  it("q 的空白仍按「未提供」处理（导出与列表同一口径）", async () => {
    const { service, repo } = serviceWith();

    await service.exportCsv({ tenantId: TENANT_ID, q: "   " });

    expect(repo.lastQuery).toEqual({
      tenantId: TENANT_ID,
      sortBy: "occurredAt",
      sortDir: "desc",
      page: 1,
      pageSize: FUND_LEDGER_EXPORT_MAX_ROWS,
    });
  });
});

describe("DS-008 资金台账 CSV 导出：行数上限", () => {
  it("total > 5000 抛专用错误与固定消息，绝不返回被截断的 CSV", async () => {
    const { service, repo } = serviceWith({
      rows: [transactionRow()],
      total: FUND_LEDGER_EXPORT_MAX_ROWS + 1,
    });

    await expect(service.exportCsv({ tenantId: TENANT_ID })).rejects.toThrow(
      "导出结果超过 5000 行，请缩小筛选范围",
    );
    await expect(
      service.exportCsv({ tenantId: TENANT_ID }),
    ).rejects.toBeInstanceOf(FundLedgerExportLimitError);
    expect(repo.callCount).toBe(2);
  });

  it("total 恰好等于 5000 时正常导出（边界不误伤）", async () => {
    const { service } = serviceWith({
      rows: [transactionRow()],
      total: FUND_LEDGER_EXPORT_MAX_ROWS,
    });

    const csv = await service.exportCsv({ tenantId: TENANT_ID });

    expect(csvLines(csv)).toHaveLength(3);
    expect(csv).toContain("LT00000000000000000000000000000001");
  });

  it("没有匹配行时只有表头 + 末尾 CRLF", async () => {
    const { service } = serviceWith({ rows: [], total: 0 });

    const csv = await service.exportCsv({ tenantId: TENANT_ID });

    expect(csv.startsWith(BOM)).toBe(true);
    expect(csvLines(csv)).toHaveLength(2);
    expect(csvLines(csv)[1]).toBe("");
  });
});

describe("DS-008 资金台账 CSV 导出：表头、列序与单元格口径", () => {
  it("固定 22 列表头、BOM 与 CRLF、末行后保留一个 CRLF", async () => {
    const { service } = serviceWith({ rows: [transactionRow()], total: 1 });

    const csv = await service.exportCsv({ tenantId: TENANT_ID });

    expect(csv.startsWith(BOM)).toBe(true);
    expect(csv.endsWith("\r\n")).toBe(true);
    expect(csvLines(csv)[0]).toBe(
      "交易号,事件类型,交易状态,对账状态,资金流方向,金额(元),借方(元),贷方(元),是否平衡,资金账户编码,资金账户名称,资金账户类型,资金账户状态,来源类型,来源ID,摘要,辅助核算,创建人ID,确认人ID,发生时间,确认时间,创建时间",
    );
    expect(csvCells(csv, 1)).toHaveLength(22);
  });

  it("常规行：金额按元、平衡为「是」、资金流方向按交易头账户推导", async () => {
    const { service } = serviceWith({ rows: [transactionRow()], total: 1 });

    const csv = await service.exportCsv({ tenantId: TENANT_ID });
    const cells = csvCells(csv, 1);

    expect(cells).toEqual([
      "LT00000000000000000000000000000001",
      "PAYMENT_CONFIRMED",
      "CONFIRMED",
      "UNRECONCILED",
      "CREDIT",
      "100.00",
      "100.00",
      "100.00",
      "是",
      "WECHAT_MAIN",
      "微信主账户",
      "WECHAT_SETTLEMENT",
      "ACTIVE",
      "payment_order",
      "88888888-8888-8888-8888-888888888888",
      "支付已确认",
      `customer_profile:${CUSTOMER_PROFILE_ID}`,
      ACTOR_ID,
      ACTOR_ID,
      ROW_CREATED_AT,
      ROW_CREATED_AT,
      ROW_CREATED_AT,
    ]);
  });

  it("null 字段输出空单元格（不写 null/undefined，也不伪造默认值）", async () => {
    const { service } = serviceWith({
      rows: [
        transactionRow({
          eventType: null,
          description: null,
          sourceType: null,
          sourceId: null,
          createdBy: null,
          confirmedBy: null,
          confirmedAt: null,
          fundAccountId: null,
          fundAccount: null,
          entries: [
            entry({
              direction: "DEBIT",
              amountFen: 0n,
              auxiliaryType: null,
              auxiliaryId: null,
            }),
            entry({
              direction: "CREDIT",
              amountFen: 0n,
              auxiliaryType: null,
              auxiliaryId: null,
            }),
          ],
        }),
      ],
      total: 1,
    });

    const csv = await service.exportCsv({ tenantId: TENANT_ID });
    const cells = csvCells(csv, 1);

    expect(cells).toHaveLength(22);
    expect(cells.slice(0, 9)).toEqual([
      "LT00000000000000000000000000000001",
      "",
      "CONFIRMED",
      "UNRECONCILED",
      "",
      "0.00",
      "0.00",
      "0.00",
      "否",
    ]);
    // 资金账户四列 + 来源两列 + 摘要 + 辅助核算 + 创建人 + 确认人 = 10 个空单元格
    expect(cells.slice(9, 19)).toEqual(Array<string>(10).fill(""));
    expect(cells.slice(19)).toEqual([ROW_CREATED_AT, "", ROW_CREATED_AT]);
    expect(csv).not.toContain("null");
    expect(csv).not.toContain("undefined");
  });

  it("辅助核算去重后按 type:id 用 ; 连接，顺序稳定", async () => {
    const { service } = serviceWith({
      rows: [
        transactionRow({
          entries: [
            entry({ direction: "DEBIT", amountFen: 5000n }),
            entry({ direction: "DEBIT", amountFen: 5000n }),
            entry({
              direction: "DEBIT",
              amountFen: 5000n,
              auxiliaryType: "settlement_batch",
              auxiliaryId: SETTLEMENT_BATCH_ID,
            }),
            entry({
              direction: "CREDIT",
              amountFen: 15000n,
              fundAccountId: FUND_ACCOUNT_ID,
              auxiliaryType: null,
              auxiliaryId: null,
            }),
          ],
        }),
      ],
      total: 1,
    });

    const csv = await service.exportCsv({ tenantId: TENANT_ID });

    expect(csvCells(csv, 1)[16]).toBe(
      `customer_profile:${CUSTOMER_PROFILE_ID};settlement_batch:${SETTLEMENT_BATCH_ID}`,
    );
  });

  it("不平衡行照常导出并标记「否」", async () => {
    const { service } = serviceWith({
      rows: [
        transactionRow({
          entries: [
            entry({ direction: "DEBIT", amountFen: 12345n }),
            entry({
              direction: "CREDIT",
              amountFen: 12000n,
              fundAccountId: FUND_ACCOUNT_ID,
            }),
          ],
        }),
      ],
      total: 1,
    });

    const csv = await service.exportCsv({ tenantId: TENANT_ID });
    const cells = csvCells(csv, 1);

    expect(cells[5]).toBe("123.45");
    expect(cells[6]).toBe("123.45");
    expect(cells[7]).toBe("120.00");
    expect(cells[8]).toBe("否");
  });

  it("超过 Number.MAX_SAFE_INTEGER 的分金额不丢精度", async () => {
    const huge = 9007199254740993n;
    const { service } = serviceWith({
      rows: [
        transactionRow({
          entries: [
            entry({ direction: "DEBIT", amountFen: huge }),
            entry({
              direction: "CREDIT",
              amountFen: huge,
              fundAccountId: FUND_ACCOUNT_ID,
            }),
          ],
        }),
      ],
      total: 1,
    });

    const csv = await service.exportCsv({ tenantId: TENANT_ID });
    const cells = csvCells(csv, 1);

    expect(cells[5]).toBe("90071992547409.93");
    expect(cells[7]).toBe("90071992547409.93");
    expect(cells[8]).toBe("是");
  });

  it("交易号/摘要/来源/账户名/辅助核算里的公式前缀全部被安全编码", async () => {
    const { service } = serviceWith({
      rows: [
        transactionRow({
          txNo: "=cmd|'/c calc'!A0",
          description: "@SUM(A1)",
          sourceType: "-1+1",
          sourceId: "+1",
          fundAccount: {
            id: FUND_ACCOUNT_ID,
            code: "=1+1",
            name: "+微信主账户",
            kind: "WECHAT_SETTLEMENT",
            status: "ACTIVE",
          },
          entries: [
            entry({
              direction: "DEBIT",
              amountFen: 10000n,
              auxiliaryType: "=bad",
              auxiliaryId: "@id",
            }),
            entry({
              direction: "CREDIT",
              amountFen: 10000n,
              fundAccountId: FUND_ACCOUNT_ID,
              auxiliaryType: null,
              auxiliaryId: null,
            }),
          ],
        }),
      ],
      total: 1,
    });

    const csv = await service.exportCsv({ tenantId: TENANT_ID });
    const row = csvLines(csv)[1] ?? "";

    expect(row).toContain("'=cmd|'/c calc'!A0");
    expect(row).toContain("'@SUM(A1)");
    expect(row).toContain("'-1+1");
    expect(row).toContain("'+1");
    expect(row).toContain("'=1+1");
    expect(row).toContain("'+微信主账户");
    expect(row).toContain("'=bad:@id");
    // 任何列都不允许以未转义的危险前缀开头
    expect(row).not.toMatch(/(^|,)[=+\-@]/);
  });

  it("导出顺序完全沿用仓储返回顺序", async () => {
    const { service } = serviceWith({
      rows: [transactionRow({ txNo: "B" }), transactionRow({ txNo: "A" })],
      total: 2,
    });

    const csv = await service.exportCsv({
      tenantId: TENANT_ID,
      sortBy: "txNo",
      sortDir: "asc",
    });

    expect(csvLines(csv)[1]?.startsWith("B,")).toBe(true);
    expect(csvLines(csv)[2]?.startsWith("A,")).toBe(true);
  });

  it("导出只读：只调用一次列表查询，仓储上不存在任何写入口", async () => {
    const { service, repo } = serviceWith({
      rows: [transactionRow()],
      total: 1,
    });

    await service.exportCsv({ tenantId: TENANT_ID });

    expect(repo.callCount).toBe(1);
    expect(repo.lastQuery?.tenantId).toBe(TENANT_ID);
  });
});
