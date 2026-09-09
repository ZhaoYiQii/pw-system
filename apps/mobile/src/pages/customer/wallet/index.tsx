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

interface WalletEntry {
  id: string;
  txNo: string;
  type: "RECHARGE" | "DEDUCT";
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
    setBusy(true);
    setMsg(null);
    try {
      const updated = await apiAdapter.request<WalletView>(
        "/api/v1/boss/wallet/recharge",
        { method: "POST", token, body: { amountFen } },
      );
      setWallet(updated);
      setMsg({ tone: "success", text: "充值成功（本地模拟支付）。" });
    } catch (error) {
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
                  <Text>{entry.type === "RECHARGE" ? "充值" : "扣费"}</Text>
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
