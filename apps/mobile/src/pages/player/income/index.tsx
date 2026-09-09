import { Text, View } from "@tarojs/components";
import { useLoad } from "@tarojs/taro";
import { useState } from "react";
import { identityAdapter } from "@platform-identity";
import { session } from "@platform-session";
import { tenantLocator } from "@platform-locator";
import { apiAdapter } from "@platform-api";
import { formatFenYuan } from "../../../features/money/money";
import {
  PlayerLoginCard,
  PlayerMessage,
  PlayerPage,
} from "../../../components/player-ui";
import "./index.css";

interface IncomeRecord {
  id: string;
  source: "LEGACY" | "SLOT";
  amountFen: string;
  status: string;
  orderNo: string;
  createdAt: string;
}
interface IncomeView {
  pendingFen: string;
  settledFen: string;
  records: IncomeRecord[];
}

const STATUS_TEXT: Record<string, string> = {
  PENDING: "待确认",
  SETTLED: "待商家打款",
  BATCHED: "结算中",
  PAID: "已打款",
};

export default function PlayerIncomePage() {
  const [token, setToken] = useState<string | null>(session.getToken());
  const [tenantCode, setTenantCode] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [income, setIncome] = useState<IncomeView | null>(null);

  const load = async (accessToken: string) => {
    try {
      setIncome(
        await apiAdapter.request<IncomeView>("/api/v1/tenant/player/income", {
          token: accessToken,
        }),
      );
    } catch (error) {
      setMsg(error instanceof Error ? error.message : String(error));
      session.clearToken();
      setToken(null);
    }
  };

  useLoad(async () => {
    const accessToken = session.getToken();
    setToken(accessToken);
    if (accessToken) await load(accessToken);
    const info = await tenantLocator.resolveTenant();
    if (info.state === "ok" && info.tenant?.code)
      setTenantCode(info.tenant.code);
  });

  const login = async () => {
    setMsg(null);
    try {
      const input: {
        kind: "tenant";
        username: string;
        password: string;
        tenantCode?: string;
      } = { kind: "tenant", username, password };
      if (tenantCode) input.tenantCode = tenantCode;
      const loginSession = await identityAdapter.login(input);
      session.setToken(loginSession.accessToken);
      setToken(loginSession.accessToken);
      setPassword("");
      await load(loginSession.accessToken);
    } catch (error) {
      setMsg(error instanceof Error ? error.message : String(error));
    }
  };

  return (
    <PlayerPage
      title="我的收入"
      subtitle="应收、结算与打款记录"
      activeNav="income"
      badge={income ? <Text className="pw-badge">商家结算</Text> : undefined}
    >
      {!token ? (
        <PlayerLoginCard
          tenantCode={tenantCode}
          username={username}
          password={password}
          actionLabel="登录并查看收入"
          onTenantCode={setTenantCode}
          onUsername={setUsername}
          onPassword={setPassword}
          onLogin={() => void login()}
        />
      ) : null}
      {msg ? <PlayerMessage>{msg}</PlayerMessage> : null}
      {token && income ? (
        <>
          <View className="pw-stat-card">
            <Text className="pw-stat-label">待结算金额</Text>
            <Text className="pw-stat-value">
              {formatFenYuan(income.pendingFen)}
            </Text>
            <Text className="pw-stat-note">金额与状态以服务端核算结果为准</Text>
          </View>
          <View className="income-summary">
            <View className="income-summary-card">
              <Text className="pw-section-label">已结算</Text>
              <Text className="income-summary-value">
                {formatFenYuan(income.settledFen)}
              </Text>
            </View>
            <View className="income-summary-card">
              <Text className="pw-section-label">收入记录</Text>
              <Text className="income-summary-value">
                {income.records.length} 笔
              </Text>
            </View>
          </View>
          <View className="pw-card income-list">
            {income.records.length === 0 ? (
              <Text className="pw-empty">
                暂无收入记录。完成服务并核算后会显示在这里。
              </Text>
            ) : null}
            {income.records.map((record) => (
              <View
                key={`${record.source}-${record.id}`}
                className="income-row"
              >
                <View className="pw-row-copy">
                  <Text className="income-row-title">
                    订单 {record.orderNo} ·{" "}
                    {record.source === "SLOT" ? "档位收入" : "旧流程"}
                  </Text>
                  <Text className="pw-muted">
                    {new Date(record.createdAt).toLocaleString()}
                  </Text>
                  <Text
                    className={`pw-badge ${record.status === "PAID" ? "pw-badge-live" : "pw-badge-wait"}`}
                  >
                    {STATUS_TEXT[record.status] ?? record.status}
                  </Text>
                </View>
                <Text className="pw-price">
                  {formatFenYuan(record.amountFen)}
                </Text>
              </View>
            ))}
          </View>
        </>
      ) : null}
    </PlayerPage>
  );
}
