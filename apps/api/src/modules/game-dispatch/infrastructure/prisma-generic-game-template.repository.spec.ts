import { describe, expect, it } from "vitest";
import type { PrismaClient } from "@pw/database";
import { PrismaGenericGameTemplateRepository } from "./prisma-generic-game-template.repository.js";

/**
 * Prisma 7 走 driver adapter（PrismaPg）时，`$queryRaw` 失败被包成
 * `code = P2010` + `meta.driverAdapterError.cause`，真正的 Postgres 错误在上面。
 * 下面的形状是本地 Postgres 18 实测抓到的（见 40P01 死锁探针）。
 */
function prismaAdapterError(
  originalCode: string,
  kind: string,
  message: string,
): Error {
  return Object.assign(
    new Error(
      `Invalid \`prisma.$queryRaw()\` invocation: Raw query failed. Code: \`${originalCode}\`. Message: \`${message}\``,
    ),
    {
      name: "PrismaClientKnownRequestError",
      code: "P2010",
      meta: {
        driverAdapterError: {
          name: "DriverAdapterError",
          cause: { originalCode, originalMessage: message, kind },
        },
      },
    },
  );
}

function repositoryFailingWith(
  error: unknown,
): PrismaGenericGameTemplateRepository {
  const client = {
    $transaction: async () => {
      throw error;
    },
  } as unknown as PrismaClient;
  return new PrismaGenericGameTemplateRepository(client);
}

const setDefaultArgs: [string, string, string, { expectedRevision: number }] = [
  "tenant-1",
  "actor-1",
  "template-1",
  { expectedRevision: 3 },
];

describe("PrismaGenericGameTemplateRepository：并发写冲突映射", () => {
  it("Postgres 死锁（40P01）映射为 409 TEMPLATE_REVISION_CONFLICT", async () => {
    const repository = repositoryFailingWith(
      prismaAdapterError(
        "40P01",
        "TransactionWriteConflict",
        "deadlock detected",
      ),
    );

    await expect(
      repository.setDefault(...setDefaultArgs),
    ).rejects.toMatchObject({
      name: "GenericTemplateError",
      code: "TEMPLATE_REVISION_CONFLICT",
      status: 409,
    });
  });

  it("序列化失败（40001）同样映射为 409", async () => {
    const repository = repositoryFailingWith(
      prismaAdapterError(
        "40001",
        "TransactionWriteConflict",
        "could not serialize access due to concurrent update",
      ),
    );

    await expect(
      repository.setDefault(...setDefaultArgs),
    ).rejects.toMatchObject({
      name: "GenericTemplateError",
      code: "TEMPLATE_REVISION_CONFLICT",
      status: 409,
    });
  });

  it("唯一索引冲突（P2002）保持原有的 409 映射", async () => {
    const unique = Object.assign(new Error("Unique constraint failed"), {
      name: "PrismaClientKnownRequestError",
      code: "P2002",
    });
    const repository = repositoryFailingWith(unique);

    await expect(
      repository.setDefault(...setDefaultArgs),
    ).rejects.toMatchObject({
      code: "TEMPLATE_REVISION_CONFLICT",
      status: 409,
    });
  });

  it("非并发类数据库错误原样抛出，不被误判成 409", async () => {
    const repository = repositoryFailingWith(
      prismaAdapterError(
        "42P01",
        "TableDoesNotExist",
        `relation "games" does not exist`,
      ),
    );

    await expect(
      repository.setDefault(...setDefaultArgs),
    ).rejects.toMatchObject({
      code: "P2010",
    });
  });
});
it("driver adapter 标注的 TransactionWriteConflict 也按 409 处理", async () => {
  const repository = repositoryFailingWith(
    prismaAdapterError(
      "23505",
      "TransactionWriteConflict",
      "conflicting write",
    ),
  );

  await expect(repository.setDefault(...setDefaultArgs)).rejects.toMatchObject({
    code: "TEMPLATE_REVISION_CONFLICT",
    status: 409,
  });
});
