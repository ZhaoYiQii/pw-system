import type { IdentityAdapter, IdentitySession } from "../contracts/identity";
import { session } from "./session-store";
import { apiBase } from "./api-base";

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
  async switchContext(context, accessToken) {
    const base = apiBase();
    if (!base) throw new Error("TARO_APP_API_BASE not configured");
    const res = await fetch(`${base}/api/v1/auth/switch-context`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${accessToken}`,
        ...(session.getCsrf()
          ? { "x-csrf-token": session.getCsrf() as string }
          : {}),
      },
      credentials: "include",
      body: JSON.stringify({ context }),
    });
    const body = (await res.json().catch(() => null)) as {
      data?: IdentitySession;
      message?: string;
    } | null;
    if (!res.ok || !body?.data) {
      // 调用方（features/player-context）按 status 区分「陪玩申请未通过」与「会话失效」，必须带上。
      const error = new Error(
        body?.message ?? `switch-context failed: ${res.status}`,
      ) as Error & { status?: number };
      error.status = res.status;
      throw error;
    }
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
