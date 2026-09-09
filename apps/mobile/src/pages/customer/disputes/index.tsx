import { Button, Text, View } from "@tarojs/components";
import { useLoad } from "@tarojs/taro";
import { useState } from "react";
import { apiAdapter } from "@platform-api";
import { session } from "@platform-session";
import {
  CustomerLoginCard,
  CustomerMessage,
  CustomerShell,
  goCustomer,
  StatusPill,
} from "../../../components/customer-ui";
import {
  customerLogin,
  resolveTenantCode,
} from "../../../features/customer-ui/session";

interface DisputeRow {
  id: string;
  orderNo: string;
  status: "OPEN" | "RESOLVED";
  reason: string;
  resolution: string | null;
  createdAt: string;
  updatedAt: string;
}

export default function CustomerDisputesPage() {
  const [token, setToken] = useState<string | null>(session.getToken());
  const [tenantCode, setTenantCode] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [rows, setRows] = useState<DisputeRow[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [msg, setMsg] = useState<{
    tone: "error" | "success" | "info";
    text: string;
  } | null>(null);

  const load = async (accessToken: string) => {
    setMsg(null);
    try {
      setRows(
        await apiAdapter.request<DisputeRow[]>(
          "/api/v1/tenant/customer/disputes",
          { token: accessToken },
        ),
      );
    } catch (error) {
      setMsg({
        tone: "error",
        text: error instanceof Error ? error.message : String(error),
      });
      session.clearToken();
      setToken(null);
    } finally {
      setLoaded(true);
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

  const openCount = rows.filter((row) => row.status === "OPEN").length;

  return (
    <CustomerShell
      title="我的争议"
      subtitle="查看反馈与门店处理进度"
      badge={
        token && loaded ? (
          <Text>{openCount ? `${openCount} 条处理中` : "暂无待处理"}</Text>
        ) : undefined
      }
      active="profile"
    >
      {!token ? (
        <CustomerLoginCard
          tenantCode={tenantCode}
          username={username}
          password={password}
          busy={busy}
          actionLabel="登录并查看争议"
          onTenantCode={setTenantCode}
          onUsername={setUsername}
          onPassword={setPassword}
          onLogin={() => void login()}
        />
      ) : null}
      {msg ? (
        <CustomerMessage tone={msg.tone}>{msg.text}</CustomerMessage>
      ) : null}
      {token && !loaded ? (
        <View className="cu-loading">正在加载争议…</View>
      ) : null}
      {token && loaded && rows.length === 0 ? (
        <View className="cu-empty">
          没有争议记录。争议需绑定具体订单，仅处理真实异常。
        </View>
      ) : null}
      {token
        ? rows.map((item) => (
            <View className="cu-card" key={item.id}>
              <View className="cu-row cu-row-first">
                <Text className="cu-card-title">订单 {item.orderNo}</Text>
                <StatusPill wait={item.status === "OPEN"}>
                  {item.status === "OPEN" ? "处理中" : "已处理"}
                </StatusPill>
              </View>
              <Text className="cu-meta">我的反馈：{item.reason}</Text>
              <Text className="cu-meta">
                处理结果：{item.resolution ?? "等待门店处理"}
              </Text>
              <Text className="cu-meta">
                更新于 {new Date(item.updatedAt).toLocaleString()}
              </Text>
            </View>
          ))
        : null}
      {token ? (
        <Button
          className="cu-button cu-button-primary cu-button-full"
          onClick={() => goCustomer("/pages/customer/dispute-create/index")}
        >
          发起新争议
        </Button>
      ) : null}
    </CustomerShell>
  );
}
