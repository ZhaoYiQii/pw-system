import { identityAdapter } from "@platform-identity";
import { tenantLocator } from "@platform-locator";
import { session } from "@platform-session";

export async function customerLogin(
  tenantCode: string,
  username: string,
  password: string,
): Promise<string> {
  const input: {
    kind: "tenant";
    username: string;
    password: string;
    tenantCode?: string;
  } = { kind: "tenant", username, password };
  if (tenantCode) input.tenantCode = tenantCode;
  const loginSession = await identityAdapter.login(input);
  session.setToken(loginSession.accessToken);
  return loginSession.accessToken;
}

export async function customerLogout(): Promise<void> {
  await identityAdapter.logout("");
}

export async function resolveTenantCode(): Promise<string> {
  const info = await tenantLocator.resolveTenant();
  return info.state === "ok" && info.tenant?.code ? info.tenant.code : "";
}
