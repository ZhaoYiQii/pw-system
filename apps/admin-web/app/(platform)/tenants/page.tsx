"use client";

import { useCallback, useEffect, useState } from "react";

type TenantStatus = "ACTIVE" | "INACTIVE" | "CONFIG_ERROR";

interface Tenant {
  id: string;
  code: string;
  name: string;
  status: TenantStatus;
  timezone: string;
  createdAt: string;
}

type LoadState =
  | { phase: "loading" }
  | { phase: "error"; message: string }
  | { phase: "unauthenticated" }
  | { phase: "ready"; tenants: Tenant[] };

const apiOrigin =
  process.env.NEXT_PUBLIC_API_ORIGIN ?? "http://127.0.0.1:3000";

async function fetchTenants(): Promise<Tenant[]> {
  const res = await fetch(`${apiOrigin}/api/v1/platform/tenants`, {
    headers: { "content-type": "application/json" }
  });
  if (res.status === 401 || res.status === 403) {
    throw new AuthError();
  }
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const body = (await res.json()) as { data: Tenant[] };
  return body.data;
}

class AuthError extends Error {}

export default function PlatformTenantsPage() {
  const [state, setState] = useState<LoadState>({ phase: "loading" });
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [host, setHost] = useState("");
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setState({ phase: "loading" });
    try {
      const tenants = await fetchTenants();
      setState({ phase: "ready", tenants });
    } catch (error) {
      if (error instanceof AuthError) setState({ phase: "unauthenticated" });
      else setState({ phase: "error", message: String(error) });
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const createTenant = async () => {
    setBusy(true);
    setFormError(null);
    try {
      const res = await fetch(`${apiOrigin}/api/v1/platform/tenants`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          code,
          name,
          ...(host.trim() !== "" ? { primaryHost: host.trim() } : {})
        })
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(`HTTP ${res.status}: ${text}`);
      }
      setCode("");
      setName("");
      setHost("");
      await reload();
    } catch (error) {
      setFormError(String(error));
    } finally {
      setBusy(false);
    }
  };

  const deactivateTenant = async (id: string) => {
    setBusy(true);
    setFormError(null);
    try {
      const res = await fetch(`${apiOrigin}/api/v1/platform/tenants/${id}/deactivate`, {
        method: "POST",
        headers: { "content-type": "application/json" }
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      await reload();
    } catch (error) {
      setFormError(String(error));
    } finally {
      setBusy(false);
    }
  };

  if (state.phase === "loading") return <p>加载中…</p>;
  if (state.phase === "error") return <p>加载失败：{state.message}（请确认 API 已启动）</p>;
  if (state.phase === "unauthenticated") return <p>未认证（认证将在 Slice 2 接入）。</p>;

  return (
    <main style={{ maxWidth: 960, margin: "0 auto", padding: 24 }}>
      <h1>平台租户</h1>
      {formError ? <p role="alert">{formError}</p> : null}
      <section>
        <h2>新建租户</h2>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void createTenant();
          }}
        >
          <label>
            code <input value={code} onChange={(e) => setCode(e.target.value)} required />
          </label>
          <label>
            name <input value={name} onChange={(e) => setName(e.target.value)} required />
          </label>
          <label>
            主域名(可选) <input value={host} onChange={(e) => setHost(e.target.value)} />
          </label>
          <button type="submit" disabled={busy}>
            {busy ? "处理中…" : "创建"}
          </button>
        </form>
      </section>
      <section>
        <h2>租户列表（{state.tenants.length}）</h2>
        {state.tenants.length === 0 ? (
          <p>暂无租户</p>
        ) : (
          <table border={1} cellPadding={6}>
            <thead>
              <tr>
                <th>code</th>
                <th>name</th>
                <th>status</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {state.tenants.map((tenant) => (
                <tr key={tenant.id}>
                  <td>{tenant.code}</td>
                  <td>{tenant.name}</td>
                  <td>{tenant.status}</td>
                  <td>
                    {tenant.status === "ACTIVE" ? (
                      <button
                        disabled={busy}
                        onClick={() => void deactivateTenant(tenant.id)}
                      >
                        停用
                      </button>
                    ) : (
                      <span>{tenant.status === "INACTIVE" ? "已停用" : "配置错误"}</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </main>
  );
}
