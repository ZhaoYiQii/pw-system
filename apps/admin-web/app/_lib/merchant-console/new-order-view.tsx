"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Plus, Save, ShieldAlert } from "lucide-react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { apiFetch } from "../api";
import {
  type CustomerRow,
  type TemplateDetail,
  type TemplateRow,
} from "./merchant-api";
import { useMerchantRole } from "./role-context";

export function NewOrderView() {
  const router = useRouter();
  const { role } = useMerchantRole();
  const canOperate = role === "OWNER" || role === "ADMIN" || role === "CS";
  const [templateId, setTemplateId] = useState("");
  const [customerId, setCustomerId] = useState("");
  const [values, setValues] = useState<Record<string, string>>({});
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [duration, setDuration] = useState("60");
  const [error, setError] = useState<string | null>(null);

  const templatesQuery = useQuery({
    queryKey: ["merchant", "new-order", "templates"],
    queryFn: () => apiFetch<TemplateRow[]>("/api/v1/tenant/game-templates"),
  });
  const customersQuery = useQuery({
    queryKey: ["merchant", "new-order", "customers"],
    queryFn: () => apiFetch<CustomerRow[]>("/api/v1/tenant/customers"),
  });
  const templateQuery = useQuery({
    queryKey: ["merchant", "new-order", "template", templateId],
    queryFn: () =>
      apiFetch<TemplateDetail>(`/api/v1/tenant/game-templates/${templateId}`),
    enabled: templateId.length > 0,
  });

  const template = templateQuery.data;

  useEffect(() => {
    if (template) {
      setValues({});
      setCounts({});
      const dt = template.fields.find((f) => f.fieldType === "datetime");
      if (dt) setValues((prev) => ({ ...prev, [dt.fieldKey]: "" }));
    }
  }, [templateId, template]);

  const create = useMutation({
    mutationFn: async () => {
      if (!template) throw new Error("请先选择游戏模板");
      if (!customerId) throw new Error("请选择老板客户");
      const formValues: Record<string, string> = {};
      for (const field of template.fields) {
        if (field.fieldType === "duration") continue;
        const value = (values[field.fieldKey] ?? "").trim();
        if (field.required && !value) throw new Error(`请填写${field.label}`);
        if (value) formValues[field.fieldKey] = value;
      }
      const dtField = template.fields.find(
        (field) => field.fieldType === "datetime",
      );
      const desired = dtField
        ? values[dtField.fieldKey]?.trim() ?? ""
        : "";
      const lines = template.positions.map((position) => ({
        positionLabel: position.label,
        requiredCount: Math.max(1, counts[position.id] ?? position.defaultCount),
      }));
      if (lines.length === 0) throw new Error("模板至少需要一个岗位");
      const minutes = Number(duration);
      if (!Number.isFinite(minutes) || minutes < 1)
        throw new Error("请填写有效的目标时长");
      return apiFetch<{ orderId: string }>(
        "/api/v1/tenant/game-dispatch/orders",
        {
          method: "POST",
          body: JSON.stringify({
            templateId,
            customerProfileId: customerId,
            formValues,
            ...(desired
              ? { desiredStartAt: new Date(desired).toISOString() }
              : {}),
            durationMinutes: minutes,
            lines,
          }),
        },
      );
    },
    onSuccess: (row) => {
      setError(null);
      router.push(`/merchant-console/dispatch/${row.orderId}?kind=GD`);
    },
    onError: (e) => setError(e instanceof Error ? e.message : String(e)),
  });

  if (!canOperate) {
    return (
      <section className="mc-panel mc-forbidden">
        <div className="mc-forbidden-mark" aria-hidden="true">
          <ShieldAlert size={26} />
        </div>
        <h1>只读角色 · 403</h1>
        <p>新建派单需要店老板、店长或客服角色。</p>
        <Link href="/merchant-console/dispatch" className="mc-btn">
          回到订单台账
        </Link>
      </section>
    );
  }

  const selectTemplate = (id: string) => {
    setTemplateId(id);
    setCustomerId("");
    setDuration("60");
  };

  return (
    <div>
      <div className="mc-pagehead">
        <div>
          <div className="mc-kicker">ORDER CREATE / GD</div>
          <h1>新建派单</h1>
          <p>选择游戏模板与老板客户，创建后到详情页发布开放报名。</p>
        </div>
        <Link href="/merchant-console/dispatch" className="mc-btn">
          返回订单台账
        </Link>
      </div>

      {error ? <div className="mc-notice">{error}</div> : null}

      <section className="mc-panel mc-form-panel">
        <div className="mc-form-grid">
          <label className="mc-field">
            <span>游戏模板</span>
            <select value={templateId} onChange={(e) => selectTemplate(e.target.value)}>
              <option value="">选择模板…</option>
              {(templatesQuery.data ?? [])
                .filter((t) => t.enabled)
                .map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
            </select>
          </label>
          <label className="mc-field">
            <span>老板客户</span>
            <select
              value={customerId}
              onChange={(e) => setCustomerId(e.target.value)}
              disabled={!template}
            >
              <option value="">选择客户…</option>
              {(customersQuery.data ?? []).map((customer) => (
                <option key={customer.id} value={customer.id}>
                  {customer.name}
                </option>
              ))}
            </select>
          </label>
        </div>
      </section>

      {template ? (
        <section className="mc-panel mc-form-panel">
          <div className="mc-settings-section-title">
            <h2>{template.name} · 下单信息</h2>
            <p>带 * 为必填；解析与填写结果可直接用于发布。</p>
          </div>
          <div className="mc-form-grid">
            {template.fields
              .filter((field) => field.fieldType !== "duration")
              .map((field) => (
                <label className="mc-field" key={field.fieldKey}>
                  <span>
                    {field.label}
                    {field.required ? " *" : ""}
                  </span>
                  {field.fieldType === "multiline" ? (
                    <textarea
                      value={values[field.fieldKey] ?? ""}
                      onChange={(e) =>
                        setValues((prev) => ({
                          ...prev,
                          [field.fieldKey]: e.target.value,
                        }))
                      }
                    />
                  ) : field.fieldType === "select" ? (
                    <select
                      value={values[field.fieldKey] ?? ""}
                      onChange={(e) =>
                        setValues((prev) => ({
                          ...prev,
                          [field.fieldKey]: e.target.value,
                        }))
                      }
                    >
                      <option value="">请选择…</option>
                      {field.options.map((option) => (
                        <option key={option} value={option}>
                          {option}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <input
                      type={field.fieldType === "datetime" ? "datetime-local" : "text"}
                      value={values[field.fieldKey] ?? ""}
                      onChange={(e) =>
                        setValues((prev) => ({
                          ...prev,
                          [field.fieldKey]: e.target.value,
                        }))
                      }
                    />
                  )}
                </label>
              ))}
            <label className="mc-field">
              <span>目标时长（分钟）</span>
              <input
                type="number"
                min={1}
                max={1440}
                value={duration}
                onChange={(e) => setDuration(e.target.value)}
              />
            </label>
          </div>

          <div className="mc-seat-editor">
            <div className="mc-seat-editor-head">
              <div>
                <h2>岗位席位</h2>
                <p>按模板预置岗位，可调整每岗需要人数</p>
              </div>
            </div>
            <div className="mc-role-editor-rows">
              {template.positions.map((position) => (
                <div className="mc-role-editor-row" key={position.id}>
                  <span className="mc-field">
                    <b>{position.label}</b>
                  </span>
                  <label className="mc-field mc-field-narrow">
                    <span>需要人数</span>
                    <input
                      type="number"
                      min={1}
                      max={10}
                      value={counts[position.id] ?? position.defaultCount}
                      onChange={(e) =>
                        setCounts((prev) => ({
                          ...prev,
                          [position.id]: Math.max(
                            1,
                            Number(e.target.value) || 1,
                          ),
                        }))
                      }
                    />
                  </label>
                </div>
              ))}
            </div>
          </div>

          <div className="mc-button-row mc-form-actions">
            <button
              type="button"
              className="mc-btn mc-btn-primary"
              disabled={
                create.isPending || !customerId || Number(duration) <= 0
              }
              onClick={() => create.mutate()}
            >
              <Save size={15} />
              {create.isPending ? "创建中…" : "创建派单草稿"}
            </button>
          </div>
        </section>
      ) : (
        <div className="mc-empty">
          <Plus size={22} aria-hidden="true" />
          <p>选择模板后，可配置下单字段与岗位。</p>
        </div>
      )}
    </div>
  );
}
