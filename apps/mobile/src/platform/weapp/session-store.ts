import type { SessionHandle } from "../h5/session-store";

/** 小程序登录未接入：typed unsupported，不持久化。 */
export const session: SessionHandle = {
  getToken() {
    return null;
  },
  setToken() {
    /* noop */
  },
  clearToken() {
    /* noop */
  },
};
