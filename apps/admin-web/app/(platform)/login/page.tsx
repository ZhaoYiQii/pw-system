"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { apiFetch, setAccessToken, setCsrfToken } from "../../_lib/api";

interface LoginResult {
  accessToken: string;
  csrfToken?: string;
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
        credentials: "include",
        body: JSON.stringify({ kind: "platform", username, password }),
      });
      setAccessToken(data.accessToken);
      if (data.csrfToken) setCsrfToken(data.csrfToken);
      router.replace("/overview");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="pw-platform">
      <div className="pw-login-wrap">
        <div className="pw-login-card">
          <div
            className="pw-brand"
            style={{ padding: 0, color: "var(--pw-ink)" }}
          >
            <span className="pw-mark" style={{ color: "#fff" }}>
              PL
            </span>
            <span>
              <b style={{ color: "var(--pw-ink)" }}>陪玩门店 SaaS</b>
              <small style={{ color: "var(--pw-muted)" }}>
                PLATFORM CONSOLE
              </small>
            </span>
          </div>
          <h1>平台管理员登录</h1>
          <p>SaaS 运营后台 · 超级管理员 / 平台运营</p>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void submit();
            }}
          >
            <div className="pw-field">
              <label htmlFor="username">账号</label>
              <input
                id="username"
                value={username}
                onChange={(event) => setUsername(event.target.value)}
                autoComplete="username"
                autoFocus
                required
              />
            </div>
            <div className="pw-field" style={{ marginTop: 10 }}>
              <label htmlFor="password">密码</label>
              <input
                id="password"
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                autoComplete="current-password"
                required
              />
            </div>
            {message ? (
              <div
                className="pw-notice"
                style={{
                  background: "var(--pw-red-soft)",
                  color: "var(--pw-red)",
                  margin: "12px 0 0",
                }}
              >
                {message}
              </div>
            ) : (
              <div
                className="pw-notice"
                style={{
                  background: "var(--pw-green-soft)",
                  color: "var(--pw-green)",
                  margin: "12px 0 0",
                }}
              >
                登录后进入平台运营控制台。
              </div>
            )}
            <button
              type="submit"
              className="pw-btn pw-primary"
              disabled={busy}
              style={{ width: "100%", marginTop: 14 }}
            >
              {busy ? "登录中…" : "登录"}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
