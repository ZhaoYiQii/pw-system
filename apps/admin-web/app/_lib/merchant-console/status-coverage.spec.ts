/**
 * S-I：商家端控制台的状态文案映射必须覆盖 API 的状态枚举。
 *
 * 为什么不测「三端文案是否统一」：三端受众不同——客服看「报名选人」，老板看「正在选人」
 * 更自然——话术本来就该分叉。真问题是「新增状态忘了加映射」，那会让界面直接显示原始枚举
 * 或空白。这里以 `packages/database/prisma/schema.prisma` 的枚举为权威，
 * 断言每个值都有文案。
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { STATUS_TEXT } from "./merchant-api";

const here = path.dirname(fileURLToPath(import.meta.url));
const schemaPath = path.resolve(
  here,
  "../../../../../packages/database/prisma/schema.prisma",
);
const schema = readFileSync(schemaPath, "utf8");

/** 从 schema.prisma 里取枚举成员（忽略空行与 @@map 之类的块级属性）。 */
function enumMembers(name: string): string[] {
  const match = new RegExp(`enum ${name} \\{([^}]*)\\}`, "m").exec(schema);
  if (!match?.[1]) throw new Error(`schema.prisma 里找不到枚举 ${name}`);
  return match[1]
    .split("\n")
    .map((line) => line.trim())
    .filter(
      (line) =>
        line.length > 0 && !line.startsWith("//") && !line.startsWith("@@"),
    );
}

describe("状态文案映射完整性（S-I）", () => {
  it("schema 里的枚举确实被解析到了（防止正则失效后测试变成空转）", () => {
    expect(enumMembers("OrderStatus")).toContain("DISPATCHING");
    expect(enumMembers("SessionStatus")).toContain("ADJUSTMENT_PENDING");
  });

  it("OrderStatus 的每个值在控制台都有中文文案", () => {
    const missing = enumMembers("OrderStatus").filter(
      (value) => !(value in STATUS_TEXT),
    );
    expect(missing).toEqual([]);
  });

  it("SessionStatus 的每个值在控制台都有中文文案", () => {
    const missing = enumMembers("SessionStatus").filter(
      (value) => !(value in STATUS_TEXT),
    );
    expect(missing).toEqual([]);
  });
});
