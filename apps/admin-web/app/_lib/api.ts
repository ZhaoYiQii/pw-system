const apiOrigin = process.env.NEXT_PUBLIC_API_ORIGIN ?? "http://127.0.0.1:3000";
const TOKEN_KEY = "pw_access_token";
const CSRF_KEY = "pw_csrf_token";

export class ApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

export function getAccessToken(): string | null {
  if (typeof window === "undefined") return null;
  return window.sessionStorage.getItem(TOKEN_KEY);
}

export function setAccessToken(token: string): void {
  if (typeof window === "undefined") return;
  window.sessionStorage.setItem(TOKEN_KEY, token);
}

export function clearAccessToken(): void {
  if (typeof window === "undefined") return;
  window.sessionStorage.removeItem(TOKEN_KEY);
}

export function getCsrfToken(): string | null {
  if (typeof window === "undefined") return null;
  return window.sessionStorage.getItem(CSRF_KEY);
}

export function setCsrfToken(token: string): void {
  if (typeof window === "undefined") return;
  window.sessionStorage.setItem(CSRF_KEY, token);
}

export function clearCsrfToken(): void {
  if (typeof window === "undefined") return;
  window.sessionStorage.removeItem(CSRF_KEY);
}

/**
 * 会话自动刷新（single-flight）。
 *
 * 背景：access token 只有 15 分钟（安全基线），refresh cookie 有 14 天；
 * 之前前端收到 401 只会清 token 抛错，从不调用 refresh——用户每 15 分钟
 * 被踢回登录页。现在：401 → 静默 refresh → 重试原请求一次；并发 401 共享
 * 同一次刷新；refresh 失败才清会话并要求重新登录。
 */

let refreshInFlight: Promise<boolean> | null = null;

/** 当前会话属于平台端还是商家端（refresh 接口必须显式声明 scope）。 */
function sessionScope(): "platform" | "tenant" {
  return (
    (window.sessionStorage.getItem("pw_session_scope") as
      | "platform"
      | "tenant"
      | null) ?? "tenant"
  );
}

/** 登录成功后由登录页调用：记录会话 scope，供 refresh 使用。 */
export function setSessionScope(scope: "platform" | "tenant"): void {
  if (typeof window === "undefined") return;
  window.sessionStorage.setItem("pw_session_scope", scope);
}

export function getSessionScope(): "platform" | "tenant" {
  if (typeof window === "undefined") return "tenant";
  return sessionScope();
}

async function requestRefresh(): Promise<boolean> {
  const headers = new Headers({ "content-type": "application/json" });
  const csrf = getCsrfToken();
  if (csrf) headers.set("x-csrf-token", csrf);
  const res = await fetch(`${apiOrigin}/api/v1/auth/refresh`, {
    method: "POST",
    credentials: "include",
    headers,
    body: JSON.stringify({ scope: sessionScope() }),
  });
  if (!res.ok) return false;
  const body = (await res.json()) as {
    data?: { accessToken?: string; csrfToken?: string };
  };
  const accessToken = body.data?.accessToken;
  if (!accessToken) return false;
  setAccessToken(accessToken);
  if (body.data?.csrfToken) setCsrfToken(body.data.csrfToken);
  return true;
}

/** 并发 401 只允许一次 refresh 在飞；结果（成败）共享给所有等待者。 */
function refreshOnce(): Promise<boolean> {
  refreshInFlight ??= requestRefresh().finally(() => {
    refreshInFlight = null;
  });
  return refreshInFlight;
}

/** 调用服务端 logout 撤销 refresh session，随后清理本地会话。 */
export async function logoutSession(): Promise<void> {
  try {
    const csrf = getCsrfToken();
    await fetch(`${apiOrigin}/api/v1/auth/logout`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(csrf ? { "x-csrf-token": csrf } : {}),
      },
      credentials: "include",
    });
  } finally {
    clearAccessToken();
    clearCsrfToken();
  }
}

/** 统一请求：自动附加 Bearer access token，解包 { data }，401 清 token。 */
export async function apiFetch<T = unknown>(
  path: string,
  init?: RequestInit,
): Promise<T> {
  return apiFetchOnce<T>(path, init, true);
}

/** allowRefresh=false：重试请求不再触发第二次刷新，防止 401 循环。 */
async function apiFetchOnce<T = unknown>(
  path: string,
  init?: RequestInit,
  allowRefresh?: boolean,
): Promise<T> {
  const token = getAccessToken();
  const headers = new Headers(init?.headers);
  headers.set("content-type", "application/json");
  if (token) headers.set("authorization", `Bearer ${token}`);
  const res = await fetch(`${apiOrigin}${path}`, {
    ...init,
    headers,
  });
  const text = await res.text();
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = null;
  }
  if (res.status === 401) {
    // access token 过期：静默刷新一次并重试；刷新失败或重试仍 401 才要求登录。
    if (allowRefresh === true && (await refreshOnce())) {
      return apiFetchOnce<T>(path, init, false);
    }
    clearAccessToken();
    throw new ApiError(401, "登录已失效，请重新登录");
  }
  if (!res.ok) {
    const message =
      body !== null &&
      typeof body === "object" &&
      "message" in body &&
      typeof (body as { message?: unknown }).message === "string"
        ? (body as { message: string }).message
        : `HTTP ${res.status}`;
    throw new ApiError(res.status, message);
  }
  const data = (body as { data?: T } | null)?.data;
  return data as T;
}

/** 导出文件名的兜底值：服务端没有给出可信 `Content-Disposition` 时使用。 */
const DEFAULT_CSV_FILENAME = "fund-ledger.csv";
/** Windows 保留字符：文件名里出现即视为不可信。 */
const FORBIDDEN_FILENAME_CHARS = '<>:"|?*';

/** 只接受纯文件名：剥掉路径、拒绝 `..`、控制字符与保留字符，避免服务端头注入落盘路径。 */
function safeFilename(raw: string): string | null {
  const base = raw
    .trim()
    .replace(/^["']|["']$/g, "")
    .split(/[\\/]/)
    .pop();
  if (!base || base === "." || base === ".." || base.includes(".."))
    return null;
  for (const character of base) {
    const code = character.codePointAt(0) ?? 0;
    if (code < 0x20 || code === 0x7f) return null;
    if (FORBIDDEN_FILENAME_CHARS.includes(character)) return null;
  }
  return base;
}

/** 解析 `Content-Disposition`（优先 RFC 5987 `filename*`）；不可信时返回 null。 */
function filenameFromDisposition(value: string | null): string | null {
  if (!value) return null;
  const extended = /filename\*\s*=\s*([^;]+)/i.exec(value);
  if (extended?.[1]) {
    const rawValue = extended[1].trim();
    const encoded = /^UTF-8''(.+)$/i.exec(rawValue)?.[1] ?? rawValue;
    try {
      return safeFilename(decodeURIComponent(encoded));
    } catch {
      return null;
    }
  }
  const plain = /filename\s*=\s*([^;]+)/i.exec(value);
  return plain?.[1] ? safeFilename(plain[1]) : null;
}

export interface DownloadedCsvFile {
  blob: Blob;
  filename: string;
}

/**
 * 只读 CSV 下载：鉴权与会话语义与 `apiFetch` 一致（Bearer + `credentials: include`，
 * 401 清 token），但**不解析 JSON、不设置 `content-type`**——导出响应是 `text/csv`。
 *
 * 失败时抛出 `ApiError`（错误体里的 `message` 原样带出）；调用方只有在拿到返回值
 * 之后才能创建 Blob URL 并触发下载，因此任何失败都不会产生残缺文件。
 */
export async function apiDownloadCsv(
  path: string,
  init?: RequestInit,
): Promise<DownloadedCsvFile> {
  const token = getAccessToken();
  const headers = new Headers(init?.headers);
  if (token) headers.set("authorization", `Bearer ${token}`);
  const res = await fetch(`${apiOrigin}${path}`, {
    ...init,
    headers,
    credentials: "include",
  });
  if (res.status === 401) {
    clearAccessToken();
    throw new ApiError(401, "登录已失效，请重新登录");
  }
  if (!res.ok) {
    const text = await res.text();
    let message = `HTTP ${res.status}`;
    try {
      const body: unknown = text ? JSON.parse(text) : null;
      if (body !== null && typeof body === "object" && "message" in body) {
        const candidate = (body as { message?: unknown }).message;
        if (typeof candidate === "string" && candidate !== "") {
          message = candidate;
        }
      }
    } catch {
      // 非 JSON 错误体：保留 `HTTP <status>` 兜底文案，不吞掉原始状态码。
    }
    throw new ApiError(res.status, message);
  }
  const blob = await res.blob();
  return {
    blob,
    filename:
      filenameFromDisposition(res.headers.get("content-disposition")) ??
      DEFAULT_CSV_FILENAME,
  };
}
