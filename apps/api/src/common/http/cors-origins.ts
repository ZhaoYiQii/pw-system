/**
 * 允许的前端来源白名单。
 *
 * 背景：原来 `ADMIN_WEB_ORIGIN` / `H5_ORIGIN` 各只接受**一个** origin，而本机同一服务既是
 * `localhost:3005` 又可能是 `127.0.0.1:3005`；只配一个时，用另一种写法打开商家端就会被 CORS 拦
 * （实测：重启 3300 后 `http://127.0.0.1:3005` 的预检没有 Access-Control-Allow-Origin）。
 * 现在两个变量都支持逗号分隔的多值，方便把两种写法一起放进来。
 */
export function parseAllowedOrigins(env: {
  ADMIN_WEB_ORIGIN?: string;
  H5_ORIGIN?: string;
}): string[] {
  const out: string[] = [];
  for (const value of [env.ADMIN_WEB_ORIGIN, env.H5_ORIGIN]) {
    if (typeof value !== "string") continue;
    for (const part of value.split(",")) {
      const origin = part.trim();
      if (origin.length > 0 && !out.includes(origin)) out.push(origin);
    }
  }
  return out;
}
