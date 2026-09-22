import { describe, expect, it } from "vitest";
import { parseTradeBill, yuanToFen } from "./bill-parser.js";

/** 官方 ALL 账单表头（partner/4013080599）。 */
const ALL_HEADER =
  "`交易时间,`公众账号ID,`商户号,`特约商户号,`设备号,`微信订单号,`商户订单号,`用户标识,`交易类型,`交易状态," +
  "`付款银行,`货币种类,`应结订单金额,`代金券金额,`微信退款单号,`商户退款单号,`退款金额,`充值券退款金额,`退款类型," +
  "`退款状态,`商品名称,`商户数据包,`手续费,`费率,`订单金额,`申请退款金额,`费率备注";

const ALL_SUMMARY_HEADER =
  "`总交易单数,`应结订单总金额,`退款总金额,`充值券退款总金额,`手续费总金额,`订单总金额,`申请退款总金额";

function row(fields: {
  time?: string;
  transactionId?: string;
  outTradeNo: string;
  state: string;
  settle: string;
  refund?: string;
  fee?: string;
  total: string;
  refundId?: string;
}) {
  return [
    `\`${fields.time ?? "2026-09-22 10:00:00"}`,
    "`wxab8acb865bb11234",
    "`1900007291",
    "`1900007292",
    "`",
    `\`${fields.transactionId ?? ""}`,
    `\`${fields.outTradeNo}`,
    "`oUpF8uMuAJO_M2pxb1Q9zNjWeS6o",
    "`JSAPI",
    `\`${fields.state}`,
    "`OTHERS",
    "`CNY",
    `\`${fields.settle}`,
    "`0.00",
    `\`${fields.refundId ?? ""}`,
    "`",
    `\`${fields.refund ?? "0.00"}`,
    "`0.00",
    "`",
    "`",
    "`陪玩充值",
    "`",
    `\`${fields.fee ?? "0.05"}`,
    "`0.60%",
    `\`${fields.total}`,
    "`0.00",
    "`726",
  ].join(",");
}

function bill(rows: string[], summary: string): string {
  return [ALL_HEADER, ...rows, "", ALL_SUMMARY_HEADER, summary].join("\n");
}

describe("S4-3a：交易账单解析", () => {
  it("元→分：字符串精确换算（不走浮点），并拒绝非法金额", () => {
    expect(yuanToFen("8.88")).toBe(888n);
    expect(yuanToFen("9.76")).toBe(976n);
    expect(yuanToFen("123.45")).toBe(12345n);
    expect(yuanToFen("0.1")).toBe(10n);
    expect(yuanToFen("100")).toBe(10000n);
    expect(yuanToFen("0.00")).toBe(0n);
    // 浮点乘 100 会得到 888.0000000000001 / 97.6 这类值，这里必须是整数分
    expect(yuanToFen("88.8")).toBe(8880n);
    expect(() => yuanToFen("8.888")).toThrowError(/格式非法/);
    expect(() => yuanToFen("abc")).toThrowError(/格式非法/);
  });

  it("解析 ALL 账单明细：单号、状态、金额（订单/应结/退款/手续费）与汇总", () => {
    const text = bill(
      [
        row({
          outTradeNo: "WXA1",
          transactionId: "4200001111111111111111111111",
          state: "SUCCESS",
          settle: "8.88",
          total: "8.88",
        }),
        row({
          outTradeNo: "WXA2",
          transactionId: "4200002222222222222222222222",
          state: "SUCCESS",
          settle: "5.66",
          total: "5.66",
          fee: "0.05",
        }),
      ],
      "`2,`14.54,`0.00,`0.00,`0.10,`14.54,`0.00",
    );
    const parsed = parseTradeBill(text);
    expect(parsed.rows).toHaveLength(2);
    expect(parsed.rows[0]).toMatchObject({
      outTradeNo: "WXA1",
      transactionId: "4200001111111111111111111111",
      tradeState: "SUCCESS",
      totalAmountFen: 888n,
      settleAmountFen: 888n,
      refundAmountFen: 0n,
      feeFen: 5n,
      subMchid: "1900007292",
    });
    expect(parsed.summary).toEqual({
      totalCount: 2,
      settleTotalFen: 1454n,
      refundTotalFen: 0n,
      feeTotalFen: 10n,
      orderTotalFen: 1454n,
    });
  });

  it("兼容官方提到的旧版表头：没有「应结订单金额」时取「总金额」", () => {
    const oldHeader = ALL_HEADER.replace("`应结订单金额", "`总金额").replace(
      "`代金券金额",
      "`企业红包金额",
    );
    const text = [
      oldHeader,
      row({
        outTradeNo: "WXOLD",
        state: "SUCCESS",
        settle: "3.33",
        total: "3.33",
      }),
      "",
      ALL_SUMMARY_HEADER,
      "`1,`3.33,`0.00,`0.00,`0.02,`3.33,`0.00",
    ].join("\n");
    const parsed = parseTradeBill(text);
    expect(parsed.rows[0]!.settleAmountFen).toBe(333n);
  });

  it("UTF-8 BOM 与反引号前缀都能处理", () => {
    const text = `\uFEFF${bill([row({ outTradeNo: "WXBOM", state: "SUCCESS", settle: "1.00", total: "1.00" })], "`1,`1.00,`0.00,`0.00,`0.01,`1.00,`0.00")}`;
    const parsed = parseTradeBill(text);
    expect(parsed.rows[0]!.outTradeNo).toBe("WXBOM");
    expect(parsed.rows[0]!.settleAmountFen).toBe(100n);
  });

  it("空账单（只有表头 + 汇总 0）也是合法输入", () => {
    const parsed = parseTradeBill(
      bill([], "`0,`0.00,`0.00,`0.00,`0.00,`0.00,`0.00"),
    );
    expect(parsed.rows).toHaveLength(0);
    expect(parsed.summary.totalCount).toBe(0);
  });

  it("退款行：带微信退款单号与退款金额，订单金额为 0.00", () => {
    const text = bill(
      [
        row({
          outTradeNo: "WXREFUND",
          state: "REFUND",
          settle: "0.00",
          total: "0.00",
          refund: "6.66",
          refundId: "5030000000000000000000000001",
        }),
      ],
      "`1,`0.00,`6.66,`0.00,`0.04,`0.00,`6.66",
    );
    const parsed = parseTradeBill(text);
    expect(parsed.rows[0]).toMatchObject({
      tradeState: "REFUND",
      refundAmountFen: 666n,
      refundId: "5030000000000000000000000001",
    });
    expect(parsed.summary.refundTotalFen).toBe(666n);
  });

  it("格式异常必须**报错而不是静默跳过**：缺汇总行 / 表头不对 / 行内缺单号", () => {
    expect(() =>
      parseTradeBill(
        [
          ALL_HEADER,
          row({
            outTradeNo: "X",
            state: "SUCCESS",
            settle: "1.00",
            total: "1.00",
          }),
        ].join("\n"),
      ),
    ).toThrowError(/汇总行/);
    expect(() => parseTradeBill("`交易时间,`订单金额\n`1.00\n")).toThrowError(
      /表头不符合预期/,
    );
    const brokenLine = row({
      outTradeNo: "X",
      state: "SUCCESS",
      settle: "1.00",
      total: "1.00",
    }).replace("`X", "`");
    expect(() =>
      parseTradeBill(
        bill([brokenLine], "`1,`1.00,`0.00,`0.00,`0.01,`1.00,`0.00"),
      ),
    ).toThrowError(/缺少商户订单号/);
  });
});
