export type LocatorParam =
  | { name: "host"; value: string }
  | { name: "code"; value: string };

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
 */
export function resolveLocatorParam(
  search: string,
  host: string,
): LocatorParam | null {
  const code = readShortCode(search);
  if (code) return { name: "code", value: code };
  const trimmedHost = host.trim();
  return trimmedHost.length > 0 ? { name: "host", value: trimmedHost } : null;
}
