/**
 * SP2 §8.1：注册 / 设置密码的**平台适配层**——页面只依赖本文件。
 *
 * 本文件只做两件事：把纯逻辑层（`register.ts`）的端口接到 `@platform-api` / `@platform-session`，
 * 以及把服务端的 `{ data }` 信封摊平成会话。两段式编排留在 `register.ts`（可在 node 环境单测）。
 */
import { apiAdapter } from "@platform-api";
import { session } from "@platform-session";
import {
  runRegistration,
  type RegisterInput,
  type RegisterOutcome,
  type RegisterPorts,
  type RegisterSession,
} from "./register";

interface RegisterResponse {
  accessToken: string;
  csrfToken?: string;
  principal: { username: string };
}

/** 第 1 段：建号 + 直接签发会话；服务端同时下发 refresh cookie 与 csrf token。 */
async function register(
  body: Record<string, unknown>,
): Promise<RegisterSession> {
  const result = await apiAdapter.request<RegisterResponse>(
    "/api/v1/auth/register",
    { method: "POST", body },
  );
  session.setToken(result.accessToken);
  if (result.csrfToken) session.setCsrf(result.csrfToken);
  return {
    accessToken: result.accessToken,
    username: result.principal.username,
    ...(result.csrfToken ? { csrfToken: result.csrfToken } : {}),
  };
}

/**
 * 第 2 段：既有陪玩申请端点。用显式 token 而非 `session.getToken()`——第 1 段刚建号时
 * 会话已写入，但显式传递能保证「重试第 2 段」与「首次提交」走同一条路径。
 */
async function postPlayerApplication(
  token: string,
  intro: string,
): Promise<void> {
  await apiAdapter.request("/api/v1/tenant/player-applications", {
    method: "POST",
    body: { intro },
    token,
  });
}

const ports: RegisterPorts = {
  register,
  applyAsPlayer: postPlayerApplication,
};

/** 自助注册入口（两段式）：第 1 段失败抛错；陪玩申请失败只降级，账号会话照常返回。 */
export function registerAccount(input: RegisterInput): Promise<RegisterOutcome> {
  return runRegistration(ports, input);
}

/** 设置/修改密码：是否要求原密码由服务端判定（初次免验，此后必验）。 */
export async function setAccountPassword(input: {
  newPassword: string;
  currentPassword?: string;
}): Promise<void> {
  const token = session.getToken();
  await apiAdapter.request("/api/v1/auth/password", {
    method: "POST",
    body: {
      newPassword: input.newPassword,
      ...(input.currentPassword
        ? { currentPassword: input.currentPassword }
        : {}),
    },
    ...(token ? { token } : {}),
  });
}

/** 陪玩申请（profile 页单独使用）：必须已有租户会话。 */
export async function applyAsPlayer(intro: string): Promise<void> {
  const token = session.getToken();
  if (!token) throw new Error("登录状态已失效，请重新登录后再提交陪玩申请");
  await postPlayerApplication(token, intro);
}
