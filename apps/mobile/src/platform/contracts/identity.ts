export interface IdentitySession {
  accessToken: string;
  refreshToken?: string;
  csrfToken?: string;
  principal: {
    sub: string;
    scope: string;
    role: string;
    username: string;
    tenantId?: string;
  };
  expiresInSeconds: number;
}

/** 主规格 13.1：登录/刷新/登出平台适配接口。业务只依赖本契约。 */
export interface IdentityAdapter {
  login(input: {
    kind: "platform" | "tenant";
    tenantCode?: string;
    username: string;
    password: string;
  }): Promise<IdentitySession>;
  /**
   * 切换端上下文（老板端 ↔ 陪玩端）。端上下文判别是单值：多角色账号登录后默认落在老板端，
   * 进入陪玩端前必须显式切换。账号未持有目标角色时服务端返回 403，
   * 适配器抛出的错误对象带 `status`，调用方据此区分「未获批准」与「会话失效」。
   */
  switchContext(
    context: "CUSTOMER" | "PLAYER",
    accessToken: string,
  ): Promise<IdentitySession>;
  refresh(
    refreshToken: string,
    scope: "platform" | "tenant",
  ): Promise<IdentitySession>;
  logout(refreshToken: string): Promise<void>;
}
