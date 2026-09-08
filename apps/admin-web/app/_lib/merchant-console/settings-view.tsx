"use client";

import { useState } from "react";
import { Check, RotateCcw, Save, UserPlus } from "lucide-react";
import { DemoDialog, useDemoToast } from "./demo-ui";
import { featureDescription, featureMeta } from "../feature-catalog";
import {
  MERCHANT_GROUPS,
  MERCHANT_MODULES,
  MERCHANT_ROLE_META,
  MERCHANT_ROLES,
  canAccessModule,
  type MerchantModule,
} from "./modules";
import {
  SETTING_EMPLOYEES,
  SETTING_FEATURE_ENABLED,
  SETTING_FEATURE_KEYS,
  SETTING_TABS,
  SETTING_VERSIONS,
  type SettingTabId,
  type SettingVersion,
} from "./settings-data";

export function SettingsModuleView() {
  const [tab, setTab] = useState<SettingTabId>("brand");

  return (
    <div>
      <div className="mc-pagehead">
        <div>
          <div className="mc-kicker">SETTINGS</div>
          <h1>门店设置</h1>
          <p>
            门店资料与品牌、配置版本、员工与角色、权限矩阵、套餐与功能开关。
          </p>
        </div>
        <span className="mc-chip">
          原型演示 <b>未接后端</b>
        </span>
      </div>

      <div
        className="mc-settings-tabs"
        role="tablist"
        aria-label="门店设置分区"
      >
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
      {tab === "versions" ? <VersionHistorySection /> : null}
      {tab === "employees" ? <EmployeesSection /> : null}
      {tab === "matrix" ? <MatrixSection /> : null}
      {tab === "plan" ? <PlanSection /> : null}
    </div>
  );
}

function VersionHistorySection() {
  const { toast, showToast } = useDemoToast();
  const [rollback, setRollback] = useState<SettingVersion | null>(null);

  return (
    <section className="mc-panel">
      <div className="mc-section-head">
        <div>
          <h2>配置版本历史与回滚</h2>
          <p>
            品牌、服务规则等门店配置均保留版本；回滚会生成新版本而非删除旧版
          </p>
        </div>
      </div>
      <div className="mc-version-list">
        {SETTING_VERSIONS.map((version) => (
          <div className="mc-version-row" key={version.id}>
            <span className="mc-version-meta">
              <b>
                {version.version} · {version.label}
              </b>
              <small>
                {version.actor} · {version.time}
              </small>
            </span>
            <span className="mc-version-actions">
              <span
                className={`mc-status ${version.isCurrent ? "st-done" : "st-muted"}`}
              >
                {version.isCurrent ? "当前版本" : "历史版本"}
              </span>
              {!version.isCurrent ? (
                <button
                  type="button"
                  className="mc-btn mc-btn-small"
                  onClick={() => setRollback(version)}
                >
                  <RotateCcw size={13} />
                  回滚到此版本
                </button>
              ) : null}
            </span>
          </div>
        ))}
      </div>
      <div className="mc-notice">
        演示仅展示版本列表与确认流程；真实回滚调用租户配置接口并写入审计日志。
      </div>

      {rollback ? (
        <DemoDialog
          open
          title={`回滚到 ${rollback.version}`}
          confirmLabel="确认回滚"
          onCancel={() => setRollback(null)}
          onConfirm={() => {
            setRollback(null);
            showToast("演示回滚已记录 · 未调用 config/rollback");
          }}
        >
          <p>
            回滚后门店配置将恢复到「{rollback.label}」，并生成新的版本记录。
          </p>
          <div className="mc-summary-line">
            <span>目标版本</span>
            <b>{rollback.version}</b>
          </div>
        </DemoDialog>
      ) : null}
      {toast}
    </section>
  );
}

function BrandSection() {
  const { toast, showToast } = useDemoToast();
  const [storeName, setStoreName] = useState("南城 · 壹号店");
  const [storeCode] = useState("c1");
  const [businessStatus] = useState("营业中");
  const [accentColor, setAccentColor] = useState("#CF6040");
  const [timezone] = useState("Asia/Shanghai");

  return (
    <section className="mc-panel mc-form-panel">
      <div className="mc-settings-section-title">
        <h2>门店资料与品牌</h2>
        <p>
          门店身份、H5 访问域名与视觉 token 覆盖；品牌 token 将由门店 H5 读取。
        </p>
      </div>
      <div className="mc-form-grid">
        <label className="mc-field">
          <span>门店名称</span>
          <input
            value={storeName}
            onChange={(event) => setStoreName(event.target.value)}
          />
        </label>
        <label className="mc-field">
          <span>门店 code</span>
          <input value={storeCode} readOnly />
        </label>
        <label className="mc-field">
          <span>营业状态</span>
          <input value={businessStatus} readOnly />
        </label>
        <label className="mc-field">
          <span>时区</span>
          <input value={timezone} readOnly />
        </label>
        <label className="mc-field">
          <span>主操作色（accent）</span>
          <input
            type="color"
            value={accentColor}
            onChange={(event) => setAccentColor(event.target.value)}
          />
        </label>
      </div>
      <div className="mc-brand-preview">
        <span className="mc-brand-logo" style={{ background: accentColor }}>
          PW
        </span>
        <span>
          <b>{storeName}</b>
          <small>门店前台与后台统一读取该品牌值（演示）</small>
        </span>
      </div>
      <div className="mc-notice">
        保存仅更新当前页面的演示状态；真实门店资料与品牌 token
        需要租户配置接口。
      </div>
      <div className="mc-button-row mc-form-actions">
        <button
          type="button"
          className="mc-btn mc-btn-primary"
          onClick={() => showToast("门店资料已保存 · 仅前端演示")}
        >
          <Save size={15} />
          保存门店资料
        </button>
      </div>
      {toast}
    </section>
  );
}

function EmployeesSection() {
  const { toast, showToast } = useDemoToast();
  const [dialogEmployee, setDialogEmployee] = useState<
    (typeof SETTING_EMPLOYEES)[number] | null
  >(null);

  return (
    <section className="mc-panel">
      <div className="mc-section-head">
        <div>
          <h2>员工与角色</h2>
          <p>员工列表与角色分配；真实账号与邀请接口在后端权限切片开放</p>
        </div>
        <button
          type="button"
          className="mc-btn mc-btn-small"
          onClick={() => showToast("演示：员工邀请表单将在账号接口就绪后启用")}
        >
          <UserPlus size={14} />
          邀请员工
        </button>
      </div>
      <div className="mc-table-wrap">
        <table>
          <thead>
            <tr>
              <th>员工</th>
              <th>角色</th>
              <th>最近活跃</th>
              <th>状态</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {SETTING_EMPLOYEES.map((employee) => (
              <tr key={employee.id}>
                <td>
                  <span className="mc-avatar mc-avatar-sm">
                    {employee.name.slice(0, 1)}
                  </span>
                  <span className="mc-cell-title">{employee.name}</span>
                </td>
                <td>
                  <b>{employee.roleLabel}</b>
                  <span className="mc-sub">{employee.roleDesc}</span>
                </td>
                <td>{employee.lastActive}</td>
                <td>
                  <span className={`mc-status st-${employee.statusTone}`}>
                    {employee.statusLabel}
                  </span>
                </td>
                <td>
                  <button
                    type="button"
                    className="mc-btn mc-btn-ghost mc-btn-small"
                    onClick={() => setDialogEmployee(employee)}
                  >
                    编辑角色
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {dialogEmployee ? (
        <DemoDialog
          open
          title={`编辑角色 · ${dialogEmployee.name}`}
          confirmLabel="了解"
          onCancel={() => setDialogEmployee(null)}
          onConfirm={() => {
            setDialogEmployee(null);
            showToast("角色分配演示完成 · 后端权限矩阵未改动");
          }}
        >
          <p>
            当前角色为「{dialogEmployee.roleLabel} · {dialogEmployee.roleDesc}
            」。员工角色分配与细粒度授权将作为独立权限模型由后端开放，前端只读展示。
          </p>
          <div className="mc-summary-line">
            <span>最近活跃</span>
            <b>{dialogEmployee.lastActive}</b>
          </div>
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
        <div>
          <h2>权限矩阵</h2>
          <p>三台模块 × 四角色，由 UiPermission mock 驱动（只读展示）</p>
        </div>
      </div>
      <div className="mc-table-wrap mc-matrix-table">
        <table>
          <thead>
            <tr>
              <th>模块</th>
              {MERCHANT_ROLES.map((role) => (
                <th key={role}>
                  {MERCHANT_ROLE_META[role].label}
                  <span className="mc-sub">
                    {MERCHANT_ROLE_META[role].desc}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {MERCHANT_GROUPS.map((group) => (
              <MatrixGroupRows
                key={group.id}
                groupLabel={group.label}
                modules={MERCHANT_MODULES.filter(
                  (moduleItem) => moduleItem.group === group.id,
                )}
              />
            ))}
          </tbody>
        </table>
      </div>
      <div className="mc-table-foot">
        <span>「✓」= mock 导航可见；财务审计为「只读 · 涉自身」</span>
        <span>前端隐藏不等于授权，接入后端后以真实权限为准</span>
      </div>
    </section>
  );
}

function MatrixGroupRows({
  groupLabel,
  modules,
}: {
  groupLabel: string;
  modules: MerchantModule[];
}) {
  return modules.map((moduleItem) => (
    <tr key={moduleItem.id}>
      <td>
        <span className="mc-sub">{groupLabel}</span>
        <b className="mc-cell-title">{moduleItem.label}</b>
      </td>
      {MERCHANT_ROLES.map((role) => (
        <td key={role}>
          {canAccessModule(role, moduleItem.id) ? (
            <span className="mc-matrix-check">
              <Check size={14} aria-hidden="true" />
            </span>
          ) : (
            <span className="mc-muted-text">—</span>
          )}
        </td>
      ))}
    </tr>
  ));
}

function PlanSection() {
  const { toast, showToast } = useDemoToast();
  const [enabled, setEnabled] = useState<Set<string>>(
    () => new Set(SETTING_FEATURE_ENABLED),
  );

  const toggle = (featureKey: string) => {
    setEnabled((prev) => {
      const next = new Set(prev);
      if (next.has(featureKey)) {
        next.delete(featureKey);
      } else {
        next.add(featureKey);
      }
      return next;
    });
  };

  return (
    <div className="mc-plan-grid">
      <section className="mc-panel mc-form-panel">
        <div className="mc-settings-section-title">
          <h2>当前套餐</h2>
          <p>套餐与订阅状态为演示数据，真实状态来自订阅与权益接口。</p>
        </div>
        <div className="mc-summary-line">
          <span>套餐</span>
          <b>专业版</b>
        </div>
        <div className="mc-summary-line">
          <span>状态</span>
          <b>生效中</b>
        </div>
        <div className="mc-summary-line">
          <span>到期时间</span>
          <b>2026-10-01</b>
        </div>
        <div className="mc-notice">
          “续费”“切换套餐”按钮待后端订阅接口就绪后启用，当前不提供跳转。
        </div>
      </section>

      <section className="mc-panel">
        <div className="mc-section-head">
          <div>
            <h2>功能开关</h2>
            <p>增值模块为独立权益；core 功能随套餐启用（演示只读）</p>
          </div>
        </div>
        <div className="mc-feature-list">
          {SETTING_FEATURE_KEYS.map((featureKey) => {
            const meta = featureMeta(featureKey);
            if (!meta) return null;
            const isCore = featureKey.startsWith("core.");
            const isOn = enabled.has(featureKey);
            return (
              <div className="mc-feature-row" key={featureKey}>
                <span>
                  <b>{meta.name}</b>
                  <small>{featureDescription(featureKey)}</small>
                </span>
                <span className="mc-feature-action">
                  <span
                    className={`mc-status ${isOn ? "st-done" : "st-muted"}`}
                  >
                    {isOn ? "已启用" : "未启用"}
                  </span>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={isOn}
                    aria-label={`${meta.name}开关`}
                    className={`mc-switch${isOn ? " on" : ""}`}
                    disabled={isCore}
                    onClick={() => toggle(featureKey)}
                  >
                    <i />
                  </button>
                </span>
              </div>
            );
          })}
        </div>
        <div className="mc-table-foot">
          <button
            type="button"
            className="mc-btn mc-btn-primary mc-btn-small"
            onClick={() => showToast("功能开关已保存 · 仅前端演示")}
          >
            <Save size={14} />
            保存开关
          </button>
          <span>
            {[...enabled].filter((key) => key.startsWith("addon.")).length}{" "}
            个增值模块启用
          </span>
        </div>
      </section>

      {toast}
    </div>
  );
}
