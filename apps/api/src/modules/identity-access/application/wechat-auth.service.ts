import type { AuthRepository } from "./auth-ports.js";
import type { AuthService, SessionBundle } from "./auth.service.js";
import type { WechatOauthClient } from "../infrastructure/wechat-oauth.client.js";
import {
  WECHAT_STATE_TTL_SECONDS,
  WechatStateError,
  createStateToken,
  hashStateToken,
  isValidStateToken,
  sanitizeReturnTo,
} from "../infrastructure/wechat-state.js";

/**
 * S3c-1：微信网页授权登录的编排（A′ 口径：微信优先、手机号后补）。
 *
 * state 走「不透明随机串 + 服务端短期记录」：微信只接受 a-zA-Z0-9、≤128 字节的 state，
 * 所以 tenantCode/returnTo 不能塞进 state（见 wechat-state.ts 的说明）。
 *
 * 已知取舍（写在这里，不在代码里假装没有）：同一个人若「先手机号登录、后微信登录」，
 * 会因为 openid 尚未绑定而产生第二个账号；补绑手机号时由 S3c-2 的合并规则收敛。
 */

export class WechatLoginDisabledError extends Error {
  constructor() {
    super("微信登录未启用");
    this.name = "WechatLoginDisabledError";
  }
}

export class WechatTenantNotFoundError extends Error {
  constructor(tenantCode: string) {
    super(`门店不存在：${tenantCode}`);
    this.name = "WechatTenantNotFoundError";
  }
}

export class WechatStateMismatchError extends Error {
  constructor() {
    super("state 与 tenantCode 不一致");
    this.name = "WechatStateMismatchError";
  }
}

export type WechatLoginRuntime =
  | { readonly enabled: false }
  | { readonly enabled: true; readonly client: WechatOauthClient };

export class WechatAuthService {
  constructor(
    private readonly runtime: WechatLoginRuntime,
    private readonly auth: AuthService,
    private readonly states: AuthRepository,
  ) {}

  /** 建 state 记录并给出「跳去微信」的地址。门店不存在在这里就 404，不浪费用户一次跳转。 */
  async resolveAuthorizeUrl(
    tenantCode: string,
    returnTo: unknown,
  ): Promise<string> {
    const { client } = this.requireEnabled();
    const tenantId = await this.auth.resolveTenantId(tenantCode);
    if (!tenantId) throw new WechatTenantNotFoundError(tenantCode);
    const state = createStateToken();
    await this.states.createWechatLoginState({
      tenantId,
      stateHash: hashStateToken(state),
      returnTo: sanitizeReturnTo(returnTo),
      expiresAt: new Date(Date.now() + WECHAT_STATE_TTL_SECONDS * 1000),
    });
    return client.authorizeUrl(state);
  }

  /**
   * H5 入口页拿到 `code`+`state` 后调这里。
   * state 先于网络调用被校验并**一次性消费**：脏/重放的 state 不会消耗用户的 code。
   */
  async loginWithCode(input: {
    tenantCode: string;
    code: string;
    state: string;
  }): Promise<{ bundle: SessionBundle; returnTo: string }> {
    const { client } = this.requireEnabled();
    if (!isValidStateToken(input.state)) {
      throw new WechatStateError("state 格式不合法");
    }
    const record = await this.states.consumeWechatLoginState(
      hashStateToken(input.state),
    );
    if (!record) {
      throw new WechatStateError("state 不存在、已过期或已被使用");
    }
    const tenantId = await this.auth.resolveTenantId(input.tenantCode);
    if (!tenantId) throw new WechatTenantNotFoundError(input.tenantCode);
    if (tenantId !== record.tenantId) throw new WechatStateMismatchError();
    const identity = await client.exchangeCode(input.code);
    const bundle = await this.auth.wechatCustomerLogin(
      tenantId,
      identity.openid,
    );
    return { bundle, returnTo: record.returnTo };
  }

  private requireEnabled(): { client: WechatOauthClient } {
    if (!this.runtime.enabled) throw new WechatLoginDisabledError();
    return { client: this.runtime.client };
  }
}
