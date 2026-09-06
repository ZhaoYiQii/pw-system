export interface SessionHandle {
  getToken(): string | null;
  setToken(token: string): void;
  clearToken(): void;
}

/** H5：token 存 localStorage（仅平台目录允许访问）。 */
export const session: SessionHandle = {
  getToken() {
    try {
      if (typeof localStorage === "undefined") return null;
      return localStorage.getItem("pw_access_token");
    } catch {
      return null;
    }
  },
  setToken(token: string) {
    try {
      if (typeof localStorage === "undefined") return;
      localStorage.setItem("pw_access_token", token);
    } catch {
      /* ignore */
    }
  },
  clearToken() {
    try {
      if (typeof localStorage === "undefined") return;
      localStorage.removeItem("pw_access_token");
    } catch {
      /* ignore */
    }
  },
};
