"use client";

import {
  QueryClient,
  QueryClientProvider,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { ArrowRight, Calculator, Percent, Search } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { ApiError, apiFetch } from "../../_lib/api";
import { PlatformShell } from "../../_lib/platform-shell";

interface Tenant {
  id: string;
  code: string;
  name: string;
  status: string;
}
interface FinanceRule {
  platformFeeBp: number;
  storeCutBp: number;
}

function pct(bp: number): string {
  return `${(bp / 100).toFixed(2)}%`;
}
function splitAmount(amount: number, bp: number): string {
  return new Intl.NumberFormat("zh-CN", {
    style: "currency",
    currency: "CNY",
    minimumFractionDigits: 2,
  }).format((amount * bp) / 10000);
}

function Inner() {
  const queryClient = useQueryClient();
  const [tenantId, setTenantId] = useState("");
  const [keyword, setKeyword] = useState("");
  const [draftBp, setDraftBp] = useState(300);
  const [previewAmount, setPreviewAmount] = useState(1000);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const tenantsQuery = useQuery({
    queryKey: ["platform-billing-tenants"],
    queryFn: () => apiFetch<Tenant[]>("/api/v1/platform/tenants"),
  });
  const tenants = tenantsQuery.data ?? [];
  const filteredTenants = useMemo(
    () =>
      tenants.filter((tenant) =>
        `${tenant.name} ${tenant.code}`
          .toLowerCase()
          .includes(keyword.trim().toLowerCase()),
      ),
    [keyword, tenants],
  );
  useEffect(() => {
    if (!tenantId && tenants[0]) setTenantId(tenants[0].id);
  }, [tenantId, tenants]);

  const ruleQuery = useQuery({
    queryKey: ["platform-finance-rule", tenantId],
    queryFn: () =>
      apiFetch<FinanceRule>(
        `/api/v1/platform/tenants/${tenantId}/finance-rules`,
      ),
    enabled: Boolean(tenantId),
  });
  useEffect(() => {
    if (ruleQuery.data) setDraftBp(ruleQuery.data.platformFeeBp);
  }, [ruleQuery.data]);

  const save = useMutation({
    mutationFn: () =>
      apiFetch<FinanceRule>(
        `/api/v1/platform/tenants/${tenantId}/finance-rules`,
        { method: "PATCH", body: JSON.stringify({ platformFeeBp: draftBp }) },
      ),
    onSuccess: (rule) => {
      setNotice(
        `平台费率已更新为 ${pct(rule.platformFeeBp)}，本次变更已写入审计。`,
      );
      setError(null);
      void queryClient.invalidateQueries({
        queryKey: ["platform-finance-rule", tenantId],
      });
    },
    onError: (reason) => {
      setNotice(null);
      setError(reason instanceof Error ? reason.message : String(reason));
    },
  });

  const selectedTenant = tenants.find((tenant) => tenant.id === tenantId);
  const storeCutBp = ruleQuery.data?.storeCutBp ?? 2000;
  const playerBp = Math.max(0, 10000 - draftBp - storeCutBp);
  const valid =
    Number.isInteger(draftBp) && draftBp >= 0 && draftBp + storeCutBp <= 10000;
  const is401 =
    tenantsQuery.error instanceof ApiError && tenantsQuery.error.status === 401;

  return (
    <PlatformShell>
      {is401 ? (
        <div className="pw-panel pw-auth-card">
          <div className="pw-panel-body">
            <h2>尚未登录平台账号</h2>
            <p>登录后管理平台费率。</p>
            <Link className="pw-btn pw-primary" href="/login">
              去登录
            </Link>
          </div>
        </div>
      ) : (
        <>
          <div className="pw-page-head">
            <div>
              <div className="pw-eyebrow">Platform / Billing Rules</div>
              <h1>平台费率</h1>
              <p>按门店维护平台服务费率，并即时预览分账结果。</p>
            </div>
            <span className="pw-head-chip">
              <Percent size={14} /> 变更自动留痕
            </span>
          </div>
          {notice ? (
            <div className="pw-notice pw-notice-success" aria-live="polite">
              {notice}
            </div>
          ) : null}
          {error ? (
            <div className="pw-notice pw-notice-error" aria-live="polite">
              {error}
            </div>
          ) : null}
          {tenantsQuery.isError && !is401 ? (
            <div className="pw-notice">
              门店数据暂不可用，当前仍可查看分账试算界面。
            </div>
          ) : null}

          <div className="pw-grid-billing">
            <div className="pw-panel pw-tenant-picker">
              <div className="pw-panel-head">
                <h2>选择门店</h2>
                <p>{filteredTenants.length} 家</p>
              </div>
              <div className="pw-panel-body">
                <label className="pw-search">
                  <Search size={15} aria-hidden />
                  <input
                    name="billing-tenant-search"
                    autoComplete="off"
                    value={keyword}
                    onChange={(event) => setKeyword(event.target.value)}
                    placeholder="搜索门店或 Code…"
                  />
                </label>
              </div>
              <div className="pw-tenant-list">
                {filteredTenants.map((tenant) => (
                  <button
                    type="button"
                    key={tenant.id}
                    className={
                      tenant.id === tenantId ? "pw-selected" : undefined
                    }
                    onClick={() => {
                      setTenantId(tenant.id);
                      setNotice(null);
                      setError(null);
                    }}
                  >
                    <span>
                      <b>{tenant.name}</b>
                      <small className="pw-mono">{tenant.code}</small>
                    </span>
                    <span
                      className={`pw-status ${tenant.status === "ACTIVE" ? "pw-ok" : "pw-off"}`}
                    >
                      {tenant.status === "ACTIVE" ? "营业中" : "已停用"}
                    </span>
                  </button>
                ))}
              </div>
            </div>

            <div>
              <div className="pw-panel">
                <div className="pw-panel-head">
                  <div>
                    <h2>费率设置</h2>
                    <span className="pw-panel-kicker">
                      {selectedTenant?.name ?? "请选择门店"}
                    </span>
                  </div>
                  <p>单位：bp，100 bp = 1%</p>
                </div>
                <div className="pw-panel-body">
                  {!tenantId ? (
                    <div className="pw-empty">请先从左侧选择一家门店。</div>
                  ) : ruleQuery.isPending ? (
                    <div className="pw-empty">读取费率中…</div>
                  ) : (
                    <div className="pw-rate-form">
                      <div className="pw-field">
                        <label htmlFor="platform-fee">平台服务费率</label>
                        <div className="pw-input-suffix">
                          <input
                            id="platform-fee"
                            name="platform-fee"
                            autoComplete="off"
                            type="number"
                            min={0}
                            max={Math.max(0, 10000 - storeCutBp)}
                            step={10}
                            value={draftBp}
                            onChange={(event) =>
                              setDraftBp(Number(event.target.value))
                            }
                          />
                          <span>bp</span>
                        </div>
                        <small>当前 {pct(draftBp)}，由平台管理员维护</small>
                      </div>
                      <div className="pw-rate-readonly">
                        <span>门店抽成</span>
                        <b>{pct(storeCutBp)}</b>
                        <small>{storeCutBp} bp · 门店侧维护</small>
                      </div>
                      <div className="pw-rate-readonly pw-rate-player">
                        <span>陪玩师所得</span>
                        <b>{pct(playerBp)}</b>
                        <small>按剩余比例自动计算</small>
                      </div>
                    </div>
                  )}
                  {!valid ? (
                    <div className="pw-inline-error">
                      平台费率与门店抽成之和不能超过 100%。
                    </div>
                  ) : null}
                  <div className="pw-actions-row">
                    <button
                      type="button"
                      className="pw-btn"
                      disabled={!ruleQuery.data || save.isPending}
                      onClick={() =>
                        setDraftBp(ruleQuery.data?.platformFeeBp ?? 300)
                      }
                    >
                      恢复当前值
                    </button>
                    <button
                      type="button"
                      className="pw-btn pw-primary"
                      disabled={
                        !tenantId ||
                        !valid ||
                        save.isPending ||
                        draftBp === ruleQuery.data?.platformFeeBp
                      }
                      onClick={() => save.mutate()}
                    >
                      {save.isPending ? "保存中…" : "保存费率"}
                    </button>
                  </div>
                </div>
              </div>

              <div className="pw-panel">
                <div className="pw-panel-head">
                  <h2>
                    <Calculator size={16} aria-hidden /> 分账试算
                  </h2>
                  <p>仅用于前端预览</p>
                </div>
                <div className="pw-panel-body">
                  <div className="pw-preview-top">
                    <div className="pw-field">
                      <label htmlFor="preview-amount">订单实付金额</label>
                      <div className="pw-input-suffix">
                        <input
                          id="preview-amount"
                          name="preview-amount"
                          autoComplete="off"
                          type="number"
                          min={0}
                          step={100}
                          value={previewAmount}
                          onChange={(event) =>
                            setPreviewAmount(
                              Math.max(0, Number(event.target.value)),
                            )
                          }
                        />
                        <span>元</span>
                      </div>
                    </div>
                    <ArrowRight size={20} aria-hidden />
                  </div>
                  <div className="pw-split-grid">
                    <div>
                      <span>平台服务费</span>
                      <b>{splitAmount(previewAmount, draftBp)}</b>
                      <small>{pct(draftBp)}</small>
                    </div>
                    <div>
                      <span>门店收入</span>
                      <b>{splitAmount(previewAmount, storeCutBp)}</b>
                      <small>{pct(storeCutBp)}</small>
                    </div>
                    <div className="pw-split-main">
                      <span>陪玩师所得</span>
                      <b>{splitAmount(previewAmount, playerBp)}</b>
                      <small>{pct(playerBp)}</small>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </>
      )}
    </PlatformShell>
  );
}

export default function PlatformBillingRulesPage() {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: { staleTime: 30_000, retry: 1, refetchOnWindowFocus: false },
        },
      }),
  );
  return (
    <QueryClientProvider client={queryClient}>
      <Inner />
    </QueryClientProvider>
  );
}
