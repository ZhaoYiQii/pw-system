import { describe, expect, it } from "vitest";
import {
  RECONCILIATION_CASE_DEFAULT_PAGE_SIZE,
  RECONCILIATION_CASE_MAX_PAGE_SIZE,
  RECONCILIATION_RESOLUTION_TYPES,
  ReconciliationCaseInputError,
} from "./reconciliation-case-ports.js";
import type {
  ReconciliationCaseCommandInput,
  ReconciliationCaseIgnoreCommand,
  ReconciliationCaseQuery,
  ReconciliationCaseQueryInput,
  ReconciliationCaseRepository,
  ReconciliationCaseRow,
  ReconciliationCaseSubmitReviewCommand,
  ReconciliationCaseTransitionCommand,
} from "./reconciliation-case-ports.js";
import { ReconciliationCaseService } from "./reconciliation-case.service.js";

/**
 * DS-012：对账处理单列表的纯应用层口径单测（假仓储，不 mock Prisma/NestJS）。
 *
 * 三条不可让步的口径：
 * 1. 查询值**逐字段规范化**：认不出的状态、非规范正整数一律 400，绝不静默回退成「全部」或第 1 页；
 * 2. 金额只以十进制字符串出网（`BigInt` 绝不经过 `number`），时间只以 ISO 字符串出网，可空字段显式 `null`；
 * 3. 仓储只被调用一次，参数就是规范化后的强类型查询（列表与总数同一口径）。
 */

/** 六个状态按 DS-010 规格写字面量：期望值来自规格，不从被测模块反推。 */
const EXACT_STATUSES = [
  "OPEN",
  "CLAIMED",
  "PROCESSING",
  "PENDING_REVIEW",
  "CLOSED",
  "IGNORED",
] as const;

/** 字段齐全的一行（用于证明每个可空字段都被显式映射，而不是靠缺席蒙对）。 */
const ROW: ReconciliationCaseRow = {
  id: "case-1",
  differenceId: "diff-1",
  status: "PENDING_REVIEW",
  ownerId: "11111111-1111-4111-8111-111111111111",
  resolutionType: "AMOUNT_CORRECTED",
  resolutionNote: "已按账单金额补记",
  linkedTransactionId: "22222222-2222-4222-8222-222222222222",
  reviewedBy: "33333333-3333-4333-8333-333333333333",
  reviewedAt: new Date("2026-09-25T03:00:00.000Z"),
  closedAt: new Date("2026-09-25T04:00:00.000Z"),
  createdAt: new Date("2026-09-25T02:00:00.000Z"),
  updatedAt: new Date("2026-09-25T04:00:01.000Z"),
  version: 3,
  difference: {
    kind: "AMOUNT_MISMATCH",
    amountFen: 100n,
    detail: "微信 100 分，本地 0 分",
    paymentOrderId: "44444444-4444-4444-8444-444444444444",
    resolvedAt: new Date("2026-09-25T04:00:00.000Z"),
    createdAt: new Date("2026-09-25T01:59:00.000Z"),
  },
};

/** 全可空字段为空的一行：`null` 必须原样出网，不能被写成缺省、空串或 0。 */
const EMPTY_ROW: ReconciliationCaseRow = {
  id: "case-2",
  differenceId: "diff-2",
  status: "OPEN",
  ownerId: null,
  resolutionType: null,
  resolutionNote: null,
  linkedTransactionId: null,
  reviewedBy: null,
  reviewedAt: null,
  closedAt: null,
  createdAt: new Date("2026-09-25T05:00:00.000Z"),
  updatedAt: new Date("2026-09-25T05:00:00.000Z"),
  version: 1,
  difference: {
    kind: "STATUS_MISMATCH",
    amountFen: null,
    detail: null,
    paymentOrderId: null,
    resolvedAt: null,
    createdAt: new Date("2026-09-25T04:59:00.000Z"),
  },
};

function repositoryStub(
  options: { rows?: ReconciliationCaseRow[]; total?: number } = {},
) {
  const calls: ReconciliationCaseQuery[] = [];
  const repository: ReconciliationCaseRepository = {
    list: async (input) => {
      calls.push(input);
      return { rows: options.rows ?? [], total: options.total ?? 0 };
    },
    // 列表用例不该走命令：被调用即失败，避免「走错路径也算通过」。
    claim: async () => {
      throw new Error("列表用例不应调用 repository.claim");
    },
    startProcessing: async () => {
      throw new Error("列表用例不应调用 repository.startProcessing");
    },
    submitReview: async () => {
      throw new Error("列表用例不应调用 repository.submitReview");
    },
    close: async () => {
      throw new Error("列表用例不应调用 repository.close");
    },
    ignore: async () => {
      throw new Error("列表用例不应调用 repository.ignore");
    },
  };
  return { repository, calls };
}

function serviceWith(
  options: { rows?: ReconciliationCaseRow[]; total?: number } = {},
) {
  const { repository, calls } = repositoryStub(options);
  return { service: new ReconciliationCaseService(repository), calls };
}

/** 非法查询值：必须抛 `ReconciliationCaseInputError`，且**完全没有触碰仓储**。 */
async function expectRejected(input: Partial<ReconciliationCaseQueryInput>) {
  const { service, calls } = serviceWith({ rows: [ROW], total: 1 });
  await expect(
    service.list({ tenantId: "tenant-1", ...input }),
  ).rejects.toBeInstanceOf(ReconciliationCaseInputError);
  expect(calls).toEqual([]);
}

describe("ReconciliationCaseService.list — 查询规范化", () => {
  it("默认 page=1、pageSize=20、不加状态过滤，仓储只被调用一次", async () => {
    const { service, calls } = serviceWith({ rows: [ROW], total: 9 });

    const view = await service.list({ tenantId: "tenant-1" });

    expect(calls).toEqual([
      {
        tenantId: "tenant-1",
        status: null,
        page: 1,
        pageSize: RECONCILIATION_CASE_DEFAULT_PAGE_SIZE,
      },
    ]);
    expect(view).toMatchObject({ total: 9, page: 1, pageSize: 20 });
  });

  it("`null` 等同「未提供」（与既有解析口径一致），不走拒绝分支", async () => {
    const { service, calls } = serviceWith();

    await service.list({
      tenantId: "tenant-1",
      status: null,
      page: null,
      pageSize: null,
    });

    expect(calls).toEqual([
      {
        tenantId: "tenant-1",
        status: null,
        page: 1,
        pageSize: RECONCILIATION_CASE_DEFAULT_PAGE_SIZE,
      },
    ]);
  });

  it("status/page/pageSize 规范化成强类型值后传给仓储", async () => {
    const { service, calls } = serviceWith();

    await service.list({
      tenantId: "tenant-1",
      status: "PENDING_REVIEW",
      page: "3",
      pageSize: "50",
    });

    expect(calls).toEqual([
      {
        tenantId: "tenant-1",
        status: "PENDING_REVIEW",
        page: 3,
        pageSize: 50,
      },
    ]);
  });

  it("六个状态逐个被接受（大小写敏感，不做别名折叠）", async () => {
    for (const status of EXACT_STATUSES) {
      const { service, calls } = serviceWith();

      await service.list({ tenantId: "tenant-1", status });

      expect(calls).toHaveLength(1);
      expect(calls[0]?.status).toBe(status);
    }
  });
});

describe("ReconciliationCaseService.list — 非法查询值一律拒绝", () => {
  it("认不出的状态（未知 / 小写 / 空白 / 数组）不触碰仓储", async () => {
    for (const status of [
      "UNKNOWN",
      "open",
      "Pending_Review",
      "",
      "   ",
      ["OPEN"],
      ["OPEN", "CLOSED"],
      "OPEN,CLOSED",
      1,
      true,
    ]) {
      await expectRejected({ status });
    }
  });

  it("page 拒绝 0、前导零、符号、小数、空白与数组", async () => {
    for (const page of [
      "0",
      "01",
      "007",
      "-1",
      "+1",
      "1.0",
      "1e2",
      "一",
      "",
      "   ",
      ["1"],
      1,
      true,
    ]) {
      await expectRejected({ page });
    }
  });

  it("pageSize 除同一批畸形值外还拒绝 0 与超过上限", async () => {
    for (const pageSize of [
      "0",
      "00",
      "-10",
      "+10",
      "10.5",
      "1e1",
      "",
      "   ",
      ["10"],
      10,
      true,
      String(RECONCILIATION_CASE_MAX_PAGE_SIZE + 1),
      "101",
    ]) {
      await expectRejected({ pageSize });
    }
  });

  it("pageSize 上限本身仍然合法", async () => {
    const { service, calls } = serviceWith();

    await service.list({
      tenantId: "tenant-1",
      pageSize: String(RECONCILIATION_CASE_MAX_PAGE_SIZE),
    });

    expect(calls[0]?.pageSize).toBe(RECONCILIATION_CASE_MAX_PAGE_SIZE);
  });

  it("page 与 pageSize 各自安全，但相乘后的偏移量越过安全整数：拒绝且不触碰仓储", async () => {
    // 两个值单独看都合法——90071992547411 是安全整数，100 也没超过上限；
    // 但 (90071992547411 - 1) * 100 = 9007199254741000 已越过 MAX_SAFE_INTEGER。
    await expectRejected({ page: "90071992547411", pageSize: "100" });
  });

  it("偏移量刚好落在安全整数边界内：仍然放行，不误伤", async () => {
    const { service, calls } = serviceWith();

    await service.list({
      tenantId: "tenant-1",
      page: "90071992547410",
      pageSize: "100",
    });

    // (90071992547410 - 1) * 100 = 9007199254740900 ≤ Number.MAX_SAFE_INTEGER
    expect(calls).toHaveLength(1);
    expect(calls[0]?.page).toBe(90071992547410);
    expect(calls[0]?.pageSize).toBe(100);
  });

  it("错误消息不依赖原始输入回显，也不含控制字符", async () => {
    const { service } = serviceWith();

    const error = await service
      .list({ tenantId: "tenant-1", status: "OPEN\nX-Injected: 1" })
      .then(
        () => null,
        (caught: unknown) => caught as Error,
      );

    expect(error).toBeInstanceOf(ReconciliationCaseInputError);
    expect(error?.name).toBe("ReconciliationCaseInputError");
    // 逐码位判断，不写字面量控制字符：字面量会把源文件变成二进制，diff/grep 与工具链都会失灵。
    const hasControlCharacter = [...(error?.message ?? "")].some(
      (character) => (character.codePointAt(0) ?? 0) < 0x20,
    );
    expect(hasControlCharacter).toBe(false);
  });

  it("缺少租户上下文时直接拒绝（纵深防御，控制器已在更外层拦成 401）", async () => {
    const { service, calls } = serviceWith();

    await expect(service.list({ tenantId: "  " })).rejects.toBeInstanceOf(
      ReconciliationCaseInputError,
    );
    expect(calls).toEqual([]);
  });
});

describe("ReconciliationCaseService.list — 响应映射", () => {
  it("固定映射：可空字段显式 null、时间为 ISO 字符串、version 与分页原样为整数", async () => {
    const { service } = serviceWith({ rows: [ROW], total: 1 });

    const view = await service.list({ tenantId: "tenant-1" });

    expect(view).toEqual({
      rows: [
        {
          id: "case-1",
          differenceId: "diff-1",
          status: "PENDING_REVIEW",
          ownerId: "11111111-1111-4111-8111-111111111111",
          resolutionType: "AMOUNT_CORRECTED",
          resolutionNote: "已按账单金额补记",
          linkedTransactionId: "22222222-2222-4222-8222-222222222222",
          reviewedBy: "33333333-3333-4333-8333-333333333333",
          reviewedAt: "2026-09-25T03:00:00.000Z",
          closedAt: "2026-09-25T04:00:00.000Z",
          createdAt: "2026-09-25T02:00:00.000Z",
          updatedAt: "2026-09-25T04:00:01.000Z",
          version: 3,
          difference: {
            kind: "AMOUNT_MISMATCH",
            kindLabel: "金额不一致",
            amountFen: "100",
            detail: "微信 100 分，本地 0 分",
            paymentOrderId: "44444444-4444-4444-8444-444444444444",
            resolvedAt: "2026-09-25T04:00:00.000Z",
            createdAt: "2026-09-25T01:59:00.000Z",
          },
        },
      ],
      total: 1,
      page: 1,
      pageSize: 20,
    });
  });

  it("可空字段全为空时显式 null（不是缺省、空串或 0）", async () => {
    const { service } = serviceWith({ rows: [EMPTY_ROW], total: 1 });

    const view = await service.list({ tenantId: "tenant-1" });
    const row = view.rows[0]!;

    expect(row.ownerId).toBeNull();
    expect(row.resolutionType).toBeNull();
    expect(row.resolutionNote).toBeNull();
    expect(row.linkedTransactionId).toBeNull();
    expect(row.reviewedBy).toBeNull();
    expect(row.reviewedAt).toBeNull();
    expect(row.closedAt).toBeNull();
    expect(row.difference.amountFen).toBeNull();
    expect(row.difference.detail).toBeNull();
    expect(row.difference.paymentOrderId).toBeNull();
    expect(row.difference.resolvedAt).toBeNull();
    // 缺省字段会被 `toEqual` 悄悄放行，这里逐键确认每个字段都存在。
    expect(Object.keys(row).sort()).toEqual([
      "closedAt",
      "createdAt",
      "difference",
      "differenceId",
      "id",
      "linkedTransactionId",
      "ownerId",
      "resolutionNote",
      "resolutionType",
      "reviewedAt",
      "reviewedBy",
      "status",
      "updatedAt",
      "version",
    ]);
  });

  it("金额以十进制字符串出网：超出 Number 安全整数也不失真", async () => {
    const { service } = serviceWith({
      rows: [
        {
          ...ROW,
          difference: { ...ROW.difference, amountFen: 9007199254740993n },
        },
      ],
      total: 1,
    });

    const view = await service.list({ tenantId: "tenant-1" });

    expect(view.rows[0]?.difference.amountFen).toBe("9007199254740993");
  });

  it("认不出的差异类型沿用既有兜底文案，不被静默归类", async () => {
    const { service } = serviceWith({
      rows: [
        {
          ...ROW,
          difference: { ...ROW.difference, kind: "NEW_KIND_FROM_WECHAT" },
        },
      ],
      total: 1,
    });

    const view = await service.list({ tenantId: "tenant-1" });

    expect(view.rows[0]?.difference.kindLabel).toBe(
      "未识别差异类型：NEW_KIND_FROM_WECHAT",
    );
  });

  it("空结果不是错误：返回空行数组与仓储给的 total", async () => {
    const { service } = serviceWith({ rows: [], total: 0 });

    const view = await service.list({
      tenantId: "tenant-1",
      status: "OPEN",
      page: "2",
      pageSize: "5",
    });

    expect(view).toEqual({ rows: [], total: 0, page: 2, pageSize: 5 });
  });
});

/**
 * DS-013：认领 / 开始处理两个**命令**的应用层口径（假仓储，不 mock Prisma/NestJS）。
 *
 * 四条不可让步的口径：
 * 1. 原始输入逐字段校验后才规范化：畸形 UUID、畸形 `expectedVersion`、多余请求体字段一律 400，
 *    且在**触碰仓储之前**就被拒绝——服务层绝不替客户端「修正」值（不 trim、不 Number 转换）；
 * 2. 每个命令只调用**一个**仓储方法、且只调用一次（认领不会顺手开始处理，也不会去查列表）；
 * 3. 返回行复用 DS-012 的 `toReconciliationCaseView()`（可空显式 `null`、金额十进制字符串）；
 * 4. 错误消息是固定安全文案：绝不回显客户端传来的路径/请求体原文，也不含控制字符。
 *
 * 真库事务、并发竞态、租户隔离与审计写入**不在**本文件的证明范围（假仓储证明不了），
 * 由 Codex 的真库验收覆盖，本文件不宣称那些结论。
 */

/** 规范 UUID 主键形状（caseId 必须与之一致；合成值，不指向任何真实行）。 */
const CASE_ID = "11111111-1111-4111-8111-111111111111";
const OPERATOR_ID = "33333333-3333-4333-8333-333333333333";

/** 命令成功时返回的视图：DS-012 行契约的完整字面量（期望值来自契约，不从被测模块反推）。 */
const COMMAND_VIEW = {
  id: "case-1",
  differenceId: "diff-1",
  status: "PENDING_REVIEW",
  ownerId: "11111111-1111-4111-8111-111111111111",
  resolutionType: "AMOUNT_CORRECTED",
  resolutionNote: "已按账单金额补记",
  linkedTransactionId: "22222222-2222-4222-8222-222222222222",
  reviewedBy: "33333333-3333-4333-8333-333333333333",
  reviewedAt: "2026-09-25T03:00:00.000Z",
  closedAt: "2026-09-25T04:00:00.000Z",
  createdAt: "2026-09-25T02:00:00.000Z",
  updatedAt: "2026-09-25T04:00:01.000Z",
  version: 3,
  difference: {
    kind: "AMOUNT_MISMATCH",
    kindLabel: "金额不一致",
    amountFen: "100",
    detail: "微信 100 分，本地 0 分",
    paymentOrderId: "44444444-4444-4444-8444-444444444444",
    resolvedAt: "2026-09-25T04:00:00.000Z",
    createdAt: "2026-09-25T01:59:00.000Z",
  },
};

/** 命令仓储桩：五个方法各自记录调用，便于证明「只走了该走的那一条」。 */
function commandStub(row: ReconciliationCaseRow = ROW) {
  const claimed: ReconciliationCaseTransitionCommand[] = [];
  const started: ReconciliationCaseTransitionCommand[] = [];
  const submitted: ReconciliationCaseSubmitReviewCommand[] = [];
  const closed: ReconciliationCaseTransitionCommand[] = [];
  const ignored: ReconciliationCaseIgnoreCommand[] = [];
  const listed: ReconciliationCaseQuery[] = [];
  const repository: ReconciliationCaseRepository = {
    list: async (input) => {
      listed.push(input);
      return { rows: [], total: 0 };
    },
    claim: async (input) => {
      claimed.push(input);
      return row;
    },
    startProcessing: async (input) => {
      started.push(input);
      return row;
    },
    submitReview: async (input) => {
      submitted.push(input);
      return row;
    },
    close: async (input) => {
      closed.push(input);
      return row;
    },
    ignore: async (input) => {
      ignored.push(input);
      return row;
    },
  };
  return {
    service: new ReconciliationCaseService(repository),
    claimed,
    started,
    submitted,
    closed,
    ignored,
    listed,
  };
}

function commandInput(
  overrides: {
    tenantId?: unknown;
    operatorAccountId?: unknown;
    caseId?: unknown;
    body?: unknown;
  } = {},
): ReconciliationCaseCommandInput {
  return {
    tenantId: "tenant-1",
    operatorAccountId: OPERATOR_ID,
    caseId: CASE_ID,
    body: { expectedVersion: 1 },
    ...overrides,
  } as ReconciliationCaseCommandInput;
}

/** 五个命令统一取原始入参（规范化在服务层内），因此可以用同一个并集方法名驱动。 */
type CommandMethod =
  "claim" | "startProcessing" | "submitReview" | "close" | "ignore";

/** 畸形命令：必须抛 `ReconciliationCaseInputError`，且**五个仓储方法都没被触碰**。 */
async function expectCommandRejected(
  method: CommandMethod,
  overrides: {
    tenantId?: unknown;
    operatorAccountId?: unknown;
    caseId?: unknown;
    body?: unknown;
  } = {},
) {
  const stub = commandStub();
  await expect(
    stub.service[method](commandInput(overrides)),
  ).rejects.toBeInstanceOf(ReconciliationCaseInputError);
  expect(stub.claimed).toEqual([]);
  expect(stub.started).toEqual([]);
  expect(stub.submitted).toEqual([]);
  expect(stub.closed).toEqual([]);
  expect(stub.ignored).toEqual([]);
  expect(stub.listed).toEqual([]);
}

/** 五个命令共享的畸形输入：同一套防线，一个都不能漏。 */
const ALL_COMMANDS: readonly CommandMethod[] = [
  "claim",
  "startProcessing",
  "submitReview",
  "close",
  "ignore",
];

describe("ReconciliationCaseService.claim — 认领命令", () => {
  it("规范化成强类型命令，只调用 repository.claim 一次，返回 DS-012 视图", async () => {
    const stub = commandStub();

    const view = await stub.service.claim(
      commandInput({ body: { expectedVersion: 7 } }),
    );

    expect(stub.claimed).toEqual([
      {
        tenantId: "tenant-1",
        operatorAccountId: OPERATOR_ID,
        caseId: CASE_ID,
        expectedVersion: 7,
      },
    ]);
    expect(stub.started).toEqual([]);
    expect(stub.listed).toEqual([]);
    expect(view).toEqual(COMMAND_VIEW);
  });

  it("租户与操作人只取登录态字段，绝不从请求体里认领", async () => {
    const stub = commandStub();

    await stub.service.claim(
      commandInput({
        tenantId: "tenant-from-principal",
        body: { expectedVersion: 1 },
      }),
    );

    expect(stub.claimed[0]?.tenantId).toBe("tenant-from-principal");
    expect(stub.claimed[0]?.operatorAccountId).toBe(OPERATOR_ID);
  });
});

describe("ReconciliationCaseService.startProcessing — 开始处理命令", () => {
  it("只调用 repository.startProcessing 一次，返回 DS-012 视图", async () => {
    const stub = commandStub();

    const view = await stub.service.startProcessing(
      commandInput({ body: { expectedVersion: 2 } }),
    );

    expect(stub.started).toEqual([
      {
        tenantId: "tenant-1",
        operatorAccountId: OPERATOR_ID,
        caseId: CASE_ID,
        expectedVersion: 2,
      },
    ]);
    expect(stub.claimed).toEqual([]);
    expect(stub.listed).toEqual([]);
    expect(view).toEqual(COMMAND_VIEW);
  });

  it("六个状态字面量之外的字段一律不认：请求体只允许 expectedVersion", async () => {
    await expectCommandRejected("startProcessing", {
      body: { expectedVersion: 2, status: "PROCESSING" },
    });
    await expectCommandRejected("startProcessing", {
      body: { expectedVersion: 2, ownerId: OPERATOR_ID },
    });
    await expectCommandRejected("startProcessing", {
      body: { expectedVersion: 2, reason: "随便写" },
    });
  });
});

describe("ReconciliationCaseService 命令 — 畸形输入一律拒绝且不触碰仓储", () => {
  it("caseId 不是单个规范 UUID：拒绝（含数组、空串、带空白与换行的伪 UUID）", async () => {
    for (const caseId of [
      "",
      "   ",
      "not-a-uuid",
      "11111111111111111111111111111111",
      `${CASE_ID} `,
      ` ${CASE_ID}`,
      `${CASE_ID}\n`,
      CASE_ID.replace(/-/g, ""),
      CASE_ID.slice(0, -1),
      `${CASE_ID}-extra`,
      [CASE_ID],
      [CASE_ID, CASE_ID],
      1,
      null,
      undefined,
      true,
      {},
    ]) {
      await expectCommandRejected("claim", { caseId });
      await expectCommandRejected("startProcessing", { caseId });
    }
  });

  it("请求体必须是只含 expectedVersion 的普通对象：数组、null、标量、多字段全拒", async () => {
    for (const body of [
      null,
      undefined,
      "expectedVersion=1",
      "1",
      1,
      true,
      [1],
      [{ expectedVersion: 1 }],
      {},
      { expectedVersion: 1, extra: 1 },
      { ExpectedVersion: 1 },
      { __proto__: { expectedVersion: 1 } },
    ]) {
      await expectCommandRejected("claim", { body });
      await expectCommandRejected("startProcessing", { body });
    }
  });

  it("expectedVersion 拒绝字符串、0、负数、小数、NaN、无穷与不安全整数", async () => {
    for (const expectedVersion of [
      "1",
      "",
      "  1  ",
      "1.0",
      0,
      -1,
      1.5,
      NaN,
      Infinity,
      -Infinity,
      Number.MAX_SAFE_INTEGER + 1,
      2 ** 53,
      null,
      undefined,
      true,
      [1],
      { value: 1 },
    ]) {
      await expectCommandRejected("claim", { body: { expectedVersion } });
      await expectCommandRejected("startProcessing", {
        body: { expectedVersion },
      });
    }
  });

  it("expectedVersion 的合法下界与安全上界放行（不误伤）", async () => {
    for (const expectedVersion of [1, Number.MAX_SAFE_INTEGER]) {
      const stub = commandStub();

      await stub.service.claim(commandInput({ body: { expectedVersion } }));

      expect(stub.claimed[0]?.expectedVersion).toBe(expectedVersion);
    }
  });

  it("tenantId / operatorAccountId 缺失或空白：在仓储之前被拒绝", async () => {
    for (const tenantId of ["", "   ", null, undefined, 1, {}, []]) {
      await expectCommandRejected("claim", { tenantId });
      await expectCommandRejected("startProcessing", { tenantId });
    }
    for (const operatorAccountId of ["", "   ", null, undefined, 42, {}, []]) {
      await expectCommandRejected("claim", { operatorAccountId });
      await expectCommandRejected("startProcessing", { operatorAccountId });
    }
  });

  it("错误消息不回显敌意路径/请求体原文，也不含控制字符", async () => {
    const hostile = "X-Injected-Header";
    const inputs = [
      commandInput({ caseId: `${CASE_ID}\n${hostile}: 1` }),
      commandInput({ body: { expectedVersion: `${hostile}: 1` } }),
      commandInput({ body: { expectedVersion: 1, [hostile]: "1" } }),
      commandInput({ caseId: `${hostile}: 1` }),
    ];

    for (const input of inputs) {
      const error = await commandStub()
        .service.claim(input)
        .then(
          () => null,
          (caught: unknown) => caught as Error,
        );

      expect(error).toBeInstanceOf(ReconciliationCaseInputError);
      expect(error?.name).toBe("ReconciliationCaseInputError");
      // 固定文案：既不点名原始输入，也不可能被拼进日志行。
      expect(error?.message.includes(hostile)).toBe(false);
      // 逐码位判断，不写字面量控制字符（字面量会把源文件变成二进制）。
      const hasControlCharacter = [...(error?.message ?? "")].some(
        (character) => (character.codePointAt(0) ?? 0) < 0x20,
      );
      expect(hasControlCharacter).toBe(false);
    }
  });
});

/**
 * DS-014：提交复核 / 复核关闭 / 忽略三条命令的应用层口径（假仓储，不 mock Prisma/NestJS）。
 *
 * 在 DS-013 那四条口径之上，本切片再加三条：
 * 5. 请求体是**封闭**契约：`resolutionType` 只有两个公开取值，落库用的内部字面量 `IGNORED`
 *    不是可请求值；带不带 `linkedTransactionId` 由 `resolutionType` **唯一决定**，不一致即拒——
 *    既不能缺、也不能多；
 * 6. 长度按 **Unicode 码位**计（不是 UTF-16 码元）：一个 emoji 算一个字符，
 *    500 个 emoji 合法（1000 个 UTF-16 码元）、501 个非法——用 `.length` 实现会误杀合法输入；
 * 7. 说明/理由先 `trim()` 再计长再落库：首尾空白不进仓储，纯空白串等于没写，一律拒。
 *
 * 真库事务、并发竞态、租户隔离、审计写入与 difference 解析**不在**本文件的证明范围（假仓储证明不了），
 * 由 Codex 的真库验收覆盖，本文件不宣称那些结论。
 */

/** 两个公开的处理结果类型：字面量来自任务包契约，不从被测模块反推。 */
const EXACT_RESOLUTION_TYPES = [
  "NO_LEDGER_CHANGE",
  "LEDGER_TRANSACTION",
] as const;

/** 说明 / 理由的长度上下界（按码位计）：来自任务包契约。 */
const NOTE_MIN_CODE_POINTS = 1;
const NOTE_MAX_CODE_POINTS = 500;

/** 一个 emoji = 1 个 Unicode 码位、2 个 UTF-16 码元：用来证明长度按码位计。 */
const EMOJI = "\u{1F600}";

/** 规范 UUID 形状的关联交易号（合成值，不指向任何真实行）。 */
const LINKED_TRANSACTION_ID = "22222222-2222-4222-8222-222222222222";

/**
 * 说明 / 理由里不允许出现的控制字符（Unicode Cc = U+0000–U+001F 与 U+007F–U+009F）。
 * 用转义写，不写字面量：字面量控制字符会把源文件变成二进制，diff/grep 与工具链都会失灵。
 */
const CONTROL_CHARACTERS = [
  "\u0000",
  "\t",
  "\n",
  "\r",
  "\u001f",
  "\u007f",
  "\u0085",
  "\u009f",
] as const;

/** 合法提交复核请求体（按需覆盖单个字段）。 */
function submitReviewBody(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    expectedVersion: 1,
    resolutionType: "NO_LEDGER_CHANGE",
    resolutionNote: "已核对，无需改账",
    ...overrides,
  };
}

/** 合法忽略请求体（按需覆盖单个字段）。 */
function ignoreBody(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return { expectedVersion: 1, reason: "重复差异，无需处理", ...overrides };
}

describe("ReconciliationCaseService 处理结果类型词表", () => {
  it("只暴露两个公开取值，且顺序与契约一致", () => {
    expect([...RECONCILIATION_RESOLUTION_TYPES]).toEqual([
      ...EXACT_RESOLUTION_TYPES,
    ]);
  });
});

describe("ReconciliationCaseService.submitReview — 提交复核命令", () => {
  it("NO_LEDGER_CHANGE 不带关联交易：规范化成 linkedTransactionId: null，只调用 repository.submitReview 一次", async () => {
    const stub = commandStub();

    const view = await stub.service.submitReview(
      commandInput({ body: submitReviewBody({ expectedVersion: 7 }) }),
    );

    expect(stub.submitted).toEqual([
      {
        tenantId: "tenant-1",
        operatorAccountId: OPERATOR_ID,
        caseId: CASE_ID,
        expectedVersion: 7,
        resolutionType: "NO_LEDGER_CHANGE",
        resolutionNote: "已核对，无需改账",
        linkedTransactionId: null,
      },
    ]);
    // 其余四个命令一个都不能被顺带走一遍。
    expect(stub.claimed).toEqual([]);
    expect(stub.started).toEqual([]);
    expect(stub.closed).toEqual([]);
    expect(stub.ignored).toEqual([]);
    expect(stub.listed).toEqual([]);
    expect(view).toEqual(COMMAND_VIEW);
  });

  it("LEDGER_TRANSACTION 带规范 UUID：原样透传给仓储", async () => {
    const stub = commandStub();

    await stub.service.submitReview(
      commandInput({
        body: submitReviewBody({
          resolutionType: "LEDGER_TRANSACTION",
          linkedTransactionId: LINKED_TRANSACTION_ID,
        }),
      }),
    );

    expect(stub.submitted).toEqual([
      {
        tenantId: "tenant-1",
        operatorAccountId: OPERATOR_ID,
        caseId: CASE_ID,
        expectedVersion: 1,
        resolutionType: "LEDGER_TRANSACTION",
        resolutionNote: "已核对，无需改账",
        linkedTransactionId: LINKED_TRANSACTION_ID,
      },
    ]);
  });

  it("说明先 trim 再计长再落库：首尾空白不进仓储", async () => {
    const stub = commandStub();

    await stub.service.submitReview(
      commandInput({
        body: submitReviewBody({ resolutionNote: "  已按账单金额补记  " }),
      }),
    );

    expect(stub.submitted[0]?.resolutionNote).toBe("已按账单金额补记");
  });
});

describe("ReconciliationCaseService.submitReview — 处理结果与关联交易的组合不变量", () => {
  it("LEDGER_TRANSACTION 必须带 linkedTransactionId：缺席或显式 null 都拒", async () => {
    await expectCommandRejected("submitReview", {
      body: submitReviewBody({ resolutionType: "LEDGER_TRANSACTION" }),
    });
    await expectCommandRejected("submitReview", {
      body: submitReviewBody({
        resolutionType: "LEDGER_TRANSACTION",
        linkedTransactionId: null,
      }),
    });
  });

  it("NO_LEDGER_CHANGE 必须缺席 linkedTransactionId：给了值或给了 null 都拒", async () => {
    // 「必须缺席」按封闭契约从严理解：键存在即拒，哪怕值是 null——
    // 否则 OpenAPI 侧只能写成「两个分支都允许该键」，与运行期就不一致了。
    await expectCommandRejected("submitReview", {
      body: submitReviewBody({ linkedTransactionId: LINKED_TRANSACTION_ID }),
    });
    await expectCommandRejected("submitReview", {
      body: submitReviewBody({ linkedTransactionId: null }),
    });
  });

  it("linkedTransactionId 必须是单个规范 UUID：不 trim、不做宽松修正", async () => {
    for (const linkedTransactionId of [
      "",
      "   ",
      "not-a-uuid",
      LINKED_TRANSACTION_ID.replace(/-/g, ""),
      `${LINKED_TRANSACTION_ID} `,
      ` ${LINKED_TRANSACTION_ID}`,
      `${LINKED_TRANSACTION_ID}\n`,
      LINKED_TRANSACTION_ID.slice(0, -1),
      `${LINKED_TRANSACTION_ID}-extra`,
      [LINKED_TRANSACTION_ID],
      1,
      true,
      {},
    ]) {
      await expectCommandRejected("submitReview", {
        body: submitReviewBody({
          resolutionType: "LEDGER_TRANSACTION",
          linkedTransactionId,
        }),
      });
    }
  });
});

describe("ReconciliationCaseService.submitReview — 非法输入一律拒绝且不触碰仓储", () => {
  it("resolutionType 只认两个公开取值（含内部字面量 IGNORED、大小写变体与数组）", async () => {
    for (const resolutionType of [
      // 落库用的内部字面量不是可请求值：忽略走 ignore 命令，不能从这里绕进去。
      "IGNORED",
      "no_ledger_change",
      "ledger_transaction",
      "NO_LEDGER_CHANGE ",
      " NO_LEDGER_CHANGE",
      "",
      "   ",
      "UNKNOWN",
      ["NO_LEDGER_CHANGE"],
      ["NO_LEDGER_CHANGE", "LEDGER_TRANSACTION"],
      null,
      1,
      true,
      {},
    ]) {
      await expectCommandRejected("submitReview", {
        body: submitReviewBody({ resolutionType }),
      });
    }
  });

  it("resolutionNote 缺失 / 非字符串 / 纯空白 / 空串一律拒绝", async () => {
    for (const resolutionNote of [
      undefined,
      null,
      "",
      "   ",
      "\t",
      "\n",
      1,
      true,
      {},
      [""],
    ]) {
      await expectCommandRejected("submitReview", {
        body: submitReviewBody({ resolutionNote }),
      });
    }
  });

  it("说明长度按 Unicode 码位计：500 个 emoji 合法（1000 个 UTF-16 码元），501 个非法", async () => {
    const stub = commandStub();
    const noteAtLimit = EMOJI.repeat(NOTE_MAX_CODE_POINTS);

    // 前提校验：这一串确实超过 500 个 UTF-16 码元 —— 用 `.length` 计长会误拒合法输入。
    expect(noteAtLimit.length).toBeGreaterThan(NOTE_MAX_CODE_POINTS);

    await stub.service.submitReview(
      commandInput({ body: submitReviewBody({ resolutionNote: noteAtLimit }) }),
    );

    expect(stub.submitted[0]?.resolutionNote).toBe(noteAtLimit);

    await expectCommandRejected("submitReview", {
      body: submitReviewBody({
        resolutionNote: EMOJI.repeat(NOTE_MAX_CODE_POINTS + 1),
      }),
    });
  });

  it("说明恰好 1 个码位合法、0 个码位非法（下界不误伤）", async () => {
    const stub = commandStub();

    await stub.service.submitReview(
      commandInput({ body: submitReviewBody({ resolutionNote: "字" }) }),
    );

    expect(stub.submitted[0]?.resolutionNote).toBe("字");
    expect(NOTE_MIN_CODE_POINTS).toBe(1);
  });

  it("说明含控制字符一律拒绝（Unicode Cc，含 DEL 与 C1 区）", async () => {
    for (const control of CONTROL_CHARACTERS) {
      await expectCommandRejected("submitReview", {
        body: submitReviewBody({ resolutionNote: `已核对${control}改账` }),
      });
    }
  });

  it("请求体是封闭契约：多余字段一律拒绝，且不接受客户端补的身份/状态/时间戳", async () => {
    for (const body of [
      submitReviewBody({ extra: 1 }),
      submitReviewBody({ status: "CLOSED" }),
      submitReviewBody({ ownerId: OPERATOR_ID }),
      submitReviewBody({ reviewedBy: OPERATOR_ID }),
      submitReviewBody({ reviewedAt: "2026-09-25T04:00:00.000Z" }),
      submitReviewBody({ closedAt: "2026-09-25T04:00:00.000Z" }),
      submitReviewBody({ tenantId: "tenant-2" }),
      submitReviewBody({ caseId: CASE_ID }),
      submitReviewBody({ Ignored: 1 }),
    ]) {
      await expectCommandRejected("submitReview", { body });
    }
  });
});

describe("ReconciliationCaseService.close — 复核关闭命令", () => {
  it("只含 expectedVersion：只调用 repository.close 一次，返回 DS-012 视图", async () => {
    const stub = commandStub();

    const view = await stub.service.close(
      commandInput({ body: { expectedVersion: 4 } }),
    );

    expect(stub.closed).toEqual([
      {
        tenantId: "tenant-1",
        operatorAccountId: OPERATOR_ID,
        caseId: CASE_ID,
        expectedVersion: 4,
      },
    ]);
    expect(stub.claimed).toEqual([]);
    expect(stub.started).toEqual([]);
    expect(stub.submitted).toEqual([]);
    expect(stub.ignored).toEqual([]);
    expect(stub.listed).toEqual([]);
    expect(view).toEqual(COMMAND_VIEW);
  });

  it("复核人只来自登录态：任何客户端身份/时间戳/说明字段都拒绝", async () => {
    for (const body of [
      { expectedVersion: 4, reviewedBy: OPERATOR_ID },
      { expectedVersion: 4, reviewedAt: "2026-09-25T04:00:00.000Z" },
      { expectedVersion: 4, closedAt: "2026-09-25T04:00:00.000Z" },
      { expectedVersion: 4, status: "CLOSED" },
      { expectedVersion: 4, resolutionType: "NO_LEDGER_CHANGE" },
      { expectedVersion: 4, ownerId: OPERATOR_ID },
      { expectedVersion: 4, extra: 1 },
    ]) {
      await expectCommandRejected("close", { body });
    }
  });
});

describe("ReconciliationCaseService.ignore — 忽略命令", () => {
  it("规范化理由（trim）并只调用 repository.ignore 一次", async () => {
    const stub = commandStub();

    const view = await stub.service.ignore(
      commandInput({
        body: ignoreBody({
          expectedVersion: 9,
          reason: "  重复差异，无需处理  ",
        }),
      }),
    );

    expect(stub.ignored).toEqual([
      {
        tenantId: "tenant-1",
        operatorAccountId: OPERATOR_ID,
        caseId: CASE_ID,
        expectedVersion: 9,
        reason: "重复差异，无需处理",
      },
    ]);
    expect(stub.claimed).toEqual([]);
    expect(stub.started).toEqual([]);
    expect(stub.submitted).toEqual([]);
    expect(stub.closed).toEqual([]);
    expect(stub.listed).toEqual([]);
    expect(view).toEqual(COMMAND_VIEW);
  });

  it("理由缺失 / 非字符串 / 纯空白 / 超长 / 含控制字符一律拒绝", async () => {
    for (const reason of [
      undefined,
      null,
      "",
      "   ",
      "\t",
      1,
      true,
      {},
      [""],
      EMOJI.repeat(NOTE_MAX_CODE_POINTS + 1),
    ]) {
      await expectCommandRejected("ignore", { body: ignoreBody({ reason }) });
    }

    for (const control of CONTROL_CHARACTERS) {
      await expectCommandRejected("ignore", {
        body: ignoreBody({ reason: `重复${control}差异` }),
      });
    }
  });

  it("理由长度按 Unicode 码位计：500 个 emoji 合法（1000 个 UTF-16 码元）", async () => {
    const stub = commandStub();
    const reasonAtLimit = EMOJI.repeat(NOTE_MAX_CODE_POINTS);

    expect(reasonAtLimit.length).toBeGreaterThan(NOTE_MAX_CODE_POINTS);

    await stub.service.ignore(
      commandInput({ body: ignoreBody({ reason: reasonAtLimit }) }),
    );

    expect(stub.ignored[0]?.reason).toBe(reasonAtLimit);
  });

  it("请求体是封闭契约：多余字段一律拒绝（含内部落库字段与身份字段）", async () => {
    for (const body of [
      ignoreBody({ extra: 1 }),
      ignoreBody({ status: "IGNORED" }),
      ignoreBody({ resolutionType: "IGNORED" }),
      ignoreBody({ resolutionNote: "随便写" }),
      ignoreBody({ linkedTransactionId: LINKED_TRANSACTION_ID }),
      ignoreBody({ reviewedBy: OPERATOR_ID }),
      ignoreBody({ ownerId: OPERATOR_ID }),
      ignoreBody({ tenantId: "tenant-2" }),
      ignoreBody({ Reason: "大小写不符" }),
    ]) {
      await expectCommandRejected("ignore", { body });
    }
  });
});

describe("DS-014 三条命令 — 与 DS-013 共用同一套输入防线", () => {
  it("caseId 不是单个规范 UUID：五个命令一致拒绝且不触碰仓储", async () => {
    for (const caseId of [
      "",
      "   ",
      "not-a-uuid",
      CASE_ID.replace(/-/g, ""),
      `${CASE_ID} `,
      `${CASE_ID}\n`,
      [CASE_ID],
      1,
      null,
      undefined,
      true,
      {},
    ]) {
      for (const method of ALL_COMMANDS) {
        await expectCommandRejected(method, { caseId });
      }
    }
  });

  it("expectedVersion 畸形：五个命令一致拒绝且不触碰仓储", async () => {
    for (const expectedVersion of [
      "1",
      "  1  ",
      "1.0",
      0,
      -1,
      1.5,
      NaN,
      Infinity,
      Number.MAX_SAFE_INTEGER + 1,
      null,
      undefined,
      true,
      [1],
      { value: 1 },
    ]) {
      for (const method of ALL_COMMANDS) {
        await expectCommandRejected(method, { body: { expectedVersion } });
      }
    }
  });

  it("请求体不是普通对象（数组 / 标量 / null）：五个命令一致拒绝", async () => {
    for (const body of [
      null,
      undefined,
      "expectedVersion=1",
      1,
      true,
      [1],
      [],
    ]) {
      for (const method of ALL_COMMANDS) {
        await expectCommandRejected(method, { body });
      }
    }
  });

  it("缺少租户或操作人上下文：五个命令都在触碰仓储之前拒绝", async () => {
    for (const tenantId of ["", "   ", null, undefined, 1, {}, []]) {
      for (const method of ALL_COMMANDS) {
        await expectCommandRejected(method, { tenantId });
      }
    }
    for (const operatorAccountId of ["", "   ", null, undefined, 42, {}, []]) {
      for (const method of ALL_COMMANDS) {
        await expectCommandRejected(method, { operatorAccountId });
      }
    }
  });

  it("错误消息不回显敌意原文，也不含控制字符", async () => {
    const hostile = "X-Injected-Header";
    // 敌意字符串只摆在**结构性**位置：未知键名、枚举值、声明「必须缺席」的字段、含换行的自由文本。
    // 自由文本本身（说明 / 理由）允许冒号——那是正常业务文案，见下一条正向用例。
    const bodies = [
      submitReviewBody({ resolutionType: hostile }),
      submitReviewBody({ [hostile]: "1" }),
      submitReviewBody({ linkedTransactionId: `${hostile}: 1` }),
      ignoreBody({ reason: `${hostile}: 1\n${hostile}` }),
      ignoreBody({ [hostile]: "1" }),
      { expectedVersion: 1, [hostile]: "1" },
    ];

    for (const body of bodies) {
      for (const method of ["submitReview", "ignore", "close"] as const) {
        const error = await commandStub()
          .service[method](commandInput({ body }))
          .then(
            () => null,
            (caught: unknown) => caught as Error,
          );

        expect(error).toBeInstanceOf(ReconciliationCaseInputError);
        expect(error?.name).toBe("ReconciliationCaseInputError");
        expect(error?.message.includes(hostile)).toBe(false);
        // 逐码位判断，不写字面量控制字符（字面量会把源文件变成二进制）。
        const hasControlCharacter = [...(error?.message ?? "")].some(
          (character) => (character.codePointAt(0) ?? 0) < 0x20,
        );
        expect(hasControlCharacter).toBe(false);
      }
    }
  });

  it("自由文本里的冒号与斜杠不是敌意输入：原样接受并逐字符落库（不静默改写、也不误伤）", async () => {
    const stub = commandStub();
    const note = "X-Injected-Header: 1/2";

    await stub.service.submitReview(
      commandInput({ body: submitReviewBody({ resolutionNote: note }) }),
    );

    // 校验的是「不该拦的没被拦」：把冒号当敌意特征拒掉，等于让财务无法谈论账单编号。
    expect(stub.submitted).toHaveLength(1);
    expect(stub.submitted[0]?.resolutionNote).toBe(note);
  });
});
