import type { ApiAdapter, ApiInit } from "../contracts/api-transport";

function apiBase(): string {
  const configured =
    typeof process !== "undefined" ? process.env?.TARO_APP_API_BASE : undefined;
  if (configured) return configured;
  if (typeof location !== "undefined") return location.origin;
  return "";
}

/** H5 API 传输：Bearer + JSON + 同源 cookie；401 抛可辨识错误由页面登出。 */
export const apiAdapter: ApiAdapter = {
  async request<T>(path: string, init: ApiInit = {}): Promise<T> {
    const base = apiBase();
    if (!base) throw new Error("TARO_APP_API_BASE not configured");
    const res = await fetch(`${base}${path}`, {
      method: init.method ?? "GET",
      headers: {
        "content-type": "application/json",
        ...(init.token ? { authorization: `Bearer ${init.token}` } : {}),
      },
      credentials: "include",
      body: init.body === undefined ? null : JSON.stringify(init.body),
    });
    const text = await res.text();
    let data: unknown = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = null;
    }
    if (!res.ok) {
      const message =
        data &&
        typeof data === "object" &&
        "message" in data &&
        typeof (data as { message?: unknown }).message === "string"
          ? (data as { message: string }).message
          : `HTTP ${res.status}`;
      const error = new Error(message) as Error & { status?: number };
      error.status = res.status;
      throw error;
    }
    return (data as { data?: T })?.data as T;
  },
};
