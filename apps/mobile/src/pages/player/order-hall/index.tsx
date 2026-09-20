import { Button, Input, Text, View } from "@tarojs/components";
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
/** 算价模型 Task 3：陪玩端报单读路径（game-dispatch 主线）。 */
interface ReportSessionView {
  id: string;
  status: string;
  durationSeconds: number | null;
  declaredDurationMinutes: number | null;
  reportStatus: string;
  reportReviewNote: string | null;
  earningFen: string | null;
}
interface ServiceSlotView {
  orderSlotId: string;
  positionLabel: string;
  unitPriceFen: string;
  session: ReportSessionView | null;
}
interface ServiceSlotsView {
  orderId: string;
  slots: ServiceSlotView[];
}
/** 算价模型 Task 4：game-dispatch 报名大厅与我的报名（陪玩端报名/取消入口）。 */
interface GdHallLine {
  lineId: string;
  positionLabel: string;
  requiredCount: number;
  appliedCount: number;
  myApplicationId: string | null;
  myApplicationStatus: string | null;
}
interface GdHallOrder {
  orderId: string;
  dispatchNo: string;
  orderNo: string;
  durationMinutes: number;
  desiredStartAt: string | null;
  roundClosesAt: string | null;
  lines: GdHallLine[];
}
interface GdApplication {
  applicationId: string;
  orderId: string;
  dispatchNo: string;
  orderNo: string;
  orderStatus: string;
  lineId: string;
  positionLabel: string;
  status: string;
  createdAt: string;
  slotId: string | null;
  canWithdraw: boolean;
}
type HallView = "hall" | "service" | "applications";

const APPLICATION_STATUS: Record<string, string> = {
  APPLIED: "报名待选",
  SELECTED: "已被选",
  EXPIRED: "已结束",
  WITHDRAWN: "已撤销",
};

/** 报单状态（设计规格 §3.3）：未报单 / 待客服审批 / 已通过 / 已驳回。 */
const REPORT_STATUS: Record<string, string> = {
  NOT_REPORTED: "待报单",
  PENDING_REVIEW: "待客服审批",
  APPROVED: "已审批",
  REJECTED: "已驳回，可重新报单",
};

/** game-dispatch 报名状态（设计规格 §3.5）。 */
const GD_APPLICATION_STATUS: Record<string, string> = {
  APPLIED: "报名待选",
  SELECTED: "已被选中",
  RELEASED: "名额已释放",
  WITHDRAWN: "已取消报名",
  REJECTED: "已被门店移除",
  EXPIRED: "已失效",
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
  const [gdHall, setGdHall] = useState<GdHallOrder[]>([]);
  const [gdMine, setGdMine] = useState<GdApplication[]>([]);
  const [sessions, setSessions] = useState<Record<string, SessionView>>({});
  const [reportSlots, setReportSlots] = useState<
    Record<string, ServiceSlotView[]>
  >({});
  const [minutesDraft, setMinutesDraft] = useState<Record<string, string>>({});
  const [reportShots, setReportShots] = useState<
    Record<string, { start: boolean; end: boolean }>
  >({});
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
      // 算价模型 Task 4：game-dispatch 主线的大厅与我的报名（报名/取消/服务都挂在这里）。
      const [gdHallOrders, gdApplications] = await Promise.all([
        apiAdapter
          .request<GdHallOrder[]>("/api/v1/tenant/game-dispatch/player/hall", {
            token: accessToken,
          })
          .catch(() => [] as GdHallOrder[]),
        apiAdapter
          .request<GdApplication[]>(
            "/api/v1/tenant/game-dispatch/player/applications",
            { token: accessToken },
          )
          .catch(() => [] as GdApplication[]),
      ]);
      setHall(availableOrders);
      setMine(applications);
      setGdHall(gdHallOrders);
      setGdMine(gdApplications);
      const next: Record<string, SessionView> = {};
      const nextSlots: Record<string, ServiceSlotView[]> = {};
      const slotOrderIds: string[] = [];
      for (const application of applications) {
        if (application.status !== "SELECTED") continue;
        slotOrderIds.push(application.orderId);
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
      for (const application of gdApplications) {
        if (application.slotId) slotOrderIds.push(application.orderId);
      }
      // 报单与开始/结束服务挂在 game-dispatch 档位上；经典流程订单这里会返回空数组。
      for (const orderId of Array.from(new Set(slotOrderIds))) {
        try {
          const slotsView = await apiAdapter.request<ServiceSlotsView>(
            `/api/v1/tenant/game-dispatch/player/orders/${orderId}/service-slots`,
            { token: accessToken },
          );
          nextSlots[orderId] = slotsView.slots;
        } catch {
          nextSlots[orderId] = [];
        }
      }
      setSessions(next);
      setReportSlots(nextSlots);
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

  /**
   * 报单截图（设计规格 §3.3 / §9 第 4-5 条）：复用既有证据通道，
   * 用 evidenceType 区分报单的开始/结束截图，供客服审批时人工核查。
   */
  const uploadReportShot = async (
    slotId: string,
    kind: "REPORT_START" | "REPORT_END",
  ) => {
    if (!token) return;
    setBusy(true);
    setMsg(null);
    try {
      const evidence = await mediaAdapter.chooseEvidence({ capture: true });
      await apiAdapter.uploadBytes(
        `/api/v1/tenant/game-dispatch/slots/${slotId}/session/evidence?evidenceType=${kind}`,
        token,
        evidence.name,
        evidence.bytes,
      );
      setReportShots((prev) => {
        const current = prev[slotId] ?? { start: false, end: false };
        return {
          ...prev,
          [slotId]:
            kind === "REPORT_START"
              ? { ...current, start: true }
              : { ...current, end: true },
        };
      });
      setMsg(kind === "REPORT_START" ? "开始截图已上传。" : "结束截图已上传。");
    } catch (error) {
      setMsg(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  /** 提交报单：申报总时长（15–1440 分钟）；金额由客服审批后按核定分钟数产生。 */
  const submitReport = async (slotId: string) => {
    if (!token) return;
    const minutes = Number(minutesDraft[slotId] ?? "");
    if (!Number.isInteger(minutes) || minutes < 15 || minutes > 1440) {
      setMsg("申报时长需为 15–1440 分钟。");
      return;
    }
    setBusy(true);
    setMsg(null);
    try {
      await apiAdapter.request(
        `/api/v1/tenant/game-dispatch/slots/${slotId}/report`,
        { method: "POST", token, body: { declaredDurationMinutes: minutes } },
      );
      setMsg("报单已提交，等待客服审批。");
      setMinutesDraft((prev) => ({ ...prev, [slotId]: "" }));
      setReportShots((prev) => ({
        ...prev,
        [slotId]: { start: false, end: false },
      }));
      await load(token);
    } catch (error) {
      setMsg(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  /** game-dispatch 报名（Task 4 / 设计规格 §3.5）：未选中前可自由报名。 */
  const applyGd = async (orderId: string, lineId: string) => {
    if (!token) return;
    setBusy(true);
    setMsg(null);
    try {
      await apiAdapter.request(
        `/api/v1/tenant/game-dispatch/orders/${orderId}/lines/${lineId}/applications`,
        { method: "POST", token, body: {} },
      );
      setMsg("报名已提交，等待门店选人。");
      await load(token);
    } catch (error) {
      setMsg(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  /** 取消报名：选中锁定后服务端返回 409（APPLICATION_LOCKED），需门店释放名额。 */
  const withdrawGd = async (applicationId: string) => {
    if (!token) return;
    setBusy(true);
    setMsg(null);
    try {
      await apiAdapter.request(
        `/api/v1/tenant/game-dispatch/applications/${applicationId}/withdraw`,
        { method: "POST", token, body: {} },
      );
      setMsg("已取消报名。");
      await load(token);
    } catch (error) {
      setMsg(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  /** 开始服务：开始后立刻上传开始证据（既有证据通道，用途 START）。 */
  const startGdSession = async (slotId: string) => {
    if (!token) return;
    setBusy(true);
    setMsg(null);
    try {
      await apiAdapter.request(
        `/api/v1/tenant/game-dispatch/slots/${slotId}/session/start`,
        { method: "POST", token, body: {} },
      );
      const evidence = await mediaAdapter.chooseEvidence({ capture: true });
      await apiAdapter.uploadBytes(
        `/api/v1/tenant/game-dispatch/slots/${slotId}/session/evidence?evidenceType=START`,
        token,
        evidence.name,
        evidence.bytes,
      );
      setMsg("服务已开始，开始证据已保存。");
      await load(token);
    } catch (error) {
      setMsg(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  /** 结束服务：先上传结束证据再结束；金额在报单审批后产生（Task 3）。 */
  const endGdSession = async (slotId: string) => {
    if (!token) return;
    setBusy(true);
    setMsg(null);
    try {
      const evidence = await mediaAdapter.chooseEvidence({ capture: true });
      await apiAdapter.uploadBytes(
        `/api/v1/tenant/game-dispatch/slots/${slotId}/session/evidence?evidenceType=END`,
        token,
        evidence.name,
        evidence.bytes,
      );
      await apiAdapter.request(
        `/api/v1/tenant/game-dispatch/slots/${slotId}/session/end`,
        { method: "POST", token, body: {} },
      );
      setMsg("服务已结束，请填写报单申报时长。");
      await load(token);
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
            msg.startsWith("证据已") ||
            msg.startsWith("开始截图已") ||
            msg.startsWith("结束截图已") ||
            msg.startsWith("报单已提交") ||
            msg.startsWith("报名已提交") ||
            msg.startsWith("已取消报名") ||
            msg.startsWith("服务已")
              ? "success"
              : "error"
          }
        >
          {msg}
        </PlayerMessage>
      ) : null}

      {token && view === "hall" ? (
        <>
          <View className="pw-stat-card hall-command-card">
            <View className="hall-command-label">
              <View className="hall-live-dot" />
              <Text className="pw-stat-label">MATCH STRIP · 今日大厅</Text>
            </View>
            <View className="hall-command-main">
              <Text className="pw-stat-value">{hall.length}</Text>
              <Text className="hall-command-unit">单可接</Text>
            </View>
            <Text className="pw-stat-note">
              大厅自动同步门店订单，报名权限由门店配置决定
            </Text>
          </View>
          {hall.length === 0 ? (
            <View className="hall-empty-state">
              <View className="hall-empty-mark">
                <View />
              </View>
              <Text className="hall-empty-title">当前没有新订单</Text>
              <Text className="hall-empty-copy">
                大厅会自动同步，保持可接单状态即可
              </Text>
            </View>
          ) : null}
          {hall.map((order) => (
            <View key={order.id} className="pw-card hall-order-card">
              <View className="hall-match-strip">
                <Text>NEW MATCH</Text>
                <Text>{formatDateTime(order.desiredStartAt)}</Text>
              </View>
              <View className="hall-order-heading">
                <Text className="pw-card-title">{order.productName}</Text>
                <Text className="hall-order-no">#{order.orderNo}</Text>
              </View>
              <View className="hall-order-meta">
                <Text className="pw-muted">
                  服务时长 · {Math.floor(order.durationSeconds / 60)} 分钟
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
          {gdHall.length ? (
            <View className="hall-gd-section">
              <Text className="hall-report-title">
                游戏派单 · 可报名（选中前可自助取消）
              </Text>
              {gdHall.map((order) => (
                <View key={order.orderId} className="pw-card hall-order-card">
                  <View className="hall-match-strip">
                    <Text>GAME DISPATCH</Text>
                    <Text>{formatDateTime(order.desiredStartAt)}</Text>
                  </View>
                  <View className="hall-order-heading">
                    <Text className="pw-card-title">
                      派单 #{order.dispatchNo}
                    </Text>
                    <Text className="hall-order-no">#{order.orderNo}</Text>
                  </View>
                  <Text className="pw-muted">
                    服务时长 · {order.durationMinutes} 分钟 · 报名截止{" "}
                    {formatDateTime(order.roundClosesAt)}
                  </Text>
                  {order.lines.map((line) => (
                    <View
                      key={line.lineId}
                      className="pw-row-between hall-gd-line"
                    >
                      <View className="pw-row-copy">
                        <Text className="pw-card-title">
                          {line.positionLabel}
                        </Text>
                        <Text className="pw-muted">
                          已报名 {line.appliedCount} / 需要 {line.requiredCount}
                          {line.myApplicationStatus === "APPLIED"
                            ? " · 我已报名"
                            : ""}
                        </Text>
                      </View>
                      <Button
                        className="pw-button pw-button-small pw-button-soft"
                        disabled={
                          busy || line.myApplicationStatus === "APPLIED"
                        }
                        onClick={() => void applyGd(order.orderId, line.lineId)}
                      >
                        {line.myApplicationStatus === "APPLIED"
                          ? "已报名"
                          : "报名"}
                      </Button>
                    </View>
                  ))}
                </View>
              ))}
            </View>
          ) : null}
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
                {(reportSlots[application.orderId] ?? []).length ? (
                  <View className="hall-report">
                    <Text className="hall-report-title">
                      报单 · 申报总时长 + 开始/结束截图
                    </Text>
                    {(reportSlots[application.orderId] ?? []).map((slot) => {
                      const report = slot.session;
                      const reportStatus =
                        report?.reportStatus ?? "NOT_REPORTED";
                      const shots = reportShots[slot.orderSlotId] ?? {
                        start: false,
                        end: false,
                      };
                      const ended = report?.status === "ENDED";
                      const editable =
                        ended &&
                        (reportStatus === "NOT_REPORTED" ||
                          reportStatus === "REJECTED");
                      return (
                        <View
                          key={slot.orderSlotId}
                          className="hall-report-row"
                        >
                          <View className="pw-row-between">
                            <Text className="pw-card-title">
                              {slot.positionLabel}
                            </Text>
                            <Text className="pw-badge pw-badge-wait">
                              {REPORT_STATUS[reportStatus] ?? reportStatus}
                            </Text>
                          </View>
                          <Text className="pw-muted">
                            单价 {formatFenYuan(slot.unitPriceFen)} / 小时
                            {typeof report?.durationSeconds === "number"
                              ? ` · 证据计时 ${Math.floor(report.durationSeconds / 60)} 分钟（仅作对照）`
                              : ""}
                          </Text>
                          {reportStatus === "APPROVED" ? (
                            <Text className="pw-stat-value">
                              核定 {report?.declaredDurationMinutes ?? 0} 分钟 ·
                              实收 {formatFenYuan(report?.earningFen ?? "0")}
                            </Text>
                          ) : null}
                          {reportStatus === "PENDING_REVIEW" ? (
                            <Text className="pw-muted">
                              已申报 {report?.declaredDurationMinutes ?? 0}{" "}
                              分钟，等待客服审批。
                            </Text>
                          ) : null}
                          {reportStatus === "REJECTED" &&
                          report?.reportReviewNote ? (
                            <Text className="pw-muted">
                              驳回原因：{report.reportReviewNote}
                            </Text>
                          ) : null}
                          {!ended ? (
                            <Text className="pw-muted">
                              结束服务后可提交报单。
                            </Text>
                          ) : null}
                          {editable ? (
                            <>
                              <Input
                                className="pw-input"
                                type="number"
                                placeholder="总时长（分钟，15–1440）"
                                value={minutesDraft[slot.orderSlotId] ?? ""}
                                onInput={(event) =>
                                  setMinutesDraft((prev) => ({
                                    ...prev,
                                    [slot.orderSlotId]: event.detail.value,
                                  }))
                                }
                              />
                              <View className="hall-session-actions">
                                <Button
                                  className={`pw-button pw-button-small ${shots.start ? "pw-button-dark" : "pw-button-plain"}`}
                                  disabled={busy}
                                  onClick={() =>
                                    void uploadReportShot(
                                      slot.orderSlotId,
                                      "REPORT_START",
                                    )
                                  }
                                >
                                  {shots.start
                                    ? "开始截图已传"
                                    : "上传开始截图"}
                                </Button>
                                <Button
                                  className={`pw-button pw-button-small ${shots.end ? "pw-button-dark" : "pw-button-plain"}`}
                                  disabled={busy}
                                  onClick={() =>
                                    void uploadReportShot(
                                      slot.orderSlotId,
                                      "REPORT_END",
                                    )
                                  }
                                >
                                  {shots.end ? "结束截图已传" : "上传结束截图"}
                                </Button>
                              </View>
                              <Button
                                className="pw-button pw-button-primary"
                                disabled={busy || !shots.start || !shots.end}
                                onClick={() =>
                                  void submitReport(slot.orderSlotId)
                                }
                              >
                                提交报单
                              </Button>
                            </>
                          ) : null}
                        </View>
                      );
                    })}
                  </View>
                ) : null}
              </View>
            );
          })}
          {gdMine
            .filter((application) => application.slotId !== null)
            .map((application) => {
              const slot = (reportSlots[application.orderId] ?? []).find(
                (item) => item.orderSlotId === application.slotId,
              );
              const session = slot?.session ?? null;
              const reportStatus = session?.reportStatus ?? "NOT_REPORTED";
              const shots = reportShots[application.slotId ?? ""] ?? {
                start: false,
                end: false,
              };
              const running = session?.status === "STARTED";
              const ended = session?.status === "ENDED";
              const editable =
                ended &&
                (reportStatus === "NOT_REPORTED" ||
                  reportStatus === "REJECTED");
              return (
                <View key={application.applicationId} className="pw-card">
                  <View className="pw-row-between">
                    <View className="pw-row-copy">
                      <Text className="pw-card-title">
                        {application.positionLabel} · 派单 #
                        {application.dispatchNo}
                      </Text>
                      <Text className="pw-muted">
                        {running
                          ? "服务进行中，请上传证据后结束"
                          : ended
                            ? "服务已结束，请提交报单"
                            : "待开始服务"}
                      </Text>
                    </View>
                    <Text
                      className={`pw-badge ${running ? "pw-badge-live" : "pw-badge-wait"}`}
                    >
                      {ended
                        ? (REPORT_STATUS[reportStatus] ?? reportStatus)
                        : running
                          ? "进行中"
                          : "待开始"}
                    </Text>
                  </View>
                  {slot ? (
                    <Text className="pw-muted">
                      单价 {formatFenYuan(slot.unitPriceFen)} / 小时
                      {typeof session?.durationSeconds === "number"
                        ? ` · 证据计时 ${Math.floor(session.durationSeconds / 60)} 分钟（仅作对照）`
                        : ""}
                    </Text>
                  ) : null}
                  <View className="hall-session-actions">
                    {!running && !ended && application.slotId ? (
                      <Button
                        className="pw-button pw-button-primary"
                        disabled={busy}
                        onClick={() =>
                          void startGdSession(application.slotId as string)
                        }
                      >
                        开始服务（拍照留证）
                      </Button>
                    ) : null}
                    {running && application.slotId ? (
                      <Button
                        className="pw-button pw-button-plain"
                        disabled={busy}
                        onClick={() =>
                          void endGdSession(application.slotId as string)
                        }
                      >
                        结束服务（先拍照/录像）
                      </Button>
                    ) : null}
                  </View>
                  {reportStatus === "PENDING_REVIEW" ? (
                    <Text className="pw-muted">
                      已申报 {session?.declaredDurationMinutes ?? 0}{" "}
                      分钟，等待客服审批。
                    </Text>
                  ) : null}
                  {reportStatus === "APPROVED" ? (
                    <Text className="pw-stat-value">
                      核定 {session?.declaredDurationMinutes ?? 0} 分钟 · 实收{" "}
                      {formatFenYuan(session?.earningFen ?? "0")}
                    </Text>
                  ) : null}
                  {reportStatus === "REJECTED" && session?.reportReviewNote ? (
                    <Text className="pw-muted">
                      驳回原因：{session.reportReviewNote}
                    </Text>
                  ) : null}
                  {editable && application.slotId ? (
                    <>
                      <Input
                        className="pw-input"
                        type="number"
                        placeholder="总时长（分钟，15–1440）"
                        value={minutesDraft[application.slotId] ?? ""}
                        onInput={(event) =>
                          setMinutesDraft((prev) => ({
                            ...prev,
                            [application.slotId as string]: event.detail.value,
                          }))
                        }
                      />
                      <View className="hall-session-actions">
                        <Button
                          className={`pw-button pw-button-small ${shots.start ? "pw-button-dark" : "pw-button-plain"}`}
                          disabled={busy}
                          onClick={() =>
                            void uploadReportShot(
                              application.slotId as string,
                              "REPORT_START",
                            )
                          }
                        >
                          {shots.start ? "开始截图已传" : "上传开始截图"}
                        </Button>
                        <Button
                          className={`pw-button pw-button-small ${shots.end ? "pw-button-dark" : "pw-button-plain"}`}
                          disabled={busy}
                          onClick={() =>
                            void uploadReportShot(
                              application.slotId as string,
                              "REPORT_END",
                            )
                          }
                        >
                          {shots.end ? "结束截图已传" : "上传结束截图"}
                        </Button>
                      </View>
                      <Button
                        className="pw-button pw-button-primary"
                        disabled={busy || !shots.start || !shots.end}
                        onClick={() =>
                          void submitReport(application.slotId as string)
                        }
                      >
                        提交报单
                      </Button>
                    </>
                  ) : null}
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
          {gdMine.length ? (
            <>
              <Text className="hall-report-title">游戏派单 · 我的报名</Text>
              {gdMine.map((application) => (
                <View key={application.applicationId} className="pw-card">
                  <View className="pw-row-between">
                    <View className="pw-row-copy">
                      <Text className="pw-card-title">
                        {application.positionLabel} · 派单 #
                        {application.dispatchNo}
                      </Text>
                      <Text className="pw-muted">
                        报名于 {formatDateTime(application.createdAt)}
                      </Text>
                    </View>
                    <Text
                      className={`pw-badge ${application.status === "SELECTED" ? "pw-badge-live" : "pw-badge-wait"}`}
                    >
                      {GD_APPLICATION_STATUS[application.status] ??
                        application.status}
                    </Text>
                  </View>
                  {application.status === "SELECTED" &&
                  application.slotId === null ? (
                    <Text className="pw-muted">
                      已被选中但档位不存在，请联系门店确认。
                    </Text>
                  ) : null}
                  {application.status === "SELECTED" && application.slotId ? (
                    <Button
                      className="pw-button pw-button-small pw-button-dark"
                      onClick={() => setView("service")}
                    >
                      查看场次
                    </Button>
                  ) : null}
                  {application.status === "APPLIED" ? (
                    <>
                      <Button
                        className="pw-button pw-button-small pw-button-plain"
                        disabled={busy || !application.canWithdraw}
                        onClick={() =>
                          void withdrawGd(application.applicationId)
                        }
                      >
                        取消报名
                      </Button>
                      {!application.canWithdraw ? (
                        <Text className="pw-muted">
                          已被选中锁定，如需取消请联系门店释放名额。
                        </Text>
                      ) : null}
                    </>
                  ) : null}
                </View>
              ))}
            </>
          ) : null}
        </View>
      ) : null}
    </PlayerPage>
  );
}
