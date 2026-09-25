import { describe, expect, it } from "vitest";
import { FundAccountsService } from "./fund-accounts.service.js";
import {
  FundAccountDuplicateCodeError,
  FundAccountInputError,
} from "../domain/fund-account.js";
import type {
  FundAccountRecord,
  FundAccountRepositoryPort,
  NormalizedFundAccountInput,
} from "../domain/fund-account.js";

function record(overrides: Partial<FundAccountRecord> = {}): FundAccountRecord {
  return {
    id: "acc-1",
    tenantId: "tenant-real",
    code: "WECHAT_MAIN",
    name: "微信结算主账户",
    kind: "WECHAT_SETTLEMENT",
    status: "ACTIVE",
    externalRef: null,
    createdAt: new Date("2026-09-24T00:00:00.000Z"),
    ...overrides,
  };
}

interface FakeRepo extends FundAccountRepositoryPort {
  listTenants: string[];
  createCalls: Array<{ tenantId: string; input: NormalizedFundAccountInput }>;
}

function fakeRepo(overrides: Partial<FundAccountRepositoryPort> = {}): FakeRepo {
  const listTenants: string[] = [];
  const createCalls: Array<{ tenantId: string; input: NormalizedFundAccountInput }> = [];
  const base: FundAccountRepositoryPort = {
    list: async (tenantId: string): Promise<FundAccountRecord[]> => {
      listTenants.push(tenantId);
      return [record()];
    },
    create: async (
      tenantId: string,
      input: NormalizedFundAccountInput,
    ): Promise<FundAccountRecord> => {
      createCalls.push({ tenantId, input });
      return record({
        code: input.code,
        name: input.name,
        kind: input.kind,
        externalRef: input.externalRef,
      });
    },
  };
  return { ...base, ...overrides, listTenants, createCalls };
}

const VALID_BODY = {
  code: "wechat_main",
  name: "  微信结算主账户  ",
  kind: "WECHAT_SETTLEMENT",
};

describe("FundAccountsService（DS-002 应用层编排）", () => {
  it("create 只把服务端传入的 tenantId 交给仓储，忽略请求体里的 tenantId", async () => {
    const repo = fakeRepo();
    const service = new FundAccountsService(repo);

    await service.create("tenant-real", { ...VALID_BODY, tenantId: "attacker" });

    expect(repo.createCalls).toEqual([
      {
        tenantId: "tenant-real",
        input: {
          code: "WECHAT_MAIN",
          name: "微信结算主账户",
          kind: "WECHAT_SETTLEMENT",
          externalRef: null,
        },
      },
    ]);
  });

  it("list 只把服务端传入的 tenantId 交给仓储", async () => {
    const repo = fakeRepo();
    const service = new FundAccountsService(repo);

    await service.list("tenant-real");

    expect(repo.listTenants).toEqual(["tenant-real"]);
  });

  it("list 按仓储返回顺序映射为 view，createdAt 为 ISO 字符串", async () => {
    const repo = fakeRepo({
      list: async () => [
        record({ id: "acc-1", createdAt: new Date("2026-09-24T00:00:00.000Z") }),
        record({ id: "acc-2", createdAt: new Date("2026-09-25T00:00:00.000Z") }),
      ],
    });
    const service = new FundAccountsService(repo);

    const items = await service.list("tenant-real");

    expect(items.map((item) => item.id)).toEqual(["acc-1", "acc-2"]);
    expect(items.map((item) => item.createdAt)).toEqual([
      "2026-09-24T00:00:00.000Z",
      "2026-09-25T00:00:00.000Z",
    ]);
  });

  it("创建成功后返回 ISO 字符串时间，且不包含 tenantId", async () => {
    const service = new FundAccountsService(fakeRepo());

    const view = await service.create("tenant-real", VALID_BODY);

    expect(view.createdAt).toBe("2026-09-24T00:00:00.000Z");
    expect(new Date(view.createdAt).toISOString()).toBe(view.createdAt);
    expect(view).not.toHaveProperty("tenantId");
  });

  it("重复 code 的领域错误不被吞掉，原样抛出", async () => {
    const repo = fakeRepo({
      create: async () => {
        throw new FundAccountDuplicateCodeError("资金账户 code 已存在：WECHAT_MAIN");
      },
    });
    const service = new FundAccountsService(repo);

    await expect(service.create("tenant-real", VALID_BODY)).rejects.toBeInstanceOf(
      FundAccountDuplicateCodeError,
    );
    await expect(service.create("tenant-real", VALID_BODY)).rejects.toThrow("WECHAT_MAIN");
  });

  it("输入不合法时在调用仓储前就抛 FundAccountInputError", async () => {
    const repo = fakeRepo();
    const service = new FundAccountsService(repo);

    await expect(
      service.create("tenant-real", { code: "9BAD", name: "现金账户", kind: "CASH" }),
    ).rejects.toBeInstanceOf(FundAccountInputError);
    expect(repo.createCalls).toHaveLength(0);
  });
});
