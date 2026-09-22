import { HttpException, HttpStatus } from "@nestjs/common";
import { randomBytes } from "node:crypto";
import type { Request, Response } from "express";
import { REFRESH_TOKEN_TTL_SECONDS } from "../infrastructure/tokens.js";

/**
 * 会话 cookie 的唯一写入点。
 *
 * 为什么抽出来：登录、微信登录、切换身份三条路径都要种同一对 cookie，
 * 安全属性（httpOnly / sameSite / secure / path）散在多处写就会漂移。
 */

export const REFRESH_COOKIE = "pw_refresh";
export const CSRF_COOKIE = "pw_csrf";
export const REFRESH_COOKIE_PATH = "/api/v1/auth";

export function readCookie(req: Request, name: string): string | undefined {
  const header = req.headers.cookie;
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const idx = part.indexOf("=");
    if (idx === -1) continue;
    const key = part.slice(0, idx).trim();
    if (key === name) return part.slice(idx + 1).trim();
  }
  return undefined;
}

export function setRefreshCookie(res: Response, token: string): void {
  res.cookie(REFRESH_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: REFRESH_COOKIE_PATH,
    maxAge: REFRESH_TOKEN_TTL_SECONDS * 1000,
  });
}

export function setCsrfCookie(res: Response): string {
  const token = randomBytes(24).toString("base64url");
  res.cookie(CSRF_COOKIE, token, {
    httpOnly: false,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: REFRESH_TOKEN_TTL_SECONDS * 1000,
  });
  return token;
}

export function requireCsrf(req: Request): void {
  const cookieToken = readCookie(req, CSRF_COOKIE);
  const headerToken = req.headers["x-csrf-token"];
  if (
    !cookieToken ||
    typeof headerToken !== "string" ||
    cookieToken !== headerToken
  ) {
    // 行为与原实现一致：403 而不是 500
    throw new HttpException("CSRF token mismatch", HttpStatus.FORBIDDEN);
  }
}

export function clearRefreshCookie(res: Response): void {
  res.clearCookie(REFRESH_COOKIE, { path: REFRESH_COOKIE_PATH });
}
