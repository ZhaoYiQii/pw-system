/**
 * H5 的 API 基址：构建期注入优先（TARO_APP_API_BASE），否则同源。
 *
 * 为什么单独抽一个文件：微信授权要整页跳转到 API 的 /authorize，
 * 三份各自实现一旦漂移，就会出现「登录请求打到 A、授权跳转到 B」这种极难查的错。
 */
export function apiBase(): string {
  const configured =
    typeof process !== "undefined" ? process.env?.TARO_APP_API_BASE : undefined;
  if (configured) return configured;
  if (typeof location !== "undefined") return location.origin;
  return "";
}
