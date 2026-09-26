/**
 * SP2 §8.1：自助注册的两段式编排（**纯逻辑**，不 import 任何 `@platform-*` 别名）。
 *
 * 为什么两段式：注册建号（CUSTOMER）与陪玩申请是两件事——账号一旦建好就不该因为
 * 「陪玩申请没提交成功」而让用户以为注册失败。所以第 1 段失败原样抛错（页面显示服务端消息），
 * 第 2 段失败只降级成 `playerApplication: "failed"`，账号会话照常返回。
 */

export interface RegisterInput {
  tenantCode: string;
  username: string;
  password: string;
  displayName?: string;
  phone?: string;
  code?: string;
  /** 勾选「我是陪玩」→ 建号后追加陪玩申请。 */
  asPlayer?: boolean;
  playerIntro?: string;
}

export interface RegisterSession {
  accessToken: string;
  csrfToken?: string;
  username: string;
}

export interface RegisterPorts {
  /** 第 1 段：建号 + 直接签发会话（`POST /api/v1/auth/register`）。 */
  register(body: Record<string, unknown>): Promise<RegisterSession>;
  /** 第 2 段：既有陪玩申请端点（`POST /api/v1/tenant/player-applications`）。 */
  applyAsPlayer(token: string, intro: string): Promise<void>;
}

export type PlayerApplication = "skipped" | "submitted" | "failed";

export interface RegisterOutcome {
  session: RegisterSession;
  playerApplication: PlayerApplication;
  playerError?: string;
}

/** 服务端在 displayName 缺省时用的同一条规则（`用户` + 用户名后四位），前端保持一致以免两处文案漂移。 */
export function defaultDisplayName(username: string): string {
  return `用户${username.slice(-4)}`;
}

/** 只带真正有值的字段：空串与 undefined 一律不发，避免服务端把 `""` 当有效值。 */
export function registerBody(input: RegisterInput): Record<string, unknown> {
  const displayName = (input.displayName ?? "").trim() || defaultDisplayName(input.username);
  const body: Record<string, unknown> = {
    tenantCode: input.tenantCode,
    username: input.username,
    password: input.password,
    displayName,
  };
  if (input.phone) body.phone = input.phone;
  if (input.code) body.code = input.code;
  return body;
}

/**
 * 两段式注册：第 1 段原样抛错；第 2 段（陪玩申请）失败只降级，不吞掉账号已建的事实。
 * 页面据此提示「账号已创建，陪玩申请未提交，可重试」并只重试第 2 段。
 */
export async function runRegistration(
  ports: RegisterPorts,
  input: RegisterInput,
): Promise<RegisterOutcome> {
  const session = await ports.register(registerBody(input));
  if (input.asPlayer !== true) {
    return { session, playerApplication: "skipped" };
  }
  try {
    await ports.applyAsPlayer(
      session.accessToken,
      (input.playerIntro ?? "").trim(),
    );
    return { session, playerApplication: "submitted" };
  } catch (error) {
    return {
      session,
      playerApplication: "failed",
      playerError: error instanceof Error ? error.message : String(error),
    };
  }
}
