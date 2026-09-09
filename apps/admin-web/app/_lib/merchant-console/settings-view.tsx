"use client";

import { useEffect, useState } from "react";
import { RotateCcw, Save, UserPlus } from "lucide-react";
import {
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { apiFetch } from "../api";
import { DemoDialog, DemoEmptyState, useDemoToast } from "./demo-ui";
import {
  MERCHANT_GROUPS,
  MERCHANT_MODULES,
  MERCHANT_ROLES,
  MERCHANT_ROLE_META,
  canAccessModule,
} from "./modules";
import {
  type ConfigVersionRow,
  type EffectiveConfig,
  type FeatureState,
  type SubscriptionView,
  type TenantAccount,
  type TenantConfigV1,
  dateTime,
  statusLabel,
} from "./merchant-api";

export type SettingTabId =
  | "brand"
  | "versions"
  | "employees"
  | "matrix"
  | "plan";

const SETTING_TABS: Array<{ id: SettingTabId; label: string }> = [
  { id: "brand", label: "门店与品牌" },
  { id: "versions", label: "配置版本" },
  { id: "employees", label: "员工与角色" },
  { id: "matrix", label: "权限矩阵" },
  { id: "plan", label: "套餐与功能" },
];

const DEFAULT_CONFIG: TenantConfigV1 = {
  schemaVersion: "v1",
  brand: {
    primaryColor: "#2f54eb",
    accentColor: "#fa8c16",
    logoText: "PW",
    borderRadius: 8,
  },
  storefront: { allowCustomerSelection: true, showServiceDuration: true },
};

const ROLE_OPTIONS = [
  { value: "TENANT_OWNER", label: "店老板", desc: "全模块管理" },
  { value: "TENANT_ADMIN", label: "店长", desc: "经营与配置" },
  { value: "CUSTOMER_SERVICE", label: "客服", desc: "订单与派单" },
  { value: "FINANCE", label: "财务", desc: "结算与风控" },
];

export function SettingsModuleView() {
  const [tab, setTab] = useState<SettingTabId>("brand");
  return (
    <div>
      <div className="mc-pagehead">
        <div>
          <div className="mc-kicker">SETTINGS</div>
          <h1>门店设置</h1>
          <p>真实配置、版本回滚、员工角色与订阅状态。</p>
        </div>
      </div>
      <div className="mc-settings-tabs" role="tablist" aria-label="门店设置分区">
        {SETTING_TABS.map((item) => (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={tab === item.id}
            className={tab === item.id ? "active" : undefined}
            onClick={() => setTab(item.id)}
          >
            {item.label}
          </button>
        ))}
      </div>
      {tab === "brand" ? <BrandSection /> : null}
      {tab === "versions" ? <VersionSection /> : null}
      {tab === "employees" ? <EmployeesSection /> : null}
      {tab === "matrix" ? <MatrixSection /> : null}
      {tab === "plan" ? <PlanSection /> : null}
    </div>
  );
}

function BrandSection() {
  const queryClient = useQueryClient();
  const { toast, showToast } = useDemoToast();
  const [form, setForm] = useState<TenantConfigV1 | null>(null);
  const query = useQuery({
    queryKey: ["merchant", "settings", "effective"],
    queryFn: () => apiFetch<EffectiveConfig>("/api/v1/tenant/config"),
  });
  useEffect(() => {
    if (query.data?.config && !form) setForm(query.data.config);
  }, [query.data, form]);
  const [message, setMessage] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: () =>
      apiFetch<EffectiveConfig>("/api/v1/tenant/config", {
        method: "POST",
        body: JSON.stringify({ config: form ?? cfg }),
      }),
    onSuccess: (cfg) => {
      showToast(`配置已保存并生效（v${cfg.version}）。`);
      void queryClient.invalidateQueries({ queryKey: ["merchant", "settings"] });
    },
    onError: (e) => setMessage(e instanceof Error ? e.message : String(e)),
  });
  const cfg = query.data?.config ?? form ?? DEFAULT_CONFIG;
  const update = (patch: Partial<TenantConfigV1>) =>
    setForm((prev) => ({ ...(prev ?? cfg), ...patch }));
  const updateBrand = (patch: Partial<TenantConfigV1["brand"]>) =>
    update({ brand: { ...cfg.brand, ...patch } });
  const updateStorefront = (patch: Partial<TenantConfigV1["storefront"]>) =>
    update({ storefront: { ...cfg.storefront, ...patch } });
  return (
    <section className="mc-panel mc-form-panel">
      <div className="mc-settings-section-title">
        <h2>门店资料与品牌</h2>
        <p>当前生效版本 v{query.data?.version ?? "-"} · {query.data?.status ?? "加载中"}</p>
      </div>
      {message ? <div className="mc-notice">{message}</div> : null}
      <div className="mc-form-grid">
        <label className="mc-field"><span>主色</span><input type="color" value={cfg.brand.primaryColor} onChange={(e) => updateBrand({ primaryColor: e.target.value })} /></label>
        <label className="mc-field"><span>辅色</span><input type="color" value={cfg.brand.accentColor} onChange={(e) => updateBrand({ accentColor: e.target.value })} /></label>
        <label className="mc-field"><span>门店文字（1-40）</span><input maxLength={40} value={cfg.brand.logoText} onChange={(e) => updateBrand({ logoText: e.target.value })} /></label>
        <label className="mc-field"><span>圆角（0-24）</span><input type="number" min={0} max={24} value={cfg.brand.borderRadius} onChange={(e) => updateBrand({ borderRadius: Number(e.target.value) })} /></label>
      </div>
      <label className="mc-check">
        <input type="checkbox" checked={cfg.storefront.allowCustomerSelection} onChange={(e) => updateStorefront({ allowCustomerSelection: e.target.checked })} />
        前台允许客户自选陪玩
      </label>
      <label className="mc-check">
        <input type="checkbox" checked={cfg.storefront.showServiceDuration} onChange={(e) => updateStorefront({ showServiceDuration: e.target.checked })} />
        前台展示服务时长
      </label>
      <div className="mc-brand-preview">
        <span className="mc-brand-logo" style={{ background: cfg.brand.accentColor, borderRadius: cfg.brand.borderRadius }}>
          {cfg.brand.logoText.slice(0, 2).toUpperCase()}
        </span>
        <span><b>{cfg.brand.logoText}</b><small>保存后门店前台与后台统一读取。</small></span>
      </div>
      <div className="mc-button-row mc-form-actions">
        <button type="button" className="mc-btn mc-btn-primary" disabled={save.isPending} onClick={() => save.mutate()}>
          <Save size={15} /> 保存并生效
        </button>
      </div>
      {toast}
    </section>
  );
}

function VersionSection() {
  const queryClient = useQueryClient();
  const { toast, showToast } = useDemoToast();
  const versionsQuery = useQuery({
    queryKey: ["merchant", "settings", "versions"],
    queryFn: () =>
      apiFetch<ConfigVersionRow[]>("/api/v1/tenant/config/versions"),
  });
  const [message, setMessage] = useState<string | null>(null);
  const rollback = useMutation({
    mutationFn: () =>
      apiFetch<EffectiveConfig>("/api/v1/tenant/config/rollback", { method: "POST" }),
    onSuccess: (cfg) => {
      showToast(`已回滚到上一版本（当前 v${cfg.version}）。`);
      void queryClient.invalidateQueries({ queryKey: ["merchant", "settings"] });
    },
    onError: (e) => setMessage(e instanceof Error ? e.message : String(e)),
  });
  const rows = versionsQuery.data ?? [];
  const [confirm, setConfirm] = useState(false);
  return (
    <section className="mc-panel">
      <div className="mc-section-head">
        <div><h2>配置版本历史与回滚</h2><p>每次保存生成新版本；回滚到上一生效版本。</p></div>
      </div>
      {message ? <div className="mc-notice">{message}</div> : null}
      {rows.length ? (
        <div className="mc-version-list">
          {[...rows].sort((a, b) => b.version - a.version).map((version) => (
            <div className="mc-version-row" key={version.id}>
              <span className="mc-version-meta">
                <b>v{version.version} · {version.status}</b>
                <small>{dateTime(version.createdAt)}</small>
              </span>
              <span className="mc-version-actions">
                <span className={`mc-status ${version.status === "ACTIVE" ? "st-done" : "st-muted"}`}>
                  {version.status === "ACTIVE" ? "当前版本" : "历史版本"}
                </span>
                {version.status !== "ACTIVE" ? (
                  <button type="button" className="mc-btn mc-btn-small" onClick={() => setConfirm(true)}>
                    <RotateCcw size={13} /> 回滚上一版本
                  </button>
                ) : null}
              </span>
            </div>
          ))}
        </div>
      ) : <div className="mc-empty mc-empty-compact">暂无保存记录。</div>}
      <DemoDialog
        open={confirm}
        title="回滚配置"
        confirmLabel="确认回滚"
        onCancel={() => setConfirm(false)}
        onConfirm={() => { setConfirm(false); rollback.mutate(); }}
      >
        <p>回滚会将上一生效版本重新置为当前版本，并生成新版本记录。</p>
      </DemoDialog>
      {toast}
    </section>
  );
}

function EmployeesSection() {
  const queryClient = useQueryClient();
  const { toast, showToast } = useDemoToast();
  const employeesQuery = useQuery({
    queryKey: ["merchant", "settings", "employees"],
    queryFn: () => apiFetch<TenantAccount[]>("/api/v1/tenant/accounts"),
  });
  const [dialog, setDialog] = useState<
    | { mode: "create"; employee: null }
    | { mode: "edit"; employee: TenantAccount }
    | null
  >(null);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [roles, setRoles] = useState<string[]>(["CUSTOMER_SERVICE"]);
  const [message, setMessage] = useState<string | null>(null);
  const employees = employeesQuery.data ?? [];

  const save = useMutation({
    mutationFn: async () => {
      if (!username.trim()) throw new Error("请输入用户名");
      if (roles.length === 0) throw new Error("至少选择一个角色");
      if (dialog?.mode === "create") {
        if (password.length < 8) throw new Error("密码至少 8 位");
        return apiFetch<TenantAccount>("/api/v1/tenant/accounts", {
          method: "POST",
          body: JSON.stringify({ username, password, roles }),
        });
      }
      if (!dialog || dialog.mode !== "edit" || !dialog.employee)
        throw new Error("缺少员工信息");
      return apiFetch<TenantAccount>(
        `/api/v1/tenant/accounts/${dialog.employee.id}/roles`,
        { method: "PATCH", body: JSON.stringify({ roles }) },
      );
    },
    onSuccess: () => {
      setDialog(null);
      showToast("员工已保存。");
      void queryClient.invalidateQueries({ queryKey: ["merchant", "settings", "employees"] });
    },
    onError: (e) => setMessage(e instanceof Error ? e.message : String(e)),
  });
  const toggleStatus = useMutation({
    mutationFn: (employee: TenantAccount) =>
      apiFetch<TenantAccount>(
        `/api/v1/tenant/accounts/${employee.id}/status`,
        {
          method: "PATCH",
          body: JSON.stringify({
            status: employee.status === "ACTIVE" ? "DISABLED" : "ACTIVE",
          }),
        },
      ),
    onSuccess: () => {
      showToast("员工状态已更新。");
      void queryClient.invalidateQueries({ queryKey: ["merchant", "settings", "employees"] });
    },
    onError: (e) => setMessage(e instanceof Error ? e.message : String(e)),
  });

  return (
    <section className="mc-panel">
      <div className="mc-section-head">
        <div><h2>员工与角色</h2><p>真实员工账号、启停与角色分配。</p></div>
        <button type="button" className="mc-btn mc-btn-small" onClick={() => { setDialog({ mode: "create", employee: null }); setUsername(""); setPassword(""); setRoles(["CUSTOMER_SERVICE"]); setMessage(null); }}>
          <UserPlus size={14} /> 新建员工
        </button>
      </div>
      {message ? <div className="mc-notice">{message}</div> : null}
      {employees.length ? (
        <div className="mc-table-wrap">
          <table>
            <thead><tr><th>员工</th><th>角色</th><th>状态</th><th>创建时间</th><th>操作</th></tr></thead>
            <tbody>
              {employees.map((employee) => (
                <tr key={employee.id}>
                  <td><b className="mc-cell-title">{employee.username}</b></td>
                  <td>{employee.roles.map((role) => ROLE_OPTIONS.find((r) => r.value === role)?.label ?? role).join(" / ")}</td>
                  <td><span className={`mc-status ${employee.status === "ACTIVE" ? "st-done" : "st-cancelled"}`}>{statusLabel(employee.status)}</span></td>
                  <td>{dateTime(employee.createdAt)}</td>
                  <td>
                    <div className="mc-button-row">
                      <button type="button" className="mc-btn mc-btn-ghost mc-btn-small" onClick={() => { setDialog({ mode: "edit", employee }); setUsername(employee.username); setPassword(""); setRoles(employee.roles); setMessage(null); }}>编辑角色</button>
                      <button type="button" className="mc-btn mc-btn-ghost mc-btn-small" onClick={() => toggleStatus.mutate(employee)}>{employee.status === "ACTIVE" ? "停用" : "启用"}</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : <DemoEmptyState title="暂无员工账号" description="当前角色可能没有员工管理权限或尚未创建。" />}

      {dialog ? (
        <DemoDialog
          open
          title={dialog.mode === "create" ? "新建员工" : `编辑角色：${dialog.employee.username}`}
          confirmLabel="保存"
          onCancel={() => setDialog(null)}
          onConfirm={() => save.mutate()}
        >
          <div className="mc-form-grid">
            <label className="mc-field"><span>用户名</span><input value={username} disabled={dialog.mode === "edit"} onChange={(e) => setUsername(e.target.value)} /></label>
            {dialog.mode === "create" ? <label className="mc-field"><span>初始密码（≥8）</span><input type="password" value={password} onChange={(e) => setPassword(e.target.value)} /></label> : null}
          </div>
          <fieldset>
            <legend>角色</legend>
            <div className="mc-feature-list">
              {ROLE_OPTIONS.map((option) => (
                <label className="mc-check" key={option.value}>
                  <input
                    type="checkbox"
                    checked={roles.includes(option.value)}
                    onChange={(e) =>
                      setRoles((prev) =>
                        e.target.checked
                          ? [...prev, option.value]
                          : prev.filter((r) => r !== option.value),
                      )
                    }
                  />
                  <span><b>{option.label}</b><small>{option.desc}</small></span>
                </label>
              ))}
            </div>
          </fieldset>
        </DemoDialog>
      ) : null}
      {toast}
    </section>
  );
}

function MatrixSection() {
  return (
    <section className="mc-panel">
      <div className="mc-section-head">
        <div><h2>权限矩阵</h2><p>三台模块 × 四角色；真实访问由后端角色权限执行。</p></div>
      </div>
      <div className="mc-table-wrap mc-matrix-table">
        <table>
          <thead><tr><th>模块</th>{MERCHANT_ROLES.map((role) => <th key={role}>{MERCHANT_ROLE_META[role].label}</th>)}</tr></thead>
          <tbody>
            {MERCHANT_GROUPS.map((group) =>
              MERCHANT_MODULES.filter((m) => m.group === group.id).map((m) => (
                <tr key={m.id}>
                  <td><span className="mc-sub">{group.label}</span><b className="mc-cell-title">{m.label}</b></td>
                  {MERCHANT_ROLES.map((role) => (
                    <td key={role}>{canAccessModule(role, m.id) ? "✓" : "—"}</td>
                  ))}
                </tr>
              )),
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function PlanSection() {
  const subscriptionQuery = useQuery({
    queryKey: ["merchant", "settings", "subscription"],
    queryFn: () =>
      apiFetch<SubscriptionView | null>("/api/v1/tenant/subscription"),
  });
  const featuresQuery = useQuery({
    queryKey: ["merchant", "settings", "features"],
    queryFn: () => apiFetch<FeatureState[]>("/api/v1/tenant/features"),
  });
  const subscription = subscriptionQuery.data;
  const features = featuresQuery.data ?? [];
  return (
    <div className="mc-plan-grid">
      <section className="mc-panel mc-form-panel">
        <div className="mc-settings-section-title"><h2>当前套餐</h2><p>续费与套餐变更由平台端处理。</p></div>
        {subscription ? (
          <>
            <div className="mc-summary-line"><span>套餐</span><b>{subscription.packageCode}</b></div>
            <div className="mc-summary-line"><span>状态</span><b>{statusLabel(subscription.status)}</b></div>
            <div className="mc-summary-line"><span>生效 / 到期</span><b>{dateTime(subscription.startsAt)} → {dateTime(subscription.endsAt)}</b></div>
          </>
        ) : subscriptionQuery.isPending ? <div className="mc-empty mc-empty-compact">加载中…</div> : <div className="mc-empty mc-empty-compact">暂无生效订阅，请联系平台开通。</div>}
      </section>
      <section className="mc-panel">
        <div className="mc-section-head"><div><h2>功能开关</h2><p>增值功能由平台控制，此处展示真实状态。</p></div></div>
        {features.length ? (
          <div className="mc-feature-list">
            {features.map((feature) => (
              <div className="mc-feature-row" key={feature.featureKey}>
                <span><b>{feature.featureKey}</b><small>{feature.core ? "core" : "addon"}</small></span>
                <span className={`mc-status ${feature.enabled ? "st-done" : "st-muted"}`}>
                  {feature.enabled ? "已启用" : "未启用"}
                </span>
              </div>
            ))}
          </div>
        ) : <DemoEmptyState title="暂无功能开关" description="套餐开通后展示。" />}
      </section>
    </div>
  );
}
