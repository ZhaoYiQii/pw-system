// 密码哈希：使用 Node 平台内置 scrypt（成熟 KDF，非自研算法），格式 scrypt:N:r:p:salt:hash。
import { randomBytes, scrypt as scryptCb, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(scryptCb) as (
  password: string,
  salt: Buffer,
  keylen: number,
  options: { N: number; r: number; p: number }
) => Promise<Buffer>;

const N = 16384;
const r = 8;
const p = 1;
const KEY_LEN = 64;

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = await scrypt(password, salt, KEY_LEN, { N, r, p });
  return `scrypt:${N}:${r}:${p}:${salt.toString("base64")}:${Buffer.from(hash).toString("base64")}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split(":");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;
  const n = Number(parts[1]);
  const rr = Number(parts[2]);
  const pp = Number(parts[3]);
  const salt = Buffer.from(parts[4] as string, "base64");
  const expected = Buffer.from(parts[5] as string, "base64");
  const actual = await scrypt(password, salt, expected.length, { N: n, r: rr, p: pp });
  return timingSafeEqual(actual, expected);
}
