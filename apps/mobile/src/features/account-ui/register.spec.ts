/**
 * SP2 §9.1 末行：注册两段式的部分失败分支。
 *
 * 这里钉住的是产品口径：陪玩申请失败**不等于**注册失败——账号已经建好了，
 * 用户必须能拿到会话进老板端，并由页面提示「申请未提交，可重试」。
 */
import { describe, expect, it } from "vitest";
import {
  defaultDisplayName,
  registerBody,
  runRegistration,
  type RegisterInput,
  type RegisterPorts,
  type RegisterSession,
} from "./register";

const SESSION: RegisterSession = {
  accessToken: "token-abc",
  csrfToken: "csrf-xyz",
  username: "boss88",
};

function harness(options: { registerFails?: Error; applyFails?: Error } = {}) {
  const calls = {
    registerBodies: [] as Record<string, unknown>[],
    apply: [] as Array<{ token: string; intro: string }>,
  };
  const ports: RegisterPorts = {
    register: async (body) => {
      if (options.registerFails) throw options.registerFails;
      calls.registerBodies.push(body);
      return SESSION;
    },
    applyAsPlayer: async (token, intro) => {
      if (options.applyFails) throw options.applyFails;
      calls.apply.push({ token, intro });
    },
  };
  return { ports, calls };
}

function input(overrides: Partial<RegisterInput> = {}): RegisterInput {
  return {
    tenantCode: "demo-shop",
    username: "boss88",
    password: "register-pass-123",
    ...overrides,
  };
}

describe("SP2 注册两段式编排", () => {
  it("不勾选陪玩 → 第 2 段完全不调用，结果是 skipped", async () => {
    const { ports, calls } = harness();
    const outcome = await runRegistration(ports, input());
    expect(outcome.playerApplication).toBe("skipped");
    expect(outcome.session).toEqual(SESSION);
    expect(calls.apply).toHaveLength(0);
  });

  it("勾选陪玩且申请成功 → submitted，申请带上会话 token 与说明", async () => {
    const { ports, calls } = harness();
    const outcome = await runRegistration(
      ports,
      input({ asPlayer: true, playerIntro: " 王者荣耀 三年  " }),
    );
    expect(outcome.playerApplication).toBe("submitted");
    expect(calls.apply).toEqual([
      { token: SESSION.accessToken, intro: "王者荣耀 三年" },
    ]);
  });

  it("勾选陪玩但申请失败 → failed + 原始消息 + 不抛错，账号会话仍在返回值里", async () => {
    const { ports } = harness({ applyFails: new Error("申请说明太短") });
    const outcome = await runRegistration(
      ports,
      input({ asPlayer: true, playerIntro: "新手" }),
    );
    expect(outcome.playerApplication).toBe("failed");
    expect(outcome.playerError).toBe("申请说明太短");
    expect(outcome.session).toEqual(SESSION);
  });

  it("第 1 段失败 → 原样抛出，且不去提交陪玩申请", async () => {
    const { ports, calls } = harness({
      registerFails: new Error("该用户名已被使用"),
    });
    await expect(
      runRegistration(ports, input({ asPlayer: true, playerIntro: "王者" })),
    ).rejects.toThrow("该用户名已被使用");
    expect(calls.apply).toHaveLength(0);
  });

  it("defaultDisplayName 取用户名后四位", () => {
    expect(defaultDisplayName("boss88")).toBe("用户ss88");
  });

  it("registerBody 只带真正有值的字段，不产生 undefined 值", () => {
    const body = registerBody(input());
    expect(body).toEqual({
      tenantCode: "demo-shop",
      username: "boss88",
      password: "register-pass-123",
      displayName: "用户ss88",
    });
    expect(Object.values(body)).not.toContain(undefined);

    const withAll = registerBody(
      input({
        displayName: " 张老板 ",
        phone: "13900001111",
        code: "123456",
        asPlayer: true,
        playerIntro: "王者",
      }),
    );
    expect(withAll).toEqual({
      tenantCode: "demo-shop",
      username: "boss88",
      password: "register-pass-123",
      displayName: "张老板",
      phone: "13900001111",
      code: "123456",
    });
    // 陪玩意向属于第 2 段，不能混进注册请求体
    expect(withAll).not.toHaveProperty("asPlayer");
    expect(withAll).not.toHaveProperty("playerIntro");
    expect(Object.values(withAll)).not.toContain(undefined);
  });
});
