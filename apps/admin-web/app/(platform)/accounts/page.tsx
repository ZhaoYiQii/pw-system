"use client";

import {
  QueryClient,
  QueryClientProvider,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import Link from "next/link";
import { Clock3, KeyRound, ShieldCheck } from "lucide-react";
import { useState } from "react";
import { ApiError, apiFetch } from "../../_lib/api";
import { PlatformShell } from "../../_lib/platform-shell";

interface AccountRow {
  id: string;
  username: string;
  role: string;
  status: "ACTIVE" | "DISABLED";
  createdAt: string;
  updatedAt: string;
}

interface Principal {
  sub: string;
  role: string;
  username: string;
}

interface TenantRow {
  id: string;
  code: string;
  name: string;
}

interface AccessGrant {
  id: string;
  grantorUsername: string | null;
  granteeUsername: string;
  tenantId: string;
  tenantCode: string | null;
  tenantName: string;
  reason: string;
  scope: string;
  status: "ACTIVE" | "REVOKED";
  expiresAt: string;
  revokedAt: string | null;
  createdAt: string;
}

const DURATION_OPTIONS: { minutes: number; label: string }[] = [
  { minutes: 30, label: "30 分钟" },
  { minutes: 120, label: "2 小时" },
  { minutes: 480, label: "8 小时" },
  { minutes: 1440, label: "24 小时" },
];

const ROLE_LABELS: Record<string, string> = {
  PLATFORM_SUPER_ADMIN: "超级管理员",
  PLATFORM_SUPPORT: "平台运营",
};

function formatDate(iso: string): string {
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(iso));
}

function Inner() {
  const queryClient = useQueryClient();
  const [notice, setNotice] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState("PLATFORM_SUPPORT");
  const [grantAccountId, setGrantAccountId] = useState("");
  const [grantTenantId, setGrantTenantId] = useState("");
  const [grantReason, setGrantReason] = useState("");
  const [grantDurationMinutes, setGrantDurationMinutes] = useState(120);

  const accountsQuery = useQuery({
    queryKey: ["platform-accounts"],
    queryFn: () => apiFetch<AccountRow[]>("/api/v1/platform/accounts"),
  });
  const grantsQuery = useQuery({
    queryKey: ["platform-grants"],
    queryFn: () => apiFetch<AccessGrant[]>("/api/v1/platform/grants"),
  });
  const meQuery = useQuery({
    queryKey: ["platform-account-me"],
    queryFn: () => apiFetch<Principal>("/api/v1/platform/me"),
  });
  const tenantsQuery = useQuery({
    queryKey: ["platform-account-grant-tenants"],
    queryFn: () => apiFetch<TenantRow[]>("/api/v1/platform/tenants"),
  });

  const accounts = accountsQuery.data ?? [];
  const is401 =
    accountsQuery.error instanceof ApiError &&
    accountsQuery.error.status === 401;

  const create = useMutation({
    mutationFn: () =>
      apiFetch<AccountRow>("/api/v1/platform/accounts", {
        method: "POST",
        body: JSON.stringify({
          username: username.trim(),
          password,
          role,
        }),
      }),
    onSuccess: (account) => {
      setNotice(`已创建平台账号 ${account.username}。`);
      setFormError(null);
      setUsername("");
      setPassword("");
      void queryClient.invalidateQueries({ queryKey: ["platform-accounts"] });
    },
    onError: (error) =>
      setFormError(error instanceof Error ? error.message : String(error)),
  });

  const setStatus = useMutation({
    mutationFn: ({
      id,
      status,
    }: {
      id: string;
      status: "ACTIVE" | "DISABLED";
    }) =>
      apiFetch<AccountRow>(`/api/v1/platform/accounts/${id}/status`, {
        method: "PATCH",
        body: JSON.stringify({ status }),
      }),
    onSuccess: (account) => {
      setNotice(
        `已${account.status === "ACTIVE" ? "启用" : "停用"} ${account.username}。`,
      );
      setFormError(null);
      void queryClient.invalidateQueries({ queryKey: ["platform-accounts"] });
    },
    onError: (error) =>
      setFormError(error instanceof Error ? error.message : String(error)),
  });

  const changeRoleMutation = useMutation({
    mutationFn: ({ id, nextRole }: { id: string; nextRole: string }) =>
      apiFetch<AccountRow>(`/api/v1/platform/accounts/${id}/role`, {
        method: "PATCH",
        body: JSON.stringify({ role: nextRole }),
      }),
    onSuccess: (account) => {
      setNotice(
        `${account.username} 角色已更新为 ${ROLE_LABELS[account.role] ?? account.role}。`,
      );
      setFormError(null);
      void queryClient.invalidateQueries({ queryKey: ["platform-accounts"] });
    },
    onError: (error) =>
      setFormError(error instanceof Error ? error.message : String(error)),
  });

  const createGrant = useMutation({
    mutationFn: () =>
      apiFetch<AccessGrant>("/api/v1/platform/grants", {
        method: "POST",
        body: JSON.stringify({
          granteeAccountId: grantAccountId,
          tenantId: grantTenantId,
          reason: grantReason.trim(),
          durationMinutes: grantDurationMinutes,
        }),
      }),
    onSuccess: (grant) => {
      setNotice(
        `已创建 ${grant.granteeUsername} → ${grant.tenantName} 的临时只读授权。`,
      );
      setFormError(null);
      setGrantAccountId("");
      setGrantTenantId("");
      setGrantReason("");
      setGrantDurationMinutes(120);
      void queryClient.invalidateQueries({ queryKey: ["platform-grants"] });
    },
    onError: (error) =>
      setFormError(error instanceof Error ? error.message : String(error)),
  });

  const revokeGrant = useMutation({
    mutationFn: (grantId: string) =>
      apiFetch<AccessGrant>(`/api/v1/platform/grants/${grantId}/revoke`, {
        method: "POST",
      }),
    onSuccess: (grant) => {
      setNotice(`已撤销 ${grant.granteeUsername} 的临时授权。`);
      setFormError(null);
      void queryClient.invalidateQueries({ queryKey: ["platform-grants"] });
    },
    onError: (error) =>
      setFormError(error instanceof Error ? error.message : String(error)),
  });

  const meId = meQuery.data?.sub;
  const grants = grantsQuery.data ?? [];
  const busy =
    create.isPending ||
    setStatus.isPending ||
    changeRoleMutation.isPending ||
    createGrant.isPending ||
    revokeGrant.isPending;

  return (
    <PlatformShell>
      {is401 ? (
        <div
          className="pw-panel"
          style={{ maxWidth: 520, margin: "60px auto" }}
        >
          <div className="pw-panel-body">
            <h2 style={{ margin: "0 0 8px" }}>尚未登录平台账号</h2>
            <Link
              className="pw-btn pw-primary"
              href="/login"
              style={{ marginTop: 12 }}
            >
              去登录
            </Link>
          </div>
        </div>
      ) : (
        <>
          <div className="pw-page-head">
            <div>
              <div className="pw-eyebrow">Platform / Accounts</div>
              <h1>平台账号</h1>
              <p>平台管理员、运营账号及跨租户临时访问权限管理。</p>
            </div>
          </div>

          {notice ? (
            <div
              className="pw-notice"
              aria-live="polite"
              style={{
                background: "var(--pw-green-soft)",
                color: "var(--pw-green)",
              }}
            >
              {notice}
            </div>
          ) : null}
          {formError ? (
            <div
              className="pw-notice"
              aria-live="polite"
              style={{
                background: "var(--pw-red-soft)",
                color: "var(--pw-red)",
              }}
            >
              {formError}
            </div>
          ) : null}

          <div className="pw-panel">
            <div className="pw-panel-head">
              <h2>添加平台账号</h2>
              <p>初始密码仅本次展示，系统不留存明文</p>
            </div>
            <div className="pw-panel-body">
              <div className="pw-form">
                <div className="pw-field">
                  <label htmlFor="account-username">账号</label>
                  <input
                    id="account-username"
                    value={username}
                    onChange={(event) => setUsername(event.target.value)}
                    placeholder="3-32 位小写字母/数字开头"
                    autoComplete="off"
                    required
                  />
                </div>
                <div className="pw-field">
                  <label htmlFor="account-password">初始密码</label>
                  <input
                    id="account-password"
                    type="password"
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    placeholder="至少 8 位"
                    autoComplete="new-password"
                    required
                  />
                </div>
                <div className="pw-field">
                  <label htmlFor="account-role">角色</label>
                  <select
                    id="account-role"
                    value={role}
                    onChange={(event) => setRole(event.target.value)}
                  >
                    <option value="PLATFORM_SUPER_ADMIN">超级管理员</option>
                    <option value="PLATFORM_SUPPORT">平台运营</option>
                  </select>
                </div>
              </div>
              <button
                type="button"
                className="pw-btn pw-primary"
                style={{ marginTop: 12 }}
                disabled={
                  busy || username.trim().length < 3 || password.length < 8
                }
                onClick={() => create.mutate()}
              >
                {create.isPending ? "创建中…" : "＋ 创建账号"}
              </button>
            </div>
          </div>

          <div className="pw-panel">
            <div className="pw-panel-head">
              <h2>账号列表</h2>
              <p>{accounts.length} 个账号</p>
            </div>
            <div className="pw-panel-body" style={{ padding: 0 }}>
              {accountsQuery.isPending ? (
                <div className="pw-empty">加载账号…</div>
              ) : null}
              {accounts.length > 0 ? (
                <table>
                  <thead>
                    <tr>
                      <th>账号</th>
                      <th>角色</th>
                      <th>状态</th>
                      <th>创建时间</th>
                      <th>操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {accounts.map((account) => {
                      const self = account.id === meId;
                      return (
                        <tr key={account.id}>
                          <td>
                            <b>{account.username}</b>
                            {self ? (
                              <span
                                className="pw-pending"
                                style={{ marginLeft: 8 }}
                              >
                                当前账号
                              </span>
                            ) : null}
                          </td>
                          <td>
                            <select
                              value={account.role}
                              disabled={self || busy}
                              onChange={(event) =>
                                changeRoleMutation.mutate({
                                  id: account.id,
                                  nextRole: event.target.value,
                                })
                              }
                              aria-label={`${account.username}角色`}
                              style={{
                                height: 30,
                                border: "1px solid var(--pw-line)",
                                borderRadius: 8,
                                background: "#faf8f2",
                                padding: "0 6px",
                                fontSize: 12,
                              }}
                            >
                              <option value="PLATFORM_SUPER_ADMIN">
                                超级管理员
                              </option>
                              <option value="PLATFORM_SUPPORT">平台运营</option>
                            </select>
                          </td>
                          <td>
                            <span
                              className={`pw-status ${
                                account.status === "ACTIVE" ? "pw-ok" : "pw-off"
                              }`}
                            >
                              {account.status === "ACTIVE" ? "启用" : "停用"}
                            </span>
                          </td>
                          <td className="pw-mono">
                            {formatDate(account.createdAt)}
                          </td>
                          <td>
                            {self ? (
                              <span
                                style={{
                                  color: "var(--pw-muted)",
                                  fontSize: 11,
                                }}
                              >
                                不可操作
                              </span>
                            ) : (
                              <button
                                type="button"
                                className={`pw-btn pw-small ${
                                  account.status === "ACTIVE" ? "pw-danger" : ""
                                }`}
                                disabled={busy}
                                onClick={() =>
                                  setStatus.mutate({
                                    id: account.id,
                                    status:
                                      account.status === "ACTIVE"
                                        ? "DISABLED"
                                        : "ACTIVE",
                                  })
                                }
                              >
                                {account.status === "ACTIVE" ? "停用" : "启用"}
                              </button>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              ) : null}
            </div>
          </div>

          <div className="pw-panel">
            <div className="pw-panel-head">
              <div>
                <h2>
                  <KeyRound size={16} /> 跨租户临时授权
                </h2>
                <span className="pw-panel-kicker">
                  仅向平台运营开放指定门店的限时只读访问
                </span>
              </div>
            </div>
            <div className="pw-panel-body">
              <div className="pw-grant-layout">
                <div className="pw-grant-form">
                  <div className="pw-form">
                    <div className="pw-field">
                      <label htmlFor="grant-account">授权账号</label>
                      <select
                        id="grant-account"
                        name="grant-account"
                        value={grantAccountId}
                        onChange={(event) =>
                          setGrantAccountId(event.target.value)
                        }
                      >
                        <option value="">选择平台运营账号</option>
                        {accounts
                          .filter(
                            (account) =>
                              account.role === "PLATFORM_SUPPORT" &&
                              account.status === "ACTIVE",
                          )
                          .map((account) => (
                            <option key={account.id} value={account.id}>
                              {account.username}
                            </option>
                          ))}
                      </select>
                    </div>
                    <div className="pw-field">
                      <label htmlFor="grant-tenant">目标门店</label>
                      <select
                        id="grant-tenant"
                        name="grant-tenant"
                        value={grantTenantId}
                        onChange={(event) =>
                          setGrantTenantId(event.target.value)
                        }
                      >
                        <option value="">选择一家门店</option>
                        {(tenantsQuery.data ?? []).map((tenant) => (
                          <option key={tenant.id} value={tenant.id}>
                            {tenant.name}（{tenant.code}）
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="pw-field">
                      <label htmlFor="grant-duration">有效时长</label>
                      <select
                        id="grant-duration"
                        name="grant-duration"
                        value={grantDurationMinutes}
                        onChange={(event) =>
                          setGrantDurationMinutes(Number(event.target.value))
                        }
                      >
                        {DURATION_OPTIONS.map((option) => (
                          <option key={option.minutes} value={option.minutes}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="pw-field pw-full">
                      <label htmlFor="grant-reason">授权原因（必填）</label>
                      <textarea
                        id="grant-reason"
                        name="grant-reason"
                        autoComplete="off"
                        value={grantReason}
                        onChange={(event) => setGrantReason(event.target.value)}
                        placeholder="例如：协助门店排查订单结算异常…"
                      />
                    </div>
                  </div>
                  <div className="pw-notice">
                    <ShieldCheck size={14} />{" "}
                    默认不包含订单截图与财务明细权限；授权与撤销都会写入平台审计。
                  </div>
                  <button
                    type="button"
                    className="pw-btn pw-primary"
                    disabled={
                      busy ||
                      !grantAccountId ||
                      !grantTenantId ||
                      grantReason.trim().length < 4
                    }
                    onClick={() => createGrant.mutate()}
                  >
                    {createGrant.isPending ? "创建中…" : "创建临时授权"}
                  </button>
                </div>
                <div className="pw-grant-list">
                  <div className="pw-grant-list-head">
                    <b>当前授权</b>
                    <span>
                      {
                        grants.filter((grant) => grant.status === "ACTIVE")
                          .length
                      }{" "}
                      条生效中
                    </span>
                  </div>
                  {grants.length === 0 ? (
                    <div className="pw-empty pw-empty-compact">
                      <Clock3 size={20} />
                      <span>暂无临时授权</span>
                      <small>创建后将在此处展示有效期与撤销入口</small>
                    </div>
                  ) : (
                    grants.map((grant) => (
                      <article key={grant.id} className="pw-grant-item">
                        <div>
                          <b>{grant.granteeUsername}</b>
                          <span>可访问 {grant.tenantName}</span>
                        </div>
                        <span
                          className={`pw-status ${grant.status === "ACTIVE" ? "pw-ok" : "pw-off"}`}
                        >
                          {grant.status === "ACTIVE"
                            ? `${new Date(grant.expiresAt).toLocaleString(
                                "zh-CN",
                                {
                                  month: "2-digit",
                                  day: "2-digit",
                                  hour: "2-digit",
                                  minute: "2-digit",
                                },
                              )} 前有效`
                            : "已撤销"}
                        </span>
                        <p>{grant.reason}</p>
                        {grant.status === "ACTIVE" ? (
                          <button
                            type="button"
                            className="pw-btn pw-small pw-danger"
                            disabled={revokeGrant.isPending}
                            onClick={() => revokeGrant.mutate(grant.id)}
                          >
                            {revokeGrant.isPending ? "撤销中…" : "撤销"}
                          </button>
                        ) : null}
                      </article>
                    ))
                  )}
                </div>
              </div>
            </div>
          </div>
        </>
      )}
    </PlatformShell>
  );
}

export default function PlatformAccountsPage() {
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
