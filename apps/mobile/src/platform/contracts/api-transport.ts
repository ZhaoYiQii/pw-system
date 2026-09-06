/** 业务页面的唯一 HTTP 传输契约：平台实现负责 base URL/凭据/跨域 cookie。 */
export interface ApiInit {
  method?: "GET" | "POST" | "PATCH" | "DELETE";
  body?: unknown;
  token?: string;
}

export interface ApiAdapter {
  request<T = unknown>(path: string, init?: ApiInit): Promise<T>;
  uploadBytes<T = unknown>(
    path: string,
    token: string,
    name: string,
    bytes: Uint8Array,
  ): Promise<T>;
}
