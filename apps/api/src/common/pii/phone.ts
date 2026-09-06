import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
} from "node:crypto";

/** 读取 PII 主密钥：生产必须配置 PII_MASTER_KEY（32 字节 base64）；本地测试用 SESSION_SECRET 派生。 */
function masterKey(): Buffer {
  const configured = process.env.PII_MASTER_KEY;
  if (configured) {
    const key = Buffer.from(configured, "base64");
    if (key.length !== 32) {
      throw new Error("PII_MASTER_KEY must be 32 bytes base64");
    }
    return key;
  }
  if (process.env.NODE_ENV === "production") {
    throw new Error("PII_MASTER_KEY is required in production");
  }
  const secret = process.env.SESSION_SECRET ?? "dev-pii-secret";
  return createHash("sha256").update(`${secret}:pii-mobile`).digest();
}

function normalizeMobile(value: string): string {
  return value.replace(/[\s-]/g, "");
}

export interface PhoneCipher {
  mobileEnc: string;
  mobileHash: string;
}

export function encryptPhone(tenantId: string, value: string): PhoneCipher {
  const mobile = normalizeMobile(value);
  const key = masterKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([cipher.update(mobile, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  const mobileEnc = Buffer.concat([iv, tag, ct]).toString("base64");
  const mobileHash = createHmac("sha256", key)
    .update(`${tenantId}:${mobile}`)
    .digest("hex");
  return { mobileEnc, mobileHash };
}

export function decryptPhone(mobileEnc: string): string {
  const raw = Buffer.from(mobileEnc, "base64");
  if (raw.length < 28) throw new Error("invalid phone ciphertext");
  const iv = raw.subarray(0, 12);
  const tag = raw.subarray(12, 28);
  const ct = raw.subarray(28);
  const decipher = createDecipheriv("aes-256-gcm", masterKey(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString(
    "utf8",
  );
}

export function phoneHash(tenantId: string, value: string): string {
  return createHmac("sha256", masterKey())
    .update(`${tenantId}:${normalizeMobile(value)}`)
    .digest("hex");
}
