// S4-6b：支付结果页。只做两件事：按 outTradeNo 轮询到账状态，把状态机的文案渲染出来。
import { Button, Text, View } from "@tarojs/components";
import Taro, { useLoad, useRouter } from "@tarojs/taro";
import { useState } from "react";
import { apiAdapter } from "@platform-api";
import { session } from "@platform-session";
import { CustomerShell } from "../../../components/customer-ui";
import { payResultView } from "../../../features/wechat-pay/pay-result";
import {
  nextPollAction,
  type PayOutcome,
} from "../../../features/wechat-pay/wechat-pay";

const MAX_ATTEMPTS = 10;
const INTERVAL_MS = 3000;

interface OrderStatus {
  status: string;
  amountFen: string;
  credited: boolean;
}

export default function PayResultPage() {
  const router = useRouter();
  const outTradeNo = String(router.params.outTradeNo ?? "");
  const outcomeParam = router.params.outcome;
  const outcome: PayOutcome | null =
    outcomeParam === "PAID" ||
    outcomeParam === "CANCELLED" ||
    outcomeParam === "FAILED"
      ? outcomeParam
      : null;

  const [credited, setCredited] = useState(false);
  const [attempts, setAttempts] = useState(0);
  const [amountFen, setAmountFen] = useState<string | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);

  useLoad(() => {
    const token = session.getToken();
    if (!token) {
      setError("请先登录后再查看支付结果");
      return;
    }
    if (!outTradeNo) {
      setError("缺少支付单号，无法查询结果");
      return;
    }
    let stopped = false;
    let round = 0;
    const tick = async () => {
      if (stopped) return;
      round += 1;
      try {
        const status = await apiAdapter.request<OrderStatus>(
          `/api/v1/payments/wechatpay/orders/${outTradeNo}`,
          { token },
        );
        if (stopped) return;
        setCredited(status.credited);
        setAmountFen(status.amountFen);
        setAttempts(round);
        const action = nextPollAction({
          outcome: outcome ?? "FAILED",
          credited: status.credited,
          attempts: round,
          maxAttempts: MAX_ATTEMPTS,
        });
        if (action === "KEEP_POLLING") setTimeout(tick, INTERVAL_MS);
      } catch (e) {
        if (stopped) return;
        setError(e instanceof Error ? e.message : String(e));
      }
    };
    void tick();
    return () => {
      stopped = true;
    };
  });

  const view = error
    ? {
        kind: "FAILED" as const,
        title: "查询支付结果失败",
        detail: error,
        showRetry: true,
        amountFen: null,
      }
    : payResultView({
        outcome,
        credited,
        attempts,
        maxAttempts: MAX_ATTEMPTS,
        ...(amountFen ? { amountFen } : {}),
      });

  return (
    <CustomerShell title="支付结果" active="wallet">
      <View className="cu-card">
        <Text className="cu-section-label">{view.title}</Text>
        <Text className="cu-meta">{view.detail}</Text>
        {view.amountFen ? (
          <Text className="cu-money-line-value">
            {`${(Number(view.amountFen) / 100).toFixed(2)} 元`}
          </Text>
        ) : null}
      </View>
      <View className="cu-card cu-recharge">
        <Button
          className="btn"
          onClick={() => {
            // 回到钱包页（成功就刷新余额；失败/超时让客户自己决定是否再试）
            Taro.navigateBack({ delta: 1 });
          }}
        >
          返回钱包
        </Button>
      </View>
    </CustomerShell>
  );
}
