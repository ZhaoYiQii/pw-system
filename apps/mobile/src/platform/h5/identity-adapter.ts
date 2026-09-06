import type { IdentityAdapter, IdentitySession } from "../contracts/identity";
import { session } from "./session-store";

function apiBase(): string {
  const configured =
    typeof process !== "undefined" ? process.env?.TARO_APP_API_BASE : undefined;
  if (configured) return configured;
  if (typeof location !== "undefined") return location.origin;
  return "";
}

/** H5 账号登录适配（HttpOnly refresh cookie + CSRF 双提交，主规格 16.1）。 */
export const identityAdapter: IdentityAdapter = {
  async login(input) {
    const base = apiBase();
    if (!base) throw new Error("TARO_APP_API_BASE not configured");
    const res = await fetch(`${base}/api/v1/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      credentials: "include",
      body: JSON.stringify(input),
    });
    const body = (await res.json()) as { data?: IdentitySession };
    if (!res.ok || !body.data) throw new Error(`login failed: ${res.status}`);
    if (body.data.csrfToken) session.setCsrf(body.data.csrfToken);
    return body.data;
  },
  async refresh(_refreshToken, scope) {
    const base = apiBase();
    if (!base) throw new Error("TARO_APP_API_BASE not configured");
    const res = await fetch(`${base}/api/v1/auth/refresh`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(session.getCsrf()
          ? { "x-csrf-token": session.getCsrf() as string }
          : {}),
      },
      credentials: "include",
      body: JSON.stringify({ scope }),
    });
    const body = (await res.json()) as { data?: IdentitySession };
    if (!res.ok || !body.data) throw new Error(`refresh failed: ${res.status}`);
    if (body.data.csrfToken) session.setCsrf(body.data.csrfToken);
    return body.data;
  },
  async logout() {
    const base = apiBase();
    if (base) {
      await fetch(`${base}/api/v1/auth/logout`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(session.getCsrf()
            ? { "x-csrf-token": session.getCsrf() as string }
            : {}),
        },
        credentials: "include",
      });
    }
    session.clearToken();
    session.setCsrf("");
  },
};
