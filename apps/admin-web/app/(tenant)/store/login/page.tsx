"use client";

import { useState } from "react";

const apiOrigin = process.env.NEXT_PUBLIC_API_ORIGIN ?? "http://127.0.0.1:3000";

export default function TenantLoginPage() {
  const [tenantCode, setTenantCode] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch(`${apiOrigin}/api/v1/auth/login`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ kind: "tenant", tenantCode, username, password })
      });
      const body = (await res.json()) as {
        data?: { accessToken?: string; principal?: { role?: string } };
      };
      if (!res.ok || !body.data?.accessToken) {
        throw new Error("登录失败：" + res.status);
      }
      sessionStorage.setItem("pw_access_token", body.data.accessToken);
      setMessage("登录成功：" + (body.data.principal?.role ?? ""));
    } catch (error) {
      setMessage(String(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <main style={{ maxWidth: 420, margin: "0 auto", padding: 24 }}>
      <h1>门店登录</h1>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <label>
          门店 code <input value={tenantCode} onChange={(e) => setTenantCode(e.target.value)} required />
        </label>
        <label>
          账号 <input value={username} onChange={(e) => setUsername(e.target.value)} required />
        </label>
        <label>
          密码{" "}
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </label>
        <button type="submit" disabled={busy}>
          {busy ? "登录中…" : "登录"}
        </button>
      </form>
      {message ? <p role="status">{message}</p> : null}
    </main>
  );
}
