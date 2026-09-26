/**
 * 陪玩端入口判定（Bug 3 回归）。
 *
 * 这里钉住的产品口径：**未通过陪玩申请不是「登录失败」**。
 * 修复前的症状是页面把服务端 403「需要陪玩身份」当鉴权失败，清掉会话、退回登录卡，
 * 于是已获批准的账号看起来「登录不进去」。正确口径是：
 * - 403 → 提示「申请审核中或尚未通过」，会话保留（用户确实登录成功了）；
 * - 401 → 才是会话失效，页面清 token 退回登录卡；
 * - 其它错误 → 原样透出服务端消息，不吞。
 */
import { describe, expect, it } from "vitest";
import {
  PLAYER_APPLICATION_PENDING_MESSAGE,
  enterPlayer,
  type PlayerEntryPorts,
} from "./enter";

function ports(
  outcome: { token: string } | { fail: Error & { status?: number } },
): PlayerEntryPorts {
  return {
    switchToPlayer: async () => {
      if ("fail" in outcome) throw outcome.fail;
      return outcome.token;
    },
  };
}

function httpError(
  status: number,
  message: string,
): Error & { status?: number } {
  const error = new Error(message) as Error & { status?: number };
  error.status = status;
  return error;
}

describe("enterPlayer", () => {
  it("切换成功 → 返回陪玩上下文 token，无提示、会话未失效", async () => {
    const result = await enterPlayer(
      "boss-token",
      ports({ token: "player-token" }),
    );
    expect(result).toEqual({
      token: "player-token",
      message: null,
      sessionExpired: false,
    });
  });

  it("403（申请未通过）→ 给出待审核口径，且不判为会话失效", async () => {
    const result = await enterPlayer(
      "boss-token",
      ports({ fail: httpError(403, "需要陪玩身份") }),
    );
    expect(result.token).toBeNull();
    expect(result.message).toBe(PLAYER_APPLICATION_PENDING_MESSAGE);
    expect(result.sessionExpired).toBe(false);
  });

  it("401 → 判为会话失效，页面据此清 token 退回登录卡", async () => {
    const result = await enterPlayer(
      "stale-token",
      ports({ fail: httpError(401, "unauthorized") }),
    );
    expect(result.sessionExpired).toBe(true);
    expect(result.token).toBeNull();
  });

  it("其它错误（如网络失败）→ 原样透出服务端消息，不吞也不改写", async () => {
    const result = await enterPlayer(
      "boss-token",
      ports({ fail: new Error("HTTP 500") }),
    );
    expect(result.token).toBeNull();
    expect(result.message).toBe("HTTP 500");
    expect(result.sessionExpired).toBe(false);
  });
});
