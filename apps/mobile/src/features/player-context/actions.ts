/**
 * 陪玩端入口的平台接线：把纯逻辑层（`enter.ts`）的端口接到 `@platform-identity`。
 *
 * 返回的 token 只交给当前页面使用，**不写回 session**：会话里的 token 保持老板端上下文，
 * 老板端页面因此完全不受影响（端上下文判别是单值，见 ADR-0009）。代价是每次进入
 * 陪玩端页面多一次 switch-context 请求；换来的是两端不互相污染——把陪玩上下文的 token
 * 写回 session 会让老板端页面在下一次 refresh 之前一直拿 403「需要客户身份」。
 */
import { identityAdapter } from "@platform-identity";
import {
  enterPlayer as enterPlayerWith,
  type PlayerEntryOutcome,
} from "./enter";

export type { PlayerEntryOutcome };
export { PLAYER_APPLICATION_PENDING_MESSAGE } from "./enter";

/** 页面进入陪玩端的统一入口：切换端上下文并返回可直接用于陪玩端接口的 token。 */
export function enterPlayer(accessToken: string): Promise<PlayerEntryOutcome> {
  return enterPlayerWith(accessToken, {
    switchToPlayer: async (token) =>
      (await identityAdapter.switchContext("PLAYER", token)).accessToken,
  });
}
