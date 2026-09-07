import { Button, Input, Text, View } from "@tarojs/components";
import { useLoad } from "@tarojs/taro";
import { useState, type CSSProperties } from "react";
import { identityAdapter } from "@platform-identity";
import { session } from "@platform-session";
import { apiAdapter } from "@platform-api";

interface WalletView {
  bossNo: string;
  balanceFen: string;
  entries: Array<{
    txNo: string;
    type: string;
    amountFen: string;
    balanceAfterFen: string;
    reason: string | null;
    createdAt: string;
  }>;
}

export default function WalletPage() {
  const [token, setToken] = useState<string | null>(session.getToken());
  const [tenantCode, setTenantCode] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [amount, setAmount] = useState("100");
  const [wallet, setWallet] = useState<WalletView | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const load = async (t: string) => {
    try {
      const data = await apiAdapter.request<WalletView>("/api/v1/boss/wallet", {
        token: t,
      });
      setWallet(data);
    } catch (error) {
      setMsg(error instanceof Error ? error.message : String(error));
    }
  };

  useLoad(() => {
    const t = session.getToken();
    setToken(t);
    if (t) void load(t);
  });

  const login = async () => {
    try {
      const s = await identityAdapter.login({
        kind: "tenant",
        tenantCode,
        username,
        password,
      });
      session.setToken(s.accessToken);
      setToken(s.accessToken);
      await load(s.accessToken);
    } catch (error) {
      setMsg(error instanceof Error ? error.message : String(error));
    }
  };

  const recharge = async () => {
    if (!token) return;
    setMsg(null);
    try {
      const amountFen = String(Math.round(Number(amount) * 100));
      const data = await apiAdapter.request<WalletView>(
        "/api/v1/boss/wallet/recharge",
        { method: "POST", token, body: { amountFen } },
      );
      setWallet(data);
      setMsg("充值成功（本地模拟支付）。");
    } catch (error) {
      setMsg(error instanceof Error ? error.message : String(error));
    }
  };

  return (
    <View
      style={{ padding: 16, display: "flex", flexDirection: "column", gap: 12 }}
    >
      <Text style={{ fontSize: 20, fontWeight: "bold" }}>我的钱包</Text>
      {msg ? <Text style={{ color: "#dc2626" }}>{msg}</Text> : null}
      {!token ? (
        <>
          <Input
            style={inputStyle}
            value={tenantCode}
            placeholder="门店 code"
            onInput={(e) => setTenantCode(e.detail.value)}
          />
          <Input
            style={inputStyle}
            value={username}
            placeholder="老板账号"
            onInput={(e) => setUsername(e.detail.value)}
          />
          <Input
            style={inputStyle}
            password
            value={password}
            placeholder="密码"
            onInput={(e) => setPassword(e.detail.value)}
          />
          <Button onClick={() => void login()}>登录</Button>
        </>
      ) : (
        <>
          <Button size="mini" onClick={() => token && void load(token)}>
            刷新
          </Button>
          {wallet ? (
            <>
              <View style={cardStyle}>
                <Text>老板编号：{wallet.bossNo}</Text>
                <Text style={{ fontSize: 24, fontWeight: "bold" }}>
                  余额 ¥{(BigInt(wallet.balanceFen) / BigInt(100)).toString()}.
                  {String(BigInt(wallet.balanceFen) % BigInt(100)).padStart(
                    2,
                    "0",
                  )}
                </Text>
              </View>
              <View style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <Input
                  style={inputStyle}
                  type="number"
                  value={amount}
                  onInput={(e) => setAmount(e.detail.value)}
                />
                <Button size="mini" onClick={() => void recharge()}>
                  充值
                </Button>
              </View>
              {wallet.entries.slice(0, 5).map((entry) => (
                <View key={entry.txNo} style={cardStyle}>
                  <Text>
                    {entry.type === "RECHARGE" ? "充值" : "扣费"} ¥
                    {(BigInt(entry.amountFen) / BigInt(100)).toString()}.
                    {String(BigInt(entry.amountFen) % BigInt(100)).padStart(
                      2,
                      "0",
                    )}
                  </Text>
                  <Text style={{ color: "#6b7280", fontSize: 12 }}>
                    {entry.reason ?? entry.txNo}
                  </Text>
                </View>
              ))}
            </>
          ) : null}
        </>
      )}
    </View>
  );
}

const inputStyle: CSSProperties = {
  border: "1px solid #d1d5db",
  borderRadius: 8,
  padding: 8,
  height: 40,
};
const cardStyle: CSSProperties = {
  border: "1px solid #e5e7eb",
  borderRadius: 10,
  padding: 12,
  display: "flex",
  flexDirection: "column",
  gap: 4,
};
