"use client";

/**
 * S4 新建派单：三阶段弹窗（客户+游戏 → 该游戏已发布模板 → 填写并按快照创建）。
 *
 * 规则（设计规格 §10 / §11.2，仓库 AGENTS「改到即迁」）：
 * - 本页整体迁移到新栈：Tailwind token + components/ui + TanStack Query，不再使用旧 .mc-* 类；
 * - 阶段由 new-order-template-flow 派生；切换游戏清空、切换模板先确认再按会话缓存恢复；
 * - 只展示该游戏未归档且有生效版本的模板（默认优先），无模板时给空状态与带 gameId 的入口；
 * - 表单值只留在弹窗会话内存（不进 URL、不进 localStorage）；提交中禁用按钮；
 * - 一次创建意图一个 Idempotency-Key，失败保留输入，按错误码决定下一步动作。
 */
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Plus, ShieldAlert } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { apiFetch } from "../api";
import {
  DEFAULT_ORDER_DURATION_MINUTES,
  NewOrderFlowError,
  buildCreateOrderRequest,
  describeCreateError,
  initialNewOrderState,
  intentFor,
  missingRequiredKeys,
  needsTemplateSwitchConfirm,
  newOrderStage,
  resetIntent,
  selectCustomer,
  selectGame,
  selectTemplate,
  updateValue,
  type NewOrderState,
  type NewOrderTemplateOption,
} from "./new-order-template-flow";
import { toDraftConfig } from "./template-draft-state";
import { TemplateOrderForm } from "./template-order-form";
import {
  createTemplateOrder,
  fetchPublishedTemplates,
  fetchPublishedVersionForm,
  type PublishedVersionForm,
} from "./template-order-api";
import { TemplateApiError } from "./template-api";
import {
  GAME_DISPATCH_TEMPLATE_V2_FEATURE,
  useTemplateV2Feature,
} from "./feature-flags";
import { useMerchantRole } from "./role-context";

interface CustomerRow {
  id: string;
  name: string;
}

interface GameRow {
  id: string;
  name: string;
  enabled?: boolean;
}

const STAGE_LABELS: Record<ReturnType<typeof newOrderStage>, string> = {
  PARTY: "1 客户与游戏",
  TEMPLATE: "2 选择模板",
  FORM: "3 填写并创建",
};

/** 新栈风格的搜索选择器：单一 combobox + listbox，键盘与 aria 状态完整。 */
function SearchPicker({
  id,
  label,
  options,
  selectedId,
  placeholder,
  disabled = false,
  onSelect,
}: {
  id: string;
  label: string;
  options: { id: string; label: string }[];
  selectedId: string;
  placeholder: string;
  disabled?: boolean;
  onSelect: (id: string) => void;
}) {
  const selected = options.find((option) => option.id === selectedId);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const listboxId = `${id}-options`;
  const text = query !== "" ? query : (selected?.label ?? "");
  const keyword = text.trim().toLowerCase();
  const filtered = keyword
    ? options.filter((option) => option.label.toLowerCase().includes(keyword))
    : options;

  // 打开时按 Esc 或点击外部关闭（旧实现的行为，迁移后必须保持）。
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    <div className="space-y-1.5" ref={rootRef}>
      <label htmlFor={id} className="text-sm text-foreground">
        {label}
      </label>
      <div className="relative">
        <Input
          id={id}
          value={text}
          disabled={disabled}
          placeholder={placeholder}
          role="combobox"
          aria-label={label}
          aria-autocomplete="list"
          aria-expanded={open && !disabled}
          aria-controls={listboxId}
          onChange={(event) => {
            setQuery(event.target.value);
            setOpen(true);
            if (event.target.value !== (selected?.label ?? "")) onSelect("");
          }}
          onFocus={() => setOpen(true)}
        />
        {open && !disabled ? (
          <ul
            id={listboxId}
            role="listbox"
            aria-label={`${label}选项`}
            className="absolute z-20 mt-1 max-h-60 w-full overflow-y-auto rounded-lg border bg-popover p-1 shadow-lg"
          >
            {filtered.length > 0 ? (
              filtered.map((option) => (
                <li key={option.id}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={option.id === selectedId}
                    className="block w-full rounded-md px-3 py-2 text-left text-sm hover:bg-accent"
                    onClick={() => {
                      setQuery("");
                      setOpen(false);
                      onSelect(option.id);
                    }}
                  >
                    {option.label}
                  </button>
                </li>
              ))
            ) : (
              <li className="px-3 py-2 text-sm text-muted-foreground">
                没有匹配项
              </li>
            )}
          </ul>
        ) : null}
      </div>
    </div>
  );
}

export function NewOrderView({
  embedded = false,
  onCreated,
}: {
  embedded?: boolean;
  onCreated?: (orderId: string) => void;
} = {}) {
  const router = useRouter();
  const { role } = useMerchantRole();
  const v2Feature = useTemplateV2Feature();
  const canOperate = role === "OWNER" || role === "ADMIN" || role === "CS";

  const [state, setState] = useState<NewOrderState>(initialNewOrderState);
  const [notice, setNotice] = useState("");
  const [durationText, setDurationText] = useState(
    String(DEFAULT_ORDER_DURATION_MINUTES),
  );
  /** 弹窗会话内的值缓存：按 templateVersionId 保存，切回时恢复。 */
  const valueCache = useRef(new Map<string, Record<string, unknown>>());
  const stage = newOrderStage(state);

  const customersQuery = useQuery({
    queryKey: ["merchant", "new-order", "customers"],
    queryFn: () => apiFetch<CustomerRow[]>("/api/v1/tenant/customers"),
    enabled: canOperate,
  });
  const gamesQuery = useQuery({
    queryKey: ["merchant", "new-order", "games"],
    queryFn: () => apiFetch<GameRow[]>("/api/v1/tenant/catalog/games"),
    enabled: canOperate,
    staleTime: 5 * 60_000,
  });
  const templatesQuery = useQuery({
    queryKey: ["merchant", "new-order", "published", state.gameId],
    queryFn: () => fetchPublishedTemplates(state.gameId),
    enabled: canOperate && state.gameId !== "",
  });
  const formQuery = useQuery({
    queryKey: [
      "merchant",
      "new-order",
      "form",
      state.template?.versionId ?? "",
    ],
    queryFn: () => fetchPublishedVersionForm(state.template!.versionId),
    enabled: canOperate && state.template !== null,
    staleTime: 0,
  });

  const form: PublishedVersionForm | undefined = formQuery.data;
  /** 契约类型（生成）经 S3 的边界转换进入编辑器镜像类型，再交给渲染组件。 */
  const formConfig = useMemo(
    () => (form === undefined ? undefined : toDraftConfig(form.config)),
    [form],
  );
  const missingKeys = useMemo(
    () =>
      formConfig === undefined
        ? []
        : missingRequiredKeys(formConfig, state.values),
    [formConfig, state.values],
  );

  const create = useMutation({
    mutationFn: async () => {
      const request = buildCreateOrderRequest(state);
      const intent = intentFor(state, () => crypto.randomUUID());
      setState((current) => ({ ...current, intent }));
      return createTemplateOrder(request, intent.key);
    },
    onSuccess: (created) => {
      setNotice("");
      setState((current) => resetIntent(current));
      if (onCreated) {
        onCreated(created.orderId);
        return;
      }
      router.push(`/merchant-console/dispatch/${created.orderId}?kind=GD`);
    },
    onError: (error: unknown) => {
      const code = error instanceof TemplateApiError ? error.code : "UNKNOWN";
      const hint = describeCreateError(code);
      setNotice(hint.message);
      if (hint.action === "RESET_INTENT") {
        setState((current) => resetIntent(current));
        return;
      }
      if (hint.action === "RESELECT_TEMPLATE") {
        // 保留当前模板与已填内容：用户需要看到自己填过什么再重新选择，
        // 界面不静默换模板（规格 §11.2）。
        return;
      }
      if (hint.action === "RELOAD_FORM") {
        void formQuery.refetch();
      }
    },
  });

  const chooseGame = useCallback((gameId: string) => {
    setNotice("");
    setState((current) => selectGame(current, gameId));
  }, []);

  const chooseTemplate = useCallback((template: NewOrderTemplateOption) => {
    setNotice("");
    setState((current) => {
      if (needsTemplateSwitchConfirm(current, template.templateId)) {
        const confirmed =
          typeof window === "undefined"
            ? true
            : window.confirm("当前模板已填写内容，切换会暂存本次输入。继续？");
        if (!confirmed) return current;
      }
      if (current.template !== null) {
        valueCache.current.set(current.template.versionId, current.values);
      }
      return selectTemplate(
        current,
        template,
        valueCache.current.get(template.versionId),
      );
    });
  }, []);

  if (v2Feature.ready && !v2Feature.enabled) {
    return (
      <Card>
        <CardContent className="space-y-2 p-6">
          <h1 className="text-base font-semibold">
            该门店尚未开通通用派单模板
          </h1>
          <p className="text-sm text-muted-foreground">
            新建派单需要能力位
            <code className="font-mono text-xs">
              {GAME_DISPATCH_TEMPLATE_V2_FEATURE}
            </code>
            ，请联系平台开通。
          </p>
        </CardContent>
      </Card>
    );
  }

  if (!canOperate) {
    return (
      <Card>
        <CardContent className="flex flex-col items-start gap-3 p-6">
          <span className="flex size-10 items-center justify-center rounded-full bg-destructive/10 text-destructive">
            <ShieldAlert size={20} aria-hidden="true" />
          </span>
          <h1 className="text-base font-semibold">只读角色 · 403</h1>
          <p className="text-sm text-muted-foreground">
            新建派单需要店老板、店长或客服角色。
          </p>
          {embedded ? null : (
            <Button asChild variant="outline">
              <Link href="/merchant-console/dispatch">回到订单台账</Link>
            </Button>
          )}
        </CardContent>
      </Card>
    );
  }

  const templates = templatesQuery.data ?? [];

  return (
    <div className="space-y-4">
      {embedded ? null : (
        <header className="flex items-start justify-between gap-4">
          <div>
            <p className="font-mono text-xs text-muted-foreground">
              ORDER CREATE / GD
            </p>
            <h1 className="text-lg font-semibold">新建派单</h1>
            <p className="text-sm text-muted-foreground">
              选择客户与游戏，锁定一个已发布模板版本后创建派单。
            </p>
          </div>
          <Button asChild variant="outline">
            <Link href="/merchant-console/dispatch">返回订单台账</Link>
          </Button>
        </header>
      )}

      <ol className="flex flex-wrap items-center gap-2 text-xs">
        {(["PARTY", "TEMPLATE", "FORM"] as const).map((key) => (
          <li key={key}>
            <Badge variant={stage === key ? "default" : "outline"}>
              {STAGE_LABELS[key]}
            </Badge>
          </li>
        ))}
      </ol>

      <div
        aria-live="polite"
        role="status"
        className="text-sm text-destructive"
      >
        {notice}
      </div>

      <Card>
        <CardContent className="grid gap-4 p-4 sm:grid-cols-2">
          <SearchPicker
            id="customer-picker"
            label="老板客户"
            placeholder="输入姓名搜索或选择客户…"
            options={(customersQuery.data ?? []).map((customer) => ({
              id: customer.id,
              label: customer.name,
            }))}
            selectedId={state.customerId}
            onSelect={(id) => {
              setNotice("");
              setState((current) => selectCustomer(current, id));
            }}
          />
          <SearchPicker
            id="game-picker"
            label="游戏"
            placeholder="输入游戏名搜索或选择…"
            options={(gamesQuery.data ?? [])
              .filter((game) => game.enabled !== false)
              .map((game) => ({ id: game.id, label: game.name }))}
            selectedId={state.gameId}
            onSelect={chooseGame}
          />
        </CardContent>
      </Card>

      {stage === "PARTY" ? (
        <p className="text-sm text-muted-foreground">
          先选择老板客户与游戏，再挑该游戏的已发布模板。
        </p>
      ) : null}

      {stage !== "PARTY" ? (
        <Card>
          <CardContent className="space-y-3 p-4">
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-sm font-semibold">游戏模板</h2>
              <span className="text-xs text-muted-foreground">
                只显示未归档且有生效版本的模板
              </span>
            </div>
            {templatesQuery.isPending ? (
              <p className="text-sm text-muted-foreground">正在加载模板…</p>
            ) : null}
            {templatesQuery.isError ? (
              <p className="text-sm text-destructive">
                模板列表加载失败，请稍后重试。
              </p>
            ) : null}
            {!templatesQuery.isPending && templates.length === 0 ? (
              <div className="space-y-2 rounded-lg border border-dashed p-4">
                <p className="text-sm text-muted-foreground">
                  该游戏还没有已发布模板，先创建并发布一个模板再下单。
                </p>
                <Button asChild variant="outline" size="sm">
                  <Link
                    href={`/merchant-console/dispatch/templates?game=${state.gameId}`}
                  >
                    去模板管理
                  </Link>
                </Button>
              </div>
            ) : null}
            <ul className="grid gap-2 sm:grid-cols-2">
              {templates.map((template) => (
                <li key={template.templateId}>
                  <button
                    type="button"
                    aria-pressed={
                      state.template?.templateId === template.templateId
                    }
                    className="w-full rounded-lg border p-3 text-left transition-colors hover:bg-accent aria-[pressed=true]:border-primary"
                    onClick={() => chooseTemplate(template)}
                  >
                    <span className="flex items-center gap-2">
                      <span className="text-sm font-medium">
                        {template.name}
                      </span>
                      {template.isDefault ? (
                        <Badge variant="secondary">默认</Badge>
                      ) : null}
                    </span>
                    <span className="mt-1 block font-mono text-xs text-muted-foreground">
                      v{template.versionNo}
                      {template.lastUsedAt ? " · 最近使用" : ""}
                    </span>
                    {template.description ? (
                      <span className="mt-1 block text-xs text-muted-foreground">
                        {template.description}
                      </span>
                    ) : null}
                  </button>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      ) : null}

      {stage === "FORM" && form !== undefined && formConfig !== undefined ? (
        <Card>
          <CardContent className="space-y-4 p-4">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-sm font-semibold">
                {state.template?.name ?? "下单信息"}
              </h2>
              <Badge variant="outline">
                锁定 v{form.versionNo}（{form.versionId.slice(0, 8)}）
              </Badge>
            </div>
            <p className="text-xs text-muted-foreground">
              人数与加价由服务端按该发布版本快照计算，创建后在订单详情查看结果。
            </p>

            <TemplateOrderForm
              config={formConfig}
              values={state.values}
              missingKeys={missingKeys}
              onValueChange={(stableKey, value) => {
                setNotice("");
                setState((current) => updateValue(current, stableKey, value));
              }}
            />

            <label className="block max-w-[200px] text-sm">
              <span>目标时长（分钟）</span>
              <Input
                aria-label="目标时长（分钟）"
                className="mt-1"
                inputMode="numeric"
                value={durationText}
                onChange={(event) => {
                  const next = event.target.value;
                  setDurationText(next);
                  const minutes = Number(next);
                  if (Number.isFinite(minutes) && minutes >= 15) {
                    setState((current) => ({
                      ...current,
                      durationMinutes: Math.trunc(minutes),
                      intent: null,
                    }));
                  }
                }}
              />
            </label>

            <div className="flex items-center gap-3">
              <Button
                type="button"
                disabled={
                  create.isPending ||
                  state.template === null ||
                  state.customerId === ""
                }
                onClick={() => {
                  try {
                    buildCreateOrderRequest(state);
                  } catch (error) {
                    if (error instanceof NewOrderFlowError)
                      setNotice(error.message);
                    return;
                  }
                  create.mutate();
                }}
              >
                <Plus size={15} aria-hidden="true" />
                {create.isPending ? "创建中…" : "创建派单草稿"}
              </Button>
              {missingKeys.length > 0 ? (
                <span className="text-xs text-muted-foreground">
                  还有 {missingKeys.length} 个必填项未填写
                </span>
              ) : null}
            </div>
          </CardContent>
        </Card>
      ) : null}

      {stage === "TEMPLATE" ? (
        <p className="text-sm text-muted-foreground">
          选择模板后即可按发布快照填写下单信息。
        </p>
      ) : null}
    </div>
  );
}
