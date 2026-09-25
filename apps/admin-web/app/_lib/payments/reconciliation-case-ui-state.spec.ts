import { describe, expect, it } from "vitest";
import {
  RECONCILIATION_CASE_EMPTY_TEXT,
  RECONCILIATION_CASE_PAGE_SIZE,
  RECONCILIATION_CONFLICT_MESSAGE,
  RECONCILIATION_NOTE_MAX_CODE_POINTS,
  RECONCILIATION_SELECTABLE_RESOLUTION_TYPES,
  accountLabel,
  actionLabel,
  caseActionsFor,
  caseCommandPath,
  caseStatusLabel,
  commitIgnoreForm,
  commitSubmitReviewForm,
  isConflictStatus,
  noteLabel,
  resolutionTypeLabel,
} from "./reconciliation-case-ui-state";

const CASE_ID = "11111111-1111-4111-8111-111111111111";
const ME = "33333333-3333-4333-8333-333333333333";
const OTHER = "44444444-4444-4444-8444-444444444444";
const TRANSACTION_ID = "22222222-2222-4222-8222-222222222222";

/** 只取行上这两个字段（结构化类型），完整 API 行天然满足。 */
function row(status: string, ownerId: string | null) {
  return { status, ownerId };
}

describe("caseActionsFor — 状态 × 归属决定可见动作", () => {
  it("OPEN：可认领也可忽略，且与「我是谁」无关（还没人认领，归属不适用）", () => {
    const mine = caseActionsFor(row("OPEN", null), ME);
    const anonymous = caseActionsFor(row("OPEN", null), null);

    expect(mine).toEqual({ kind: "actions", actions: ["claim", "ignore"] });
    // 身份还没取到时不能少给动作：OPEN 的动作本来就不依赖身份。
    expect(anonymous).toEqual(mine);
  });

  it("CLAIMED 本人：可开始处理也可忽略", () => {
    expect(caseActionsFor(row("CLAIMED", ME), ME)).toEqual({
      kind: "actions",
      actions: ["start-processing", "ignore"],
    });
  });

  it("CLAIMED 他人：只读，开始处理与忽略都不给（不能推别人的单）", () => {
    expect(caseActionsFor(row("CLAIMED", OTHER), ME)).toEqual({
      kind: "read-only",
      reason: "他人处理中",
    });
  });

  it("PROCESSING 本人：可提交复核", () => {
    expect(caseActionsFor(row("PROCESSING", ME), ME)).toEqual({
      kind: "actions",
      actions: ["submit-review"],
    });
  });

  it("PROCESSING 他人：只读，提交复核不给", () => {
    expect(caseActionsFor(row("PROCESSING", OTHER), ME)).toEqual({
      kind: "read-only",
      reason: "他人处理中",
    });
  });

  it("PENDING_REVIEW 他人：可复核关闭（复核人本就该是别人）", () => {
    expect(caseActionsFor(row("PENDING_REVIEW", OTHER), ME)).toEqual({
      kind: "actions",
      actions: ["close"],
    });
  });

  it("PENDING_REVIEW 本人：只读「等待其他财务复核」——自己提交的单自己关不了", () => {
    const plan = caseActionsFor(row("PENDING_REVIEW", ME), ME);

    expect(plan.kind).toBe("read-only");
    expect(plan).toEqual({ kind: "read-only", reason: "等待其他财务复核" });
    // 再确认一次：关闭动作无论如何都不在返回里。
    expect(plan.kind === "actions" ? plan.actions : []).not.toContain("close");
  });

  it("终态（CLOSED / IGNORED）：没有任何变更动作", () => {
    for (const status of ["CLOSED", "IGNORED"]) {
      for (const ownerId of [null, ME, OTHER]) {
        const plan = caseActionsFor(row(status, ownerId), ME);
        expect(plan.kind).toBe("read-only");
        expect(plan.kind === "actions" ? plan.actions : []).toEqual([]);
      }
    }
  });

  it("身份未知（/me 还没回来）：本人专属动作一律不给，失败关闭而不是乐观放开", () => {
    for (const status of [
      "CLAIMED",
      "PROCESSING",
      "PENDING_REVIEW",
      "CLOSED",
      "IGNORED",
    ]) {
      const plan = caseActionsFor(row(status, ME), null);
      expect(plan.kind).toBe("read-only");
    }
  });

  it("CLAIMED 但没有处理人（数据漂移）：按「不是我的」处理，失败关闭", () => {
    expect(caseActionsFor(row("CLAIMED", null), ME)).toEqual({
      kind: "read-only",
      reason: "他人处理中",
    });
  });

  it("认不出的状态：只读并点名原值，绝不猜测出一个按钮", () => {
    const plan = caseActionsFor(row("PENDING_REVIEW_V2", ME), ME);

    expect(plan.kind).toBe("read-only");
    expect(plan.kind === "read-only" ? plan.reason : "").toContain(
      "PENDING_REVIEW_V2",
    );
  });
});

describe("动作文案与命令路径", () => {
  it("五个动作各有中文按钮文案", () => {
    expect(actionLabel("claim")).toBe("认领");
    expect(actionLabel("start-processing")).toBe("开始处理");
    expect(actionLabel("submit-review")).toBe("提交复核");
    expect(actionLabel("close")).toBe("复核关闭");
    expect(actionLabel("ignore")).toBe("忽略");
  });

  it("命令路径与任务包契约逐字一致", () => {
    const base = `/api/v1/tenant/reconciliation/cases/${CASE_ID}`;
    expect(caseCommandPath(CASE_ID, "claim")).toBe(`${base}/claim`);
    expect(caseCommandPath(CASE_ID, "start-processing")).toBe(
      `${base}/start-processing`,
    );
    expect(caseCommandPath(CASE_ID, "submit-review")).toBe(
      `${base}/submit-review`,
    );
    expect(caseCommandPath(CASE_ID, "close")).toBe(`${base}/close`);
    expect(caseCommandPath(CASE_ID, "ignore")).toBe(`${base}/ignore`);
  });
});

describe("展示文案映射", () => {
  it("六个状态都有中文；未知值回退原始值，空值显示破折号", () => {
    expect(caseStatusLabel("OPEN")).toBe("待认领");
    expect(caseStatusLabel("CLAIMED")).toBe("已认领");
    expect(caseStatusLabel("PROCESSING")).toBe("处理中");
    expect(caseStatusLabel("PENDING_REVIEW")).toBe("待复核");
    expect(caseStatusLabel("CLOSED")).toBe("已关闭");
    expect(caseStatusLabel("IGNORED")).toBe("已忽略");
    expect(caseStatusLabel("SOMETHING_NEW")).toBe("SOMETHING_NEW");
    expect(caseStatusLabel(null)).toBe(RECONCILIATION_CASE_EMPTY_TEXT);
    expect(caseStatusLabel("")).toBe(RECONCILIATION_CASE_EMPTY_TEXT);
  });

  it("处理结果类型：内部字面量 IGNORED 有中文（服务端会写进这一列）", () => {
    expect(resolutionTypeLabel("NO_LEDGER_CHANGE")).toBe("无需改账");
    expect(resolutionTypeLabel("LEDGER_TRANSACTION")).toBe("关联交易");
    expect(resolutionTypeLabel("IGNORED")).toBe("已忽略");
    expect(resolutionTypeLabel(null)).toBe(RECONCILIATION_CASE_EMPTY_TEXT);
  });

  it("表单可选的处理结果类型只有两个公开值：IGNORED 只能由忽略命令产生", () => {
    expect([...RECONCILIATION_SELECTABLE_RESOLUTION_TYPES]).toEqual([
      "NO_LEDGER_CHANGE",
      "LEDGER_TRANSACTION",
    ]);
    expect([...RECONCILIATION_SELECTABLE_RESOLUTION_TYPES]).not.toContain(
      "IGNORED",
    );
  });

  it("处理人 / 复核人：无值显示破折号，不省略这一列", () => {
    expect(accountLabel(ME)).toBe(ME);
    expect(accountLabel(null)).toBe(RECONCILIATION_CASE_EMPTY_TEXT);
    expect(accountLabel(undefined)).toBe(RECONCILIATION_CASE_EMPTY_TEXT);
    expect(accountLabel("")).toBe(RECONCILIATION_CASE_EMPTY_TEXT);
  });

  it("处理说明：原文展示（不截断），空值显示破折号", () => {
    const note = "已核对微信账单，本地漏记，无需改账";
    expect(noteLabel(note)).toBe(note);
    expect(noteLabel(null)).toBe(RECONCILIATION_CASE_EMPTY_TEXT);
    expect(noteLabel("   ")).toBe(RECONCILIATION_CASE_EMPTY_TEXT);
  });
});

describe("commitSubmitReviewForm — expectedVersion 只取行上的 version", () => {
  it("直接把行上的 version 当作 expectedVersion，绝不推导成 version + 1", () => {
    const versioned = { version: 7 };
    const result = commitSubmitReviewForm(versioned, {
      resolutionType: "NO_LEDGER_CHANGE",
      resolutionNote: "已核对，无需改账",
      linkedTransactionId: "",
    });

    expect(result.ok).toBe(true);
    expect(result.ok ? result.body.expectedVersion : null).toBe(7);
    expect(result.ok ? result.body.expectedVersion : null).not.toBe(8);
  });

  it("NO_LEDGER_CHANGE：linkedTransactionId 必须**缺席**（不是 null，也不接受空白值）", () => {
    const result = commitSubmitReviewForm(
      { version: 3 },
      {
        resolutionType: "NO_LEDGER_CHANGE",
        resolutionNote: "无需改账",
        // 表单残留了上次输入的 id：不能悄悄带上，也不能悄悄忽略。
        linkedTransactionId: "",
      },
    );

    expect(result.ok).toBe(true);
    expect(
      result.ok ? Object.hasOwn(result.body, "linkedTransactionId") : true,
    ).toBe(false);
  });

  it("LEDGER_TRANSACTION：必须给出规范 UUID，值原样透传", () => {
    const result = commitSubmitReviewForm(
      { version: 4 },
      {
        resolutionType: "LEDGER_TRANSACTION",
        resolutionNote: "已关联既有交易",
        linkedTransactionId: TRANSACTION_ID,
      },
    );

    expect(result.ok).toBe(true);
    expect(result.ok ? result.body.linkedTransactionId : null).toBe(
      TRANSACTION_ID,
    );
  });

  it("LEDGER_TRANSACTION 缺关联交易 / 形状不对：拒绝，且不回显恶意原文", () => {
    for (const linkedTransactionId of [
      "",
      "   ",
      "not-a-uuid",
      `${CASE_ID} `,
    ]) {
      const result = commitSubmitReviewForm(
        { version: 1 },
        {
          resolutionType: "LEDGER_TRANSACTION",
          resolutionNote: "说明",
          linkedTransactionId,
        },
      );

      expect(result.ok).toBe(false);
      expect(result.ok ? null : result.errors.linkedTransactionId).toBeTruthy();
    }
  });

  it("说明先 trim 再计长：落进请求体的是 trim 后的值", () => {
    const result = commitSubmitReviewForm(
      { version: 1 },
      {
        resolutionType: "NO_LEDGER_CHANGE",
        resolutionNote: "  需要人工复核  ",
        linkedTransactionId: "",
      },
    );

    expect(result.ok ? result.body.resolutionNote : null).toBe("需要人工复核");
  });

  it("说明为空 / 纯空白 / 超长：拒绝并给字段错误", () => {
    const empty = commitSubmitReviewForm(
      { version: 1 },
      {
        resolutionType: "NO_LEDGER_CHANGE",
        resolutionNote: "   ",
        linkedTransactionId: "",
      },
    );
    expect(empty.ok).toBe(false);
    expect(empty.ok ? null : empty.errors.resolutionNote).toBeTruthy();

    // 按码位计长：正好 500 个 emoji 合法，501 个非法（UTF-16 码元是 1000/1002）。
    const emoji = "\u{1F600}";
    const atLimit = commitSubmitReviewForm(
      { version: 1 },
      {
        resolutionType: "NO_LEDGER_CHANGE",
        resolutionNote: emoji.repeat(RECONCILIATION_NOTE_MAX_CODE_POINTS),
        linkedTransactionId: "",
      },
    );
    expect(atLimit.ok).toBe(true);
    expect(atLimit.ok ? [...atLimit.body.resolutionNote].length : 0).toBe(
      RECONCILIATION_NOTE_MAX_CODE_POINTS,
    );

    const overLimit = commitSubmitReviewForm(
      { version: 1 },
      {
        resolutionType: "NO_LEDGER_CHANGE",
        resolutionNote: emoji.repeat(RECONCILIATION_NOTE_MAX_CODE_POINTS + 1),
        linkedTransactionId: "",
      },
    );
    expect(overLimit.ok).toBe(false);
  });

  it("处理结果类型必须是两个公开值之一（大小写与空白都不做宽松修正）", () => {
    for (const resolutionType of ["", "ignored", "no_ledger_change", "OTHER"]) {
      const result = commitSubmitReviewForm(
        { version: 1 },
        { resolutionType, resolutionNote: "说明", linkedTransactionId: "" },
      );
      expect(result.ok).toBe(false);
      expect(result.ok ? null : result.errors.resolutionType).toBeTruthy();
    }
  });

  it("请求体里绝不出现客户端身份 / 状态 / 时间戳字段", () => {
    const result = commitSubmitReviewForm(
      { version: 5 },
      {
        resolutionType: "LEDGER_TRANSACTION",
        resolutionNote: "说明",
        linkedTransactionId: TRANSACTION_ID,
      },
    );

    expect(result.ok).toBe(true);
    expect(result.ok ? Object.keys(result.body).sort() : []).toEqual([
      "expectedVersion",
      "linkedTransactionId",
      "resolutionNote",
      "resolutionType",
    ]);
  });
});

describe("commitIgnoreForm — 理由必填且只带两个字段", () => {
  it("expectedVersion 取行上的 version；理由是 trim 后的值", () => {
    const result = commitIgnoreForm({ version: 9 }, "  重复差异，无需处理  ");

    expect(result.ok).toBe(true);
    expect(result.ok ? result.body : null).toEqual({
      expectedVersion: 9,
      reason: "重复差异，无需处理",
    });
  });

  it("理由为空 / 纯空白 / 超长：拒绝并给字段错误", () => {
    for (const reason of ["", "   ", "\n", "\u{1F600}".repeat(501)]) {
      const result = commitIgnoreForm({ version: 1 }, reason);
      expect(result.ok).toBe(false);
      expect(result.ok ? null : result.errors.reason).toBeTruthy();
    }
  });

  it("请求体里绝不出现身份 / 处理结果类型字段（IGNORED 由服务端写）", () => {
    const result = commitIgnoreForm({ version: 2 }, "理由");

    expect(result.ok ? Object.keys(result.body).sort() : []).toEqual([
      "expectedVersion",
      "reason",
    ]);
  });
});

describe("分页与错误文案常量", () => {
  it("页大小与任务包一致，冲突文案逐字一致", () => {
    expect(RECONCILIATION_CASE_PAGE_SIZE).toBe(20);
    expect(RECONCILIATION_CONFLICT_MESSAGE).toBe(
      "数据已被其他操作更新，请刷新后重试",
    );
  });

  it("只有 409 才是并发冲突：不自动重试，提示刷新", () => {
    expect(isConflictStatus(409)).toBe(true);
    for (const status of [400, 401, 403, 404, 500]) {
      expect(isConflictStatus(status)).toBe(false);
    }
  });
});
