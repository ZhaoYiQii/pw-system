// 客户自助下单（v2 通用派单模板）H5 页面：选游戏 → 选该游戏的已发布模板 → 填表 → 提交。
//
// 规则（设计规格 C-1 / C-7 / C-9 / C-11）：
// - 端口由入口决定：客户 H5 只拿 CUSTOMER 过滤结果，界面**不出现任何端口选择**；
// - v2 不可用时回退经典（v1）下单：addon 未开、后端还没有 v2 路由、该游戏没有已发布模板；
// - 表单只渲染服务端返回的配置（服务端是过滤权威），人数与价格一律由服务端算、界面只显示；
// - 客户侧不做草稿：一次填写一次提交，幂等键按请求体签名复用（同一次意图重试安全）；
// - 双端约束：不引入 Tailwind/shadcn，window/document/localStorage 只出现在 platform 适配层。
import { Button, Input, Text, Textarea, View } from "@tarojs/components";
import { useLoad } from "@tarojs/taro";
import { useState } from "react";
import { apiAdapter } from "@platform-api";
import { session } from "@platform-session";
import {
  CustomerLoginCard,
  CustomerMessage,
  CustomerShell,
  goCustomer,
} from "../../../components/customer-ui";
import { formatFenYuan } from "../../../features/money/money";
import {
  customerLogin,
  resolveTenantCode,
} from "../../../features/customer-ui/session";
import {
  newIdempotencyKey,
  orderIntentFor,
  type OrderIntent,
} from "../../../features/customer-ui/order-intent";
import {
  allowsFreeInput,
  collectOrderValues,
  missingRequirements,
  type OrderComponentLike,
  type OrderConfigLike,
  type OrderFieldLike,
  type OrderFieldTypeV2,
  type OrderNoteLike,
  type OrderSectionLike,
  type OrderStaffingSourceLike,
  type OrderTableColumnLike,
  type OrderTableLike,
} from "../../../features/customer-ui/order-values";

const CUSTOMER_SELF_SERVICE_FEATURE = "addon.customer_self_service";
const CUSTOMER_GAMES_PATH = "/api/v1/tenant/game-dispatch/customer/games";

/** 表单/模板接口的路径前缀（客户入口，端口由服务端按入口决定）。 */
const CUSTOMER_TEMPLATE_BASE = "/api/v1/tenant/game-dispatch/customer";

const FIELD_TYPE_LABELS: Record<OrderFieldTypeV2, string> = {
  TEXT: "文本",
  TEXTAREA: "多行文本",
  NUMBER: "数字",
  MONEY_FEN: "金额（分）",
  DATETIME: "时间",
  SINGLE_SELECT: "单选",
  MULTI_SELECT: "多选",
};

const STEP_TEXT = {
  GAME: { title: "自助下单", subtitle: "第 1 步 · 选择游戏" },
  TEMPLATE: { title: "选择服务模板", subtitle: "第 2 步 · 该游戏的已发布模板" },
  FORM: { title: "填写需求", subtitle: "第 3 步 · 只显示客户可见的内容" },
  DONE: { title: "下单成功", subtitle: "人数与加价由服务端按发布快照计算" },
} as const;

type V2Step = keyof typeof STEP_TEXT;
type FlowMode = "loading" | "v1" | "v2";
type Toast = { tone: "error" | "success" | "info"; text: string } | null;

/** v1（经典）下单接口的形状。 */
interface TemplateOption {
  id: string;
  name: string;
}

interface TemplateDetail {
  id: string;
  name: string;
  fields: Array<{
    fieldKey: string;
    label: string;
    fieldType: string;
    required: boolean;
    options: string[];
  }>;
  positions: Array<{
    id: string;
    label: string;
    defaultCount: number;
  }>;
}

interface CreatedDraft {
  orderId: string;
  dispatchOrderId: string;
  dispatchNo: string;
}

/** v2 客户入口接口的形状（GET customer/games、published、versions/:id/form、template-orders）。 */
interface FeatureFlag {
  featureKey: string;
  enabled: boolean;
}

interface PublishedGame {
  gameId: string;
  name: string;
}

interface PublishedTemplate {
  templateId: string;
  name: string;
  description?: string | null;
  versionId: string;
  versionNo: number;
  isDefault: boolean;
  lastUsedAt: string | null;
}

interface PublishedConfig extends OrderConfigLike {
  schemaVersion: number;
  documentRendererVersion: number;
  sections: OrderSectionLike[];
  components: OrderComponentLike[];
  staffingSource?: OrderStaffingSourceLike;
}

interface PublishedForm {
  templateId: string;
  gameId: string | null;
  versionId: string;
  versionNo: number;
  config: PublishedConfig;
}

interface CreatedTemplateOrder {
  orderId: string;
  dispatchOrderId: string;
  staffingSummary: {
    total: number;
    rows: Array<{ label: string; count: number }>;
  };
  priceAdjustmentFen: string;
  document?: { plainText: string } | null;
}

function asText(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return "";
}

function asRows(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (row): row is Record<string, unknown> =>
      typeof row === "object" && row !== null && !Array.isArray(row),
  );
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function statusOf(error: unknown): number | undefined {
  return (error as { status?: number }).status;
}

function blankTableRow(table: OrderTableLike): Record<string, unknown> {
  const row: Record<string, unknown> = {};
  for (const column of table.columns) row[column.stableKey] = "";
  return row;
}

function ChoiceCard({
  order,
  title,
  note,
  tag,
  active,
  onSelect,
}: {
  order: number;
  title: string;
  note?: string | undefined;
  tag?: string | undefined;
  active: boolean;
  onSelect: () => void;
}) {
  return (
    <Button
      className={`cu-choice${active ? " is-active" : ""}`}
      aria-label={title}
      aria-pressed={active}
      onClick={onSelect}
    >
      <Text className="cu-choice-badge">{String(order).padStart(2, "0")}</Text>
      <View className="cu-grow">
        <Text className="cu-choice-title">{title}</Text>
        {note ? <Text className="cu-choice-note">{note}</Text> : null}
      </View>
      {tag ? <Text className="cu-choice-tag">{tag}</Text> : null}
    </Button>
  );
}

function FieldInput({
  field,
  value,
  missing,
  onChange,
}: {
  field: OrderFieldLike;
  value: unknown;
  missing: boolean;
  onChange: (value: unknown) => void;
}) {
  const heading = (
    <Text className="cu-field-label">
      {field.label}
      {field.required ? <Text className="cu-required"> *</Text> : null}
    </Text>
  );

  if (
    field.fieldType === "SINGLE_SELECT" ||
    field.fieldType === "MULTI_SELECT"
  ) {
    const selected =
      field.fieldType === "SINGLE_SELECT"
        ? typeof value === "string" && value !== ""
          ? [value]
          : []
        : Array.isArray(value)
          ? value.filter((item): item is string => typeof item === "string")
          : [];
    return (
      <View className="cu-field">
        {heading}
        <View className="cu-seg">
          {(field.options ?? []).map((option) => {
            const picked = selected.includes(option.value);
            return (
              <Button
                key={option.value}
                className={`cu-seg-option${picked ? " is-active" : ""}`}
                aria-label={`${field.label} ${option.label}`}
                aria-pressed={picked}
                onClick={() => {
                  if (field.fieldType === "SINGLE_SELECT") {
                    onChange(option.value);
                    return;
                  }
                  onChange(
                    picked
                      ? selected.filter((item) => item !== option.value)
                      : [...selected, option.value],
                  );
                }}
              >
                {option.label}
                {option.priceDeltaFen
                  ? ` +${formatFenYuan(option.priceDeltaFen)}`
                  : ""}
              </Button>
            );
          })}
        </View>
        {field.fieldType === "SINGLE_SELECT" && allowsFreeInput(field) ? (
          <Input
            className="cu-input"
            name={field.stableKey}
            aria-label={`${field.label}（可自定义）`}
            value={asText(value)}
            placeholder="也可直接填写，例如 翡翠1"
            onInput={(event) => onChange(event.detail.value)}
          />
        ) : null}
        <Text className="cu-field-note">
          {field.required ? "必填" : "选填"} ·{" "}
          {FIELD_TYPE_LABELS[field.fieldType]}
          {field.fieldType === "SINGLE_SELECT" && allowsFreeInput(field)
            ? "，可填写预设外的值；不在预设库中不影响提交，将按基础价。"
            : ""}
        </Text>
        {missing ? <Text className="cu-field-hint">此项必填</Text> : null}
      </View>
    );
  }

  const text = asText(value);
  const placeholder =
    field.fieldType === "DATETIME"
      ? "2026-09-19 20:00"
      : (field.placeholder ?? "");
  return (
    <View className="cu-field">
      {heading}
      {field.fieldType === "TEXTAREA" ? (
        <Textarea
          className="cu-textarea"
          aria-label={field.label}
          value={text}
          placeholder={placeholder}
          onInput={(event) => onChange(event.detail.value)}
        />
      ) : (
        <Input
          className="cu-input"
          type={
            field.fieldType === "NUMBER" || field.fieldType === "MONEY_FEN"
              ? "digit"
              : "text"
          }
          name={field.stableKey}
          aria-label={field.label}
          value={text}
          placeholder={placeholder}
          onInput={(event) => onChange(event.detail.value)}
        />
      )}
      <Text className="cu-field-note">
        {field.required ? "必填" : "选填"} ·{" "}
        {FIELD_TYPE_LABELS[field.fieldType]}
        {field.fieldType === "DATETIME" ? "，例如 2026-09-19 20:00" : ""}
      </Text>
      {missing ? <Text className="cu-field-hint">此项必填</Text> : null}
    </View>
  );
}

function NoteBlock({ note }: { note: OrderNoteLike }) {
  return (
    <View className="cu-note">
      <Text className="cu-note-title">{note.label}</Text>
      <Text>{note.text}</Text>
    </View>
  );
}

/** 文本列占满剩余宽度，数字列固定窄宽，末列留给操作。 */
function tableCellClass(column: OrderTableColumnLike): string {
  return column.columnType === "NUMBER" ? "cu-col cu-col-count" : "cu-col";
}

function TableInput({
  table,
  rows,
  missing,
  onChange,
}: {
  table: OrderTableLike;
  rows: Record<string, unknown>[];
  missing: boolean;
  onChange: (rows: Record<string, unknown>[]) => void;
}) {
  return (
    <View className="cu-field">
      <Text className="cu-field-label">{table.label}</Text>
      <Text className="cu-field-note">可重复表格 · 每行单独填写</Text>
      <View className="cu-table">
        <View className="cu-table-head">
          {table.columns.map((column) => (
            <Text className={tableCellClass(column)} key={column.stableKey}>
              {column.label}
              {column.required ? <Text className="cu-required"> *</Text> : null}
            </Text>
          ))}
          <Text className="cu-col-action">操作</Text>
        </View>
        {rows.length === 0 ? (
          <Text className="cu-table-empty">
            还没有数据行，点「添加行」输入。
          </Text>
        ) : null}
        {rows.map((row, index) => (
          <View className="cu-table-row" key={`${table.stableKey}-${index}`}>
            {table.columns.map((column) => {
              const cell = asText(row[column.stableKey]);
              const setCell = (next: unknown) =>
                onChange(
                  rows.map((item, rowIndex) =>
                    rowIndex === index
                      ? { ...item, [column.stableKey]: next }
                      : item,
                  ),
                );
              const cellLabel = `${table.label} 第 ${index + 1} 行 ${column.label}`;
              return (
                <View className={tableCellClass(column)} key={column.stableKey}>
                  {column.columnType === "SINGLE_SELECT" ? (
                    <View className="cu-seg">
                      {(column.options ?? []).map((option) => (
                        <Button
                          key={option.value}
                          className={`cu-seg-option${cell === option.value ? " is-active" : ""}`}
                          aria-label={`${cellLabel} ${option.label}`}
                          aria-pressed={cell === option.value}
                          onClick={() => setCell(option.value)}
                        >
                          {option.label}
                        </Button>
                      ))}
                    </View>
                  ) : (
                    <Input
                      className="cu-input"
                      type={column.columnType === "NUMBER" ? "digit" : "text"}
                      aria-label={cellLabel}
                      value={cell}
                      onInput={(event) => setCell(event.detail.value)}
                    />
                  )}
                </View>
              );
            })}
            <View className="cu-col-action">
              <Button
                className="cu-table-delete"
                aria-label={`删除 ${table.label} 第 ${index + 1} 行`}
                onClick={() =>
                  onChange(rows.filter((_, rowIndex) => rowIndex !== index))
                }
              >
                删
              </Button>
            </View>
          </View>
        ))}
      </View>
      <Button
        className="cu-button cu-button-outline"
        aria-label={`添加一行 ${table.label}`}
        onClick={() => onChange([...rows, blankTableRow(table)])}
      >
        + 添加行
      </Button>
      {missing ? <Text className="cu-field-hint">此项必填</Text> : null}
    </View>
  );
}

function OrderForm({
  config,
  values,
  missingKeys,
  onChange,
}: {
  config: PublishedConfig;
  values: Record<string, unknown>;
  missingKeys: ReadonlySet<string>;
  onChange: (stableKey: string, value: unknown) => void;
}) {
  const sections = config.sections
    .filter((section) => section.enabled)
    .slice()
    .sort((left, right) => left.sortOrder - right.sortOrder);
  const activeSectionKeys = new Set(
    sections.map((section) => section.stableKey),
  );
  const components = config.components.filter(
    (component) =>
      component.enabled && activeSectionKeys.has(component.sectionKey),
  );

  return (
    <View className="cu-stack">
      {sections.map((section) => {
        const items = components
          .filter((component) => component.sectionKey === section.stableKey)
          .slice()
          .sort((left, right) => left.sortOrder - right.sortOrder);
        if (items.length === 0) return null;
        return (
          <View className="cu-card" key={section.stableKey}>
            <Text className="cu-card-title">{section.label}</Text>
            <View className="cu-fields">
              {items.map((component) => {
                const missing = missingKeys.has(component.stableKey);
                if (component.kind === "NOTE") {
                  return (
                    <NoteBlock key={component.stableKey} note={component} />
                  );
                }
                if (component.kind === "REPEATABLE_TABLE") {
                  return (
                    <TableInput
                      key={component.stableKey}
                      table={component}
                      rows={asRows(values[component.stableKey])}
                      missing={missing}
                      onChange={(rows) => onChange(component.stableKey, rows)}
                    />
                  );
                }
                return (
                  <FieldInput
                    key={component.stableKey}
                    field={component}
                    value={values[component.stableKey]}
                    missing={missing}
                    onChange={(value) => onChange(component.stableKey, value)}
                  />
                );
              })}
            </View>
          </View>
        );
      })}
    </View>
  );
}

export default function GameOrderPage() {
  const [token, setToken] = useState<string | null>(session.getToken());
  const [tenantCode, setTenantCode] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<Toast>(null);
  const [mode, setMode] = useState<FlowMode>("loading");
  const [selfEnabled, setSelfEnabled] = useState<boolean | null>(null);
  const [v1Notice, setV1Notice] = useState<string | null>(null);
  const [v1Created, setV1Created] = useState<CreatedDraft | null>(null);

  // v1（经典）下单页状态
  const [templates, setTemplates] = useState<TemplateOption[]>([]);
  const [detail, setDetail] = useState<TemplateDetail | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [duration, setDuration] = useState("60");

  // v2（通用模板）下单页状态
  const [games, setGames] = useState<PublishedGame[]>([]);
  const [gameId, setGameId] = useState("");
  const [v2Templates, setV2Templates] = useState<PublishedTemplate[]>([]);
  const [v2Template, setV2Template] = useState<PublishedTemplate | null>(null);
  const [v2Form, setV2Form] = useState<PublishedForm | null>(null);
  const [v2Values, setV2Values] = useState<Record<string, unknown>>({});
  const [v2Created, setV2Created] = useState<CreatedTemplateOrder | null>(null);
  const [intent, setIntent] = useState<OrderIntent | null>(null);

  const v2Step: V2Step =
    v2Created !== null
      ? "DONE"
      : v2Form !== null
        ? "FORM"
        : v2Template !== null
          ? "TEMPLATE"
          : gameId !== ""
            ? "TEMPLATE"
            : "GAME";
  const selectedGame = games.find((game) => game.gameId === gameId) ?? null;
  const missing = missingRequirements(
    v2Form?.config ?? { sections: [], components: [] },
    v2Values,
  );
  const missingKeys = new Set(missing.map((item) => item.key));

  const resetV2 = (keepGame: boolean) => {
    setV2Template(null);
    setV2Form(null);
    setV2Values({});
    setV2Created(null);
    setIntent(null);
    if (!keepGame) {
      setGameId("");
      setV2Templates([]);
    }
  };

  const showError = (error: unknown) => {
    setMsg({ tone: "error", text: errorText(error) });
    if (statusOf(error) === 401) {
      session.clearToken();
      setToken(null);
    }
  };

  const loadV1Templates = async (accessToken: string) => {
    const list = await apiAdapter.request<TemplateOption[]>(
      `${CUSTOMER_TEMPLATE_BASE}/templates`,
      { token: accessToken },
    );
    setTemplates(list);
    setMode("v1");
  };

  /** 试 v2：拿得到「可下单游戏」就走 v2，否则按 C-7 回退 v1。 */
  const tryV2 = async (accessToken: string): Promise<boolean> => {
    try {
      const list = await apiAdapter.request<PublishedGame[]>(
        CUSTOMER_GAMES_PATH,
        { token: accessToken },
      );
      if (list.length === 0) return false;
      setGames(list);
      setMode("v2");
      return true;
    } catch (error) {
      if (statusOf(error) === 401) throw error;
      // 403：v2 能力位未开；404：后端还是旧构建（还没有这条路由）→ 静默回退经典下单。
      if (statusOf(error) !== 403 && statusOf(error) !== 404) {
        setV1Notice("通用模板暂时不可用，已切换为经典下单流程。");
      }
      return false;
    }
  };

  const load = async (accessToken: string) => {
    setMsg(null);
    setV1Notice(null);
    setMode("loading");
    setV1Created(null);
    resetV2(false);
    try {
      const features = await apiAdapter.request<FeatureFlag[]>(
        "/api/v1/tenant/features",
        { token: accessToken },
      );
      const enabled =
        features.find(
          (feature) => feature.featureKey === CUSTOMER_SELF_SERVICE_FEATURE,
        )?.enabled !== false;
      setSelfEnabled(enabled);
      if (!enabled) {
        setTemplates([]);
        setMode("v1");
        return;
      }
      const v2Ready = await tryV2(accessToken);
      if (!v2Ready) await loadV1Templates(accessToken);
    } catch (error) {
      // 与升级前一致：加载失败即退出登录态，让用户重新登录。
      showError(error);
      session.clearToken();
      setToken(null);
    }
  };

  useLoad(async () => {
    const accessToken = session.getToken();
    setToken(accessToken);
    if (accessToken) await load(accessToken);
    const code = await resolveTenantCode();
    if (code) setTenantCode(code);
  });

  const login = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const accessToken = await customerLogin(tenantCode, username, password);
      setToken(accessToken);
      setPassword("");
      await load(accessToken);
    } catch (error) {
      setMsg({ tone: "error", text: errorText(error) });
    } finally {
      setBusy(false);
    }
  };

  // ===== v2：游戏 → 模板 → 表单 → 提交 =====

  const chooseGame = async (nextGameId: string) => {
    if (!token) return;
    setBusy(true);
    setMsg(null);
    setV1Notice(null);
    setGameId(nextGameId);
    resetV2(true);
    try {
      const list = await apiAdapter.request<PublishedTemplate[]>(
        `${CUSTOMER_TEMPLATE_BASE}/published?gameId=${encodeURIComponent(nextGameId)}`,
        { token },
      );
      if (list.length === 0) {
        // C-7：该游戏没有 v2 已发布模板 → 回退经典下单。
        setV1Notice("该游戏暂无通用模板，已切换为经典下单流程。");
        await loadV1Templates(token);
        return;
      }
      setV2Templates(list);
    } catch (error) {
      showError(error);
    } finally {
      setBusy(false);
    }
  };

  const chooseTemplate = async (template: PublishedTemplate) => {
    if (!token) return;
    setBusy(true);
    setMsg(null);
    try {
      const form = await apiAdapter.request<PublishedForm>(
        `${CUSTOMER_TEMPLATE_BASE}/versions/${template.versionId}/form`,
        { token },
      );
      setV2Template(template);
      setV2Form(form);
      setV2Values({});
      setIntent(null);
    } catch (error) {
      showError(error);
    } finally {
      setBusy(false);
    }
  };

  const setV2Value = (stableKey: string, value: unknown) => {
    setV2Values((previous) => ({ ...previous, [stableKey]: value }));
    setIntent(null);
    setMsg(null);
  };

  const submitV2 = async () => {
    if (!token || !v2Form || !v2Template) return;
    const collected = collectOrderValues(v2Form.config, v2Values);
    if (collected.errors.length > 0) {
      setMsg({ tone: "error", text: collected.errors[0] ?? "请检查表单" });
      return;
    }
    const body = {
      gameId: v2Form.gameId ?? gameId,
      templateId: v2Template.templateId,
      templateVersionId: v2Template.versionId,
      values: collected.values,
    };
    const nextIntent = orderIntentFor(intent, body, newIdempotencyKey);
    setIntent(nextIntent);
    setBusy(true);
    setMsg(null);
    try {
      const created = await apiAdapter.request<CreatedTemplateOrder>(
        `${CUSTOMER_TEMPLATE_BASE}/template-orders`,
        {
          method: "POST",
          token,
          body,
          headers: { "idempotency-key": nextIntent.key },
        },
      );
      setV2Created(created);
      setIntent(null);
    } catch (error) {
      showError(error);
    } finally {
      setBusy(false);
    }
  };

  // ===== v1（经典）下单 =====

  const selectTemplate = async (id: string) => {
    if (!token) return;
    setValues({});
    setCounts({});
    setDetail(null);
    setMsg(null);
    try {
      setDetail(
        await apiAdapter.request<TemplateDetail>(
          `${CUSTOMER_TEMPLATE_BASE}/templates/${id}`,
          { token },
        ),
      );
    } catch (error) {
      showError(error);
    }
  };

  const submitV1 = async () => {
    if (!token || !detail) return;
    const formValues: Record<string, string> = {};
    for (const field of detail.fields) {
      if (field.fieldType === "duration") continue;
      const value = values[field.fieldKey]?.trim() ?? "";
      if (field.required && !value) {
        setMsg({ tone: "error", text: `请填写 ${field.label}` });
        return;
      }
      if (value) formValues[field.fieldKey] = value;
    }
    const lines = detail.positions.map((position) => ({
      positionLabel: position.label,
      requiredCount: Math.max(1, counts[position.id] ?? position.defaultCount),
    }));
    setBusy(true);
    setMsg(null);
    try {
      const result = await apiAdapter.request<CreatedDraft>(
        `${CUSTOMER_TEMPLATE_BASE}/orders`,
        {
          method: "POST",
          token,
          body: {
            templateId: detail.id,
            formValues,
            durationMinutes: Number(duration),
            lines,
          },
        },
      );
      setV1Created(result);
    } catch (error) {
      showError(error);
    } finally {
      setBusy(false);
    }
  };

  const shellTitle =
    mode === "v2"
      ? STEP_TEXT[v2Step].title
      : v1Created !== null
        ? "下单成功"
        : "自助下单";
  const shellSubtitle =
    mode === "v2"
      ? STEP_TEXT[v2Step].subtitle
      : mode === "v1"
        ? "经典下单流程"
        : "正在加载…";

  return (
    <CustomerShell title={shellTitle} subtitle={shellSubtitle} active="order">
      {!token ? (
        <CustomerLoginCard
          tenantCode={tenantCode}
          username={username}
          password={password}
          busy={busy}
          actionLabel="登录并开始下单"
          onTenantCode={setTenantCode}
          onUsername={setUsername}
          onPassword={setPassword}
          onLogin={() => void login()}
        />
      ) : null}
      {msg ? (
        <CustomerMessage tone={msg.tone}>{msg.text}</CustomerMessage>
      ) : null}
      {token && v1Notice ? (
        <CustomerMessage tone="info">{v1Notice}</CustomerMessage>
      ) : null}
      {token && selfEnabled === false ? (
        <>
          <View className="cu-empty">
            这家门店暂未开启老板自助服务，请联系门店客服下单。
          </View>
          <Button
            className="cu-button cu-button-outline cu-button-small cu-button-full"
            onClick={() => goCustomer("/pages/customer/service-off/index")}
          >
            查看未开通说明
          </Button>
        </>
      ) : null}
      {token && selfEnabled && mode === "loading" ? (
        <View className="cu-loading">正在加载可下单的游戏…</View>
      ) : null}

      {/* v2：只显示服务端按 CUSTOMER 端口过滤后的内容，界面没有任何端口选择（C-9） */}
      {token && selfEnabled && mode === "v2" ? (
        <>
          {v2Step === "GAME" ? (
            <>
              <Text className="cu-section-label">选择游戏</Text>
              {games.map((game, index) => (
                <ChoiceCard
                  key={game.gameId}
                  order={index + 1}
                  title={game.name}
                  active={gameId === game.gameId}
                  onSelect={() => void chooseGame(game.gameId)}
                />
              ))}
              <Text className="cu-footnote">
                只列出有已发布模板的游戏；人数与加价由门店模板决定。
              </Text>
            </>
          ) : null}

          {v2Step === "TEMPLATE" ? (
            <>
              <Text className="cu-section-label">
                {selectedGame ? `${selectedGame.name} · 选择模板` : "选择模板"}
              </Text>
              {v2Templates.map((template, index) => (
                <ChoiceCard
                  key={template.templateId}
                  order={index + 1}
                  title={template.name}
                  note={`v${template.versionNo}${template.description ? ` · ${template.description}` : ""}`}
                  tag={template.isDefault ? "默认" : undefined}
                  active={v2Template?.templateId === template.templateId}
                  onSelect={() => void chooseTemplate(template)}
                />
              ))}
              <Button
                className="cu-button cu-button-outline cu-button-small cu-button-full"
                onClick={() => {
                  setMsg(null);
                  resetV2(false);
                }}
              >
                换个游戏
              </Button>
            </>
          ) : null}

          {v2Step === "FORM" && v2Form && v2Template ? (
            <>
              <View className="cu-card">
                <Text className="cu-card-title">{v2Template.name}</Text>
                <Text className="cu-meta">
                  锁定 v{v2Form.versionNo} · 人数与加价由服务端按发布快照计算
                </Text>
              </View>
              <OrderForm
                config={v2Form.config}
                values={v2Values}
                missingKeys={missingKeys}
                onChange={setV2Value}
              />
              <Button
                className={`cu-button cu-button-primary cu-button-full${busy ? " is-disabled" : ""}`}
                disabled={busy}
                onClick={() => void submitV2()}
              >
                {busy ? "提交中…" : "提交订单"}
              </Button>
              {missing.length > 0 ? (
                <Text className="cu-footnote">
                  还有 {missing.length} 个必填项未填写
                </Text>
              ) : null}
              <Button
                className="cu-button cu-button-outline cu-button-small cu-button-full"
                onClick={() => {
                  setMsg(null);
                  resetV2(true);
                }}
              >
                换个模板
              </Button>
            </>
          ) : null}

          {v2Step === "DONE" && v2Created ? (
            <>
              <View className="cu-stat cu-stat-pine">
                <Text className="cu-stat-label">下单成功</Text>
                <Text className="cu-stat-value">
                  {v2Created.staffingSummary.total} 人
                </Text>
                <Text className="cu-stat-note">
                  人数与加价由服务端按发布快照计算；门店确认并发布后会推送选人链接。
                </Text>
              </View>
              <View className="cu-card">
                <Text className="cu-card-title">服务端计算结果</Text>
                <View className="cu-money-line">
                  <Text>确认人数</Text>
                  <Text className="cu-money-line-value">
                    {v2Created.staffingSummary.total} 人
                  </Text>
                </View>
                {v2Created.staffingSummary.rows.map((row) => (
                  <View className="cu-money-line" key={row.label}>
                    <Text>{row.label}</Text>
                    <Text className="cu-money-line-value">{row.count} 人</Text>
                  </View>
                ))}
                <View className="cu-money-line">
                  <Text>选项加价</Text>
                  <Text className="cu-money-line-value">
                    {formatFenYuan(v2Created.priceAdjustmentFen)}
                  </Text>
                </View>
              </View>
              {v2Created.document?.plainText ? (
                <View className="cu-note">
                  <Text className="cu-note-title">订单文案</Text>
                  <Text>{v2Created.document.plainText}</Text>
                </View>
              ) : null}
              <Button
                className="cu-button cu-button-primary cu-button-full"
                onClick={() => goCustomer("/pages/customer/orders/index")}
              >
                查看我的订单
              </Button>
              <Button
                className="cu-button cu-button-outline cu-button-full"
                onClick={() => {
                  setMsg(null);
                  resetV2(false);
                }}
              >
                再下一单
              </Button>
            </>
          ) : null}
        </>
      ) : null}

      {/* v1 回退：addon 未开、后端无 v2 路由或该游戏没有已发布模板时保持原流程 */}
      {token && selfEnabled && mode === "v1" ? (
        <>
          {v1Created ? (
            <>
              <View className="cu-stat cu-stat-pine">
                <Text className="cu-stat-label">下单成功</Text>
                <Text className="cu-stat-value">{v1Created.dispatchNo}</Text>
                <Text className="cu-stat-note">
                  门店确认并发布后，会推送选人链接；钱包需保持余额充足。
                </Text>
              </View>
              <Button
                className="cu-button cu-button-primary cu-button-full"
                onClick={() => goCustomer("/pages/customer/orders/index")}
              >
                查看我的订单
              </Button>
            </>
          ) : null}
          {!v1Created ? (
            <>
              {templates.length === 0 ? (
                <View className="cu-empty">
                  暂无可用的下单模板，请等待门店配置服务目录。
                </View>
              ) : null}
              <Text className="cu-section-label">选择游戏模板</Text>
              <View className="cu-tabs">
                {templates.map((template) => (
                  <Button
                    key={template.id}
                    className={`cu-tab${detail?.id === template.id ? " is-active" : ""}`}
                    onClick={() => void selectTemplate(template.id)}
                  >
                    {template.name}
                  </Button>
                ))}
              </View>
              {detail ? (
                <View className="cu-card">
                  <Text className="cu-card-title">{detail.name}</Text>
                  <View className="cu-fields">
                    {detail.fields
                      .filter((field) => field.fieldType !== "duration")
                      .map((field) => (
                        <View className="cu-field" key={field.fieldKey}>
                          <Text className="cu-label">
                            {field.label}
                            {field.required ? " *" : ""}
                          </Text>
                          <Input
                            className="cu-input"
                            name={field.fieldKey}
                            aria-label={field.label}
                            value={values[field.fieldKey] ?? ""}
                            placeholder={field.options[0] ?? "填写"}
                            onInput={(event) =>
                              setValues({
                                ...values,
                                [field.fieldKey]: event.detail.value,
                              })
                            }
                          />
                        </View>
                      ))}
                    <View className="cu-field">
                      <Text className="cu-label">时长（分钟）</Text>
                      <Input
                        className="cu-input"
                        type="number"
                        name="durationMinutes"
                        aria-label="时长（分钟）"
                        value={duration}
                        onInput={(event) => setDuration(event.detail.value)}
                      />
                    </View>
                    {detail.positions.map((position) => (
                      <View className="cu-field" key={position.id}>
                        <Text className="cu-label">{position.label} 人数</Text>
                        <Input
                          className="cu-input"
                          type="number"
                          name={position.label}
                          aria-label={`${position.label}人数`}
                          value={String(
                            counts[position.id] ?? position.defaultCount,
                          )}
                          onInput={(event) =>
                            setCounts({
                              ...counts,
                              [position.id]: Math.max(
                                1,
                                Number(event.detail.value) || 1,
                              ),
                            })
                          }
                        />
                      </View>
                    ))}
                  </View>
                  <Button
                    className={`cu-button cu-button-primary cu-button-full${busy ? " is-disabled" : ""}`}
                    style={{ marginTop: 24 }}
                    disabled={busy}
                    onClick={() => void submitV1()}
                  >
                    {busy ? "提交中…" : "提交订单"}
                  </Button>
                </View>
              ) : null}
            </>
          ) : null}
        </>
      ) : null}
    </CustomerShell>
  );
}
