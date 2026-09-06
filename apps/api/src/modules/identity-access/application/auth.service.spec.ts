import { describe, expect, it } from "vitest";
import { hashPassword } from "../infrastructure/password.js";
import { TokenService } from "../infrastructure/tokens.js";

const SECRET = "test-secret-0123456789-0123456789-0123456789";

describe("password + token primitives", () => {
  it("scrypt hash roundtrip", async () => {
    const hash = await hashPassword("s3cret!");
    expect(hash.startsWith("scrypt:")).toBe(true);
    await expect(verifyWith("s3cret!", hash)).resolves.toBe(true);
    await expect(verifyWith("wrong", hash)).resolves.toBe(false);
  });
});

async function verifyWith(password: string, hash: string): Promise<boolean> {
  const { verifyPassword } = await import("../infrastructure/password.js");
  return verifyPassword(password, hash);
}

describe("TokenService", () => {
  const tokens = new TokenService(SECRET);
  const principal = {
    sub: "11111111-1111-4111-8111-111111111111",
    scope: "platform",
    role: "PLATFORM_SUPER_ADMIN",
    username: "admin"
  } as const;

  it("signs and verifies with matching audience", async () => {
    const token = await tokens.signAccess(principal);
    const verified = await tokens.verifyAccess(token, ["pw-platform"]);
    expect(verified.sub).toBe(principal.sub);
  });

  it("rejects token presented to wrong audience", async () => {
    const token = await tokens.signAccess(principal);
    await expect(tokens.verifyAccess(token, ["pw-tenant"])).rejects.toThrow();
  });

  it("rejects tampered token", async () => {
    const token = await tokens.signAccess(principal);
    const tampered = token.slice(0, -2) + (token.endsWith("aa") ? "bb" : "aa");
    await expect(tokens.verifyAccess(tampered, ["pw-platform"])).rejects.toThrow();
  });
});
