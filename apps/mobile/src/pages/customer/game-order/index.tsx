import { Button, Input, Text, View } from "@tarojs/components";
import { useLoad } from "@tarojs/taro";
import { useState } from "react";
import { apiAdapter } from "@platform-api";
import { session } from "@platform-session";
import {
  CustomerLoginCard,
  CustomerMessage,
  CustomerShell,
  goCustomer,
} from "../../../components/customer-ui";
import {
  customerLogin,
  resolveTenantCode,
} from "../../../features/customer-ui/session";

interface TemplateOption {
  id: string;
  name: string;
}

interface TemplateDetail {
  id: string;
  name: string;
  fields: Array<{
    fieldKey: string;
    label: string;
    fieldType: string;
    required: boolean;
    options: string[];
  }>;
  positions: Array<{
    id: string;
    label: string;
    defaultCount: number;
  }>;
}

interface CreatedDraft {
  orderId: string;
  dispatchOrderId: string;
  dispatchNo: string;
}

export default function GameOrderPage() {
  const [token, setToken] = useState<string | null>(session.getToken());
  const [tenantCode, setTenantCode] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [selfEnabled, setSelfEnabled] = useState<boolean | null>(null);
  const [templates, setTemplates] = useState<TemplateOption[]>([]);
  const [detail, setDetail] = useState<TemplateDetail | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [duration, setDuration] = useState("60");
  const [created, setCreated] = useState<CreatedDraft | null>(null);
  const [msg, setMsg] = useState<{
    tone: "error" | "success" | "info";
    text: string;
  } | null>(null);

  const loadTemplates = async (accessToken: string) => {
    setMsg(null);
    try {
      const [list, features] = await Promise.all([
        apiAdapter.request<TemplateOption[]>(
          "/api/v1/tenant/game-dispatch/customer/templates",
          { token: accessToken },
        ),
        apiAdapter.request<Array<{ featureKey: string; enabled: boolean }>>(
          "/api/v1/tenant/features",
          { token: accessToken },
        ),
      ]);
      const enabled = features.find(
        (feature) => feature.featureKey === "addon.customer_self_service",
      )?.enabled;
      setSelfEnabled(enabled !== false);
      setTemplates(list);
    } catch (error) {
      setMsg({
        tone: "error",
        text: error instanceof Error ? error.message : String(error),
      });
      session.clearToken();
      setToken(null);
    }
  };

  useLoad(async () => {
    const accessToken = session.getToken();
    setToken(accessToken);
    if (accessToken) await loadTemplates(accessToken);
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
      await loadTemplates(accessToken);
    } catch (error) {
      setMsg({
        tone: "error",
        text: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setBusy(false);
    }
  };

  const selectTemplate = async (id: string) => {
    if (!token) return;
    setValues({});
    setCounts({});
    setDetail(null);
    setMsg(null);
    try {
      setDetail(
        await apiAdapter.request<TemplateDetail>(
          `/api/v1/tenant/game-dispatch/customer/templates/${id}`,
          { token },
        ),
      );
    } catch (error) {
      setMsg({
        tone: "error",
        text: error instanceof Error ? error.message : String(error),
      });
    }
  };

  const submit = async () => {
    if (!token || !detail) return;
    const formValues: Record<string, string> = {};
    for (const field of detail.fields) {
      if (field.fieldType === "duration") continue;
      const value = values[field.fieldKey]?.trim() ?? "";
      if (field.required && !value) {
        setMsg({ tone: "error", text: `请填写 ${field.label}` });
        return;
      }
      if (value) formValues[field.fieldKey] = value;
    }
    const lines = detail.positions.map((position) => ({
      positionLabel: position.label,
      requiredCount: Math.max(1, counts[position.id] ?? position.defaultCount),
    }));
    setBusy(true);
    setMsg(null);
    try {
      const result = await apiAdapter.request<CreatedDraft>(
        "/api/v1/tenant/game-dispatch/customer/orders",
        {
          method: "POST",
          token,
          body: {
            templateId: detail.id,
            formValues,
            durationMinutes: Number(duration),
            lines,
          },
        },
      );
      setCreated(result);
    } catch (error) {
      setMsg({
        tone: "error",
        text: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <CustomerShell title="自助下单" subtitle="选择服务模板" active="order">
      {!token ? (
        <CustomerLoginCard
          tenantCode={tenantCode}
          username={username}
          password={password}
          busy={busy}
          actionLabel="登录并开始下单"
          onTenantCode={setTenantCode}
          onUsername={setUsername}
          onPassword={setPassword}
          onLogin={() => void login()}
        />
      ) : null}
      {msg ? (
        <CustomerMessage tone={msg.tone}>{msg.text}</CustomerMessage>
      ) : null}
      {created ? (
        <>
          <View className="cu-stat cu-stat-pine">
            <Text className="cu-stat-label">下单成功</Text>
            <Text className="cu-stat-value">{created.dispatchNo}</Text>
            <Text className="cu-stat-note">
              门店确认并发布后，会推送选人链接；钱包需保持余额充足。
            </Text>
          </View>
          <Button
            className="cu-button cu-button-primary cu-button-full"
            onClick={() => goCustomer("/pages/customer/orders/index")}
          >
            查看我的订单
          </Button>
        </>
      ) : null}
      {token && !created && selfEnabled === false ? (
        <>
          <View className="cu-empty">
            这家门店暂未开启老板自助服务，请联系门店客服下单。
          </View>
          <Button
            className="cu-button cu-button-outline cu-button-small cu-button-full"
            onClick={() => goCustomer("/pages/customer/service-off/index")}
          >
            查看未开通说明
          </Button>
        </>
      ) : null}
      {token && selfEnabled && !created ? (
        <>
          {templates.length === 0 ? (
            <View className="cu-empty">
              暂无可用的下单模板，请等待门店配置服务目录。
            </View>
          ) : null}
          <Text className="cu-section-label">选择游戏模板</Text>
          <View className="cu-tabs">
            {templates.map((template) => (
              <Button
                key={template.id}
                className={`cu-tab${detail?.id === template.id ? " is-active" : ""}`}
                onClick={() => void selectTemplate(template.id)}
              >
                {template.name}
              </Button>
            ))}
          </View>
          {detail ? (
            <View className="cu-card">
              <Text className="cu-card-title">{detail.name}</Text>
              <View className="cu-fields">
                {detail.fields
                  .filter((field) => field.fieldType !== "duration")
                  .map((field) => (
                    <View className="cu-field" key={field.fieldKey}>
                      <Text className="cu-label">
                        {field.label}
                        {field.required ? " *" : ""}
                      </Text>
                      <Input
                        className="cu-input"
                        name={field.fieldKey}
                        aria-label={field.label}
                        value={values[field.fieldKey] ?? ""}
                        placeholder={field.options[0] ?? "填写"}
                        onInput={(event) =>
                          setValues({
                            ...values,
                            [field.fieldKey]: event.detail.value,
                          })
                        }
                      />
                    </View>
                  ))}
                <View className="cu-field">
                  <Text className="cu-label">时长（分钟）</Text>
                  <Input
                    className="cu-input"
                    type="number"
                    name="durationMinutes"
                    aria-label="时长（分钟）"
                    value={duration}
                    onInput={(event) => setDuration(event.detail.value)}
                  />
                </View>
                {detail.positions.map((position) => (
                  <View className="cu-field" key={position.id}>
                    <Text className="cu-label">{position.label} 人数</Text>
                    <Input
                      className="cu-input"
                      type="number"
                      name={position.label}
                      aria-label={`${position.label}人数`}
                      value={String(
                        counts[position.id] ?? position.defaultCount,
                      )}
                      onInput={(event) =>
                        setCounts({
                          ...counts,
                          [position.id]: Math.max(
                            1,
                            Number(event.detail.value) || 1,
                          ),
                        })
                      }
                    />
                  </View>
                ))}
              </View>
              <Button
                className={`cu-button cu-button-primary cu-button-full${busy ? " is-disabled" : ""}`}
                style={{ marginTop: 24 }}
                disabled={busy}
                onClick={() => void submit()}
              >
                {busy ? "提交中…" : "提交订单"}
              </Button>
            </View>
          ) : null}
        </>
      ) : null}
    </CustomerShell>
  );
}
