"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useId, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ApiError, apiFetch } from "../api";
import { formatFenYuan } from "../money";
import {
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
  type ReconciliationCaseIgnoreBody,
  type ReconciliationCaseRow,
  type ReconciliationCaseSubmitReviewBody,
  type ReconciliationCaseTransitionBody,
  type SubmitReviewFormErrors,
} from "./reconciliation-case-ui-state";

/**
 * DS-014：门店「对账处理工作台」。
 *
 * 对账（S4-3）在后台跑：拉微信账单 → 比本地账本 → 差异落库。差异是**门店自己的账**，
 * 钱对不对得上只有门店知道业务上发生了什么。DS-010~013 给了处理单的状态机、库表与两个
 * 前置命令，本页把最后一段接上：认领 → 开始处理 → 提交复核 →（另一个账号）复核关闭，
 * 或在 OPEN/CLAIMED 阶段带理由忽略。
 *
 * 边界：
 * - 每个命令都是「带 `expectedVersion` 的乐观锁请求」，`expectedVersion` **只**取列表行上的
 *   `version`（见 `reconciliation-case-ui-state.ts`），绝不推导；
 * - 身份只来自登录态：当前账号 id 取自 `/api/v1/tenant/me`，只用于决定按钮可见性，
 *   **绝不**放进命令请求体（服务端会 400 拒绝多余字段）；
 * - 服务端是唯一的裁决者：这里给的按钮只是「此刻合理的动作」，409/400 一律如实显示，
 *   不做自动重试、不乐观改状态；
 * - 金额与差异明细全部来自服务端返回，页面不重算任何财务合计；
 * - 页面本身**不创建**处理单、不改差异金额，也不提供改派 / 抢占 / 重开 / 自动复核。
 */

interface StatementView {
  id: string;
  billType: string;
  billDate: string;
  subMchid: string;
  totalCount: number;
  totalFen: string;
  downloadedAt: string;
}

interface DifferenceView {
  id: string;
  kind: string;
  kindLabel: string;
  amountFen: string | null;
  detail: string | null;
  paymentOrderId: string | null;
  resolvedAt: string | null;
  createdAt: string;
}

interface ReconciliationView {
  statements: StatementView[];
  differences: DifferenceView[];
  unresolvedCount: number;
}

/** 处理单分页视图（`apiFetch` 已解包外层 `{ data }`）。 */
interface ReconciliationCasePage {
  rows: ReconciliationCaseRow[];
  total: number;
  page: number;
  pageSize: number;
}

/** `/api/v1/tenant/me` 只需要账号 id；其余字段本页不用。 */
interface CurrentAccount {
  sub: string;
}

/**
 * 五个命令的变量：`action` 与请求体形状绑定，
 * 「用 start-processing 发一个带说明的体」这种配错在类型上就不成立。
 */
type CaseCommandVariables =
  | {
      action: "claim" | "start-processing" | "close";
      body: ReconciliationCaseTransitionBody;
    }
  | { action: "submit-review"; body: ReconciliationCaseSubmitReviewBody }
  | { action: "ignore"; body: ReconciliationCaseIgnoreBody };

type TransitionCommand = "claim" | "start-processing" | "close";

/** 原始控件补上与 `Input` 一致的可见焦点环（键盘可达性，不依赖 hover）。 */
const RAW_CONTROL_CLASS =
  "rounded-md border bg-background text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50";

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function errorStatus(error: unknown): number | null {
  return error instanceof ApiError ? error.status : null;
}

function fmtTime(value: string | null): string {
  return value ? new Date(value).toLocaleString() : "—";
}

/** 状态徽标只是视觉分级，不含任何状态机语义（拓扑只在后端 DS-010）。 */
function statusBadgeVariant(
  status: string,
): "default" | "secondary" | "destructive" | "outline" {
  switch (status) {
    case "OPEN":
      return "default";
    case "PENDING_REVIEW":
      return "destructive";
    case "CLOSED":
    case "IGNORED":
      return "outline";
    default:
      return "secondary";
  }
}

interface CaseRowProps {
  readonly row: ReconciliationCaseRow;
  readonly currentAccountId: string | null;
  readonly onCommitted: (message: string) => void;
  readonly onConflict: () => void;
}

/**
 * 单行处理单：展示 + 动作 + 行内表单 + 行内错误。
 *
 * 每行一个 `useMutation` 实例，pending 天然按行隔离——一行在提交不会禁掉另一行的按钮。
 */
function CaseRow({
  row,
  currentAccountId,
  onCommitted,
  onConflict,
}: CaseRowProps) {
  const formId = useId();
  const [form, setForm] = useState<"none" | "submit-review" | "ignore">("none");
  const [resolutionType, setResolutionType] = useState<string>(
    RECONCILIATION_SELECTABLE_RESOLUTION_TYPES[0],
  );
  const [resolutionNote, setResolutionNote] = useState("");
  const [linkedTransactionId, setLinkedTransactionId] = useState("");
  const [reason, setReason] = useState("");
  const [reviewErrors, setReviewErrors] = useState<SubmitReviewFormErrors>({});
  const [ignoreError, setIgnoreError] = useState<string | null>(null);
  const [rowError, setRowError] = useState<string | null>(null);

  const command = useMutation({
    mutationFn: (variables: CaseCommandVariables) =>
      apiFetch<ReconciliationCaseRow>(
        caseCommandPath(row.id, variables.action),
        {
          method: "POST",
          body: JSON.stringify(variables.body),
        },
      ),
    // 不自动重试：409 是并发冲突，重试只会再撞一次；其余错误重试也只是重复失败。
    retry: false,
    onSuccess: (updated, variables) => {
      setRowError(null);
      setReviewErrors({});
      setIgnoreError(null);
      setForm("none");
      setResolutionNote("");
      setReason("");
      setLinkedTransactionId("");
      onCommitted(
        `${actionLabel(variables.action)}成功：该处理单现在是「${caseStatusLabel(updated.status)}」。`,
      );
    },
    onError: (error, variables) => {
      const conflict = isConflictStatus(errorStatus(error) ?? 0);
      setRowError(
        conflict ? RECONCILIATION_CONFLICT_MESSAGE : errorText(error),
      );
      if (conflict) {
        // 冲突只提示 + 重取最新数据，绝不自动重放命令。
        onConflict();
      }
      void variables;
    },
  });

  const busy = command.isPending;
  const plan = caseActionsFor(row, currentAccountId);

  const runTransition = (action: TransitionCommand) => {
    setReviewErrors({});
    setIgnoreError(null);
    setRowError(null);
    command.mutate({ action, body: { expectedVersion: row.version } });
  };

  const submitReview = () => {
    const result = commitSubmitReviewForm(row, {
      resolutionType,
      resolutionNote,
      linkedTransactionId,
    });
    if (!result.ok) {
      setReviewErrors(result.errors);
      return;
    }
    setReviewErrors({});
    setRowError(null);
    command.mutate({ action: "submit-review", body: result.body });
  };

  const submitIgnore = () => {
    const result = commitIgnoreForm(row, reason);
    if (!result.ok) {
      // 类型上 `reason` 可选，运行期失败必带理由：退一步也要给出可读文案，不能静默。
      setIgnoreError(result.errors.reason ?? "理由不合法");
      return;
    }
    if (
      !window.confirm(
        "确认忽略该处理单？忽略后不可再变更，对应差异会被标记为已解决（忽略不改动账目）。",
      )
    ) {
      return;
    }
    setIgnoreError(null);
    setRowError(null);
    command.mutate({ action: "ignore", body: result.body });
  };

  const difference = row.difference;

  return (
    <TableRow>
      <TableCell className="align-top text-sm">
        {difference.kindLabel}
        <span className="block font-mono text-xs text-muted-foreground">
          {difference.kind}
        </span>
        {difference.detail ? (
          <span className="mt-1 block text-xs text-muted-foreground">
            {difference.detail}
          </span>
        ) : null}
        {difference.paymentOrderId ? (
          <span className="mt-1 block font-mono text-xs text-muted-foreground">
            支付单 {difference.paymentOrderId}
          </span>
        ) : null}
      </TableCell>
      <TableCell className="align-top text-right font-mono text-xs">
        {difference.amountFen === null
          ? "—"
          : formatFenYuan(difference.amountFen)}
      </TableCell>
      <TableCell className="align-top">
        <Badge variant={statusBadgeVariant(row.status)}>
          {caseStatusLabel(row.status)}
        </Badge>
        <span className="mt-1 block text-xs text-muted-foreground">
          {difference.resolvedAt ? "差异已解决" : "差异未解决"}
        </span>
        <span className="block font-mono text-xs text-muted-foreground">
          版本 {row.version}
        </span>
      </TableCell>
      <TableCell className="align-top text-xs">
        <span className="block">处理人：{accountLabel(row.ownerId)}</span>
        <span className="block">复核人：{accountLabel(row.reviewedBy)}</span>
      </TableCell>
      <TableCell className="align-top text-xs">
        {resolutionTypeLabel(row.resolutionType)}
        <span className="mt-1 block text-muted-foreground">
          {noteLabel(row.resolutionNote)}
        </span>
        {row.linkedTransactionId ? (
          <span className="mt-1 block font-mono text-xs text-muted-foreground">
            关联交易 {row.linkedTransactionId}
          </span>
        ) : null}
      </TableCell>
      <TableCell className="align-top text-xs text-muted-foreground">
        <span className="block">创建 {fmtTime(row.createdAt)}</span>
        {row.reviewedAt ? (
          <span className="block">复核 {fmtTime(row.reviewedAt)}</span>
        ) : null}
        {row.closedAt ? (
          <span className="block">关闭 {fmtTime(row.closedAt)}</span>
        ) : null}
        {difference.resolvedAt ? (
          <span className="block">解决 {fmtTime(difference.resolvedAt)}</span>
        ) : null}
      </TableCell>
      <TableCell className="align-top">
        {plan.kind === "read-only" ? (
          <p className="text-xs text-muted-foreground">{plan.reason}</p>
        ) : (
          <div className="flex flex-col gap-2">
            <div className="flex flex-wrap gap-2">
              {plan.actions.map((action) => (
                <Button
                  key={action}
                  variant="outline"
                  size="sm"
                  disabled={busy}
                  onClick={() => {
                    setRowError(null);
                    if (action === "submit-review") {
                      setForm("submit-review");
                      return;
                    }
                    if (action === "ignore") {
                      setForm("ignore");
                      return;
                    }
                    if (action === "close") {
                      if (
                        !window.confirm(
                          "确认复核关闭该处理单？关闭后不可再变更，对应差异会被标记为已解决。",
                        )
                      ) {
                        return;
                      }
                      runTransition("close");
                      return;
                    }
                    runTransition(action);
                  }}
                >
                  {actionLabel(action)}
                </Button>
              ))}
            </div>

            {form === "submit-review" ? (
              <form
                className="flex w-full max-w-md flex-col gap-2 rounded-md border p-3"
                onSubmit={(event) => {
                  event.preventDefault();
                  submitReview();
                }}
              >
                <label
                  className="text-xs"
                  htmlFor={`${formId}-resolution-type`}
                >
                  <span className="mb-1 block font-medium">处理结果</span>
                  <select
                    id={`${formId}-resolution-type`}
                    className={`h-9 w-full px-3 ${RAW_CONTROL_CLASS}`}
                    value={resolutionType}
                    disabled={busy}
                    onChange={(event) => setResolutionType(event.target.value)}
                  >
                    {RECONCILIATION_SELECTABLE_RESOLUTION_TYPES.map((value) => (
                      <option key={value} value={value}>
                        {resolutionTypeLabel(value)}
                      </option>
                    ))}
                  </select>
                </label>
                {reviewErrors.resolutionType ? (
                  <p className="text-xs text-destructive">
                    {reviewErrors.resolutionType}
                  </p>
                ) : null}

                {resolutionType === "LEDGER_TRANSACTION" ? (
                  <label className="text-xs" htmlFor={`${formId}-link`}>
                    <span className="mb-1 block font-medium">关联交易 id</span>
                    <Input
                      id={`${formId}-link`}
                      autoComplete="off"
                      placeholder="本门店已确认的交易 UUID"
                      value={linkedTransactionId}
                      disabled={busy}
                      onChange={(event) =>
                        setLinkedTransactionId(event.target.value)
                      }
                    />
                    {reviewErrors.linkedTransactionId ? (
                      <span className="mt-1 block text-destructive">
                        {reviewErrors.linkedTransactionId}
                      </span>
                    ) : null}
                  </label>
                ) : null}

                <label className="text-xs" htmlFor={`${formId}-note`}>
                  <span className="mb-1 block font-medium">
                    处理说明（必填，最多 {RECONCILIATION_NOTE_MAX_CODE_POINTS}{" "}
                    字）
                  </span>
                  <textarea
                    id={`${formId}-note`}
                    className={`min-h-28 w-full p-2 ${RAW_CONTROL_CLASS}`}
                    value={resolutionNote}
                    disabled={busy}
                    onChange={(event) => setResolutionNote(event.target.value)}
                  />
                </label>
                {reviewErrors.resolutionNote ? (
                  <p className="text-xs text-destructive">
                    {reviewErrors.resolutionNote}
                  </p>
                ) : null}

                <div className="flex gap-2">
                  <Button type="submit" size="sm" disabled={busy}>
                    {busy ? "提交中…" : "提交复核"}
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    disabled={busy}
                    onClick={() => {
                      setForm("none");
                      setReviewErrors({});
                    }}
                  >
                    取消
                  </Button>
                </div>
              </form>
            ) : null}

            {form === "ignore" ? (
              <form
                className="flex w-full max-w-md flex-col gap-2 rounded-md border p-3"
                onSubmit={(event) => {
                  event.preventDefault();
                  submitIgnore();
                }}
              >
                <label className="text-xs" htmlFor={`${formId}-reason`}>
                  <span className="mb-1 block font-medium">
                    忽略理由（必填，最多 {RECONCILIATION_NOTE_MAX_CODE_POINTS}{" "}
                    字）
                  </span>
                  <textarea
                    id={`${formId}-reason`}
                    className={`min-h-20 w-full p-2 ${RAW_CONTROL_CLASS}`}
                    value={reason}
                    disabled={busy}
                    onChange={(event) => setReason(event.target.value)}
                  />
                </label>
                {ignoreError ? (
                  <p className="text-xs text-destructive">{ignoreError}</p>
                ) : null}
                <p className="text-xs text-muted-foreground">
                  忽略不修改账目，但会结束这张处理单并把对应差异标记为已解决；请把理由写清楚，日后可追溯。
                </p>
                <div className="flex gap-2">
                  <Button type="submit" size="sm" disabled={busy}>
                    {busy ? "提交中…" : "确认忽略"}
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    disabled={busy}
                    onClick={() => {
                      setForm("none");
                      setIgnoreError(null);
                    }}
                  >
                    取消
                  </Button>
                </div>
              </form>
            ) : null}
          </div>
        )}

        {rowError ? (
          <p className="mt-2 text-xs text-destructive">{rowError}</p>
        ) : null}
      </TableCell>
    </TableRow>
  );
}

export function ReconciliationPanel() {
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const [notice, setNotice] = useState<string | null>(null);

  const refreshWorkbench = () => {
    // cases 与只读总览共用 `["payments","reconciliation"]` 前缀：一次失效两者都刷新，
    // 差异的「已解决 / 未解决」与未解决计数不会停留在旧值。
    void queryClient.invalidateQueries({
      queryKey: ["payments", "reconciliation"],
    });
  };

  // 当前账号 id：只用于判断「是不是我的单」，绝不进请求体。
  const meQuery = useQuery({
    queryKey: ["merchant", "me"],
    queryFn: () => apiFetch<CurrentAccount>("/api/v1/tenant/me"),
    retry: false,
  });
  const currentAccountId = meQuery.data?.sub ?? null;

  const reconciliationQuery = useQuery({
    queryKey: ["payments", "reconciliation"],
    queryFn: () =>
      apiFetch<ReconciliationView>("/api/v1/tenant/payments/reconciliation"),
  });

  const casesQuery = useQuery({
    queryKey: ["payments", "reconciliation", "cases", page],
    queryFn: () =>
      apiFetch<ReconciliationCasePage>(
        `/api/v1/tenant/reconciliation/cases?page=${page}&pageSize=${RECONCILIATION_CASE_PAGE_SIZE}`,
      ),
  });

  const unauthorized =
    errorStatus(reconciliationQuery.error) === 401 ||
    errorStatus(casesQuery.error) === 401;
  if (unauthorized) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>尚未登录门店账号</CardTitle>
          <CardDescription>请先以门店角色登录。</CardDescription>
        </CardHeader>
        <CardContent>
          <Button asChild>
            <Link href="/store/login">去登录</Link>
          </Button>
        </CardContent>
      </Card>
    );
  }

  const data = reconciliationQuery.data;
  const cases = casesQuery.data;
  const total = cases?.total ?? 0;
  const pageSize = cases?.pageSize ?? RECONCILIATION_CASE_PAGE_SIZE;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader>
          <div className="flex items-start justify-between gap-4">
            <div>
              <CardTitle>对账处理工作台</CardTitle>
              <CardDescription>
                每一条对账差异对应一张处理单，按顺序推进：认领 → 开始处理 →
                提交复核 →
                由另一位财务复核关闭；也可在认领前后带理由忽略。复核关闭会把对应差异标记为已解决。
              </CardDescription>
            </div>
            <Button
              variant="outline"
              size="sm"
              disabled={casesQuery.isFetching}
              onClick={() => {
                setNotice(null);
                void casesQuery.refetch();
                void reconciliationQuery.refetch();
              }}
            >
              {casesQuery.isFetching ? "刷新中…" : "刷新"}
            </Button>
          </div>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {notice ? (
            <p className="rounded-md border px-3 py-2 text-sm">{notice}</p>
          ) : null}

          {meQuery.isError && errorStatus(meQuery.error) !== 401 ? (
            <p className="text-sm text-destructive">
              当前账号信息加载失败，暂不能判断哪些单属于你：
              {errorText(meQuery.error)}
            </p>
          ) : null}

          {casesQuery.isPending ? (
            <p className="text-sm text-muted-foreground">加载中…</p>
          ) : null}
          {casesQuery.isError ? (
            <p className="text-sm text-destructive">
              处理单加载失败：{errorText(casesQuery.error)}
              {casesQuery.data ? "（下表仍是上一次成功加载的数据）" : ""}
            </p>
          ) : null}

          {cases && cases.rows.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              当前没有对账处理单：账目一致时不会有单；有差异后处理单会出现在这里。
            </p>
          ) : null}

          {cases && cases.rows.length > 0 ? (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-64">差异</TableHead>
                    <TableHead className="w-28 text-right">金额</TableHead>
                    <TableHead className="w-32">处理单状态</TableHead>
                    <TableHead className="w-40">处理人 / 复核人</TableHead>
                    <TableHead className="w-56">处理结果</TableHead>
                    <TableHead className="w-40">时间</TableHead>
                    <TableHead className="w-72">操作</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {cases.rows.map((row) => (
                    <CaseRow
                      key={row.id}
                      row={row}
                      currentAccountId={currentAccountId}
                      onCommitted={(message) => {
                        setNotice(message);
                        refreshWorkbench();
                      }}
                      onConflict={refreshWorkbench}
                    />
                  ))}
                </TableBody>
              </Table>
            </div>
          ) : null}

          {cases && total > 0 ? (
            <div className="flex items-center justify-between gap-4 text-sm">
              <span className="text-muted-foreground">
                第 {cases.page} / {totalPages} 页，共 {total} 张处理单
              </span>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page <= 1 || casesQuery.isFetching}
                  onClick={() => setPage((current) => Math.max(1, current - 1))}
                >
                  上一页
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page >= totalPages || casesQuery.isFetching}
                  onClick={() => setPage((current) => current + 1)}
                >
                  下一页
                </Button>
              </div>
            </div>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>
            对账差异总览
            {data ? `（未解决 ${data.unresolvedCount}）` : ""}
          </CardTitle>
          <CardDescription>
            每日按子商户拉微信账单，与门店本地账本比对：微信有而本地没有、金额不一致等都会列在这里。
            本表只读，用于核对口径；处理动作在上面的工作台里做。
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {reconciliationQuery.isPending ? (
            <p className="text-sm text-muted-foreground">加载中…</p>
          ) : null}
          {reconciliationQuery.isError ? (
            <p className="text-sm text-destructive">
              加载失败：{errorText(reconciliationQuery.error)}
            </p>
          ) : null}

          {!reconciliationQuery.isPending &&
          !reconciliationQuery.isError &&
          data?.differences.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              {data.statements.length === 0
                ? "还没有账单文件：微信支付开通后，每日对账会自动拉取并按子商户留档。"
                : "账目一致：最近对账没有发现差异。"}
            </p>
          ) : null}

          {data && data.differences.length > 0 ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-64">差异类型</TableHead>
                  <TableHead className="w-28 text-right">金额</TableHead>
                  <TableHead>明细</TableHead>
                  <TableHead className="w-24">状态</TableHead>
                  <TableHead className="w-40">发现时间</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.differences.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell className="text-sm">
                      {row.kindLabel}
                      <span className="block font-mono text-xs text-muted-foreground">
                        {row.kind}
                      </span>
                    </TableCell>
                    <TableCell className="text-right font-mono text-xs">
                      {row.amountFen === null
                        ? "—"
                        : formatFenYuan(row.amountFen)}
                    </TableCell>
                    <TableCell className="text-xs">
                      {row.detail ?? "—"}
                      {row.paymentOrderId ? (
                        <span className="block font-mono text-xs text-muted-foreground">
                          支付单 {row.paymentOrderId}
                        </span>
                      ) : null}
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant={row.resolvedAt ? "secondary" : "destructive"}
                      >
                        {row.resolvedAt ? "已解决" : "未解决"}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {fmtTime(row.createdAt)}
                      {row.resolvedAt ? (
                        <span className="block">
                          解决 {fmtTime(row.resolvedAt)}
                        </span>
                      ) : null}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>账单文件</CardTitle>
          <CardDescription>
            最近 5 份微信账单（按子商户、按自然日留档，含文件摘要与合计）。
          </CardDescription>
        </CardHeader>
        <CardContent>
          {data && data.statements.length > 0 ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-32">账单日</TableHead>
                  <TableHead className="w-24">类型</TableHead>
                  <TableHead className="w-40">子商户号</TableHead>
                  <TableHead className="w-24 text-right">笔数</TableHead>
                  <TableHead className="w-32 text-right">合计</TableHead>
                  <TableHead>下载时间</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.statements.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell className="font-mono text-xs">
                      {row.billDate}
                    </TableCell>
                    <TableCell className="text-xs">{row.billType}</TableCell>
                    <TableCell className="font-mono text-xs">
                      {row.subMchid}
                    </TableCell>
                    <TableCell className="text-right text-xs">
                      {row.totalCount}
                    </TableCell>
                    <TableCell className="text-right font-mono text-xs">
                      {formatFenYuan(row.totalFen)}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {fmtTime(row.downloadedAt)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <p className="py-4 text-center text-sm text-muted-foreground">
              还没有账单文件。
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
