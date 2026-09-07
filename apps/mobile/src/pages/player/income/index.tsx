import { Button, Input, Text, View } from "@tarojs/components";
import Taro, { useLoad } from "@tarojs/taro";
import { useState, type CSSProperties } from "react";
import { identityAdapter } from "@platform-identity";
import { session } from "@platform-session";
import { tenantLocator } from "@platform-locator";
import { apiAdapter } from "@platform-api";
import { formatFenYuan } from "../../../features/money/money";

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
  PENDING: "服务完成待确认",
  SETTLED: "老板已结算，待商家打款",
  BATCHED: "结算批次中",
  PAID: "已打款",
};

export default function PlayerIncomePage() {
  const [token, setToken] = useState<string | null>(session.getToken());
  const [tenantCode, setTenantCode] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [income, setIncome] = useState<IncomeView | null>(null);

  const load = async (t: string) => {
    try {
      setIncome(
        await apiAdapter.request<IncomeView>("/api/v1/tenant/player/income", {
          token: t,
        }),
      );
    } catch (error) {
      setMsg(error instanceof Error ? error.message : String(error));
      session.clearToken();
      setToken(null);
    }
  };

  useLoad(async () => {
    const t = session.getToken();
    setToken(t);
    if (t) await load(t);
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
      const s = await identityAdapter.login(input);
      session.setToken(s.accessToken);
      setToken(s.accessToken);
      setPassword("");
      await load(s.accessToken);
    } catch (error) {
      setMsg(error instanceof Error ? error.message : String(error));
    }
  };

  return (
    <View style={styles.page}>
      <Text style={styles.title}>我的收入</Text>
      {token === null ? (
        <View style={styles.card}>
          <Text style={styles.label}>门店 code</Text>
          <Input
            style={styles.input}
            value={tenantCode}
            onInput={(e) => setTenantCode(e.detail.value)}
            placeholder="demo"
          />
          <Text style={styles.label}>账号（陪玩）</Text>
          <Input
            style={styles.input}
            value={username}
            onInput={(e) => setUsername(e.detail.value)}
            placeholder="player"
          />
          <Text style={styles.label}>密码</Text>
          <Input
            style={styles.input}
            password
            value={password}
            onInput={(e) => setPassword(e.detail.value)}
            placeholder="••••"
          />
          <Button style={styles.primaryBtn} onClick={() => void login()}>
            登录并查看收入
          </Button>
        </View>
      ) : null}
      {msg ? <Text style={styles.error}>{msg}</Text> : null}
      {token && income ? (
        <View style={styles.summaryRow}>
          <View style={{ ...styles.summaryCard, ...styles.pendingCard }}>
            <Text style={styles.summaryLabel}>待结算金额</Text>
            <Text style={styles.summaryAmount}>
              {formatFenYuan(income.pendingFen)}
            </Text>
          </View>
          <View style={{ ...styles.summaryCard, ...styles.settledCard }}>
            <Text style={styles.summaryLabel}>已结算金额</Text>
            <Text style={styles.summaryAmount}>
              {formatFenYuan(income.settledFen)}
            </Text>
          </View>
        </View>
      ) : null}
      {token && income ? (
        <View style={styles.list}>
          {income.records.length === 0 ? (
            <Text style={styles.empty}>暂无收入记录。</Text>
          ) : (
            income.records.map((r) => (
              <View key={`${r.source}-${r.id}`} style={styles.card}>
                <View style={styles.rowBetween}>
                  <Text style={styles.strong}>{formatFenYuan(r.amountFen)}</Text>
                  <Text style={styles.muted}>
                    {STATUS_TEXT[r.status] ?? r.status}
                  </Text>
                </View>
                <Text style={styles.muted}>
                  订单 {r.orderNo} · {r.source === "SLOT" ? "档位收入" : "旧流程"}
                </Text>
                <Text style={styles.muted}>
                  {new Date(r.createdAt).toLocaleString()}
                </Text>
              </View>
            ))
          )}
        </View>
      ) : null}
      <Button
        style={styles.secondaryBtn}
        onClick={() => void Taro.reLaunch({ url: "/pages/player/profile/index" })}
      >
        返回资料
      </Button>
    </View>
  );
}

const styles = {
  page: { padding: 16, display: "flex", flexDirection: "column", gap: 12 },
  title: { fontSize: 20, fontWeight: "bold" },
  card: {
    border: "1px solid #e5e7eb",
    borderRadius: 10,
    padding: 12,
    display: "flex",
    flexDirection: "column",
    gap: 4,
  },
  label: { color: "#6b7280", marginTop: 8 },
  input: {
    border: "1px solid #d1d5db",
    borderRadius: 8,
    padding: 8,
    height: 40,
  },
  primaryBtn: {
    background: "#2f54eb",
    color: "#fff",
    borderRadius: 8,
    marginTop: 12,
  },
  secondaryBtn: { borderRadius: 8, marginTop: 8 },
  error: { color: "#dc2626" },
  summaryRow: { display: "flex", gap: 12 },
  summaryCard: {
    flex: 1,
    borderRadius: 10,
    padding: 14,
    display: "flex",
    flexDirection: "column",
    gap: 4,
  },
  pendingCard: { border: "1px solid #fa8c16", background: "#fff7e6" },
  settledCard: { border: "1px solid #52c41a", background: "#f6ffed" },
  summaryLabel: { fontSize: 13, color: "#6b7280" },
  summaryAmount: { fontSize: 22, fontWeight: "bold" },
  list: { display: "flex", flexDirection: "column", gap: 8 },
  empty: { color: "#6b7280", textAlign: "center", padding: 20 },
  rowBetween: {
    display: "flex",
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  strong: { fontSize: 18, fontWeight: "bold" },
  muted: { color: "#6b7280", fontSize: 12 },
} satisfies Record<string, CSSProperties>;
