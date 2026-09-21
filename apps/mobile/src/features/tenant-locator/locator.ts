export type LocatorParam =
  { name: "host"; value: string } | { name: "code"; value: string };

export function readShortCode(search: string): string | null {
  try {
    const code = new URLSearchParams(search).get("t")?.trim();
    return code && code.length > 0 ? code : null;
  } catch {
    return null;
  }
}

/**
 * H5 租户定位参数：优先使用 `?t=门店code`（短码直达），否则回退当前 host。
 * 纯函数便于在 H5/单元测试中独立验证；不依赖 window/location。
 *
 * 本地/局域网地址（localhost、IPv4/IPv6 字面量）**不发起 host 解析**：
 * 这类 host 不可能绑定门店，调用只会换来一条 404 噪音（污染 console 与线上监控），
 * 而页面本来就会回退到「手输门店 code」的登录卡。
 */
export function resolveLocatorParam(
  search: string,
  host: string,
): LocatorParam | null {
  const code = readShortCode(search);
  if (code) return { name: "code", value: code };
  const trimmedHost = host.trim();
  if (trimmedHost.length === 0) return null;
  return isResolvableHost(trimmedHost)
    ? { name: "host", value: trimmedHost }
    : null;
}

/** 只有「域名形态」的 host 才值得做门店解析（排除 localhost 与 IP 字面量）。 */
export function isResolvableHost(host: string): boolean {
  const hostname = host
    .replace(/^\[|\]$/g, "")
    .split(":")[0]
    ?.trim()
    .toLowerCase();
  if (!hostname) return false;
  if (hostname === "localhost" || hostname.endsWith(".localhost")) return false;
  if (hostname.endsWith(".local")) return false;
  // IPv4 字面量（如 192.168.1.5 或 127.0.0.1）
  if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(hostname)) return false;
  // IPv6 字面量（含压缩写法，如 ::1、fe80::1）
  if (hostname.includes(":")) return false;
  return true;
}
