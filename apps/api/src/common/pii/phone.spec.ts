import { describe, expect, it } from "vitest";
import { decryptPhone, encryptPhone } from "./phone.js";

describe("phone PII codec", () => {
  it("同一号码加密不可预测但可解密；哈希稳定", () => {
    const a = encryptPhone("t1", "138 0013 8000");
    const b = encryptPhone("t1", "138-0013-8000");
    expect(a.mobileHash).toBe(b.mobileHash);
    expect(a.mobileEnc).not.toBe(b.mobileEnc);
    expect(decryptPhone(a.mobileEnc)).toBe("13800138000");
  });
});
