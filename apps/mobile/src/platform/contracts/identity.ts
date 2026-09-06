export interface IdentitySession {
  accessToken: string;
  refreshToken?: string;
  principal: { sub: string; scope: string; role: string; username: string; tenantId?: string };
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
  refresh(refreshToken: string, scope: "platform" | "tenant"): Promise<IdentitySession>;
  logout(refreshToken: string): Promise<void>;
}
