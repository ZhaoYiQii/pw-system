import { Button, Text, View } from "@tarojs/components";
import { useLoad, useRouter } from "@tarojs/taro";
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

interface OrderSummary {
  id: string;
  orderNo: string;
  status: string;
  customerName: string;
  createdAt: string;
  updatedAt: string;
  scheduledStartAt: string | null;
  requirement: {
    description: string | null;
    durationSeconds: number | null;
    desiredStartAt: string | null;
  } | null;
  snapshot: Array<{
    productName: string;
    lineTotalFen: string;
  }> | null;
  timeline: Array<{
    id: string;
    eventType: string;
    fromStatus: string | null;
    toStatus: string | null;
    occurredAt: string;
  }>;
}

interface GdApplication {
  id: string;
  playerId: string;
  playerName: string;
  positionLabel: string;
  status: string;
  createdAt: string;
}

interface GdLine {
  id: string;
  positionLabel: string;
  requiredCount: number;
  applications: GdApplication[];
}

interface GdView {
  orderId: string;
  dispatchOrderId: string;
  dispatchNo: string;
  status: string;
  templateName: string;
  formValues: Record<string, string>;
  durationMinutes: number;
  desiredStartAt: string | null;
  lines: GdLine[];
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

export default function CustomerOrderDetailPage() {
  const router = useRouter();
  const orderId = String(router.params.id ?? router.params.orderId ?? "");
  const [token, setToken] = useState<string | null>(session.getToken());
  const [tenantCode, setTenantCode] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [classic, setClassic] = useState<OrderSummary | null>(null);
  const [gd, setGd] = useState<GdView | null>(null);
  const [msg, setMsg] = useState<{
    tone: "error" | "success" | "info";
    text: string;
  } | null>(null);

  const load = async (accessToken: string) => {
    setMsg(null);
    setLoaded(false);
    setClassic(null);
    setGd(null);
    try {
      const list = await apiAdapter.request<OrderSummary[]>(
        "/api/v1/tenant/customer/orders",
        { token: accessToken },
      );
      const match = orderId
        ? list.find((order) => order.id === orderId)
        : undefined;
      if (match) {
        setClassic(match);
        return;
      }
    } catch (error) {
      setMsg({
        tone: "error",
        text: error instanceof Error ? error.message : String(error),
      });
      session.clearToken();
      setToken(null);
      setLoaded(true);
      return;
    }
    if (!orderId) {
      setLoaded(true);
      return;
    }
    try {
      setGd(
        await apiAdapter.request<GdView>(
          `/api/v1/tenant/game-dispatch/customer/orders/${orderId}/select`,
          { token: accessToken },
        ),
      );
    } catch (error) {
      setMsg({
        tone: "error",
        text: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setLoaded(true);
    }
  };

  useLoad(async () => {
    const accessToken = session.getToken();
    setToken(accessToken);
    if (accessToken && orderId) await load(accessToken);
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
      if (orderId) await load(accessToken);
    } catch (error) {
      setMsg({
        tone: "error",
        text: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setBusy(false);
    }
  };

  const confirmClassic = async () => {
    if (!token || !classic) return;
    setBusy(true);
    setMsg(null);
    try {
      await apiAdapter.request(
        `/api/v1/tenant/customer/orders/${classic.id}/complete`,
        { method: "POST", token },
      );
      setMsg({ tone: "success", text: "已确认完成，费用核算进行中。" });
      await load(token);
    } catch (error) {
      setMsg({
        tone: "error",
        text: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setBusy(false);
    }
  };

  const status = classic?.status ?? gd?.status;

  /** 快照合计（整数分 BigInt 求和 → 元文本），不经浮点；无快照返回 null。 */
  const amountText = (() => {
    const lines = classic?.snapshot ?? [];
    if (lines.length === 0) return null;
    let total = BigInt(0);
    for (const line of lines) {
      try {
        total += BigInt(line.lineTotalFen);
      } catch {
        return null;
      }
    }
    const yuan = total / BigInt(100);
    const fen = total % BigInt(100);
    return `${yuan}.${fen.toString().padStart(2, "0")}`;
  })();

  /**
   * 进度时间线（灵析重设计 Slice C）：按真实状态机推导节点。
   * 已发生 = timeline 里出现过的 toStatus；当前 = 订单 status。
   */
  const trackNodes = (() => {
    const doneStatuses = new Set(
      (classic?.timeline ?? []).map((event) => event.toStatus),
    );
    const orderStatus = classic?.status ?? gd?.status ?? null;
    const nodes: Array<{
      key: string;
      title: string;
      desc: string;
      state: "done" | "cur" | "todo";
    }> = [
      {
        key: "CREATED",
        title: "下单成功",
        desc: classic
          ? `创建于 ${new Date(classic.createdAt).toLocaleString()}`
          : "等待门店确认",
        state: "todo",
      },
      {
        key: "DISPATCHING",
        title: "选人 / 派单",
        desc: "门店与老板确认陪玩人选",
        state: "todo",
      },
      {
        key: "IN_PROGRESS",
        title: "服务进行中",
        desc: "陪玩服务过程有截图存证",
        state: "todo",
      },
      {
        key: "PENDING_CONFIRMATION",
        title: "服务结束 · 你来确认",
        desc: "确认后费用核算给陪玩",
        state: "todo",
      },
      {
        key: "COMPLETED",
        title: "已完成",
        desc: "可在钱包查看消费明细",
        state: "todo",
      },
    ];
    if (orderStatus === "CANCELLED") {
      return [
        {
          key: "CANCELLED",
          title: "订单已取消",
          desc: "如有疑问请联系门店或发起争议",
          state: "cur",
        },
      ];
    }
    const currentIndex = nodes.findIndex((node) => {
      if (node.key === "DISPATCHING") {
        return (
          orderStatus === "DISPATCHING" ||
          orderStatus === "ASSIGNED" ||
          orderStatus === "READY"
        );
      }
      return node.key === orderStatus;
    });
    return nodes.map((node, index) => ({
      ...node,
      desc:
        node.key === "DISPATCHING" && doneStatuses.has("DISPATCHING")
          ? `${node.desc} · 已完成`
          : node.desc,
      state:
        index < currentIndex
          ? "done"
          : index === currentIndex
            ? "cur"
            : "todo",
    }));
  })();
  const subtitle = classic?.orderNo ?? gd?.dispatchNo ?? "订单详情";

  return (
    <CustomerShell title="订单详情" subtitle={subtitle} active="home">
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
        <View className="cu-loading">正在加载订单详情…</View>
      ) : null}
      {token && loaded && !classic && !gd ? (
        <View className="cu-empty">
          未找到该订单，或当前账号无权查看。请从我的订单进入。
          <Button
            className="cu-button cu-button-outline cu-button-small cu-button-full"
            style={{ marginTop: 24 }}
            onClick={() => goCustomer("/pages/customer/orders/index")}
          >
            返回我的订单
          </Button>
        </View>
      ) : null}
      {status ? (
        <View className="cu-card">
          <View className="cu-row cu-row-first">
            <Text className="cu-card-title">订单状态</Text>
            <StatusPill wait={status === "PENDING_CONFIRMATION"}>
              {STATUS_TEXT[status] ?? status}
            </StatusPill>
          </View>
          {classic?.requirement?.description ? (
            <Text className="cu-meta">
              需求：{classic.requirement.description}
            </Text>
          ) : null}
          {classic?.scheduledStartAt ? (
            <Text className="cu-meta">
              计划开始：{new Date(classic.scheduledStartAt).toLocaleString()}
            </Text>
          ) : null}
          {gd?.desiredStartAt ? (
            <Text className="cu-meta">
              期望开始：{new Date(gd.desiredStartAt).toLocaleString()}
            </Text>
          ) : null}
          {gd ? (
            <Text className="cu-meta">
              {gd.templateName || "游戏派单"} · {gd.durationMinutes} 分钟 ·{" "}
              {gd.lines.length} 个岗位
            </Text>
          ) : null}
        </View>
      ) : null}
      {classic?.status === "PENDING_CONFIRMATION" ? (
        <View className="cu-cta-stick">
          <Button
            className="cu-button cu-button-green cu-button-full"
            disabled={busy}
            onClick={() => void confirmClassic()}
          >
            {busy ? "确认中…" : "服务结束 · 确认完成"}
          </Button>
          <Text className="cu-cta-fine">
            确认后按下单快照核算给陪玩；有异议请先发起争议。
          </Text>
        </View>
      ) : null}
      {gd?.status === "PENDING_CONFIRMATION" ? (
        <View className="cu-card">
          <Text className="cu-meta">
            全部场次已结束，门店完成费用核算与钱包扣费后订单将变为已完成。
            请留意钱包余额是否充足。
          </Text>
        </View>
      ) : null}
      {amountText ? (
        <View className="cu-card">
          <View className="cu-row cu-row-first">
            <Text className="cu-card-title">订单金额</Text>
            <Text className="cu-order-amount">¥{amountText}</Text>
          </View>
          <Text className="cu-meta">
            按下单快照合计；确认完成后核算给陪玩（门店抽成另计）。
          </Text>
        </View>
      ) : null}
      {trackNodes.length > 0 ? (
        <View className="cu-track">
          {trackNodes.map((node) => (
            <View className="cu-track-line" key={node.key}>
              <View className="cu-track-node">
                <View
                  className={`cu-track-dot ${node.state === "done" ? "done" : node.state === "cur" ? "cur" : ""}`}
                />
                <View
                  className={`cu-track-vline${node.state === "done" ? " done" : ""}`}
                />
              </View>
              <View
                className={`cu-track-body${node.state === "todo" ? " is-dim" : ""}`}
              >
                <Text className="cu-track-tt">{node.title}</Text>
                <Text className="cu-track-td">{node.desc}</Text>
              </View>
            </View>
          ))}
        </View>
      ) : null}      {gd && status === "DISPATCHING" ? (
        <Button
          className="cu-button cu-button-primary cu-button-full"
          onClick={() =>
            goCustomer(
              `/pages/customer/game-select/index?orderId=${gd.orderId}`,
            )
          }
        >
          去选陪玩
        </Button>
      ) : null}
      {classic && status === "DISPATCHING" ? (
        <Button
          className="cu-button cu-button-primary cu-button-full"
          onClick={() =>
            goCustomer(`/pages/customer/candidates/index?orderId=${classic.id}`)
          }
        >
          查看候选并选人
        </Button>
      ) : null}
    </CustomerShell>
  );
}
