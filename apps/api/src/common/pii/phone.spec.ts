import { afterEach, describe, expect, it, vi } from "vitest";
import { decryptPhone, encryptPhone, tryDecryptPhone } from "./phone.js";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("phone PII codec", () => {
  it("同一号码加密不可预测但可解密；哈希稳定", () => {
    const a = encryptPhone("t1", "138 0013 8000");
    const b = encryptPhone("t1", "138-0013-8000");
    expect(a.mobileHash).toBe(b.mobileHash);
    expect(a.mobileEnc).not.toBe(b.mobileEnc);
    expect(decryptPhone(a.mobileEnc)).toBe("13800138000");
  });
});

describe("tryDecryptPhone：密钥漂移时按未绑定降级", () => {
  /** 主密钥优先取 PII_MASTER_KEY，压空才走 SESSION_SECRET 派生，测试里两者都要钉住。 */
  const stubSecret = (value: string) => {
    vi.stubEnv("PII_MASTER_KEY", "");
    vi.stubEnv("SESSION_SECRET", value);
  };

  it("密钥未变时正常解出明文", () => {
    stubSecret("secret-a-0123456789-0123456789-0123456789");
    const { mobileEnc } = encryptPhone("t1", "13800138000");
    expect(tryDecryptPhone(mobileEnc)).toBe("13800138000");
  });

  it("密钥换过之后的老数据返回 null，不再抛异常", () => {
    stubSecret("secret-a-0123456789-0123456789-0123456789");
    const { mobileEnc } = encryptPhone("t1", "13800138000");
    stubSecret("secret-b-0123456789-0123456789-0123456789");
    // 严格版保持抛错语义不变，容错版负责让列表活下来。
    expect(() => decryptPhone(mobileEnc)).toThrow();
    expect(tryDecryptPhone(mobileEnc)).toBeNull();
  });

  it("非法密文返回 null", () => {
    stubSecret("secret-a-0123456789-0123456789-0123456789");
    expect(tryDecryptPhone("not-a-ciphertext")).toBeNull();
  });
});
