import type { AuthService, SessionBundle } from "./auth.service.js";
import type { WechatOauthClient } from "../infrastructure/wechat-oauth.client.js";
import type { WechatStateService } from "../infrastructure/wechat-state.js";

/**
 * S3b：微信网页授权登录的编排（A′ 口径：微信优先、手机号后补）。
 *
 * 为什么登录时**不要求手机号**：公众号 H5 里微信不提供获取手机号的接口（那是小程序的能力），
 * 而 JSAPI 支付只需要 openid —— 所以首次进店直接建号、直接可下单，手机号留给「个人中心补绑」。
 *
 * 已知取舍（写在这里，不在代码里假装没有）：同一个人若「先手机号登录、后微信登录」，
 * 会因为 openid 尚未绑定而产生第二个账号；补绑手机号时由 S3c 的合并规则收敛。
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
  | {
      readonly enabled: true;
      readonly client: WechatOauthClient;
      readonly state: WechatStateService;
    };

export class WechatAuthService {
  constructor(
    private readonly runtime: WechatLoginRuntime,
    private readonly auth: AuthService,
  ) {}

  /** 生成「跳去微信」的地址；`returnTo` 由 wechat-state 白名单化后写进签名 state。 */
  async resolveAuthorizeUrl(
    tenantCode: string,
    returnTo: unknown,
  ): Promise<string> {
    const { client, state } = this.requireEnabled();
    const stateToken = await state.sign({ tenantCode, returnTo });
    return client.authorizeUrl(stateToken);
  }

  /**
   * H5 入口页拿到 `code`+`state` 后调这里：校验 state → 换 openid → 发会话。
   * 绑定与否的判断在 AuthService.wechatCustomerLogin（未绑则建号）。
   */
  async loginWithCode(input: {
    tenantCode: string;
    code: string;
    state: string;
  }): Promise<{ bundle: SessionBundle; returnTo: string }> {
    const { client, state } = this.requireEnabled();
    const payload = await state.verify(input.state);
    if (payload.tenantCode !== input.tenantCode) {
      throw new WechatStateMismatchError();
    }
    const tenantId = await this.auth.resolveTenantId(payload.tenantCode);
    if (!tenantId) throw new WechatTenantNotFoundError(payload.tenantCode);
    const identity = await client.exchangeCode(input.code);
    const bundle = await this.auth.wechatCustomerLogin(
      tenantId,
      identity.openid,
    );
    return { bundle, returnTo: payload.returnTo };
  }

  private requireEnabled(): {
    client: WechatOauthClient;
    state: WechatStateService;
  } {
    if (!this.runtime.enabled) throw new WechatLoginDisabledError();
    return { client: this.runtime.client, state: this.runtime.state };
  }
}
