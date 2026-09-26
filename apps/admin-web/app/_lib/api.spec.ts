import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * 会话自动刷新（single-flight）单测。
 *
 * 背景：access token 15 分钟过期，后端 refresh 接口（pw_refresh cookie 14 天）
 * 一直可用，但前端从未调用——用户每 15 分钟被踢回登录页。本组用例锁定
 * `apiFetch` 的新行为：401 → 静默 refresh → 重试原请求一次；并发 401 只刷新一次；
 * refresh 失败才清会话抛 401。
 */

const { fetchMock, sessionStorageMock } = vi.hoisted(() => {
  const fetchMock = vi.fn();
  const store = new Map<string, string>();
  const sessionStorageMock = {
    getItem: (key: string) => (store.has(key) ? store.get(key)! : null),
    setItem: (key: string, value: string) => void store.set(key, value),
    removeItem: (key: string) => void store.delete(key),
    clear: () => void store.clear(),
  };
  return { fetchMock, sessionStorageMock };
});

vi.stubGlobal("fetch", fetchMock);
vi.stubGlobal("window", { sessionStorage: sessionStorageMock });
vi.stubGlobal("sessionStorage", sessionStorageMock);

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function authedResponse(data: unknown): Response {
  return jsonResponse(200, { data });
}

describe("apiFetch 会话自动刷新", () => {
  beforeEach(() => {
    fetchMock.mockReset();
    sessionStorageMock.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("access token 过期（401）时静默刷新并重试原请求，用户无感", async () => {
    sessionStorageMock.setItem("pw_access_token", "stale-token");
    sessionStorageMock.setItem("pw_csrf_token", "csrf-1");

    fetchMock
      .mockResolvedValueOnce(jsonResponse(401, { message: "token expired" }))
      .mockResolvedValueOnce(
        authedResponse({
          accessToken: "fresh-token",
          csrfToken: "csrf-2",
          expiresInSeconds: 900,
        }),
      )
      .mockResolvedValueOnce(authedResponse({ hello: "world" }));

    const { apiFetch } = await import("./api");
    const result = await apiFetch<{ hello: string }>("/api/v1/whatever");

    expect(result).toEqual({ hello: "world" });
    // 3 次调用：原请求、refresh、重试
    expect(fetchMock).toHaveBeenCalledTimes(3);
    const refreshCall = fetchMock.mock.calls[1] as unknown as [
      string,
      RequestInit,
    ];
    expect(refreshCall[0]).toContain("/api/v1/auth/refresh");
    const refreshBody = JSON.parse(String(refreshCall[1].body));
    expect(refreshBody).toEqual({ scope: "tenant" });
    // 刷新请求必须带 cookie（pw_refresh 在 httpOnly cookie 里）与 CSRF 头
    expect(refreshCall[1].credentials).toBe("include");
    expect(
      (refreshCall[1].headers as Headers).get("x-csrf-token"),
    ).toBe("csrf-1");
    // 重试请求用上了新 token
    const retryCall = fetchMock.mock.calls[2] as unknown as [
      string,
      RequestInit,
    ];
    expect(
      (retryCall[1].headers as Headers).get("authorization"),
    ).toBe("Bearer fresh-token");
    // 新令牌与新 CSRF 已落库
    expect(sessionStorageMock.getItem("pw_access_token")).toBe("fresh-token");
    expect(sessionStorageMock.getItem("pw_csrf_token")).toBe("csrf-2");
  });

  it("并发多个 401 只触发一次 refresh，其余请求等同一个刷新结果", async () => {
    sessionStorageMock.setItem("pw_access_token", "stale-token");
    sessionStorageMock.setItem("pw_csrf_token", "csrf-1");

    fetchMock
      .mockImplementationOnce(() =>
        Promise.resolve(jsonResponse(401, { message: "expired a" })),
      )
      .mockImplementationOnce(() =>
        Promise.resolve(jsonResponse(401, { message: "expired b" })),
      )
      .mockImplementationOnce(() =>
        Promise.resolve(jsonResponse(401, { message: "expired c" })),
      )
      .mockResolvedValueOnce(
        authedResponse({ accessToken: "fresh-token", csrfToken: "csrf-2" }),
      )
      .mockImplementation(() =>
        Promise.resolve(authedResponse({ ok: true })),
      );

    const { apiFetch } = await import("./api");
    const [a, b, c] = await Promise.all([
      apiFetch("/api/v1/a"),
      apiFetch("/api/v1/b"),
      apiFetch("/api/v1/c"),
    ]);

    expect(a).toEqual({ ok: true });
    expect(b).toEqual({ ok: true });
    expect(c).toEqual({ ok: true });
    // 恰好一次 refresh：3 原始 + 1 刷新 + 3 重试 = 7
    const refreshCalls = fetchMock.mock.calls.filter((call) =>
      String(call[0]).includes("/api/v1/auth/refresh"),
    );
    expect(refreshCalls).toHaveLength(1);
  });

  it("refresh 也失败时清掉会话并抛 401（真正需要重新登录）", async () => {
    sessionStorageMock.setItem("pw_access_token", "stale-token");
    sessionStorageMock.setItem("pw_csrf_token", "csrf-1");

    fetchMock
      .mockResolvedValueOnce(jsonResponse(401, { message: "token expired" }))
      .mockResolvedValueOnce(jsonResponse(401, { message: "session dead" }));

    const { apiFetch } = await import("./api");
    await expect(apiFetch("/api/v1/whatever")).rejects.toMatchObject({
      status: 401,
    });
    expect(sessionStorageMock.getItem("pw_access_token")).toBeNull();
  });

  it("refresh 成功但重试仍 401 时，不再二次刷新，直接抛 401", async () => {
    sessionStorageMock.setItem("pw_access_token", "stale-token");
    sessionStorageMock.setItem("pw_csrf_token", "csrf-1");

    fetchMock
      .mockResolvedValueOnce(jsonResponse(401, { message: "expired" }))
      .mockResolvedValueOnce(authedResponse({ accessToken: "fresh" }))
      .mockResolvedValueOnce(jsonResponse(401, { message: "still denied" }));

    const { apiFetch } = await import("./api");
    await expect(apiFetch("/api/v1/whatever")).rejects.toMatchObject({
      status: 401,
    });
    const refreshCalls = fetchMock.mock.calls.filter((call) =>
      String(call[0]).includes("/api/v1/auth/refresh"),
    );
    expect(refreshCalls).toHaveLength(1);
  });
});
