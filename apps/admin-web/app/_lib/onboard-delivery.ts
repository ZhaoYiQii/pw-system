export interface OnboardDeliveryInfo {
  tenantId: string;
  tenantCode: string;
  primaryHost: string;
  tenantName: string;
  ownerUsername: string;
  ownerPassword: string;
  packageLabel: string;
}

export interface DeliveryUrls {
  h5: { label: string; href: string };
  ownerConsole: { label: string; href: string };
}

export interface DeliveryEnv {
  wildcardRoot?: string;
  h5Origin?: string;
  consoleOrigin?: string;
}

export function resolveDeliveryUrls(
  info: OnboardDeliveryInfo,
  env: DeliveryEnv = {},
): DeliveryUrls {
  const root = (env.wildcardRoot ?? "").trim();
  if (root.length > 0) {
    return {
      h5: {
        label: `https://${info.primaryHost}`,
        href: `https://${info.primaryHost}`,
      },
      ownerConsole: {
        label: "登录商家端",
        href: `${(env.consoleOrigin ?? "").replace(/\/$/, "")}/store/login`,
      },
    };
  }
  const origin = (env.h5Origin ?? "http://localhost:3101").replace(/\/$/, "");
  return {
    h5: {
      label: `${origin}/?t=${info.tenantCode}`,
      href: `${origin}/?t=${encodeURIComponent(info.tenantCode)}`,
    },
    ownerConsole: {
      label: "登录商家端",
      href: `${(env.consoleOrigin ?? "").replace(/\/$/, "")}/store/login`,
    },
  };
}

export function buildDeliveryText(
  info: OnboardDeliveryInfo,
  urls: DeliveryUrls,
): string {
  return [
    `门店：${info.tenantName}（${info.tenantCode}）`,
    `H5 门面：${urls.h5.href}`,
    `店主账号：${info.ownerUsername}`,
    `临时密码：${info.ownerPassword}`,
    `套餐：${info.packageLabel}`,
    `商家端：${urls.ownerConsole.href}`,
  ].join("\n");
}
