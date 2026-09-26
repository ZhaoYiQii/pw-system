/**
 * 陪玩端入口判定（纯逻辑，可在 node 单测；平台接线见同目录 `actions.ts`）。
 *
 * 背景：端上下文判别是单值（ADR-0009「端上下文判别保持单值」）。账号即使已持有 PLAYER 角色，
 * 登录签发的 access token 默认仍落在老板端（`CUSTOMER` 优先），拿它直接打陪玩端接口会得到
 * 403「需要陪玩身份」。所以进入陪玩端前必须显式切一次端上下文。
 *
 * 本模块只做一件容易做错的事：把切换失败的原因翻译成页面能直接照做的结果。
 * 关键口径——**403 不是登录失败**：账号确已登录，只是还没被批准为陪玩，
 * 页面必须保留会话并给出待审核提示（修复前页面把它当鉴权失败清 token，用户看到的是「登不进去」）。
 */

/** 未通过陪玩申请时的展示口径：说的是「还没被批准」，不是「登录失败」。 */
export const PLAYER_APPLICATION_PENDING_MESSAGE =
  "陪玩申请审核中或尚未通过；门店批准后重新进入本页即可。";

const SESSION_EXPIRED_MESSAGE = "登录状态已失效，请重新登录。";

export interface PlayerEntryPorts {
  /** 切到陪玩端上下文并返回该上下文下的 access token；失败时抛出带 `status` 的错误。 */
  switchToPlayer(accessToken: string): Promise<string>;
}

export interface PlayerEntryOutcome {
  /** 陪玩端上下文下的 access token；未获批准或会话失效时为 null。 */
  token: string | null;
  /** 可直接展示的提示文案；成功时为 null。 */
  message: string | null;
  /** 失败是否因会话失效（401）——页面据此清 token 退回登录卡。 */
  sessionExpired: boolean;
}

export async function enterPlayer(
  accessToken: string,
  ports: PlayerEntryPorts,
): Promise<PlayerEntryOutcome> {
  try {
    const token = await ports.switchToPlayer(accessToken);
    return { token, message: null, sessionExpired: false };
  } catch (error) {
    const status = (error as { status?: number }).status;
    if (status === 401) {
      return {
        token: null,
        message: SESSION_EXPIRED_MESSAGE,
        sessionExpired: true,
      };
    }
    if (status === 403) {
      return {
        token: null,
        message: PLAYER_APPLICATION_PENDING_MESSAGE,
        sessionExpired: false,
      };
    }
    return {
      token: null,
      message: error instanceof Error ? error.message : String(error),
      sessionExpired: false,
    };
  }
}
