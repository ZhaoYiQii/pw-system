import { Button, Input, Text, View } from "@tarojs/components";
import { useLoad } from "@tarojs/taro";
import { useState } from "react";
import { identityAdapter } from "@platform-identity";
import { session } from "@platform-session";
import { tenantLocator } from "@platform-locator";
import { apiAdapter } from "@platform-api";
import { mediaAdapter } from "@platform-media";
import { formatFenYuan } from "../../../features/money/money";
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

export default function OrderHallPage() {
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

  const loadFeatureGate = async (t: string) => {
    try {
      const feats = await apiAdapter.request<
        Array<{ featureKey: string; enabled: boolean }>
      >("/api/v1/tenant/features", { token: t });
      const enabled = feats.find(
        (f) => f.featureKey === "addon.player_order_hall",
      )?.enabled;
      setHallEnabled(enabled !== false);
      if (enabled === false)
        setMsg("该门店未开通接单大厅 addon，无法报名接单。");
    } catch {
      setHallEnabled(true);
    }
  };

  const load = async (t: string) => {
    try {
      const h = await apiAdapter.request<HallItem[]>(
        "/api/v1/tenant/player/order-hall",
        { token: t },
      );
      const m = await apiAdapter.request<MyApp[]>(
        "/api/v1/tenant/player/applications",
        { token: t },
      );
      setHall(h);
      setMine(m);
      const next: Record<string, SessionView> = {};
      for (const app of m) {
        if (app.status !== "SELECTED") continue;
        try {
          const view = await apiAdapter.request<SessionView>(
            `/api/v1/tenant/orders/${app.orderId}/session`,
            { token: t },
          );
          if (view) next[app.orderId] = view;
        } catch {
          // 未生成场次时跳过，不阻塞大厅加载。
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
    const t = session.getToken();
    setToken(t);
    if (t) {
      await load(t);
      await loadFeatureGate(t);
    }
    const info = await tenantLocator.resolveTenant();
    if (info.state === "ok" && info.tenant?.code)
      setTenantCode(info.tenant.code);
  });

  const login = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const loginInput: {
        kind: "tenant";
        username: string;
        password: string;
        tenantCode?: string;
      } = { kind: "tenant", username, password };
      if (tenantCode) loginInput.tenantCode = tenantCode;
      const s = await identityAdapter.login(loginInput);
      session.setToken(s.accessToken);
      setToken(s.accessToken);
      setPassword("");
      await load(s.accessToken);
      await loadFeatureGate(s.accessToken);
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
      setMsg("报名成功");
      await load(token);
    } catch (error) {
      setMsg(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  const toggleSession = async (orderId: string) => {
    if (!token) return;
    const view = sessions[orderId];
    if (!view) return;
    setBusy(true);
    setMsg(null);
    try {
      const action = view.status === "STARTED" ? "end" : "start";
      await apiAdapter.request(
        `/api/v1/tenant/orders/${orderId}/session/${action}`,
        {
          method: "POST",
          token,
        },
      );
      setMsg(
        action === "start" ? "场次已开始。" : "场次已结束，等待门店核算。",
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

  const logout = () => {
    session.clearToken();
    setToken(null);
    setMsg(null);
  };

  return (
    <View className="page">
      <Text className="title">接单大厅</Text>
      {token === null ? (
        <View className="card">
          <Text className="label">门店 code</Text>
          <Input
            className="input"
            value={tenantCode}
            onInput={(e) => setTenantCode(e.detail.value)}
            placeholder="demo"
          />
          <Text className="label">账号（陪玩）</Text>
          <Input
            className="input"
            value={username}
            onInput={(e) => setUsername(e.detail.value)}
            placeholder="player"
          />
          <Text className="label">密码</Text>
          <Input
            className="input"
            password
            value={password}
            onInput={(e) => setPassword(e.detail.value)}
            placeholder="••••"
          />
          <Button className="btn" disabled={busy} onClick={() => void login()}>
            登录并查看可接订单
          </Button>
          {msg ? <Text className="err">{msg}</Text> : null}
        </View>
      ) : (
        <>
          <View className="row">
            <Text className="label">已登录（可接 {hall.length}）</Text>
            <Button size="mini" onClick={logout}>
              退出
            </Button>
          </View>
          {msg ? <Text className="err">{msg}</Text> : null}
          {hall.length === 0 ? (
            <Text className="muted">暂无派单（可先由商家端发布订单）</Text>
          ) : null}
          {hall.map((o) => (
            <View key={o.id} className="card">
              <Text className="strong">
                {o.productName} · {Math.floor(o.durationSeconds / 60)} 分钟
              </Text>
              <Text className="muted">
                单号 {o.orderNo} · {formatFenYuan(o.unitPriceFen)}
              </Text>
              {o.desiredStartAt ? (
                <Text className="muted">
                  期望开始：{new Date(o.desiredStartAt).toLocaleString()}
                </Text>
              ) : null}
              {hallEnabled ? (
                <Button
                  className="btn primary"
                  disabled={busy}
                  onClick={() => void apply(o.id)}
                >
                  报名
                </Button>
              ) : null}
            </View>
          ))}
          <View className="card">
            <Text className="strong">我的报名</Text>
            {mine.length === 0 ? <Text className="muted">暂无报名</Text> : null}
            {mine.map((m) => (
              <View key={m.id} className="row">
                <View>
                  <Text className="muted">
                    单 {m.orderId.slice(0, 8)}… · 状态：{m.status}
                  </Text>
                  {sessions[m.orderId] ? (
                    <Text className="muted">
                      · 场次：{sessions[m.orderId]?.status}
                    </Text>
                  ) : null}
                </View>
                {m.status === "SELECTED" && sessions[m.orderId] ? (
                  <View className="row-actions">
                    {sessions[m.orderId]?.status === "STARTED" ? (
                      <View
                        style={{
                          display: "flex",
                          flexDirection: "row",
                          gap: 8,
                        }}
                      >
                        <Button
                          size="mini"
                          disabled={busy}
                          onClick={() =>
                            void uploadEvidence(
                              sessions[m.orderId]?.id ?? "",
                              "upload",
                            )
                          }
                        >
                          上传证据
                        </Button>
                        <Button
                          size="mini"
                          disabled={busy}
                          onClick={() =>
                            void uploadEvidence(
                              sessions[m.orderId]?.id ?? "",
                              "capture",
                            )
                          }
                        >
                          拍照/录像
                        </Button>
                      </View>
                    ) : null}
                    <Button
                      size="mini"
                      disabled={busy}
                      onClick={() => void toggleSession(m.orderId)}
                    >
                      {sessions[m.orderId]?.status === "STARTED"
                        ? "结束场次"
                        : "开始场次"}
                    </Button>
                  </View>
                ) : null}
              </View>
            ))}
          </View>
        </>
      )}
    </View>
  );
}
