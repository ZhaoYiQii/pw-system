"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { apiFetch, setAccessToken } from "../../_lib/api";

interface LoginResult {
  accessToken: string;
  principal?: { role?: string; username?: string };
}

export default function PlatformLoginPage() {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    setMessage(null);
    try {
      const data = await apiFetch<LoginResult>("/api/v1/auth/login", {
        method: "POST",
        body: JSON.stringify({ kind: "platform", username, password })
      });
      setAccessToken(data.accessToken);
      router.push("/tenants");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="page" style={{ maxWidth: 460 }}>
      <h1 className="page-title">平台登录</h1>
      <p className="page-desc">SaaS 运营后台（平台管理员/运营）</p>
      <div className="card">
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <div className="field">
            <label htmlFor="username">账号</label>
            <input
              id="username"
              className="input"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="username"
              required
            />
          </div>
          <div className="field">
            <label htmlFor="password">密码</label>
            <input
              id="password"
              className="input"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              required
            />
          </div>
          {message ? <p className="banner banner-error">{message}</p> : null}
          <button className="btn btn-primary" type="submit" disabled={busy}>
            {busy ? "登录中…" : "登录"}
          </button>
        </form>
      </div>
      <p className="muted">
        <Link href="/">← 返回首页</Link>
      </p>
    </main>
  );
}

