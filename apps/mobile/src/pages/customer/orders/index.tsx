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

interface BossOrder {
  id: string;
  orderNo: string;
  customerName: string;
  status: string;
  createdAt: string;
  updatedAt: string;
  scheduledStartAt: string | null;
  requirement: {
    description: string | null;
    durationSeconds: number | null;
    desiredStartAt: string | null;
  } | null;
}

const STATUS_TEXT: Record<string, string> = {
  DRAFT: "草稿",
  CONFIRMED: "已确认",
  DISPATCHING: "正在选人",
  ASSIGNED: "已选定陪玩",
  READY: "待开始",
  IN_PROGRESS: "服务中",
  PENDING_CONFIRMATION: "待确认",
  COMPLETED: "已完成",
  CANCELLED: "已取消",
};

function describe(order: BossOrder): string {
  const requirement = order.requirement?.description;
  return requirement && requirement.trim()
    ? requirement.trim()
    : `订单 ${order.orderNo}`;
}

function primaryAction(order: BossOrder): {
  label: string;
  path: string;
} | null {
  if (order.status === "DISPATCHING")
    return {
      label: "查看候选并选人",
      path: `/pages/customer/candidates/index?orderId=${order.id}`,
    };
  if (order.status === "PENDING_CONFIRMATION")
    return {
      label: "确认完成",
      path: `/pages/customer/order-detail/index?id=${order.id}`,
    };
  return {
    label: "查看详情",
    path: `/pages/customer/order-detail/index?id=${order.id}`,
  };
}

export default function CustomerOrdersPage() {
  const [token, setToken] = useState<string | null>(session.getToken());
  const [tenantCode, setTenantCode] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [filter, setFilter] = useState("ALL");
  const [orders, setOrders] = useState<BossOrder[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [msg, setMsg] = useState<{
    tone: "error" | "success" | "info";
    text: string;
  } | null>(null);

  const groups: Array<{ key: string; label: string }> = [
    { key: "ALL", label: "全部" },
    { key: "ACTIVE", label: "进行中" },
    { key: "WAIT", label: "待确认" },
    { key: "DONE", label: "已完成" },
  ];

  const visible = orders.filter((order) => {
    if (filter === "ALL") return true;
    if (filter === "ACTIVE")
      return [
        "CONFIRMED",
        "DISPATCHING",
        "ASSIGNED",
        "READY",
        "IN_PROGRESS",
      ].includes(order.status);
    if (filter === "WAIT") return order.status === "PENDING_CONFIRMATION";
    return order.status === "COMPLETED";
  });

  const load = async (accessToken: string) => {
    setMsg(null);
    try {
      setOrders(
        await apiAdapter.request<BossOrder[]>(
          "/api/v1/tenant/customer/orders",
          {
            token: accessToken,
          },
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

  const refresh = () => {
    if (token) void load(token);
  };

  return (
    <CustomerShell title="我的订单" subtitle="订单与进度" active="home">
      {!token ? (
        <CustomerLoginCard
          tenantCode={tenantCode}
          username={username}
          password={password}
          busy={busy}
          actionLabel="登录并查看订单"
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
        <View className="cu-loading">正在加载订单…</View>
      ) : null}
      {token && loaded ? (
        <>
          <View className="cu-tabs">
            {groups.map((group) => (
              <Button
                key={group.key}
                className={`cu-tab${filter === group.key ? " is-active" : ""}`}
                onClick={() => setFilter(group.key)}
              >
                {group.label}
              </Button>
            ))}
          </View>
          <View className="cu-card" style={{ marginBottom: 20 }}>
            <View className="cu-row cu-row-first">
              <Text className="cu-meta">
                共 {orders.length} 笔订单；展示门店已确认的历史订单。
              </Text>
              <Button className="cu-button cu-button-small" onClick={refresh}>
                刷新
              </Button>
            </View>
          </View>
          {visible.length === 0 ? (
            <View className="cu-empty">当前筛选下没有订单。</View>
          ) : null}
          {visible.map((order) => {
            const action = primaryAction(order);
            return (
              <View className="cu-card" key={order.id}>
                <View className="cu-row cu-row-first">
                  <Text className="cu-card-title">{describe(order)}</Text>
                  <StatusPill wait={order.status === "PENDING_CONFIRMATION"}>
                    {STATUS_TEXT[order.status] ?? order.status}
                  </StatusPill>
                </View>
                <Text className="cu-meta">订单号 {order.orderNo}</Text>
                <Text className="cu-meta">
                  创建于 {new Date(order.createdAt).toLocaleString()}
                </Text>
                {order.scheduledStartAt ? (
                  <Text className="cu-meta">
                    计划开始 {new Date(order.scheduledStartAt).toLocaleString()}
                  </Text>
                ) : null}
                {action ? (
                  <Button
                    className="cu-button cu-button-outline cu-button-small cu-button-full"
                    onClick={() => goCustomer(action.path)}
                  >
                    {action.label}
                  </Button>
                ) : null}
              </View>
            );
          })}
        </>
      ) : null}
    </CustomerShell>
  );
}
