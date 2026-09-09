import { Button, Text, View } from "@tarojs/components";
import { useLoad, useRouter } from "@tarojs/taro";
import { useState } from "react";
import { identityAdapter } from "@platform-identity";
import { session } from "@platform-session";
import { tenantLocator } from "@platform-locator";
import { apiAdapter } from "@platform-api";
import { mediaAdapter } from "@platform-media";
import { formatFenYuan } from "../../../features/money/money";
import {
  PlayerLoginCard,
  PlayerMessage,
  PlayerPage,
} from "../../../components/player-ui";
import "./index.css";

interface HallItem {
  id: string;
  orderNo: string;
  productName: string;
  durationSeconds: number;
  unitPriceFen: string;
  desiredStartAt: string | null;
}
interface MyApp {
  id: string;
  orderId: string;
  status: string;
  createdAt: string;
}
interface SessionView {
  id: string;
  status: string;
  startedAt: string | null;
  endedAt: string | null;
  durationSeconds: number | null;
}
type HallView = "hall" | "service" | "applications";

const APPLICATION_STATUS: Record<string, string> = {
  APPLIED: "报名待选",
  SELECTED: "已被选",
  EXPIRED: "已结束",
  WITHDRAWN: "已撤销",
};

function formatDateTime(value: string | null): string {
  return value ? new Date(value).toLocaleString() : "时间待确认";
}

export default function OrderHallPage() {
  const router = useRouter();
  const initialView = router.params.view;
  const [view, setView] = useState<HallView>(
    initialView === "service" || initialView === "applications"
      ? initialView
      : "hall",
  );
  const [token, setToken] = useState<string | null>(session.getToken());
  const [tenantCode, setTenantCode] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [hall, setHall] = useState<HallItem[]>([]);
  const [mine, setMine] = useState<MyApp[]>([]);
  const [sessions, setSessions] = useState<Record<string, SessionView>>({});
  const [hallEnabled, setHallEnabled] = useState(true);

  const loadFeatureGate = async (accessToken: string) => {
    try {
      const features = await apiAdapter.request<
        Array<{ featureKey: string; enabled: boolean }>
      >("/api/v1/tenant/features", { token: accessToken });
      const enabled = features.find(
        (feature) => feature.featureKey === "addon.player_order_hall",
      )?.enabled;
      setHallEnabled(enabled !== false);
      if (enabled === false)
        setMsg("该门店未开通陪玩接单大厅，请联系门店开通。");
    } catch {
      setHallEnabled(true);
    }
  };

  const load = async (accessToken: string) => {
    try {
      const availableOrders = await apiAdapter.request<HallItem[]>(
        "/api/v1/tenant/player/order-hall",
        { token: accessToken },
      );
      const applications = await apiAdapter.request<MyApp[]>(
        "/api/v1/tenant/player/applications",
        { token: accessToken },
      );
      setHall(availableOrders);
      setMine(applications);
      const next: Record<string, SessionView> = {};
      for (const application of applications) {
        if (application.status !== "SELECTED") continue;
        try {
          const sessionView = await apiAdapter.request<SessionView | null>(
            `/api/v1/tenant/orders/${application.orderId}/session`,
            { token: accessToken },
          );
          next[application.orderId] = sessionView ?? {
            id: "",
            status: "NOT_STARTED",
            startedAt: null,
            endedAt: null,
            durationSeconds: null,
          };
        } catch {
          next[application.orderId] = {
            id: "",
            status: "NOT_STARTED",
            startedAt: null,
            endedAt: null,
            durationSeconds: null,
          };
        }
      }
      setSessions(next);
    } catch (error) {
      setMsg(error instanceof Error ? error.message : String(error));
      if (session.getToken()) {
        session.clearToken();
        setToken(null);
      }
    }
  };

  useLoad(async () => {
    const accessToken = session.getToken();
    setToken(accessToken);
    if (accessToken) {
      await load(accessToken);
      await loadFeatureGate(accessToken);
    }
    const info = await tenantLocator.resolveTenant();
    if (info.state === "ok" && info.tenant?.code)
      setTenantCode(info.tenant.code);
  });

  const login = async () => {
    setBusy(true);
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
      await loadFeatureGate(loginSession.accessToken);
    } catch (error) {
      setMsg(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  const apply = async (orderId: string) => {
    if (!token) return;
    setBusy(true);
    setMsg(null);
    try {
      await apiAdapter.request(
        `/api/v1/tenant/player/orders/${orderId}/applications`,
        { method: "POST", token, body: {} },
      );
      setMsg("报名成功，门店选中后会出现在服务列表中。");
      await load(token);
    } catch (error) {
      setMsg(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  const toggleSession = async (orderId: string) => {
    if (!token) return;
    const sessionView = sessions[orderId];
    if (!sessionView) return;
    setBusy(true);
    setMsg(null);
    try {
      const action = sessionView.status === "STARTED" ? "end" : "start";
      const captureProof = async (sessionId: string) => {
        const evidence = await mediaAdapter.chooseEvidence({ capture: true });
        await apiAdapter.uploadBytes(
          `/api/v1/tenant/sessions/${sessionId}/capture`,
          token,
          evidence.name,
          evidence.bytes,
        );
      };
      if (action === "start") {
        const started = await apiAdapter.request<{ id: string }>(
          `/api/v1/tenant/orders/${orderId}/session/start`,
          { method: "POST", token },
        );
        await captureProof(started.id);
      } else {
        await captureProof(sessionView.id);
        await apiAdapter.request(
          `/api/v1/tenant/orders/${orderId}/session/end`,
          { method: "POST", token },
        );
      }
      setMsg(
        action === "start"
          ? "场次已开始，开始证据已保存。"
          : "场次已结束，结束证据已保存。",
      );
      await load(token);
    } catch (error) {
      setMsg(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  const uploadEvidence = async (
    sessionId: string,
    mode: "upload" | "capture",
  ) => {
    if (!token) return;
    setBusy(true);
    setMsg(null);
    try {
      const evidence = await mediaAdapter.chooseEvidence({
        capture: mode === "capture",
      });
      await apiAdapter.uploadBytes(
        `/api/v1/tenant/sessions/${sessionId}/${mode}`,
        token,
        evidence.name,
        evidence.bytes,
      );
      setMsg(mode === "capture" ? "已拍摄并保存证据。" : "证据已上传。");
    } catch (error) {
      setMsg(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  const selectedApplications = mine.filter(
    (application) => application.status === "SELECTED",
  );
  const runningCount = selectedApplications.filter(
    (application) => sessions[application.orderId]?.status === "STARTED",
  ).length;
  const pageTitle =
    view === "hall" ? "接单大厅" : view === "service" ? "服务中" : "我的接单";
  const subtitle =
    view === "hall"
      ? `当前有 ${hall.length} 单可报名`
      : view === "service"
        ? "开始、结束与证据均以服务端为准"
        : `${mine.length} 条报名记录`;

  return (
    <PlayerPage
      title={pageTitle}
      subtitle={subtitle}
      activeNav={view === "hall" ? "orders" : "service"}
      badge={
        token ? (
          <Text
            className={`pw-badge ${view === "service" && runningCount > 0 ? "pw-badge-live" : ""}`}
          >
            {view === "service"
              ? `${runningCount} 进行中`
              : hallEnabled
                ? "可接单"
                : "未开通"}
          </Text>
        ) : undefined
      }
    >
      {!token ? (
        <PlayerLoginCard
          tenantCode={tenantCode}
          username={username}
          password={password}
          busy={busy}
          actionLabel="登录并查看可接订单"
          onTenantCode={setTenantCode}
          onUsername={setUsername}
          onPassword={setPassword}
          onLogin={() => void login()}
        />
      ) : (
        <View className="pw-tabs">
          {(["hall", "service", "applications"] as const).map((key) => (
            <Button
              key={key}
              className={`pw-tab ${view === key ? "is-active" : ""}`}
              onClick={() => setView(key)}
            >
              {key === "hall"
                ? "大厅"
                : key === "service"
                  ? "服务"
                  : "我的接单"}
            </Button>
          ))}
        </View>
      )}

      {msg ? (
        <PlayerMessage
          tone={
            msg.startsWith("报名成功") ||
            msg.startsWith("场次已") ||
            msg.startsWith("已拍摄") ||
            msg.startsWith("证据已")
              ? "success"
              : "error"
          }
        >
          {msg}
        </PlayerMessage>
      ) : null}

      {token && view === "hall" ? (
        <>
          <View className="pw-stat-card">
            <Text className="pw-stat-label">今日大厅</Text>
            <Text className="pw-stat-value">{hall.length} 单可接</Text>
            <Text className="pw-stat-note">
              订单可见性与报名权限由门店配置决定
            </Text>
          </View>
          {hall.length === 0 ? (
            <Text className="pw-empty">暂无可接订单，请稍后再来查看。</Text>
          ) : null}
          {hall.map((order) => (
            <View key={order.id} className="pw-card hall-order-card">
              <Text className="pw-card-title">{order.productName}</Text>
              <View className="hall-order-meta">
                <Text className="pw-muted">
                  单号 {order.orderNo} ·{" "}
                  {Math.floor(order.durationSeconds / 60)} 分钟
                </Text>
                <Text className="pw-muted">
                  期望开始：{formatDateTime(order.desiredStartAt)}
                </Text>
              </View>
              <View className="pw-row-between">
                <Text className="pw-price">
                  {formatFenYuan(order.unitPriceFen)}
                </Text>
                {hallEnabled ? (
                  <Button
                    className="pw-button pw-button-small pw-button-soft"
                    disabled={busy}
                    onClick={() => void apply(order.id)}
                  >
                    报名
                  </Button>
                ) : null}
              </View>
            </View>
          ))}
        </>
      ) : null}

      {token && view === "service" ? (
        <>
          {selectedApplications.length === 0 ? (
            <Text className="pw-empty">
              暂无待服务或进行中的场次。被选中后会显示在这里。
            </Text>
          ) : null}
          {selectedApplications.map((application) => {
            const sessionView = sessions[application.orderId];
            const running = sessionView?.status === "STARTED";
            return (
              <View
                key={application.id}
                className={`pw-card hall-session-card ${running ? "is-running" : ""}`}
              >
                <View className="pw-row-between">
                  <View className="pw-row-copy">
                    <Text className="pw-card-title">
                      订单 {application.orderId.slice(0, 8)}…
                    </Text>
                    <Text className="pw-muted">
                      {running
                        ? `开始时间 ${formatDateTime(sessionView.startedAt)}`
                        : "等待开始服务"}
                    </Text>
                  </View>
                  <Text
                    className={`pw-badge ${running ? "pw-badge-live" : "pw-badge-wait"}`}
                  >
                    {running ? "进行中" : "待开始"}
                  </Text>
                </View>
                {running && sessionView.durationSeconds !== null ? (
                  <Text className="pw-stat-value">
                    {Math.floor(sessionView.durationSeconds / 60)} 分钟
                  </Text>
                ) : null}
                <View className="hall-session-actions">
                  {running && sessionView.id ? (
                    <>
                      <Button
                        className="pw-button pw-button-small pw-button-plain"
                        disabled={busy}
                        onClick={() =>
                          void uploadEvidence(sessionView.id, "upload")
                        }
                      >
                        上传证据
                      </Button>
                      <Button
                        className="pw-button pw-button-small pw-button-plain"
                        disabled={busy}
                        onClick={() =>
                          void uploadEvidence(sessionView.id, "capture")
                        }
                      >
                        拍照/录像
                      </Button>
                    </>
                  ) : null}
                  <Button
                    className={`pw-button ${running ? "pw-button-plain" : "pw-button-primary"}`}
                    disabled={busy || !sessionView}
                    onClick={() => void toggleSession(application.orderId)}
                  >
                    {running
                      ? "结束服务（先拍照/录像）"
                      : "开始服务（拍照留证）"}
                  </Button>
                </View>
              </View>
            );
          })}
        </>
      ) : null}

      {token && view === "applications" ? (
        <View className="pw-stack">
          {mine.length === 0 ? (
            <Text className="pw-empty">暂无报名记录。</Text>
          ) : null}
          {mine.map((application) => (
            <View key={application.id} className="pw-card">
              <View className="pw-row-between">
                <View className="pw-row-copy">
                  <Text className="pw-card-title">
                    订单 {application.orderId.slice(0, 8)}…
                  </Text>
                  <Text className="pw-muted">
                    报名于 {formatDateTime(application.createdAt)}
                  </Text>
                </View>
                <Text
                  className={`pw-badge ${application.status === "SELECTED" ? "pw-badge-live" : "pw-badge-wait"}`}
                >
                  {APPLICATION_STATUS[application.status] ?? application.status}
                </Text>
              </View>
              {application.status === "SELECTED" ? (
                <Button
                  className="pw-button pw-button-small pw-button-dark"
                  onClick={() => setView("service")}
                >
                  查看场次
                </Button>
              ) : null}
            </View>
          ))}
        </View>
      ) : null}
    </PlayerPage>
  );
}
