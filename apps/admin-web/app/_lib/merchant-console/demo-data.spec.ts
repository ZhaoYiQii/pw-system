import { describe, expect, it } from "vitest";
import {
  INITIAL_DEMO_ORDERS,
  isTodo,
  orderNo,
  totalShortage,
} from "./demo-data";

describe("merchant demo order data", () => {
  it("formats demo order numbers with fixed prefix", () => {
    const order = INITIAL_DEMO_ORDERS[0];
    expect(order).toBeDefined();
    if (!order) return;
    expect(orderNo(order)).toBe("GD-0908-028");
    expect(orderNo({ ...order, id: "5" })).toBe("GD-0908-005");
  });

  it("treats todo statuses as actionable and completed as non-todo", () => {
    const draft = INITIAL_DEMO_ORDERS.find((order) => order.status === "DRAFT");
    const completed = INITIAL_DEMO_ORDERS.find(
      (order) => order.status === "COMPLETED",
    );
    expect(draft && isTodo(draft)).toBe(true);
    expect(completed && isTodo(completed)).toBe(false);
  });

  it("computes seat shortage including local picks", () => {
    const dispatch = INITIAL_DEMO_ORDERS.find(
      (order) => order.status === "DISPATCHING",
    );
    expect(dispatch).toBeDefined();
    if (!dispatch) return;
    expect(totalShortage(dispatch)).toBe(1);
    expect(totalShortage(dispatch, ["xiaoman"])).toBe(0);
  });
});
