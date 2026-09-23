import { Button, Input, Text, View } from "@tarojs/components";
import { useLoad } from "@tarojs/taro";
import { useState } from "react";
import { apiAdapter } from "@platform-api";
import { session } from "@platform-session";
import {
  CustomerLoginCard,
  CustomerMessage,
  CustomerShell,
} from "../../../components/customer-ui";
import { formatFenYuan } from "../../../features/money/money";
import {
  customerLogin,
  resolveTenantCode,
} from "../../../features/customer-ui/session";
import {
  currentPayReadiness,
  payWithWechat,
} from "../../../features/wechat-pay/pay-flow";
import { parseJsapiPayParams } from "../../../features/wechat-pay/wechat-pay";

interface WalletEntry {
  id: string;
  txNo: string;
  type: "RECHARGE" | "DEDUCT" | "REFUND";
  amountFen: string;
  balanceAfterFen: string;
  reason: string | null;
  createdAt: string;
}

interface WalletView {
  bossNo: string;
  balanceFen: string;
  entries: WalletEntry[];
}

/** 钱包流水文案：S4-4 起还有 REFUND（人工退款登记，金额仍为正、方向由类型决定）。 */
function walletTypeText(type: WalletEntry["type"]): string {
  if (type === "RECHARGE") return "充值";
  if (type === "REFUND") return "退款";
  return "扣费";
}

export default function WalletPage() {
  const [token, setToken] = useState<string | null>(session.getToken());
  const [tenantCode, setTenantCode] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [amount, setAmount] = useState("100");
  const [busy, setBusy] = useState(false);
  const [wallet, setWallet] = useState<WalletView | null>(null);
  const [msg, setMsg] = useState<{
    tone: "error" | "success" | "info";
    text: string;
  } | null>(null);

  const load = async (accessToken: string) => {
    setMsg(null);
    try {
      setWallet(
        await apiAdapter.request<WalletView>("/api/v1/boss/wallet", {
          token: accessToken,
        }),
      );
    } catch (error) {
      setMsg({
        tone: "error",
        text: error instanceof Error ? error.message : String(error),
      });
      session.clearToken();
      setToken(null);
    }
  };

  useLoad(async () => {
    const accessToken = session.getToken();
    setToken(accessToken);
    if (accessToken) await load(accessToken);
    const code = await resolveTenantCode();
    if (code) setTenantCode(code);
  });

  const login = async () => {
    if (!username.trim() || !password) {
      setMsg({ tone: "error", text: "请输入老板账号与密码" });
      return;
    }
    setBusy(true);
    setMsg(null);
    try {
      const accessToken = await customerLogin(tenantCode, username, password);
      setToken(accessToken);
      setPassword("");
      await load(accessToken);
    } catch (error) {
      setMsg({
        tone: "error",
        text: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setBusy(false);
    }
  };

  const recharge = async () => {
    if (!token) return;
    const amountFen = String(Math.round(Number(amount) * 100));
    if (!/^\d+$/.test(amountFen) || Number(amountFen) <= 0) {
      setMsg({ tone: "error", text: "请输入正确的充值金额" });
      return;
    }
    // ① 先判定环境：不在微信里直接提示、**不发请求**。
    // 之前把环境判定写在 catch 里是错的——它会把后端真实错误（404/503）盖成"请在微信里打开"。
    const readiness = currentPayReadiness({
      payEnabled: true,
      payerBound: true,
    });
    if (!readiness.ready) {
      setMsg({ tone: "error", text: readiness.message });
      return;
    }
    setBusy(true);
    setMsg(null);
    try {
      // S4-6a：真实微信支付（JSAPI）。后端用**门店子商户号**下单，所以先下单拿调起参数。
      const prepay = await apiAdapter.request<{
        outTradeNo: string;
        payParams: unknown;
      }>("/api/v1/payments/wechatpay/prepay", {
        method: "POST",
        token,
        body: { amountFen },
      });
      const params = parseJsapiPayParams(prepay.payParams);
      const outcome = await payWithWechat(params);
      if (outcome === "CANCELLED") {
        setMsg({ tone: "error", text: "已取消支付。" });
        return;
      }
      if (outcome === "FAILED") {
        setMsg({ tone: "error", text: "支付未完成，请重试。" });
        return;
      }
      // PAID：钱已付，但余额要等微信回调入账（S4-6b 结果页负责轮询）——这里刷新一次余额
      await load(token);
      setMsg({ tone: "success", text: "支付成功，余额已更新。" });
    } catch (error) {
      // 请求或调起失败：**原样透出**错误（404/500/409/503 都要看得见），不做任何美化掩盖
      setMsg({
        tone: "error",
        text: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <CustomerShell title="我的钱包" active="wallet">
      {!token ? (
        <CustomerLoginCard
          tenantCode={tenantCode}
          username={username}
          password={password}
          busy={busy}
          actionLabel="登录并查看钱包"
          onTenantCode={setTenantCode}
          onUsername={setUsername}
          onPassword={setPassword}
          onLogin={() => void login()}
        />
      ) : null}
      {msg ? (
        <CustomerMessage tone={msg.tone}>{msg.text}</CustomerMessage>
      ) : null}
      {token && !wallet && !busy ? (
        <View className="cu-loading">正在加载钱包…</View>
      ) : null}
      {token && wallet ? (
        <>
          <View className="cu-stat">
            <Text className="cu-stat-label">账户余额（{wallet.bossNo}）</Text>
            <Text className="cu-stat-value">
              {formatFenYuan(wallet.balanceFen)}
            </Text>
            <Text className="cu-stat-note">金额与流水以服务端核算结果为准</Text>
          </View>
          <View className="cu-card cu-recharge">
            <Input
              className="cu-input cu-grow"
              type="number"
              name="rechargeAmount"
              aria-label="充值金额"
              value={amount}
              onInput={(event) => setAmount(event.detail.value)}
            />
            <Button
              className="cu-button cu-button-dark cu-button-small"
              disabled={busy}
              onClick={() => void recharge()}
            >
              {busy ? "充值中…" : "充值"}
            </Button>
          </View>
          <Text className="cu-section-label">最近流水</Text>
          <View className="cu-card">
            {wallet.entries.length === 0 ? (
              <View className="cu-empty">暂无流水，充值后显示在这里。</View>
            ) : null}
            {wallet.entries.slice(0, 20).map((entry) => (
              <View className="cu-money-line" key={entry.id}>
                <View>
                  <Text>{walletTypeText(entry.type)}</Text>
                  {entry.reason ? (
                    <Text className="cu-meta">{entry.reason}</Text>
                  ) : null}
                </View>
                <Text className="cu-money-line-value">
                  {entry.type === "RECHARGE" ? "+" : "-"}
                  {formatFenYuan(entry.amountFen)}
                </Text>
              </View>
            ))}
          </View>
        </>
      ) : null}
    </CustomerShell>
  );
}
