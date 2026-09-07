import { Button, Input, Text, View } from "@tarojs/components";
import Taro, { useLoad } from "@tarojs/taro";
import { useState, type CSSProperties } from "react";
import { identityAdapter } from "@platform-identity";
import { session } from "@platform-session";
import { tenantLocator } from "@platform-locator";
import { apiAdapter } from "@platform-api";

interface DisputeRow {
  id: string;
  orderNo: string;
  status: "OPEN" | "RESOLVED";
  reason: string;
  resolution: string | null;
  createdAt: string;
  updatedAt: string;
}

export function DisputesPage({ role }: { role: "player" | "customer" }) {
  const [token, setToken] = useState<string | null>(session.getToken());
  const [tenantCode, setTenantCode] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [rows, setRows] = useState<DisputeRow[]>([]);

  const endpoint =
    role === "player"
      ? "/api/v1/tenant/player/disputes"
      : "/api/v1/tenant/customer/disputes";

  const load = async (t: string) => {
    try {
      setRows(await apiAdapter.request<DisputeRow[]>(endpoint, { token: t }));
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
      <Text style={styles.title}>我的争议</Text>
      {token === null ? (
        <View style={styles.card}>
          <Text style={styles.label}>门店 code</Text>
          <Input
            style={styles.input}
            value={tenantCode}
            onInput={(e) => setTenantCode(e.detail.value)}
            placeholder="demo"
          />
          <Text style={styles.label}>账号</Text>
          <Input
            style={styles.input}
            value={username}
            onInput={(e) => setUsername(e.detail.value)}
            placeholder={role === "player" ? "player" : "customer"}
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
            登录并查看争议
          </Button>
        </View>
      ) : null}
      {msg ? <Text style={styles.error}>{msg}</Text> : null}
      <View style={styles.list}>
        {rows.length === 0 ? (
          <Text style={styles.empty}>暂无争议记录。</Text>
        ) : (
          rows.map((d) => (
            <View key={d.id} style={styles.card}>
              <View style={styles.rowBetween}>
                <Text style={styles.strong}>订单 {d.orderNo}</Text>
                <Text
                  style={
                    d.status === "OPEN"
                      ? styles.openBadge
                      : styles.resolvedBadge
                  }
                >
                  {d.status === "OPEN" ? "处理中" : "已处理"}
                </Text>
              </View>
              <Text style={styles.muted}>反馈：{d.reason}</Text>
              <Text style={styles.muted}>
                处理结果：{d.resolution ?? "等待商家处理"}
              </Text>
              <Text style={styles.muted}>
                {new Date(d.updatedAt).toLocaleString()}
              </Text>
            </View>
          ))
        )}
      </View>
      <Button
        style={styles.secondaryBtn}
        onClick={() =>
          void Taro.reLaunch({
            url:
              role === "player"
                ? "/pages/player/profile/index"
                : "/pages/customer/candidates/index",
          })
        }
      >
        返回
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
  list: { display: "flex", flexDirection: "column", gap: 8 },
  empty: { color: "#6b7280", textAlign: "center", padding: 20 },
  rowBetween: {
    display: "flex",
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  strong: { fontWeight: "bold" },
  muted: { color: "#6b7280", fontSize: 12 },
  openBadge: { color: "#d46b08", fontWeight: "bold" },
  resolvedBadge: { color: "#389e0d", fontWeight: "bold" },
} satisfies Record<string, CSSProperties>;
