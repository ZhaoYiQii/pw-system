import { describe, expect, it } from "vitest";
import { escapeCsvCell, toUtf8BomCsv } from "./csv.js";

/**
 * DS-008：共享 CSV 编码的**纯口径**测试。
 *
 * 两层防护必须同时成立，且顺序固定（先公式防护、再做引号转义）：
 * 1. **公式注入**：Excel / LibreOffice 会跳过前导空白与控制符，再把 `=`/`+`/`-`/`@`
 *    开头的单元格当公式执行；这类单元格必须在**整个原值**前加 ASCII 单引号 `'`；
 * 2. **RFC 风格转义**：含逗号、双引号、回车或换行的单元格用双引号包裹，内部双引号翻倍。
 *
 * 除加前缀外不得改动原值：不 trim、不删字符、不做大小写转换。
 */

describe("escapeCsvCell：普通值原样输出", () => {
  it("中文、UUID、ISO 时间、金额文本、枚举值都不被改动", () => {
    for (const value of [
      "老王",
      "0f6b1c9e-6b1a-4f6f-9d3a-2f0a1b2c3d4e",
      "2026-09-24T12:00:00.000Z",
      "128.00",
      "0",
      "ORDER_ACCOUNTING",
    ]) {
      expect(escapeCsvCell(value)).toBe(value);
    }
  });

  it("空串保持空串（不输出 null / undefined 文本）", () => {
    expect(escapeCsvCell("")).toBe("");
  });

  it("非 ASCII 前导字符后的 = 不算公式（只认 ASCII 控制符与空白）", () => {
    expect(escapeCsvCell("订单=2026")).toBe("订单=2026");
    expect(escapeCsvCell("a=b")).toBe("a=b");
  });
});

describe("escapeCsvCell：RFC 风格转义", () => {
  it("含逗号 / 双引号 / 回车 / 换行时用双引号包裹", () => {
    expect(escapeCsvCell("老王, 大客户")).toBe('"老王, 大客户"');
    expect(escapeCsvCell('A"B')).toBe('"A""B"');
    expect(escapeCsvCell("第一行\r\n第二行")).toBe('"第一行\r\n第二行"');
    expect(escapeCsvCell("第一行\n第二行")).toBe('"第一行\n第二行"');
    expect(escapeCsvCell("第一行\r第二行")).toBe('"第一行\r第二行"');
  });

  it("内部双引号翻倍，且不 trim 原值", () => {
    expect(escapeCsvCell('a"b"c')).toBe('"a""b""c"');
    expect(escapeCsvCell(" 留白 ")).toBe(" 留白 ");
  });
});

describe("escapeCsvCell：公式注入防护", () => {
  it("以 = + - @ 开头的单元格前置 ASCII 单引号", () => {
    expect(escapeCsvCell("=1+1")).toBe("'=1+1");
    expect(escapeCsvCell("+cmd")).toBe("'+cmd");
    expect(escapeCsvCell("-2+3")).toBe("'-2+3");
    expect(escapeCsvCell("@SUM(A1)")).toBe("'@SUM(A1)");
    expect(escapeCsvCell("=cmd|'/c calc'!A0")).toBe("'=cmd|'/c calc'!A0");
  });

  it("任意前导 ASCII 控制符 / 空白之后出现危险前缀同样前置单引号", () => {
    expect(escapeCsvCell("  =1+1")).toBe("'  =1+1");
    expect(escapeCsvCell("\t@SUM(A1)")).toBe("'\t@SUM(A1)");
    // 控制符用 `String.fromCharCode` 构造：字面量 NUL 会让源文件变成二进制，diff/grep 全部失灵。
    const nulPrefix = String.fromCharCode(0);
    const delPrefix = String.fromCharCode(0x7f);
    expect(escapeCsvCell(nulPrefix + "-2+3")).toBe("'" + nulPrefix + "-2+3");
    expect(escapeCsvCell(delPrefix + "=1")).toBe("'" + delPrefix + "=1");
    expect(escapeCsvCell(" \t\r\n+1")).toBe('"\' \t\r\n+1"');
  });

  it("首字符是制表符 / 回车 / 换行时无条件前置单引号（即使后面不是危险前缀）", () => {
    expect(escapeCsvCell("\thello")).toBe("'\thello");
    expect(escapeCsvCell("\r\nplain")).toBe('"\'\r\nplain"');
    expect(escapeCsvCell("\nonly")).toBe('"\'\nonly"');
  });

  it("只有空白、没有有效字符的单元格不算公式", () => {
    expect(escapeCsvCell("   ")).toBe("   ");
  });

  it("防护在引号转义之前生效（危险前缀 + 逗号会同时被包裹）", () => {
    expect(escapeCsvCell("=1,2")).toBe('"\'=1,2"');
    expect(escapeCsvCell('=1"2')).toBe('"\'=1""2"');
  });
});

describe("toUtf8BomCsv", () => {
  it("只有一个 BOM，且位于文件最前", () => {
    const csv = toUtf8BomCsv([["a", "b"]]);
    expect(csv.startsWith("\uFEFF")).toBe(true);
    expect(csv.split("\uFEFF")).toHaveLength(2);
  });

  it("用 CRLF 连接列与行，末行后保留一个 CRLF", () => {
    const csv = toUtf8BomCsv([
      ["表头一", "表头二"],
      ["值1", "值2"],
    ]);
    expect(csv).toBe("\uFEFF表头一,表头二\r\n值1,值2\r\n");
    expect(csv.replaceAll("\r\n", "")).not.toContain("\n");
    expect(csv.slice(0, -2).endsWith("\r\n")).toBe(false);
  });

  it("对每个单元格应用同一套防护（表头与数据行一视同仁）", () => {
    const bom = String.fromCharCode(0xfeff);
    const csv = toUtf8BomCsv([
      ["=1+1", "普通"],
      ["@SUM(A1)", "老王, 大客户"],
    ]);
    expect(csv).toBe(bom + "'=1+1,普通\r\n'@SUM(A1),\"老王, 大客户\"\r\n");
  });

  it("没有任何行时只输出 BOM 与一个 CRLF", () => {
    expect(toUtf8BomCsv([])).toBe("\uFEFF\r\n");
  });
});
