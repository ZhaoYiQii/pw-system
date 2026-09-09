import { identityAdapter } from "@platform-identity";
import { tenantLocator } from "@platform-locator";
import { apiAdapter } from "@platform-api";
import { session } from "@platform-session";

export interface PhoneCodeResult {
  debugCode?: string;
  expiresInSeconds: number;
  resendAfterSeconds: number;
}

export async function sendPhoneCode(
  tenantCode: string,
  phone: string,
): Promise<PhoneCodeResult> {
  return apiAdapter.request<PhoneCodeResult>(
    "/api/v1/auth/phone-verification-code",
    {
      method: "POST",
      body: { tenantCode, phone },
    },
  );
}

export async function phoneLogin(
  tenantCode: string,
  phone: string,
  code: string,
): Promise<string> {
  const result = await apiAdapter.request<{
    accessToken: string;
    csrfToken?: string;
    expiresInSeconds: number;
  }>("/api/v1/auth/phone-login", {
    method: "POST",
    body: { tenantCode, phone, code },
  });
  session.setToken(result.accessToken);
  if (result.csrfToken) session.setCsrf(result.csrfToken);
  return result.accessToken;
}

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
